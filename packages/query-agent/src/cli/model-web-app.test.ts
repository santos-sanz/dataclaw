import assert from "node:assert/strict";
import test from "node:test";
import { stringifyJsonSafe } from "./model-web-app.js";

test("stringifyJsonSafe serializes safe-range bigint as number", () => {
  const raw = stringifyJsonSafe({ count: BigInt(42) });
  const parsed = JSON.parse(raw) as { count: unknown };

  assert.equal(typeof parsed.count, "number");
  assert.equal(parsed.count, 42);
});

test("stringifyJsonSafe serializes large bigint as string", () => {
  const large = BigInt("9223372036854775807");
  const raw = stringifyJsonSafe({ value: large });
  const parsed = JSON.parse(raw) as { value: unknown };

  assert.equal(typeof parsed.value, "string");
  assert.equal(parsed.value, "9223372036854775807");
});

test("stringifyJsonSafe handles nested bigint values", () => {
  const raw = stringifyJsonSafe({
    rows: [
      { id: BigInt(1), amount: BigInt("9007199254740993") },
    ],
  });

  const parsed = JSON.parse(raw) as { rows: Array<{ id: unknown; amount: unknown }> };
  assert.equal(parsed.rows[0]?.id, 1);
  assert.equal(parsed.rows[0]?.amount, "9007199254740993");
});
