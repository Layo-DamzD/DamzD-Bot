import test from "node:test";
import assert from "node:assert/strict";

import { calculateExpression } from "../lib/math-expression.js";

test("calculates arithmetic expressions and parentheses", () => {
  assert.equal(calculateExpression("(12 + 8) * 3"), 60);
  assert.equal(calculateExpression("10 / 2 + 7"), 12);
  assert.equal(calculateExpression("2 ^ 3 ^ 2"), 512);
  assert.equal(calculateExpression("17 % 5"), 2);
});

test("rejects invalid expressions, unsupported characters and division by zero", () => {
  assert.throws(() => calculateExpression("1 / 0"), /zero/);
  assert.throws(() => calculateExpression("process.exit()"), /Unsupported character/);
  assert.throws(() => calculateExpression("2 +"), /Expected a number/);
  assert.throws(() => calculateExpression("1 + (2 * 3"), /Invalid math/);
});
