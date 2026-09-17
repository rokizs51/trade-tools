import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCanonicalDomain,
  normalizeCompanyName,
  normalizeCountryCode,
  normalizePhone,
  normalizeSourceUrl,
  normalizeWebsiteUrl,
} from "../dist/domain/buyers/index.js";

test("normalizes company names and removes common legal suffixes", () => {
  assert.equal(normalizeCompanyName("  Al-Noor Trading LLC  "), "al noor trading");
  assert.equal(normalizeCompanyName("Nusantara Foods Pte. Ltd."), "nusantara foods");
});

test("normalizes known country names and ISO alpha-2 codes", () => {
  assert.equal(normalizeCountryCode("United Arab Emirates"), "AE");
  assert.equal(normalizeCountryCode(" id "), "ID");
  assert.equal(normalizeCountryCode("Unknown Market"), undefined);
});

test("normalizes websites and extracts canonical domains", () => {
  assert.equal(normalizeWebsiteUrl("WWW.Example.COM/"), "https://www.example.com");
  assert.equal(extractCanonicalDomain("http://www.Example.com/products"), "example.com");
  assert.equal(normalizeWebsiteUrl("ftp://example.com"), undefined);
});

test("removes common tracking parameters from source URLs", () => {
  assert.equal(
    normalizeSourceUrl("https://example.com/buyers?utm_source=test&id=4#section"),
    "https://example.com/buyers?id=4",
  );
});

test("normalizes plausible phone numbers and rejects broken values", () => {
  assert.equal(normalizePhone("+971 (4) 123-4567"), "+97141234567");
  assert.equal(normalizePhone("123"), undefined);
});
