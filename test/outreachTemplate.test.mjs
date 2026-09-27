import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMAIL_TEMPLATE,
  PLACEHOLDER_KEYS,
  listUnknownPlaceholders,
  renderEmailTemplate,
} from "../dist/domain/outreach/emailTemplate.js";

const values = {
  company: "Acme Foods",
  country: "Thailand",
  city: "Bangkok",
  commodity: "coconut",
  buyerType: "Importer",
  contactName: "Purchasing",
  ourCompany: "Trade Tools",
};

test("renders every known placeholder", () => {
  const rendered = renderEmailTemplate(
    { subject: "{commodity} for {company}", body: "Hi {contact_name} at {city}, {country}. We are {our_company}, a {buyer_type} partner." },
    values,
  );
  assert.equal(rendered.subject, "coconut for Acme Foods");
  assert.ok(rendered.body.includes("Hi Purchasing at Bangkok, Thailand."));
  assert.ok(rendered.body.includes("Trade Tools"));
});

test("falls back city->country and contact_name->Team", () => {
  const rendered = renderEmailTemplate(
    { subject: "s", body: "{city} | {contact_name}" },
    { company: "c", country: "Thailand", commodity: "x", buyerType: "y" },
  );
  assert.equal(rendered.body, "Thailand | Team");
});

test("leaves unknown placeholders intact and reports them", () => {
  const template = { subject: "Hello {name}", body: "Ref {order_id} for {company}" };
  const rendered = renderEmailTemplate(template, values);
  assert.equal(rendered.subject, "Hello {name}");
  assert.equal(rendered.body, "Ref {order_id} for Acme Foods");
  assert.deepEqual(listUnknownPlaceholders(template), ["name", "order_id"]);
});

test("whitespace inside braces still resolves", () => {
  assert.equal(renderEmailTemplate({ subject: "{ company }", body: "" }, values).subject, "Acme Foods");
});

test("default template has no unknown placeholders", () => {
  assert.deepEqual(listUnknownPlaceholders(DEFAULT_EMAIL_TEMPLATE), []);
  assert.deepEqual(
    [...PLACEHOLDER_KEYS],
    ["company", "country", "city", "commodity", "buyer_type", "contact_name", "our_company"],
  );
});
