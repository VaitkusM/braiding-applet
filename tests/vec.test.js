import * as V from "../src/core/vec.js";
import { assertClose, assertVecClose } from "./assert.js";

Deno.test("vec: basic algebra", () => {
  const a = [1, 2, 3], b = [-2, 0.5, 4];
  assertVecClose(V.add(a, b), [-1, 2.5, 7], 0);
  assertVecClose(V.sub(a, b), [3, 1.5, -1], 0);
  assertVecClose(V.scale(a, 2), [2, 4, 6], 0);
  assertVecClose(V.addScaled(a, b, 2), [-3, 3, 11], 0);
  assertClose(V.dot(a, b), -2 + 1 + 12, 0);
  assertVecClose(V.lerp(a, b, 0.5), [-0.5, 1.25, 3.5], 1e-15);
});

Deno.test("vec: cross product is right-handed and orthogonal", () => {
  assertVecClose(V.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1], 0);
  const a = [0.3, -1.2, 2], b = [1.1, 0.4, -0.7];
  const c = V.cross(a, b);
  assertClose(V.dot(c, a), 0, 1e-14);
  assertClose(V.dot(c, b), 0, 1e-14);
});

Deno.test("vec: normalize, norm, reject", () => {
  assertClose(V.norm(V.normalize([3, 4, 12])), 1, 1e-15);
  assertVecClose(V.normalize([0, 0, 0]), [0, 0, 0], 0);
  const u = [0, 0, 1];
  assertVecClose(V.rejectFrom([1, 2, 3], u), [1, 2, 0], 0);
  assertClose(V.dist([1, 1, 1], [4, 5, 1]), 5, 1e-15);
});
