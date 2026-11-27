# Diff Two Texts Faster

[![make.fun bounty](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/laithzz21/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/laithzz21/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

Entry for the [make.fun](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) bounty **"Diff two texts faster, 27 November 2026"**: a faster drop-in for make.fun's own makefun-diff 1.0.0 that answers exactly as it does on every case.

## What this does

`solve.js` (Node 22, dependency-free ES module) returns makefun-diff's patch of `{ old, new }` as one JSON string: lines are interned to integer ids once per case, the shared head and tail are trimmed, and Myers's greedy search runs over a packed integer frontier — only the furthest old-line count per diagonal per edit count is kept — with the reference's deletion-wins tie-break. The script is rebuilt by walking the stored frontiers backwards, then grouped into hunks with three lines of context, exactly as makefun-diff 1.0.0 renders them. `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each one alone with `run()`, and writes `/output/answers.json`.

## How to run

```sh
node main.ts
# reads cases.json from $MAKEFUN_INPUT_DIR (or /input)
# writes answers.json to $MAKEFUN_OUTPUT_DIR (or /output)
```

## License

MIT — see [LICENSE](LICENSE).

---

Built for [make.fun](https://make.fun/?ref=5kda0hwb&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) — enter bounties, win rewards.
