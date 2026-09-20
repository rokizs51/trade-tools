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
