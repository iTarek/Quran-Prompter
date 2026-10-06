import type { CostTable } from "./phonemeCost.js";

/**
 * Global alignment (Needleman-Wunsch) of `heard` onto `ref[from, to)` with
 * traceback. Returns, per heard char, the ref index it was substituted for
 * (matched), or -1 when it was an insertion. Insertion and deletion cost 1,
 * substitution uses the graded table.
 */
export function alignGlobal(
  heard: Uint8Array,
  ref: Uint8Array,
  from: number,
  to: number,
  table: CostTable,
): Int32Array {
  const n = heard.length;
  const m = to - from;
  const w = m + 1;
  // trace: 0 = diagonal (substitute), 1 = up (insert heard), 2 = left (delete ref)
  const trace = new Uint8Array((n + 1) * w);
  let prev = new Float32Array(w);
  let cur = new Float32Array(w);
  for (let j = 0; j <= m; j++) {
    prev[j] = j;
    trace[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    trace[i * w] = 1;
    const h = heard[i - 1];
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + table.costOf(h, ref[from + j - 1]);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      let best = diag;
      let t = 0;
      if (up < best) {
        best = up;
        t = 1;
      }
      if (left < best) {
        best = left;
        t = 2;
      }
      cur[j] = best;
      trace[i * w + j] = t;
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  const assign = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const t = trace[i * w + j];
    if (t === 0 && i > 0 && j > 0) {
      assign[i - 1] = from + j - 1;
      i--;
      j--;
    } else if (t === 1 && i > 0) {
      i--;
    } else if (j > 0) {
      j--;
    } else {
      i--;
    }
  }
  return assign;
}

/** Weighted Levenshtein distance, normalised by the longer of the two. */
export function normalizedDistance(a: Uint8Array, b: Uint8Array, table: CostTable): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  let prev = new Float32Array(b.length + 1);
  let cur = new Float32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const diag = prev[j - 1] + table.costOf(a[i - 1], b[j - 1]);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      cur[j] = diag < up ? (diag < left ? diag : left) : up < left ? up : left;
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}

export interface SemiGlobalResult {
  /** Total alignment cost, including the query-head skip charge. */
  cost: number;
  /** cost / query.length. */
  distance: number;
  /** Ref index (absolute) where the aligned stretch begins. */
  refStart: number;
  /** Ref index (absolute, exclusive) where it ends. */
  refEnd: number;
  /** Query index where the aligned stretch begins (chars before were skipped). */
  queryStart: number;
}

/**
 * Semi-global alignment used to verify a search candidate: the query must be
 * consumed to its end, may start anywhere in `ref[from, to)`, may end
 * anywhere, and may skip a prefix of itself at `headSkipCost` per char
 * (cheaper than a mismatch, dearer than typical garble — so an unalignable
 * استعاذة head is dropped while a garbled Quran stretch is still aligned).
 */
export function alignSemiGlobal(
  query: Uint8Array,
  ref: Uint8Array,
  from: number,
  to: number,
  table: CostTable,
  headSkipCost = 0.5,
): SemiGlobalResult {
  const n = query.length;
  const m = to - from;
  let prev = new Float32Array(m + 1);
  let cur = new Float32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  let prevQ = new Int32Array(m + 1);
  let curQ = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) {
    prev[j] = 0;
    prevStart[j] = j;
    prevQ[j] = 0;
  }
  for (let i = 1; i <= n; i++) {
    const h = query[i - 1];
    // Column 0: nothing of the ref consumed yet — either the query head is
    // being skipped (charged) or inserted before the ref start.
    cur[0] = i * headSkipCost;
    curStart[0] = 0;
    curQ[0] = i;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + table.costOf(h, ref[from + j - 1]);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      // A fresh start at (i, j): skip the query head, begin at ref j.
      const fresh = i * headSkipCost;
      let best = diag;
      let s = prevStart[j - 1];
      let q = prevQ[j - 1];
      if (up < best) {
        best = up;
        s = prevStart[j];
        q = prevQ[j];
      }
      if (left < best) {
        best = left;
        s = curStart[j - 1];
        q = curQ[j - 1];
      }
      if (fresh < best) {
        best = fresh;
        s = j;
        q = i;
      }
      cur[j] = best;
      curStart[j] = s;
      curQ[j] = q;
    }
    let t = prev;
    prev = cur;
    cur = t;
    let ts = prevStart;
    prevStart = curStart;
    curStart = ts;
    let tq = prevQ;
    prevQ = curQ;
    curQ = tq;
  }
  let best = prev[0];
  let bestJ = 0;
  for (let j = 1; j <= m; j++) {
    if (prev[j] < best) {
      best = prev[j];
      bestJ = j;
    }
  }
  return {
    cost: best,
    distance: n === 0 ? 1 : best / n,
    refStart: from + prevStart[bestJ],
    refEnd: from + bestJ,
    queryStart: prevQ[bestJ],
  };
}
