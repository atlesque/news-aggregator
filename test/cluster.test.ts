import assert from "node:assert/strict";
import { test } from "node:test";
import { assign, fromBlob, normalize, toBlob } from "../src/cluster.ts";

test("articles join the most similar story above the threshold", () => {
  const a = normalize([1, 0, 0]);
  const b = normalize([0, 1, 0]);
  const nearA = normalize([0.95, 0.1, 0]);
  const fresh = normalize([0, 0, 1]);
  const freshTwin = normalize([0.05, 0, 1]);
  const out = assign([nearA, fresh, freshTwin], [{ storyId: 1, vec: a }, { storyId: 2, vec: b }], 0.8);
  assert.deepEqual(out, [{ kind: "existing", storyId: 1 }, { kind: "new", group: 0 }, { kind: "new", group: 0 }]);
});

test("embeddings round-trip through a BLOB", () => {
  const v = normalize([3, 4]);
  const back = fromBlob(toBlob(v))!;
  assert.deepEqual([...back], [...v]);
  assert.deepEqual([...fromBlob([...new Uint8Array(toBlob(v))])!], [...v]);
});
