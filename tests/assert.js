/**
 * @file assert.js — tiny dependency-free assertion helpers for the Deno test suite.
 *
 * Kept local (instead of importing jsr:@std/assert) so the tests run offline and have no
 * version drift. Each helper throws an Error with a descriptive message on failure.
 */

/** @param {unknown} cond @param {string} [msg] */
export function assert(cond, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}

/**
 * |actual − expected| ≤ tol (absolute), with a readable failure message.
 * @param {number} actual @param {number} expected @param {number} tol @param {string} [msg]
 */
export function assertClose(actual, expected, tol, msg = "") {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(
      `${msg} expected ${expected}, got ${actual} (|diff| = ${
        Math.abs(actual - expected)
      } > tol ${tol})`,
    );
  }
}

/**
 * Relative closeness |actual − expected| ≤ rtol·|expected|.
 * @param {number} actual @param {number} expected @param {number} rtol @param {string} [msg]
 */
export function assertRelClose(actual, expected, rtol, msg = "") {
  const tol = rtol * Math.abs(expected);
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(
      `${msg} expected ${expected}, got ${actual} (rel diff = ${
        Math.abs(actual - expected) / Math.abs(expected)
      } > rtol ${rtol})`,
    );
  }
}

/** Element-wise assertClose for arrays of equal length. */
export function assertVecClose(actual, expected, tol, msg = "") {
  assert(actual.length === expected.length, `${msg} length mismatch`);
  for (let i = 0; i < actual.length; i++) assertClose(actual[i], expected[i], tol, `${msg}[${i}]`);
}

/** Asserts that `fn` throws. */
export function assertThrows(fn, msg = "expected function to throw") {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(msg);
}
