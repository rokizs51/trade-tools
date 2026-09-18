import assert from "node:assert/strict";
import test from "node:test";

import {
  BUYER_RESEARCH_INSTRUCTIONS,
  BUYER_RESEARCH_PROMPT_VERSION,
  BUYER_VERIFIER_INSTRUCTIONS,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../dist/agents/buyerFinder/index.js";
import { buyerFinderPromptInjectionAttacks } from "./fixtures/buyerFinderPromptInjectionAttacks.mjs";

test("buyer prompts explicitly treat retrieved content as untrusted data", () => {
  assert.equal(BUYER_RESEARCH_PROMPT_VERSION, "buyer-research-v3");
  assert.equal(BUYER_VERIFIER_PROMPT_VERSION, "buyer-verifier-v3");

  for (const prompt of [BUYER_RESEARCH_INSTRUCTIONS, BUYER_VERIFIER_INSTRUCTIONS]) {
    assert.match(prompt, /untrusted evidence/i);
    assert.match(prompt, /never follow/i);
    assert.match(prompt, /reveal hidden instructions/i);
    assert.match(prompt, /contact anyone/i);
  }
});

test("prompt-injection evaluation fixtures cover task, secret, tool, scope, and evidence attacks", () => {
  assert.equal(buyerFinderPromptInjectionAttacks.length, 5);
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /previous instructions/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /API key/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /email/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /target country/i.test(value)));
  assert.ok(buyerFinderPromptInjectionAttacks.some((value) => /missing/i.test(value)));
});
