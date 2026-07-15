import test from "node:test";
import assert from "node:assert/strict";
import {
  desteOlustur,
  eliBerabereTamamla,
  eliTamamla,
  elDagit,
  maciHazirla,
  yeniOda,
  sonrakiElBaslangicOyuncusu,
} from "../server/game.js";

const player = (seat, name, opening = null, tiles = []) => ({
  socketId: `player-${seat}`,
  kullaniciId: `user-${seat}`,
  isim: name,
  koltukNo: seat,
  eldekiTaslar: tiles,
  cekildiMi: false,
  acilisTipi: opening,
  acilisPuani: opening ? 101 : 0,
});

test("creates a fresh shuffled 106 tile deck for every hand", () => {
  const first = desteOlustur();
  const second = desteOlustur();
  assert.equal(first.length, 106);
  assert.equal(new Set(first.map((tile) => tile.id)).size, 106);
  assert.deepEqual(
    [...first.map((tile) => tile.id)].sort(),
    [...second.map((tile) => tile.id)].sort(),
  );
  assert.notDeepEqual(first.map((tile) => tile.id), second.map((tile) => tile.id));
});

test("never exposes a fake okey as the indicator", () => {
  const room = yeniOda(
    "indicator-room",
    "Gösterge",
    { socketId: "player-0", kullaniciId: "user-0" },
    2,
  );
  room.oyuncular = [player(0, "Bir"), player(1, "İki")];
  room.gameState.oyunSirasi = [0, 1];
  room.gameState.siradakiOyuncu = 0;
  for (let i = 0; i < 30; i += 1) {
    elDagit(room);
    assert.notEqual(room.gameState.gosterge.renk, "joker");
    room.gameState.oyunBasladi = false;
  }
});

test("resets the one-time series time bonus for every newly dealt hand", () => {
  const room = yeniOda(
    "timer-bonus-room",
    "Sure",
    { socketId: "player-0", kullaniciId: "user-0" },
    2,
  );
  room.oyuncular = [player(0, "Bir"), player(1, "Iki")];
  room.oyuncular.forEach((item) => {
    item.sureBonusuKullanildi = true;
  });
  room.gameState.oyunSirasi = [0, 1];
  room.gameState.siradakiOyuncu = 0;

  elDagit(room);

  assert.equal(room.oyuncular[0].sureBonusuKullanildi, false);
  assert.equal(room.oyuncular[1].sureBonusuKullanildi, false);
});

test("scores a hand, rotates the starter and declares the lowest score winner", () => {
  const room = yeniOda(
    "match-room",
    "Maç",
    { socketId: "player-0", kullaniciId: "user-0" },
    3,
    "sabit",
    5,
  );
  room.oyuncular = [
    player(0, "Kazanan", "series", []),
    player(1, "Açan", "series", [
      { id: "r-8", renk: "kirmizi", deger: 8 },
      { id: "b-9", renk: "mavi", deger: 9 },
    ]),
    player(2, "Açmayan", null, [{ id: "y-3", renk: "sari", deger: 3 }]),
  ];
  room.gameState.oyunSirasi = [0, 1, 2];
  room.gameState.gosterge = { id: "indicator", renk: "siyah", deger: 4 };
  maciHazirla(room);
  room.gameState.siradakiOyuncu = 0;
  elDagit(room);
  // elDagit her el icin yeni bir gosterge secer. Bu puanlama testi okeyle
  // bitis carpanini degil normal bitisi dogruladigi icin gostergeyi dagitimdan
  // sonra deterministik olarak sabitliyoruz.
  room.gameState.gosterge = { id: "indicator", renk: "siyah", deger: 4 };
  room.oyuncular[0].eldekiTaslar = [];
  room.oyuncular[0].acilisTipi = "series";
  room.oyuncular[1].eldekiTaslar = [
    { id: "r-8", renk: "kirmizi", deger: 8 },
    { id: "b-9", renk: "mavi", deger: 9 },
  ];
  room.oyuncular[1].acilisTipi = "series";
  room.oyuncular[2].eldekiTaslar = [{ id: "y-3", renk: "sari", deger: 3 }];
  room.oyuncular[2].acilisTipi = null;

  const result = eliTamamla(
    room,
    room.oyuncular[0],
    { id: "discard", renk: "sari", deger: 2 },
  );
  assert.equal(result.macBitti, false);
  assert.deepEqual(room.koltukPuanlari, [-101, 17, 101]);
  assert.equal(sonrakiElBaslangicOyuncusu(room), 1);

  room.gameState.tamamlananEl = 4;
  room.gameState.oyunBasladi = true;
  room.gameState.elNo = 5;
  const final = eliTamamla(
    room,
    room.oyuncular[0],
    { id: "discard-2", renk: "mavi", deger: 4 },
  );
  assert.equal(final.macBitti, true);
  assert.equal(room.gameState.macKazananlari[0].koltukNo, 0);
});

test("scores an exhausted deck as 101 for unopened and rack total for opened players", () => {
  const room = yeniOda(
    "empty-deck-room",
    "Deste sonu",
    { socketId: "player-0", kullaniciId: "user-0" },
    2,
  );
  room.oyuncular = [
    player(0, "Acmayan", null, [
      { id: "black-13", renk: "siyah", deger: 13 },
    ]),
    player(1, "Acan", "series", [
      { id: "red-8", renk: "kirmizi", deger: 8 },
      { id: "blue-9", renk: "mavi", deger: 9 },
    ]),
  ];
  room.gameState.oyunBasladi = true;
  room.gameState.elNo = 1;
  room.gameState.gosterge = { id: "indicator", renk: "sari", deger: 4 };

  const result = eliBerabereTamamla(room);

  assert.equal(result.neden, "Deste bitti");
  assert.deepEqual(room.koltukPuanlari, [101, 17]);
  assert.equal(room.gameState.oyunBasladi, false);
});

test("shows in-hand penalties in the round delta without adding them twice", () => {
  const room = yeniOda(
    "penalty-room",
    "Ceza",
    { socketId: "player-0", kullaniciId: "user-0" },
    2,
  );
  room.oyuncular = [
    player(0, "Cezali", "series", [
      { id: "red-7", renk: "kirmizi", deger: 7 },
    ]),
    player(1, "Diger", "series", [
      { id: "blue-8", renk: "mavi", deger: 8 },
    ]),
  ];
  room.gameState.oyunBasladi = true;
  room.gameState.elNo = 1;
  room.gameState.gosterge = { id: "indicator", renk: "sari", deger: 4 };
  room.koltukPuanlari = [303, 0];
  room.koltukCezaPuanlari = [303, 0];

  const result = eliBerabereTamamla(room);
  const penalized = result.puanlar.find((item) => item.koltukNo === 0);

  assert.equal(penalized.ceza, 303);
  assert.equal(penalized.fark, 310);
  assert.equal(penalized.toplam, 310);
});
