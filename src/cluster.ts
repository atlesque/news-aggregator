// Deduplication by meaning. Every new article is embedded with a multilingual model and joins
// the most similar recent story when the cosine similarity clears the threshold, so "Brand in
// Brugse binnenstad" (HLN) and "Fire in Bruges city centre" (Brussels Times) become one story.

export function normalize(vec: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(vec);
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= len;
  return out;
}

/** Dot product of two unit vectors = cosine similarity. */
export function similarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

export function toBlob(vec: Float32Array): ArrayBuffer {
  return vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength) as ArrayBuffer;
}

/** D1 returns BLOBs as an ArrayBuffer or, in some runtimes, as an array of byte values. */
export function fromBlob(blob: ArrayBuffer | ArrayLike<number> | null): Float32Array | null {
  if (!blob) return null;
  const bytes = blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob as ArrayLike<number>);
  if (bytes.byteLength === 0 || bytes.byteLength % 4) return null;
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export interface Candidate {
  storyId: number;
  vec: Float32Array;
}

export type Assignment = { kind: "existing"; storyId: number } | { kind: "new"; group: number };

/**
 * Greedy single-pass clustering. Each article joins the best existing story or a new group
 * created earlier in this batch; otherwise it starts a new group.
 */
export function assign(items: Float32Array[], existing: Candidate[], threshold: number): Assignment[] {
  const groups: Float32Array[] = [];
  return items.map((vec) => {
    let best: Assignment | null = null;
    let bestSim = threshold;
    for (const c of existing) {
      const s = similarity(vec, c.vec);
      if (s >= bestSim) {
        bestSim = s;
        best = { kind: "existing", storyId: c.storyId };
      }
    }
    groups.forEach((g, i) => {
      const s = similarity(vec, g);
      if (s >= bestSim) {
        bestSim = s;
        best = { kind: "new", group: i };
      }
    });
    if (best) return best;
    groups.push(vec);
    return { kind: "new", group: groups.length - 1 };
  });
}
