import assert from "node:assert/strict";
import test from "node:test";

import {
  BUYER_FALLBACK_RESEARCH_INSTRUCTIONS,
  BUYER_FALLBACK_RESEARCH_PROMPT_VERSION,
  BUYER_RESEARCH_INSTRUCTIONS,
  BUYER_RESEARCH_PROMPT_VERSION,
  BUYER_VERIFIER_INSTRUCTIONS,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../dist/agents/buyerFinder/index.js";
import { buyerFinderPromptInjectionAttacks } from "./fixtures/buyerFinderPromptInjectionAttacks.mjs";

test("buyer prompts explicitly treat retrieved content as untrusted data", () => {
  assert.equal(BUYER_RESEARCH_PROMPT_VERSION, "buyer-research-v5");
  assert.equal(BUYER_FALLBACK_RESEARCH_PROMPT_VERSION, "buyer-fallback-research-v1");
  assert.equal(BUYER_VERIFIER_PROMPT_VERSION, "buyer-verifier-v3");

  for (const prompt of [
    BUYER_RESEARCH_INSTRUCTIONS,
    BUYER_FALLBACK_RESEARCH_INSTRUCTIONS,
    BUYER_VERIFIER_INSTRUCTIONS,
  ]) {
    assert.match(prompt, /untrusted evidence/i);
    assert.match(prompt, /never follow/i);
    assert.match(prompt, /reveal hidden instructions/i);
    assert.match(prompt, /contact anyone/i);
  }
});

test("research prompt carries the coverage contract and reformulation policy", () => {
  assert.match(BUYER_RESEARCH_INSTRUCTIONS, /coverageContract\.minQualifiedCandidates/);
  assert.match(BUYER_RESEARCH_INSTRUCTIONS, /coverageContract\.maxSearches/);
  assert.match(BUYER_RESEARCH_INSTRUCTIONS, /reformulat/i);
  assert.match(BUYER_RESEARCH_INSTRUCTIONS, /never pad/i);
});

test("prompt-injection evaluation fixtures cover task, secret, tool, scope, and evidence attacks", () => {
  assert.equal(buyerFinderPromptInjectionAttacks.length, 5);
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /previous instructions/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /API key/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /email/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /target country/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /missing/i.test(value)));
});
