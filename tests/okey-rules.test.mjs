import test from "node:test";
import assert from "node:assert/strict";
import {
  nextBarrier,
  previewOpening,
  resolveTile,
  validatePair,
  validateSeriesGroup,
} from "../shared/okey-rules.js";

const indicator = { renk: "kirmizi", deger: 5 };
const tile = (id, renk, deger) => ({ id, renk, deger });

test("validates runs and rejects 12-13-1", () => {
  assert.equal(
    validateSeriesGroup(
      [tile(1, "mavi", 4), tile(2, "mavi", 5), tile(3, "mavi", 6)],
      indicator,
    ).valid,
    true,
  );
  assert.equal(
    validateSeriesGroup(
      [tile(1, "mavi", 12), tile(2, "mavi", 13), tile(3, "mavi", 1)],
      indicator,
    ).valid,
    false,
  );
});

test("validates same-number sets with distinct colors", () => {
  assert.equal(
    validateSeriesGroup(
      [tile(1, "mavi", 8), tile(2, "siyah", 8), tile(3, "sari", 8)],
      indicator,
    ).valid,
    true,
  );
  assert.equal(
    validateSeriesGroup(
      [tile(1, "mavi", 8), tile(2, "mavi", 8), tile(3, "sari", 8)],
      indicator,
    ).valid,
    false,
  );
});

test("uses the real okey as wildcard and fake okey as its ordinary face", () => {
  const result = validateSeriesGroup(
    [tile(1, "mavi", 4), tile(2, "kirmizi", 6), tile(3, "mavi", 6)],
    indicator,
  );
  assert.equal(result.valid, true);
  assert.equal(result.score, 15);
  assert.deepEqual(resolveTile(tile(4, "joker", 0), indicator), {
    id: 4,
    renk: "kirmizi",
    deger: 6,
    wildcard: false,
    sahteOkey: true,
  });
});

test("validates physical pairs including wildcard substitution", () => {
  assert.equal(
    validatePair([tile(1, "mavi", 9), tile(2, "mavi", 9)], indicator).valid,
    true,
  );
  assert.equal(
    validatePair([tile(1, "mavi", 9), tile(2, "sari", 9)], indicator).valid,
    false,
  );
  assert.equal(
    validatePair([tile(1, "mavi", 9), tile(2, "kirmizi", 6)], indicator).valid,
    true,
  );
});

test("counts five separated pairs and calculates barriers", () => {
  const placements = [];
  for (let pair = 0; pair < 5; pair += 1) {
    placements.push(
      { row: pair, col: 0, tile: tile(`${pair}-a`, "mavi", pair + 1) },
      { row: pair, col: 1, tile: tile(`${pair}-b`, "mavi", pair + 1) },
    );
  }
  assert.equal(
    previewOpening({ placements, mode: "pairs", indicator }).valid,
    true,
  );
  assert.equal(nextBarrier("sabit", 130, 120), 101);
  assert.equal(nextBarrier("katlamali", 101, 120), 121);
});
