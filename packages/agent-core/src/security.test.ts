import test from "node:test";
import assert from "node:assert/strict";
import { isMutatingPython, isMutatingSql } from "./security.js";

test("isMutatingSql identifies write statements", () => {
  assert.equal(isMutatingSql("SELECT * FROM items"), false);
  assert.equal(isMutatingSql("UPDATE items SET name = 'x'"), true);
  assert.equal(isMutatingSql("  delete from items where id = 1"), true);
});

test("isMutatingPython identifies unsafe write patterns", () => {
  assert.equal(isMutatingPython("print('hello')"), false);
  assert.equal(isMutatingPython("open('x.txt', 'w').write('x')"), true);
  assert.equal(isMutatingPython("import subprocess\nsubprocess.run(['ls'])"), true);
});
