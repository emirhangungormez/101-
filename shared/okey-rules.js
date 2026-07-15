const COLOR_MAP = {
  red: "kirmizi",
  blue: "mavi",
  black: "siyah",
  yellow: "sari",
  joker: "joker",
};

// Gorunen alan, daha genis bir koordinat duzleminin penceresidir. Oyuncu
// masayi yatay ve dikey kaydirarak perlerini istedigi bos koordinata dizer.
export const SERIES_COLUMNS = 40;
export const PAIRS_COLUMNS = 20;
// Ekranda dokuz satir gorunur; kalan satirlar masa icinde kaydirilarak acilir.
// 20 satir iki masadaki toplam hucre sayisini 2400'den 1200'e indirir.
export const TABLE_ROWS = 20;

const colorOf = (tile) =>
  COLOR_MAP[tile?.renk ?? tile?.color] ?? tile?.renk ?? tile?.color;
const valueOf = (tile) => Number(tile?.deger ?? tile?.value ?? 0);

export function okeyFace(indicator) {
  if (!indicator) return null;
  return {
    renk: colorOf(indicator),
    deger: valueOf(indicator) === 13 ? 1 : valueOf(indicator) + 1,
  };
}

export function resolveTile(tile, indicator) {
  const face = okeyFace(indicator);
  const renk = colorOf(tile);
  const deger = valueOf(tile);
  if (!face) return { ...tile, renk, deger, wildcard: false };
  if (renk === "joker")
    return {
      ...tile,
      renk: face.renk,
      deger: face.deger,
      wildcard: false,
      sahteOkey: true,
    };
  return {
    ...tile,
    renk,
    deger,
    wildcard: renk === face.renk && deger === face.deger,
  };
}

function runCandidate(tiles, indicator) {
  const resolved = tiles.map((tile) => resolveTile(tile, indicator));
  const fixed = resolved.filter((tile) => !tile.wildcard);
  if (tiles.length < 3 || !fixed.length) return null;
  const renk = fixed[0].renk;
  if (fixed.some((tile) => tile.renk !== renk)) return null;
  const candidates = [];
  for (let start = 1; start + tiles.length - 1 <= 13; start += 1) {
    if (
      resolved.every(
        (tile, index) => tile.wildcard || tile.deger === start + index,
      )
    ) {
      const values = resolved.map((_, index) => start + index);
      candidates.push({
        kind: "run",
        score: values.reduce((sum, value) => sum + value, 0),
        assignments: values.map((deger) => ({ renk, deger })),
      });
    }
  }
  // 101'in ozel uc serisi: yalniz tam olarak 11-12-13-1 kabul edilir.
  // Buradaki son 1 acilis puaninda 11 sayilir; 12-13-1 veya
  // 11-12-13-1-2 gibi devamlar gecerli degildir.
  const specialValues = [11, 12, 13, 1];
  if (
    tiles.length === specialValues.length &&
    resolved.every(
      (tile, index) => tile.wildcard || tile.deger === specialValues[index],
    )
  ) {
    candidates.push({
      kind: "run",
      score: 11 + 12 + 13 + 11,
      assignments: specialValues.map((deger) => ({ renk, deger })),
      special: "11-12-13-1",
    });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

function setCandidate(tiles, indicator) {
  if (tiles.length < 3 || tiles.length > 4) return null;
  const resolved = tiles.map((tile) => resolveTile(tile, indicator));
  const fixed = resolved.filter((tile) => !tile.wildcard);
  if (!fixed.length) return null;
  const deger = fixed[0].deger;
  if (fixed.some((tile) => tile.deger !== deger)) return null;
  const colors = fixed.map((tile) => tile.renk);
  if (new Set(colors).size !== colors.length) return null;
  const available = ["kirmizi", "mavi", "siyah", "sari"].filter(
    (renk) => !colors.includes(renk),
  );
  if (available.length < resolved.filter((tile) => tile.wildcard).length)
    return null;
  let wildcardIndex = 0;
  return {
    kind: "set",
    score: deger * tiles.length,
    assignments: resolved.map((tile) =>
      tile.wildcard
        ? { renk: available[wildcardIndex++], deger }
        : { renk: tile.renk, deger },
    ),
  };
}

export function validateSeriesGroup(tiles, indicator) {
  const candidates = [
    runCandidate(tiles, indicator),
    setCandidate(tiles, indicator),
  ]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return candidates[0]
    ? { valid: true, ...candidates[0] }
    : { valid: false, score: 0, assignments: [] };
}

export function validatePair(tiles, indicator) {
  if (!Array.isArray(tiles) || tiles.length !== 2) return { valid: false };
  const [a, b] = tiles.map((tile) => resolveTile(tile, indicator));
  if (a.wildcard && b.wildcard) return { valid: true };
  if (a.wildcard || b.wildcard) return { valid: true };
  return { valid: a.renk === b.renk && a.deger === b.deger };
}

export function groupsFromPlacements(placements, columns) {
  const byRow = new Map();
  for (const placement of placements) {
    const row = Number(placement.row);
    const col = Number(placement.col);
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      col >= columns
    )
      continue;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ ...placement, row, col });
  }
  const groups = [];
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cells = byRow.get(row).sort((a, b) => a.col - b.col);
    let current = [];
    for (const cell of cells) {
      if (current.length && cell.col !== current[current.length - 1].col + 1) {
        groups.push(current);
        current = [];
      }
      current.push(cell);
    }
    if (current.length) groups.push(current);
  }
  return groups;
}

export function previewOpening({
  placements,
  mode,
  indicator,
  threshold = 101,
  pairThreshold = 5,
}) {
  const columns = mode === "pairs" ? PAIRS_COLUMNS : SERIES_COLUMNS;
  const groups = groupsFromPlacements(placements, columns);
  if (!groups.length)
    return { valid: false, score: 0, pairCount: 0, groups: [] };
  if (mode === "pairs") {
    const checked = groups.map((group) =>
      validatePair(
        group.map((cell) => cell.tile),
        indicator,
      ),
    );
    const pairCount = checked.filter((item) => item.valid).length;
    return {
      valid:
        checked.every((item) => item.valid) &&
        pairCount >= Math.max(5, Number(pairThreshold) || 5),
      score: 0,
      pairCount,
      groups,
    };
  }
  const checked = groups.map((group) =>
    validateSeriesGroup(
      group.map((cell) => cell.tile),
      indicator,
    ),
  );
  const score = checked.reduce((sum, item) => sum + item.score, 0);
  return {
    valid: checked.every((item) => item.valid) && score >= threshold,
    score,
    pairCount: 0,
    groups,
    checked,
  };
}

export function nextBarrier(ruleType, current, openingScore) {
  return ruleType === "katlamali"
    ? Math.max(Number(current) || 101, openingScore + 1)
    : 101;
}

export function nextPairBarrier(ruleType, current, openingPairCount) {
  return ruleType === "katlamali"
    ? Math.max(Number(current) || 5, Number(openingPairCount) + 1)
    : 5;
}
