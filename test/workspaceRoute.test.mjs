import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultWorkspaceRoute,
  formatWorkspaceHash,
  parseWorkspaceHash,
} from "../dist/workspaceRoute.js";

const routes = [
  ["#/costing/calculator", { tool: "costing", subview: "calculator" }],
  ["#/costing/saved", { tool: "costing", subview: "saved" }],
  ["#/costing/archived", { tool: "costing", subview: "archived" }],
  ["#/load/calculator", { tool: "load", subview: "calculator" }],
  ["#/load/saved", { tool: "load", subview: "saved" }],
  ["#/load/archived", { tool: "load", subview: "archived" }],
  ["#/buyer/search", { tool: "buyer", subview: "calculator" }],
  ["#/buyer/history", { tool: "buyer", subview: "saved" }],
  ["#/buyer/saved-buyers", { tool: "buyer", subview: "archived" }],
];

test("workspace routes round-trip every tool and subview", () => {
  for (const [hash, route] of routes) {
    assert.deepEqual(parseWorkspaceHash(hash), route);
    assert.equal(formatWorkspaceHash(route), hash);
  }
});

test("workspace routes tolerate a missing hash prefix and surrounding slashes", () => {
  assert.deepEqual(parseWorkspaceHash("/load/saved/"), {
    tool: "load",
    subview: "saved",
  });
});

test("unknown and empty workspace routes fall back through an undefined result", () => {
  assert.equal(parseWorkspaceHash(""), undefined);
  assert.equal(parseWorkspaceHash("#/unknown/page"), undefined);
  assert.deepEqual(defaultWorkspaceRoute, {
    tool: "costing",
    subview: "calculator",
  });
});
