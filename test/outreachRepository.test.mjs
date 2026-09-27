import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresOutreachRepository } from "../scripts/postgresOutreachRepository.mjs";

function createSqlStub(handler) {
  const queries = [];
  function sql(first, ...values) {
    if (!first?.raw) return { type: "value-list", values: first };
    const statement = first.join("?").replace(/\s+/g, " ").trim();
    queries.push({ statement, values });
    return Promise.resolve(handler(statement, values) ?? []);
  }
  return { sql, queries };
}

test("getTemplate returns null when no row exists", async () => {
  const { sql } = createSqlStub(() => []);
  assert.equal(await createPostgresOutreachRepository(sql).getTemplate(), null);
});

test("getTemplate maps the default row", async () => {
  const { sql } = createSqlStub(() => [{ subject: "S", body: "B" }]);
  assert.deepEqual(await createPostgresOutreachRepository(sql).getTemplate(), { subject: "S", body: "B" });
});

test("saveTemplate upserts the single default row", async () => {
  const { sql, queries } = createSqlStub(() => [{ subject: "S", body: "B" }]);
  const saved = await createPostgresOutreachRepository(sql).saveTemplate({ subject: "S", body: "B" }, { now: "2026-09-27T00:00:00.000Z" });
  assert.deepEqual(saved, { subject: "S", body: "B" });
  assert.match(queries[0].statement, /insert into public\.email_templates .* on conflict \(id\) do update/s);
  assert.equal(queries[0].values[0], "S");
});

test("recordSend inserts and returns id+status", async () => {
  const { sql } = createSqlStub(() => [{ id: "send-1", status: "SENT" }]);
  const result = await createPostgresOutreachRepository(sql).recordSend({
    id: "send-1", buyerMatchId: "m1", companyId: "c1", recipientEmail: "a@b.co",
    subject: "s", body: "b", status: "SENT", errorMessage: null, sentAt: "2026-09-27T00:00:00.000Z",
  });
  assert.deepEqual(result, { id: "send-1", status: "SENT" });
});

test("countRecentSends returns the integer count", async () => {
  const { sql } = createSqlStub(() => [{ count: 3 }]);
  assert.equal(await createPostgresOutreachRepository(sql).countRecentSends("2026-09-26T00:00:00.000Z"), 3);
});

test("listSummaries groups by company with SENT-only metrics", async () => {
  const { sql } = createSqlStub(() => [
    { company_id: "c1", sent_count: 2, last_sent_at: new Date("2026-09-27T01:00:00.000Z") },
    { company_id: "c2", sent_count: 0, last_sent_at: null },
  ]);
  assert.deepEqual(await createPostgresOutreachRepository(sql).listSummaries(), {
    c1: { sentCount: 2, lastSentAt: "2026-09-27T01:00:00.000Z" },
    c2: { sentCount: 0, lastSentAt: null },
  });
});
