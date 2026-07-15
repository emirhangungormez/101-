import {
  PAIRS_COLUMNS,
  SERIES_COLUMNS,
  TABLE_ROWS,
  resolveTile,
  validatePair,
  validateSeriesGroup,
} from "../shared/okey-rules.js";

function combinations(items, size, start = 0, picked = [], output = []) {
  if (picked.length === size) {
    output.push([...picked]);
    return output;
  }
  for (let i = start; i <= items.length - (size - picked.length); i += 1) {
    picked.push(items[i]);
    combinations(items, size, i + 1, picked, output);
    picked.pop();
  }
  return output;
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

export function seriAdaylari(taslar, gosterge) {
  const unique = new Map();
  for (const size of [3, 4]) {
    for (const group of combinations(taslar, size)) {
      for (const ordered of permutations(group)) {
        const checked = validateSeriesGroup(ordered, gosterge);
        if (!checked.valid) continue;
        const key = ordered
          .map((tile) => String(tile.id))
          .sort()
          .join("|");
        const old = unique.get(key);
        if (!old || old.score < checked.score)
          unique.set(key, { tiles: ordered, score: checked.score });
        break;
      }
    }
  }
  return [...unique.values()];
}

export function ciftAdaylari(taslar, gosterge) {
  return combinations(taslar, 2)
    .filter((tiles) => validatePair(tiles, gosterge).valid)
    .map((tiles) => ({ tiles, score: 0 }));
}

function ayrikGruplar(adaylar, siralama) {
  const kullanilan = new Set();
  const secilen = [];
  for (const aday of [...adaylar].sort(siralama)) {
    if (aday.tiles.some((tile) => kullanilan.has(String(tile.id)))) continue;
    secilen.push(aday);
    aday.tiles.forEach((tile) => kullanilan.add(String(tile.id)));
  }
  return secilen;
}

function enIyiAyrikGruplar(adaylar) {
  const denemeler = [
    (a, b) => b.score - a.score || b.tiles.length - a.tiles.length,
    (a, b) => b.tiles.length - a.tiles.length || b.score - a.score,
    (a, b) => a.tiles.length - b.tiles.length || b.score - a.score,
  ].map((sorter) => ayrikGruplar(adaylar, sorter));
  return denemeler.sort((a, b) => {
    const scoreA = a.reduce((sum, group) => sum + group.score, 0);
    const scoreB = b.reduce((sum, group) => sum + group.score, 0);
    return scoreB - scoreA || b.length - a.length;
  })[0] || [];
}

const key = (row, col) => `${row}:${col}`;
const merkezdenSirala = (length) => {
  const center = Math.floor(length / 2);
  return Array.from({ length }, (_, index) => index).sort(
    (a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b,
  );
};
function gruplariYerlestir(oda, zone, groups) {
  const columns = zone === "pairs" ? PAIRS_COLUMNS : SERIES_COLUMNS;
  const committed = zone === "pairs"
    ? oda.gameState.masaZemini.cift || []
    : oda.gameState.masaZemini.seri || [];
  const occupied = new Set(committed.map((cell) => key(cell.row, cell.col)));
  const occupiedRows = new Set(committed.map((cell) => cell.row));
  const placements = [];
  const rows = merkezdenSirala(TABLE_ROWS);
  for (const group of groups) {
    let placed = false;
    for (const row of rows) {
      if (placed) break;
      if (occupiedRows.has(row)) continue;
      const starts = merkezdenSirala(columns - group.tiles.length + 1);
      for (const col of starts) {
        const beforeFree = col === 0 || !occupied.has(key(row, col - 1));
        const after = col + group.tiles.length;
        const afterFree = after >= columns || !occupied.has(key(row, after));
        const cellsFree = group.tiles.every((_, offset) =>
          !occupied.has(key(row, col + offset)),
        );
        if (!beforeFree || !afterFree || !cellsFree) continue;
        group.tiles.forEach((tile, offset) => {
          placements.push({ zone, row, col: col + offset, tasId: tile.id });
          occupied.add(key(row, col + offset));
        });
        occupiedRows.add(row);
        placed = true;
        break;
      }
    }
    if (!placed) return [];
  }
  return placements;
}

export function botMasaPlani(oda, oyuncu) {
  const indicator = oda.gameState.gosterge;
  const series = enIyiAyrikGruplar(
    seriAdaylari(oyuncu.eldekiTaslar, indicator),
  );
  const pairs = enIyiAyrikGruplar(ciftAdaylari(oyuncu.eldekiTaslar, indicator));
  const seriesScore = series.reduce((sum, group) => sum + group.score, 0);

  if (!oyuncu.acilisTipi) {
    if (seriesScore >= oda.gameState.mevcutBaraj) {
      const placements = gruplariYerlestir(oda, "series", series);
      if (placements.length && placements.length < oyuncu.eldekiTaslar.length)
        return { mode: "series", placements };
    }
    if (pairs.length >= 5) {
      const placements = gruplariYerlestir(oda, "pairs", pairs);
      if (placements.length && placements.length < oyuncu.eldekiTaslar.length)
        return { mode: "pairs", placements };
    }
    return null;
  }

  const mode = oyuncu.acilisTipi === "pairs" ? "pairs" : "series";
  const groups = mode === "pairs" ? pairs : series;
  if (!groups.length) return null;
  const placements = gruplariYerlestir(oda, mode, groups);
  return placements.length && placements.length < oyuncu.eldekiTaslar.length
    ? { mode, placements }
    : null;
}

export function botAtisSec(oyuncu, gosterge) {
  const hand = oyuncu?.eldekiTaslar || [];
  if (!hand.length) return null;
  const usefulness = (tile) => {
    const resolved = resolveTile(tile, gosterge);
    if (resolved.wildcard) return 1000;
    let score = 0;
    for (const other of hand) {
      if (other.id === tile.id) continue;
      const face = resolveTile(other, gosterge);
      if (face.wildcard) score += 4;
      if (face.deger === resolved.deger && face.renk !== resolved.renk) score += 3;
      if (face.renk === resolved.renk && Math.abs(face.deger - resolved.deger) <= 2)
        score += 2;
      if (face.renk === resolved.renk && face.deger === resolved.deger) score += 2;
    }
    return score * 20 - Number(resolved.deger || 0);
  };
  return [...hand].sort((a, b) => usefulness(a) - usefulness(b))[0];
}
