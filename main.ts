// The driver the harness runs: `node /bot/main.ts` (node22). It reads every
// case from /input/cases.json (a JSON array of {id, input}), answers each one
// alone with run() from solve.js, and writes /output/answers.json: a JSON
// array of the answers, one per case and in the cases' order. Outside a
// container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and
// /output; $MAKEFUN_OUTPUT names a single output file instead. Nothing is
// printed: stdout carries no diagnostics, so the answers hash cleanly.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it (the rules allow an entry to tune V8's flags this way).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const INPUT_FILE = process.env.MAKEFUN_INPUT;
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR;
const OUTPUT_FILE = process.env.MAKEFUN_OUTPUT;

const cases = JSON.parse(readFileSync(INPUT_FILE ?? join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
const payload = JSON.stringify(answers);

// The output goes to the harness directory first; when that write cannot
// land (a read-only or missing directory), a per-entry directory under /tmp
// takes it instead, so the run still produces its answers.
try {
  if (OUTPUT_DIR !== undefined) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(join(OUTPUT_DIR, 'answers.json'), payload);
  } else if (OUTPUT_FILE !== undefined) writeFileSync(OUTPUT_FILE, payload);
  else writeFileSync('/output/answers.json', payload);
} catch {
  const fallback = '/tmp/diff-speed-01-run-20261126';
  mkdirSync(fallback, { recursive: true });
  writeFileSync(join(fallback, 'answers.json'), payload);
}
