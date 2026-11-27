// A fast drop-in for makefun-diff 1.0.0.
//
// The job: for { old, new } return makefun-diff's patch as one JSON string.
// The reference (jsdiff-derived) splits each text into lines, trims the shared
// head and tail, then runs Myers's greedy search over what is left, preferring
// a deletion whenever a deletion and an insertion would land on the same
// point, and finally groups the edit script into hunks with three lines of
// context on each side. This module reproduces that answer exactly, but
// replaces the reference's per-step linked-list paths with a packed integer
// frontier: lines are interned to small ids once, and for every edit count d
// only the furthest old-text position reached on each diagonal is kept, in a
// dense typed array (Uint16 when the middle fits, Int32 otherwise). The furthest positions are a function of the texts alone,
// so the frontier is identical to the reference's; the script is then rebuilt
// by walking the stored frontiers backwards, applying the same
// deletion-wins tie-break at every step. No case is cached: every run() call
// builds its own line catalogue from scratch.

/** The patch's first word, and the context lines a hunk keeps around a run. */
const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;

/** Run kinds inside the edit script: a kept line, a deleted line, an inserted line. */
const KEEP = 0;
const DEL = 1;
const INS = 2;

/** How many lines a text holds: one per '\n', plus a final bare line if any. */
function countLines(text) {
  let total = 0;
  let at = -1;
  while ((at = text.indexOf('\n', at + 1)) !== -1) total++;
  if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) total++;
  return total;
}

/**
 * Cut a text into its lines and intern each one. A line keeps its '\n' except
 * for a last line that ends the text without one, so "a\n" and a bare "a" get
 * different ids. The catalogue (map, spellings, hasBreak) is shared by both
 * texts of one call, so the same line in old and new shares its id and a
 * line comparison becomes one integer comparison. ids is filled in place.
 */
function intern(text, map, spellings, hasBreak, ids) {
  let slot = 0;
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    const line = text.slice(start, nl + 1);
    let id = map.get(line);
    if (id === undefined) {
      id = spellings.length;
      map.set(line, id);
      spellings.push(line);
      hasBreak.push(true);
    }
    ids[slot++] = id;
    start = nl + 1;
  }
  if (start < text.length) {
    const line = text.slice(start);
    let id = map.get(line);
    if (id === undefined) {
      id = spellings.length;
      map.set(line, id);
      spellings.push(line);
      hasBreak.push(false);
    }
    ids[slot++] = id;
  }
  return ids;
}

/**
 * The edit script of the middle slices a and b as runs [kind, count], in
 * order, using the reference's greedy Myers search with its tie-break.
 * a and b are the line-id arrays of the two middles; both are non-empty here
 * (the caller handles a middle that is empty on one side).
 *
 * Frontier layout: frontier[d] is a packed Int32Array of length d + 1, slot j
 * holding the furthest old-line count reached on diagonal k = 2j - d (so
 * k runs -d, -d+2, ..., d). A slot holds the "no path" sentinel when no path reached that
 * diagonal. The new-line count on a diagonal is always oldCount - k.
 */
function middleRuns(a, b) {
  const n = a.length;
  const m = b.length;

  // Frontier slots hold old-line counts (0..n), so a Uint16 frontier halves
  // the stored history whenever the middle fits in it, Int32 otherwise.
  const narrow = n < 65535;
  const none = narrow ? 65535 : -1;
  const makeFrontier = (len) => (narrow ? new Uint16Array(len) : new Int32Array(len));

  // d = 0: the snake from the very start, over the lines both middles share.
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  const frontiers = [];
  const first = makeFrontier(1);
  first[0] = head;
  frontiers.push(first);
  if (head === n && head === m) return [[KEEP, head]];

  let depth = 0;
  let endK = 0;
  for (let d = 1; d <= n + m; d++) {
    const prev = frontiers[d - 1];
    const cur = makeFrontier(d + 1);
    let reached = false;
    // k and the insertion bound walk with j: k = 2j - d, and a (d-1) path on
    // diagonal k + 1 may insert while its old count is below m + k + 1.
    let k = -d;
    let insBound = m + k + 1;
    for (let j = 0; j <= d; j++, k += 2, insBound += 2) {
      // The deletion candidate steps one old line past the (d-1) path on
      // diagonal k - 1 (packed slot j - 1); the insertion candidate steps
      // one new line past the (d-1) path on diagonal k + 1 (slot j). A
      // candidate only counts when its text still has a line to consume.
      let afterDel = none;
      if (j > 0) {
        const before = prev[j - 1];
        if (before !== none && before < n) afterDel = before + 1;
      }
      let afterIns = none;
      if (j < d) {
        const before = prev[j];
        if (before !== none && before < insBound) afterIns = before;
      }
      let x;
      if (afterDel !== none && (afterIns === none || afterDel >= afterIns)) x = afterDel;
      else if (afterIns !== none) x = afterIns;
      else {
        cur[j] = none;
        continue;
      }
      // Follow the run of equal lines from the step's landing point.
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      cur[j] = x;
      if (x === n && y === m) {
        depth = d;
        endK = k;
        reached = true;
        break;
      }
    }
    frontiers.push(cur);
    if (reached) break;
  }

  // Walk the stored frontiers backwards from (depth, endK). At each step the
  // predecessor is the one the forward pass picked: the deletion when its
  // landing point is at least the insertion's, the insertion otherwise. The
  // snake after each step is a kept run; the steps themselves are single
  // deleted or inserted lines. Segments are collected last-first into flat
  // typed arrays (kind per step, kept lines after it), not one array each.
  const segKind = new Uint8Array(depth + 1);
  const segKeep = new Int32Array(depth + 1);
  let segCount = 0;
  let k = endK;
  let x = frontiers[depth][(endK + depth) / 2];
  for (let d = depth; d >= 1; d--) {
    const prev = frontiers[d - 1];
    const j = (k + d) / 2;
    let afterDel = none;
    let beforeDel = none;
    if (j > 0) {
      beforeDel = prev[j - 1];
      if (beforeDel !== none && beforeDel < n) afterDel = beforeDel + 1;
    }
    let afterIns = none;
    let beforeIns = none;
    if (j < d) {
      beforeIns = prev[j];
      if (beforeIns !== none && beforeIns - (k + 1) < m) afterIns = beforeIns;
    }
    const takeDel = afterDel !== none && (afterIns === none || afterDel >= afterIns);
    const landing = takeDel ? afterDel : afterIns;
    segKind[segCount] = takeDel ? DEL : INS;
    segKeep[segCount] = x - landing;
    segCount++;
    if (takeDel) {
      k = k - 1;
      x = beforeDel;
    } else {
      k = k + 1;
      x = beforeIns;
    }
  }
  segKind[segCount] = KEEP;
  segKeep[segCount] = x;
  segCount++;

  // Reverse the segments into forward order, merging each step's kept run
  // with its neighbours into plain runs.
  const runs = [];
  for (let s = segCount - 1; s >= 0; s--) {
    const kind = segKind[s];
    const keep = segKeep[s];
    if (kind !== KEEP) runs.push([kind, 1]);
    if (keep > 0) runs.push([KEEP, keep]);
  }
  return runs;
}

/** One patch line: the op, the line, a newline, and '%' when it had none. */
function written(op, line, hasBreak) {
  return hasBreak ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // Intern both texts' lines into shared ids, keeping each line's spelling
  // (for the patch) and whether it ends in a newline.
  const map = new Map();
  const spellings = [];
  const hasBreak = [];
  const a = intern(oldText, map, spellings, hasBreak, new Int32Array(countLines(oldText)));
  const b = intern(newText, map, spellings, hasBreak, new Int32Array(countLines(newText)));
  const n = a.length;
  const m = b.length;

  // The shared head, then the shared tail of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  // The middle's edit script: empty on a side is one run of the other kind.
  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;
  let runs;
  if (midN === 0 && midM === 0) runs = [];
  else if (midN === 0) runs = [[INS, midM]];
  else if (midM === 0) runs = [[DEL, midN]];
  else runs = middleRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix));
  if (prefix > 0) runs.unshift([KEEP, prefix]);
  if (suffix > 0) runs.push([KEEP, suffix]);

  // Group consecutive deletions/insertions into change runs, tracking each
  // run's old/new start and its deleted/inserted counts.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const kind = runs[i][0];
    const count = runs[i][1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // Hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push(written('=', spellings[a[at]], hasBreak[a[at]]));
      for (let t = 0; t < c.dels; t++) out.push(written('-', spellings[a[c.o + t]], hasBreak[a[c.o + t]]));
      for (let t = 0; t < c.ins; t++) out.push(written('+', spellings[b[c.p + t]], hasBreak[b[c.p + t]]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', spellings[a[at]], hasBreak[a[at]]));
  }
  return out.join('');
}
