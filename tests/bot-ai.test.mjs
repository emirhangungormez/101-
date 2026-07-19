import test from "node:test";
import assert from "node:assert/strict";
import { botAtisSec, botMasaPlani } from "../server/bot.js";
import { yeniOda } from "../server/game.js";

const tile = (id, renk, deger) => ({ id, renk, deger });

test("bot finds a server-valid 101 opening instead of discarding randomly", () => {
  const room = yeniOda(
    "bot-room",
    "Bot",
    { socketId: "owner", kullaniciId: "owner" },
    2,
  );
  const hand = [
    tile("r11", "kirmizi", 11), tile("r12", "kirmizi", 12), tile("r13", "kirmizi", 13),
    tile("b11", "mavi", 11), tile("b12", "mavi", 12), tile("b13", "mavi", 13),
    tile("k10", "siyah", 10), tile("k11", "siyah", 11), tile("k12", "siyah", 12),
    tile("spare", "sari", 1),
  ];
  const bot = {
    socketId: "robot-1",
    isim: "Robot",
    bot: true,
    koltukNo: 1,
    eldekiTaslar: hand,
    cekildiMi: true,
    acilisTipi: null,
  };
  room.oyuncular = [bot];
  room.gameState.gosterge = tile("indicator", "sari", 5);
  room.gameState.siradakiOyuncu = 1;
  room.gameState.oyunBasladi = true;
  const plan = botMasaPlani(room, bot);
  assert.equal(plan?.mode, "series");
  assert.ok(plan.placements.length >= 9);
  assert.ok(plan.placements.length < hand.length);
  assert.equal(new Set(plan.placements.map((item) => item.row)).size, 3);
  assert.deepEqual(
    [...new Set(plan.placements.map((item) => item.row))].sort((a, b) => a - b),
    [8, 9, 10],
  );
  assert.equal(new Set(plan.placements.map((item) => item.col)).size, 3);
});

test("bot stacks a pair opening vertically and leaves processing to one plan", () => {
  const room = yeniOda(
    "pair-bot-room",
    "Bot",
    { socketId: "owner", kullaniciId: "owner" },
    2,
  );
  const hand = [
    ...Array.from({ length: 5 }, (_, value) => [
      tile(`p-${value}-a`, "kirmizi", value + 1),
      tile(`p-${value}-b`, "kirmizi", value + 1),
    ]).flat(),
    tile("pair-spare", "sari", 13),
  ];
  const bot = {
    socketId: "robot-pair",
    isim: "Robot",
    bot: true,
    koltukNo: 1,
    eldekiTaslar: hand,
    cekildiMi: true,
    acilisTipi: null,
  };
  room.oyuncular = [bot];
  room.gameState.gosterge = tile("pair-indicator", "mavi", 8);
  room.gameState.siradakiOyuncu = 1;
  room.gameState.oyunBasladi = true;
  const plan = botMasaPlani(room, bot);
  assert.equal(plan?.mode, "pairs");
  assert.equal(plan.placements.length, 10);
  assert.deepEqual(
    [...new Set(plan.placements.map((item) => item.row))].sort((a, b) => a - b),
    [7, 8, 9, 10, 11],
  );
  assert.equal(new Set(plan.placements.map((item) => item.col)).size, 2);
});

test("automatic openings leave four empty cells around existing table tiles", () => {
  const room = yeniOda(
    "spaced-bot-room",
    "Bot",
    { socketId: "owner", kullaniciId: "owner" },
    2,
  );
  const hand = [
    tile("r11", "kirmizi", 11), tile("r12", "kirmizi", 12), tile("r13", "kirmizi", 13),
    tile("b11", "mavi", 11), tile("b12", "mavi", 12), tile("b13", "mavi", 13),
    tile("k10", "siyah", 10), tile("k11", "siyah", 11), tile("k12", "siyah", 12),
    tile("spare", "sari", 1),
  ];
  const bot = {
    socketId: "robot-spaced",
    isim: "Robot",
    bot: true,
    koltukNo: 1,
    eldekiTaslar: hand,
    cekildiMi: true,
    acilisTipi: null,
  };
  room.oyuncular = [bot];
  room.gameState.gosterge = tile("indicator", "sari", 5);
  room.gameState.masaZemini.seri = [
    { zone: "series", row: 9, col: 19, tasId: "existing" },
  ];
  const plan = botMasaPlani(room, bot);
  assert.equal(plan?.mode, "series");
  assert.ok(
    plan.placements.every(
      (item) => Math.max(Math.abs(item.row - 9), Math.abs(item.col - 19)) >= 5,
    ),
  );
});

test("bot protects the real okey when choosing a discard", () => {
  const indicator = tile("indicator", "kirmizi", 5);
  const hand = [
    tile("okey", "kirmizi", 6),
    tile("loose", "sari", 13),
    tile("near", "mavi", 2),
  ];
  assert.notEqual(botAtisSec({ eldekiTaslar: hand }, indicator).id, "okey");
});
