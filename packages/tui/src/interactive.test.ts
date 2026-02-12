import assert from "node:assert/strict";
import test from "node:test";
import { createInteractiveBanner, renderPrompt } from "./interactive.js";
import { buildTheme, resolveThemeContext } from "./theme.js";

const ANSI_PATTERN_GLOBAL = /\u001b\[[0-9;]*m/g;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/;

test("renderPrompt includes dataset badge and yolo state", () => {
  const theme = buildTheme(
    resolveThemeContext({
      compatibility: "unicode",
      isTTY: true,
      columns: 100,
      env: { TERM: "xterm-256color" },
    }),
  );

  const prompt = renderPrompt({ datasetId: "heptapod_titanic", yolo: false }, theme);
  assert.match(prompt, /dataset:heptapod_titanic/);
  assert.match(prompt, /yolo:off/);
});

test("renderPrompt shows yolo:on when enabled and dataset:none when missing", () => {
  const theme = buildTheme(
    resolveThemeContext({
      compatibility: "unicode",
      isTTY: true,
      columns: 90,
      env: { TERM: "xterm-256color" },
    }),
  );

  const prompt = renderPrompt({ datasetId: "", yolo: true }, theme);
  assert.match(prompt, /dataset:none/);
  assert.match(prompt, /yolo:on/);
});

test("ascii compatibility forces ASCII prompt and banner borders", () => {
  const theme = buildTheme(
    resolveThemeContext({
      compatibility: "ascii",
      isTTY: true,
      columns: 80,
      env: { TERM: "xterm-256color" },
    }),
  );

  const prompt = renderPrompt({ datasetId: "sample", yolo: false }, theme);
  const plainPrompt = prompt.replaceAll(ANSI_PATTERN_GLOBAL, "");
  const banner = createInteractiveBanner(theme);

  assert.equal(theme.context.useUnicode, false);
  assert.match(plainPrompt, />\s$/);
  assert.match(banner, /\+/);
});

test("NO_COLOR disables ANSI color output", () => {
  const theme = buildTheme(
    resolveThemeContext({
      compatibility: "unicode",
      isTTY: true,
      columns: 100,
      env: { TERM: "xterm-256color", NO_COLOR: "1" },
    }),
  );

  const prompt = renderPrompt({ datasetId: "sample", yolo: false }, theme);

  assert.equal(theme.context.useColor, false);
  assert.equal(ANSI_PATTERN.test(prompt), false);
});

test("renderPrompt truncates long dataset labels to keep prompt readable", () => {
  const theme = buildTheme(
    resolveThemeContext({
      compatibility: "unicode",
      isTTY: true,
      columns: 50,
      env: { TERM: "xterm-256color" },
    }),
  );

  const prompt = renderPrompt({ datasetId: "very_long_dataset_identifier_with_many_characters", yolo: false }, theme);
  const plainPrompt = prompt.replaceAll(ANSI_PATTERN_GLOBAL, "");

  assert.equal(plainPrompt.includes("..."), true);
  assert.equal(plainPrompt.includes("yolo:off"), true);
});
