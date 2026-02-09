#!/usr/bin/env node
import { createProgram } from "./cli/program.js";

createProgram().parseAsync(process.argv).catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
