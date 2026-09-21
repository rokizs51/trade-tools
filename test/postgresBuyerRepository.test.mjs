import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresBuyerRepository } from "../scripts/postgresBuyerRepository.mjs";

test("Postgres buyer result hydration uses one joined query regardless of result count", async () => {
  const { sql, queries } = createSqlStub({
    matches: [
      createJoinedRow("match-1", "company-1", "source-1", "contact-1", 90),
      createJoinedRow("match-1", "company-1", "source-1", "contact-2", 90),
      createJoinedRow("match-1", "company-1", "source-2", "contact-1", 90),
      createJoinedRow("match-1", "company-1", "source-2", "contact-2", 90),
      createJoinedRow("match-2", "company-2", "source-3", "contact-3", 80),
    ],
  });

  const results = await createPostgresBuyerRepository(sql).getSearchResults("run-1");

  assert.equal(queries.length, 1);
  assert.match(queries[0], /from public\.buyer_matches m/);
  assert.match(queries[0], /left join public\.buyer_sources bs/);
  assert.match(queries[0], /left join public\.buyer_contacts bc/);
  assert.deepEqual(
    results.map((result) => result.sources.map((source) => source.id)),
    [["source-1", "source-2"], ["source-3"]],
  );
  assert.deepEqual(
    results.map((result) => result.contacts.map((contact) => contact.id)),
    [["contact-1", "contact-2"], ["contact-3"]],
  );
});

test("Postgres buyer result hydration skips related queries for an empty result", async () => {
  const { sql, queries } = createSqlStub({ matches: [] });

  assert.deepEqual(await createPostgresBuyerRepository(sql).getSearchResults("run-empty"), []);
  assert.equal(queries.length, 1);
});

test("Postgres buyer detail uses the same single joined query", async () => {
  const { sql, queries } = createSqlStub({
    matches: [createJoinedRow("match-1", "company-1", "source-1", "contact-1", 90)],
  });

  const result = await createPostgresBuyerRepository(sql).getBuyerMatch("match-1");

  assert.equal(result.id, "match-1");
  assert.equal(result.sources.length, 1);
  assert.equal(result.contacts.length, 1);
  assert.equal(queries.length, 1);
});

test("Postgres buyer repository records and lists a bounded safe event timeline", async () => {
  const { sql } = createEventSqlStub();
  const repository = createPostgresBuyerRepository(sql);

  await repository.recordSearchEvent("run-1", {
    level: "WARN",
    eventType: "FALLBACK_STARTED",
    message: "Additional evidence research started.",
    details: { minimumQualified: 3, repairCandidateCount: 2 },
  }, {
    createId: () => "event-1",
    now: "2026-09-21T09:30:00.000Z",
  });

  assert.deepEqual(await repository.listSearchEvents("run-1"), [{
    id: "event-1",
    searchRunId: "run-1",
    level: "WARN",
    eventType: "FALLBACK_STARTED",
    message: "Additional evidence research started.",
    details: { minimumQualified: 3, repairCandidateCount: 2 },
    createdAt: "2026-09-21T09:30:00.000Z",
  }]);
});

test("Postgres buyer repository deletes terminal searches and only prunes unreferenced companies", async () => {
  const { sql, queries } = createDeleteSqlStub();

  const deleted = await createPostgresBuyerRepository(sql).deleteSearchRun("run-1");

  assert.deepEqual(deleted, { id: "run-1", orphanedCompanyCount: 1 });
  assert.ok(queries.some((query) => query.includes("delete from public.buyer_search_runs")));
  assert.ok(queries.some((query) => query.includes("delete from public.buyer_companies company")));
  assert.ok(queries.some((query) => query.includes("not exists ( select 1 from public.buyer_matches")));
});

function createSqlStub(rows) {
  const queries = [];

  function sql(first, ...values) {
    if (!first?.raw) {
      return { type: "value-list", values: first };
    }

    const statement = first.join("?").replace(/\s+/g, " ").trim();
    if (/^m\.(?:id|search_run_id) =/.test(statement)) {
      return { type: "condition", statement, values };
    }

    queries.push(statement);
    if (statement.includes("from public.buyer_matches m")) return Promise.resolve(rows.matches);
    throw new Error(`Unexpected SQL in test: ${statement}`);
  }

  return { sql, queries };
}

function createEventSqlStub() {
  const events = [];

  function sql(first, ...values) {
    if (!first?.raw) return { type: "value-list", values: first };
    const statement = first.join("?").replace(/\s+/g, " ").trim();

    if (statement.startsWith("insert into public.buyer_search_events")) {
      const [id, searchRunId, level, eventType, message, details, createdAt] = values;
      events.push({
        id,
        search_run_id: searchRunId,
        level,
        event_type: eventType,
        message,
        details_json: details,
        created_at: createdAt,
      });
      return Promise.resolve([]);
    }

    if (statement.includes("from public.buyer_search_events")) {
      return Promise.resolve(events);
    }

    throw new Error(`Unexpected SQL in event test: ${statement}`);
  }

  sql.json = (value) => value;
  return { sql, events };
}

function createDeleteSqlStub() {
  const queries = [];
  const searchRun = {
    id: "run-1",
    status: "COMPLETED",
    commodity: "Coconut",
    target_country: "Indonesia",
    target_area: null,
    requested_limit: 3,
    input_json: {},
    plan_json: null,
    model_config_json: {},
    outcome_json: null,
    current_stage: "Completed",
    progress_current: 0,
    progress_total: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: "0",
    error_code: null,
    error_message: null,
    created_at: "2026-09-21T00:00:00.000Z",
    started_at: null,
    completed_at: "2026-09-21T00:01:00.000Z",
    updated_at: "2026-09-21T00:01:00.000Z",
  };

  function sql(first, ...values) {
    if (!first?.raw) return { type: "value-list", values: first };
    const statement = first.join("?").replace(/\s+/g, " ").trim();
    queries.push(statement);
    if (statement.includes("from public.buyer_search_runs") && statement.includes("for update")) {
      return Promise.resolve([searchRun]);
    }
    if (statement.includes("select distinct company_id")) return Promise.resolve([{ company_id: "company-1" }]);
    if (statement.includes("delete from public.buyer_search_runs")) return Promise.resolve([]);
    if (statement.includes("delete from public.buyer_companies company")) return Promise.resolve([{ id: "company-1" }]);
    throw new Error(`Unexpected SQL in delete test: ${statement} (${values.length} values)`);
  }

  sql.begin = async (callback) => callback(sql);
  return { sql, queries };
}

function createMatchRow(id, companyId, confidenceScore) {
  return {
    id,
    search_run_id: "run-1",
    company_id: companyId,
    company_name: `Company ${companyId}`,
    normalized_name: `company ${companyId}`,
    website_url: `https://${companyId}.example`,
    website_domain: `${companyId}.example`,
    country_code: "ID",
    country_name: "Indonesia",
    city: "Jakarta",
    address: null,
    commodity: "Coconut",
    buyer_type: "IMPORTER",
    commodity_relationship: "Imports coconut",
    confidence_score: confidenceScore,
    confidence_level: "HIGH",
    verification_status: "VERIFIED",
    review_status: "NEW",
    rejection_reason: null,
    reviewed_at: null,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
  };
}

function createJoinedRow(matchId, companyId, sourceId, contactId, confidenceScore) {
  return {
    ...createMatchRow(matchId, companyId, confidenceScore),
    source_id: sourceId,
    source_url: `https://evidence.example/${sourceId}`,
    source_normalized_url: `https://evidence.example/${sourceId}`,
    source_title: `Evidence ${sourceId}`,
    source_publisher: "Evidence",
    source_evidence_type: "COMPANY_IDENTITY",
    source_excerpt: "Company evidence",
    source_retrieved_at: "2026-09-20T00:00:00.000Z",
    contact_id: contactId,
    contact_source_id: sourceId,
    contact_type: "EMAIL",
    contact_value: `${companyId}@example.com`,
    contact_label: "Sales",
    is_public_business_contact: true,
    contact_source_url: `https://evidence.example/${sourceId}`,
    contact_created_at: "2026-09-20T00:00:00.000Z",
    contact_updated_at: "2026-09-20T00:00:00.000Z",
  };
}
