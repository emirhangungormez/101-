import test from "node:test";
import assert from "node:assert/strict";
import {
  atilanTasIslenebilirMi,
  atilanTasCezaNedeni,
  jokeriDegistir,
  masaHamlesiDogrula,
} from "../server/game.js";

const tile = (id, renk, deger) => ({ id, renk, deger });

function roomWithHand(hand, options = {}) {
  const player = {
    socketId: "player-1",
    kullaniciId: "user-1",
    isim: "Oyuncu",
    koltukNo: 0,
    eldekiTaslar: [...hand],
    cekildiMi: options.drawn ?? true,
    acilisTipi: options.openingType ?? null,
    acilisPuani: 0,
    yandanAlinanTasId: options.sideTileId ?? null,
  };
  return {
    odaId: "test-room",
    maksimum: 2,
    kuralTipi: options.rule ?? "sabit",
    oyuncular: [player],
    koltukPuanlari: [0, 0],
    koltukCezaPuanlari: [0, 0],
    gameState: {
      oyunBasladi: true,
      siradakiOyuncu: options.turn ?? 0,
      gosterge: tile("indicator", "kirmizi", 5),
      mevcutBaraj: options.threshold ?? 101,
      mevcutCiftBaraji: options.pairThreshold ?? 5,
      masaZemini: options.table ?? { seri: [], cift: [] },
    },
  };
}

function seriesOpening() {
  const tiles = [
    ...[10, 11, 12, 13].map((value) => tile(`blue-${value}`, "mavi", value)),
    ...[10, 11, 12, 13].map((value) => tile(`black-${value}`, "siyah", value)),
    ...[3, 4, 5].map((value) => tile(`yellow-${value}`, "sari", value)),
  ];
  const placements = tiles.map((tas, index) => {
    const row = index < 4 ? 0 : index < 8 ? 1 : 2;
    const col = index < 4 ? index : index < 8 ? index - 4 : index - 8;
    return { zone: "series", row, col, tasId: tas.id };
  });
  return { tiles, placements };
}

test("commits a valid series opening and keeps fixed barrier at 101", () => {
  const { tiles, placements } = seriesOpening();
  const room = roomWithHand([...tiles, tile("spare", "sari", 9)]);
  const result = masaHamlesiDogrula(room, "player-1", {
    mode: "series",
    placements,
  });
  assert.equal(result.score, 104);
  assert.equal(room.oyuncular[0].acilisTipi, "series");
  assert.equal(room.oyuncular[0].eldekiTaslar.length, 1);
  assert.equal(room.gameState.masaZemini.seri.length, 11);
  assert.equal(room.gameState.mevcutBaraj, 101);
  assert.deepEqual(
    room.gameState.masaZemini.seri.map(({ row, col }) => ({ row, col })),
    placements.map(({ row, col }) => ({ row, col })),
  );
});

test("raises a folding room barrier to one above the successful opening", () => {
  const { tiles, placements } = seriesOpening();
  const room = roomWithHand(tiles, { rule: "katlamali" });
  masaHamlesiDogrula(room, "player-1", { mode: "series", placements });
  assert.equal(room.gameState.mevcutBaraj, 105);
});

test("rejects out-of-turn and foreign tiles but permits table processing before drawing", () => {
  const { tiles, placements } = seriesOpening();
  assert.throws(
    () =>
      masaHamlesiDogrula(roomWithHand(tiles, { turn: 1 }), "player-1", {
        mode: "series",
        placements,
      }),
    /Sira sizde degil/,
  );
  const beforeDraw = roomWithHand(tiles, { drawn: false });
  masaHamlesiDogrula(beforeDraw, "player-1", {
    mode: "series",
    placements,
  });
  assert.equal(beforeDraw.gameState.masaZemini.seri.length, placements.length);
  const room = roomWithHand(tiles.slice(1));
  assert.throws(
    () =>
      masaHamlesiDogrula(room, "player-1", {
        mode: "series",
        placements,
      }),
    /Taslar elinizde degil/,
  );
  assert.equal(room.gameState.masaZemini.seri.length, 0);
});

test("keeps freely selected table coordinates instead of repacking rows", () => {
  const additions = [7, 8, 9].map((value) =>
    tile(`new-${value}`, "sari", value),
  );
  const room = roomWithHand(additions, { openingType: "series" });
  const placements = additions.map((tas, offset) => ({
    zone: "series",
    row: 15,
    col: 18 + offset,
    tasId: tas.id,
  }));
  masaHamlesiDogrula(room, "player-1", { mode: "series", placements });
  assert.deepEqual(
    room.gameState.masaZemini.seri.map(({ row, col }) => ({ row, col })),
    placements.map(({ row, col }) => ({ row, col })),
  );
});

test("commits five physical pairs and rejects four", () => {
  const tiles = [];
  const placements = [];
  for (let pair = 0; pair < 5; pair += 1) {
    for (let copy = 0; copy < 2; copy += 1) {
      const tas = tile(`pair-${pair}-${copy}`, "mavi", pair + 1);
      tiles.push(tas);
      placements.push({ zone: "pairs", row: pair, col: copy, tasId: tas.id });
    }
  }
  const room = roomWithHand(tiles);
  masaHamlesiDogrula(room, "player-1", { mode: "pairs", placements });
  assert.equal(room.oyuncular[0].acilisTipi, "pairs");
  assert.equal(room.gameState.masaZemini.cift.length, 10);

  const shortRoom = roomWithHand(tiles.slice(0, 8));
  assert.throws(
    () =>
      masaHamlesiDogrula(shortRoom, "player-1", {
        mode: "pairs",
        placements: placements.slice(0, 8),
      }),
    /5 gecerli cift/,
  );
});

test("raises and enforces the folding pair threshold independently", () => {
  const makePairs = (count) => {
    const tiles = [];
    const placements = [];
    for (let pair = 0; pair < count; pair += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        const tas = tile(`fold-${count}-${pair}-${copy}`, "sari", pair + 1);
        tiles.push(tas);
        placements.push({ zone: "pairs", row: pair, col: copy, tasId: tas.id });
      }
    }
    return { tiles, placements };
  };
  const five = makePairs(5);
  const first = roomWithHand(five.tiles, { rule: "katlamali" });
  masaHamlesiDogrula(first, "player-1", {
    mode: "pairs",
    placements: five.placements,
  });
  assert.equal(first.gameState.mevcutCiftBaraji, 6);

  const rejected = roomWithHand(five.tiles, {
    rule: "katlamali",
    pairThreshold: 6,
  });
  assert.throws(
    () =>
      masaHamlesiDogrula(rejected, "player-1", {
        mode: "pairs",
        placements: five.placements,
      }),
    /6 gecerli cift/,
  );
  assert.equal(rejected.gameState.masaZemini.cift.length, 0);

  const six = makePairs(6);
  const accepted = roomWithHand(six.tiles, {
    rule: "katlamali",
    pairThreshold: 6,
  });
  masaHamlesiDogrula(accepted, "player-1", {
    mode: "pairs",
    placements: six.placements,
  });
  assert.equal(accepted.gameState.mevcutCiftBaraji, 7);
});

test("allows a series opener to extend a committed run", () => {
  const committedTiles = [4, 5, 6].map((value) =>
    tile(`committed-${value}`, "mavi", value),
  );
  const committed = committedTiles.map((tas, col) => ({
    zone: "series",
    row: 0,
    col,
    tasId: tas.id,
    tas,
    ownerSocketId: "another-player",
  }));
  const addition = tile("blue-7", "mavi", 7);
  const room = roomWithHand([addition], {
    openingType: "series",
    table: { seri: committed, cift: [] },
  });
  masaHamlesiDogrula(room, "player-1", {
    mode: "series",
    placements: [{ zone: "series", row: 0, col: 3, tasId: addition.id }],
  });
  assert.equal(room.gameState.masaZemini.seri.length, 4);
});

test("does not let a pair opener create a new series", () => {
  const additions = [4, 5, 6].map((value) =>
    tile(`new-${value}`, "sari", value),
  );
  const room = roomWithHand(additions, { openingType: "pairs" });
  assert.throws(
    () =>
      masaHamlesiDogrula(room, "player-1", {
        mode: "series",
        placements: additions.map((tas, col) => ({
          zone: "series",
          row: 0,
          col,
          tasId: tas.id,
        })),
      }),
    /Cift acan oyuncu seri perlerine tas isleyemez/,
  );
});

test("does not let a pair opener extend an existing series or take its okey", () => {
  const wildcard = tile("pair-opener-okey", "kirmizi", 6);
  const committed = [tile("blue-4-x", "mavi", 4), wildcard, tile("blue-6-x", "mavi", 6)].map(
    (tas, col) => ({
      zone: "series",
      row: 0,
      col,
      perId: "existing-series",
      tasId: tas.id,
      tas,
      ownerKoltukNo: 1,
    }),
  );
  const extension = tile("blue-7-x", "mavi", 7);
  const replacement = tile("blue-5-x", "mavi", 5);
  const room = roomWithHand([extension, replacement], {
    openingType: "pairs",
    table: { seri: committed, cift: [] },
  });
  assert.throws(
    () =>
      masaHamlesiDogrula(room, "player-1", {
        mode: "series",
        placements: [
          { zone: "series", row: 0, col: 3, tasId: extension.id },
        ],
      }),
    /seri perlerine tas isleyemez/,
  );
  assert.throws(
    () =>
      jokeriDegistir(room, "player-1", {
        zone: "series",
        row: 0,
        col: 1,
        tasId: replacement.id,
      }),
    /seri perlerindeki okeyi alamaz/,
  );
});

test("requires a side-drawn tile in the same valid table transaction", () => {
  const { tiles, placements } = seriesOpening();
  const sideTile = tiles[0];
  const room = roomWithHand([...tiles, tile("spare", "sari", 9)], {
    sideTileId: sideTile.id,
  });
  assert.throws(
    () =>
      masaHamlesiDogrula(room, "player-1", {
        mode: "series",
        placements: placements.slice(1),
      }),
    /Yandan aldiginiz tasi/,
  );
  masaHamlesiDogrula(room, "player-1", {
    mode: "series",
    placements,
  });
  assert.equal(room.oyuncular[0].yandanAlinanTasId, null);
});

test("detects a discard that can extend a committed series", () => {
  const committed = [4, 5, 6].map((value, index) => ({
    zone: "series",
    row: 0,
    col: index + 1,
    perId: "series-1",
    tasId: `blue-${value}`,
    tas: tile(`blue-${value}`, "mavi", value),
    ownerKoltukNo: 1,
  }));
  const room = roomWithHand([], {
    table: { seri: committed, cift: [] },
  });
  assert.equal(
    atilanTasIslenebilirMi(room, tile("blue-7", "mavi", 7)),
    true,
  );
  assert.equal(
    atilanTasIslenebilirMi(room, tile("yellow-7", "sari", 7)),
    false,
  );
});

test("detects set completion, wildcard replacement and real-okey discard penalties", () => {
  const wildcard = tile("workable-okey", "kirmizi", 6);
  const set = [
    tile("set-blue-8", "mavi", 8),
    tile("set-black-8", "siyah", 8),
    tile("set-red-8", "kirmizi", 8),
  ].map((tas, col) => ({
    zone: "series",
    row: 0,
    col,
    perId: "set-8",
    tasId: tas.id,
    tas,
  }));
  const run = [tile("run-blue-4", "mavi", 4), wildcard, tile("run-blue-6", "mavi", 6)].map(
    (tas, col) => ({
      zone: "series",
      row: 1,
      col,
      perId: "run-with-okey",
      tasId: tas.id,
      tas,
    }),
  );
  const room = roomWithHand([], { table: { seri: [...set, ...run], cift: [] } });
  assert.equal(atilanTasIslenebilirMi(room, tile("set-yellow-8", "sari", 8)), true);
  assert.equal(atilanTasIslenebilirMi(room, tile("run-blue-5", "mavi", 5)), true);
  assert.equal(
    atilanTasCezaNedeni(room, tile("physical-okey", "kirmizi", 6)),
    "Okey atildi",
  );
  assert.equal(
    atilanTasCezaNedeni(
      room,
      tile("finishing-okey", "kirmizi", 6),
      { bitiriyor: true },
    ),
    null,
  );
});

test("replaces a committed real okey, returns it to the rack and penalizes its owner", () => {
  const wildcard = tile("real-okey", "kirmizi", 6);
  const committed = [
    tile("blue-4", "mavi", 4),
    wildcard,
    tile("blue-6", "mavi", 6),
  ].map((tas, index) => ({
    zone: "series",
    row: 0,
    col: index + 1,
    perId: "series-1",
    tasId: tas.id,
    tas,
    ownerSocketId: "player-2",
    ownerKoltukNo: 1,
  }));
  const replacement = tile("blue-5", "mavi", 5);
  const room = roomWithHand([replacement], {
    openingType: "series",
    table: { seri: committed, cift: [] },
  });
  const result = jokeriDegistir(room, "player-1", {
    zone: "series",
    row: 0,
    col: 2,
    tasId: replacement.id,
  });
  assert.equal(result.cezaKoltukNo, 1);
  assert.equal(room.koltukPuanlari[1], 101);
  assert.equal(room.koltukCezaPuanlari[1], 101);
  assert.equal(room.oyuncular[0].eldekiTaslar[0].id, wildcard.id);
  assert.ok(
    room.gameState.masaZemini.seri.some(
      (cell) => cell.tas.id === replacement.id,
    ),
  );
});

test("replaces a committed real okey before drawing and commits the replacement immediately", () => {
  const wildcard = tile("real-okey-no-draw", "kirmizi", 6);
  const committed = [
    tile("black-11", "siyah", 11),
    wildcard,
    tile("black-13", "siyah", 13),
  ].map((tas, index) => ({
    zone: "series",
    row: 2,
    col: index + 4,
    perId: "series-2",
    tasId: tas.id,
    tas,
    ownerSocketId: "player-2",
    ownerKoltukNo: 1,
  }));
  const replacement = tile("black-12", "siyah", 12);
  const room = roomWithHand([replacement], {
    drawn: false,
    openingType: "series",
    table: { seri: committed, cift: [] },
  });

  jokeriDegistir(room, "player-1", {
    zone: "series",
    row: 2,
    col: 5,
    tasId: replacement.id,
  });

  assert.equal(room.gameState.masaZemini.seri[1].tas.id, replacement.id);
  assert.equal(room.oyuncular[0].eldekiTaslar[0].id, wildcard.id);
});

test("requires all four colors before taking an okey from a same-number set", () => {
  const wildcard = tile("set-okey", "kirmizi", 6);
  const blue = tile("blue-12", "mavi", 12);
  const black = tile("black-12", "siyah", 12);
  const yellow = tile("yellow-12", "sari", 12);
  const baseSet = [blue, black, wildcard].map((tas, index) => ({
    zone: "series",
    row: 4,
    col: index + 8,
    perId: "set-with-okey",
    tasId: tas.id,
    tas,
    ownerSocketId: "player-2",
    ownerKoltukNo: 1,
  }));
  const incompleteRoom = roomWithHand([yellow], {
    openingType: "series",
    table: { seri: baseSet, cift: [] },
  });

  assert.throws(
    () =>
      jokeriDegistir(incompleteRoom, "player-1", {
        zone: "series",
        row: 4,
        col: 10,
        tasId: yellow.id,
      }),
    /dort renk tamamlaninca/,
  );
  assert.equal(incompleteRoom.oyuncular[0].eldekiTaslar[0].id, yellow.id);

  const red = tile("red-12", "kirmizi", 12);
  const completeSet = [blue, black, wildcard, red].map((tas, index) => ({
    zone: "series",
    row: 4,
    col: index + 8,
    perId: "complete-set-with-okey",
    tasId: tas.id,
    tas,
    ownerSocketId: "player-2",
    ownerKoltukNo: 1,
  }));
  const completeRoom = roomWithHand([yellow], {
    openingType: "series",
    table: { seri: completeSet, cift: [] },
  });

  jokeriDegistir(completeRoom, "player-1", {
    zone: "series",
    row: 4,
    col: 10,
    tasId: yellow.id,
  });

  assert.equal(completeRoom.oyuncular[0].eldekiTaslar[0].id, wildcard.id);
  assert.equal(completeRoom.gameState.masaZemini.seri[2].tas.id, yellow.id);
});
