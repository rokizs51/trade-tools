import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createOutreachApiHandler } from "../scripts/outreachApi.mjs";
import { DEFAULT_EMAIL_TEMPLATE } from "../dist/domain/outreach/emailTemplate.js";

function makeMatch(overrides = {}) {
  return {
    id: "m1",
    reviewStatus: "APPROVED",
    company: { id: "c1", name: "Acme", countryName: "Thailand" },
    commodity: "coconut",
    buyerType: "IMPORTER",
    contacts: [
      { id: "ct1", type: "EMAIL", value: "buy@acme.test", label: "Purchasing", isPublicBusinessContact: true },
      { id: "ct2", type: "PHONE", value: "+66", isPublicBusinessContact: true },
    ],
    ...overrides,
  };
}

function harness({ match = makeMatch(), mailSender, recentSends = 0, maxSendsPerDay = 50, mailConfigured = true } = {}) {
  const sends = [];
  let template = null;
  const outreachRepository = {
    async getTemplate() { return template; },
    async saveTemplate(t) { template = { ...t }; return { ...t }; },
    async recordSend(s) { sends.push(s); return { id: s.id, status: s.status }; },
    async countRecentSends() { return recentSends; },
    async listSummaries() { return { c1: { sentCount: 1, lastSentAt: "2026-09-27T01:00:00.000Z" } }; },
  };
  const buyerRepository = { async getBuyerMatch(id) { return id === match.id ? match : undefined; } };
  const handler = createOutreachApiHandler({
    outreachRepository,
    buyerRepository,
    mailSender: mailConfigured ? mailSender : null,
    config: { defaultTemplate: DEFAULT_EMAIL_TEMPLATE, ourCompany: "Trade Tools", fromAddress: "team@acme.test", maxSendsPerDay, mailConfigured },
    now: () => "2026-09-27T02:00:00.000Z",
    createId: () => "send-1",
  });
  return { handler, sends, outreachRepository };
}

async function withServer(run, options) {
  const { handler } = harness(options);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!(await handler(request, response, url))) { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))); }
}

async function json(base, path, init) {
  const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...init });
  return { status: response.status, body: await response.json() };
}

test("GET template returns stored template when unset, plus sender metadata", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/template");
    assert.equal(status, 200);
    assert.equal(body.template.subject, DEFAULT_EMAIL_TEMPLATE.subject);
    assert.equal(body.mailConfigured, true);
    assert.equal(body.sender.ourCompany, "Trade Tools");
    assert.ok(body.placeholders.includes("contact_name"));
  }, {});
});

test("PUT template round-trips", async () => {
  await withServer(async (base) => {
    const saved = await json(base, "/api/buyer-outreach/template", { method: "PUT", body: JSON.stringify({ subject: "New {company}", body: "Hi" }) });
    assert.equal(saved.status, 200);
    const got = await json(base, "/api/buyer-outreach/template");
    assert.equal(got.body.template.subject, "New {company}");
  }, {});
});

test("PUT template rejects oversized subject", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/template", { method: "PUT", body: JSON.stringify({ subject: "x".repeat(600), body: "Hi" }) });
    assert.equal(status, 400);
    assert.equal(body.error.code, "INVALID_REQUEST");
  }, {});
});

test("GET summaries returns the per-company map", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/summaries");
    assert.equal(status, 200);
    assert.equal(body.summaries.c1.sentCount, 1);
  }, {});
});

test("POST send succeeds and records a SENT row", async () => {
  const messages = [];
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "Body" }) });
    assert.equal(status, 201);
    assert.equal(body.send.status, "SENT");
  }, { mailSender: { async send(m) { messages.push(m); } } });
  assert.deepEqual(messages[0], { to: "buy@acme.test", subject: "Hi", text: "Body" });
});

test("POST send rejects a non-approved match", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 409);
    assert.equal(body.error.code, "MATCH_NOT_APPROVED");
  }, { match: makeMatch({ reviewStatus: "NEW" }), mailSender: { async send() {} } });
});

test("POST send rejects a contact not belonging to the match", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "nope", subject: "Hi", body: "B" }) });
    assert.equal(status, 409);
    assert.equal(body.error.code, "RECIPIENT_MISMATCH");
  }, { mailSender: { async send() {} } });
});

test("POST send rejects a phone contact id", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct2", subject: "Hi", body: "B" }) });
    assert.equal(status, 409);
    assert.equal(body.error.code, "RECIPIENT_MISMATCH");
  }, { mailSender: { async send() {} } });
});

test("POST send enforces the rolling 24h cap", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 429);
    assert.equal(body.error.code, "DAILY_CAP_REACHED");
  }, { mailSender: { async send() {} }, recentSends: 50, maxSendsPerDay: 50 });
});

test("POST send records FAILED and returns 502 when SMTP throws", async () => {
  const { handler, sends } = harness({ mailSender: { async send() { throw new Error("auth rejected"); } } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    await handler(request, response, url);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { status, body } = await json(`http://127.0.0.1:${server.address().port}`, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
  server.close();
  assert.equal(status, 502);
  assert.equal(body.send.status, "FAILED");
  assert.match(body.error.message, /auth rejected/);
  assert.equal(sends[0].status, "FAILED");
  assert.match(sends[0].errorMessage, /auth rejected/);
});

test("POST send returns 503 when mail is not configured", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 503);
    assert.equal(body.error.code, "MAIL_NOT_CONFIGURED");
  }, { mailConfigured: false });
});

test("POST send returns 404 when the buyer match does not exist", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "ghost", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 404);
    assert.equal(body.error.code, "BUYER_MATCH_NOT_FOUND");
  }, { mailSender: { async send() {} } });
});

test("POST send returns 503 when config claims configured but no sender is present", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 503);
    assert.equal(body.error.code, "MAIL_NOT_CONFIGURED");
  }, { mailSender: undefined });
});
