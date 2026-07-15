import test from "node:test";
import assert from "node:assert/strict";
import {
  aktifOdalar,
  genelDurum,
  koltukDurumunuDevral,
  koltukDurumunuSakla,
  koltukPuaniniGuncelle,
  MAKSIMUM_AKTIF_ODA_SAYISI,
  yeniOda,
  yeniOdaOlusturulabilir,
} from "../server/game.js";

const creator = {
  socketId: "creator-socket",
  kullaniciId: "creator-user",
  isim: "Kurucu",
};

test("limits the server to five simultaneous active rooms", () => {
  const eskiOdalar = { ...aktifOdalar };
  for (const odaId of Object.keys(aktifOdalar)) delete aktifOdalar[odaId];

  try {
    assert.equal(MAKSIMUM_AKTIF_ODA_SAYISI, 5);
    for (let index = 0; index < MAKSIMUM_AKTIF_ODA_SAYISI; index += 1) {
      assert.equal(yeniOdaOlusturulabilir(), true);
      aktifOdalar[`limit-room-${index}`] = yeniOda(
        `limit-room-${index}`,
        `Masa ${index + 1}`,
        creator,
        4,
        "sabit",
      );
    }
    assert.equal(yeniOdaOlusturulabilir(), false);
  } finally {
    for (const odaId of Object.keys(aktifOdalar)) delete aktifOdalar[odaId];
    Object.assign(aktifOdalar, eskiOdalar);
  }
});

test("keeps score on the room seat when its occupant changes", () => {
  const room = yeniOda("room-score", "Puan Masası", creator, 3, "sabit");
  room.oyuncular.push({
    socketId: "first-player",
    kullaniciId: "first-user",
    isim: "İlk Oyuncu",
    koltukNo: 1,
    eldekiTaslar: [],
  });

  assert.equal(koltukPuaniniGuncelle(room, 1, 37), 37);
  assert.equal(genelDurum(room).oyuncular[0].puan, 37);

  room.oyuncular = [];
  room.oyuncular.push({
    socketId: "second-player",
    kullaniciId: "second-user",
    isim: "Yeni Oyuncu",
    koltukNo: 1,
    eldekiTaslar: [],
  });

  const state = genelDurum(room);
  assert.equal(state.oyuncular[0].puan, 37);
  assert.equal(state.koltukPuanlari[1], 37);
});

test("isolates signed match scores by room", () => {
  const first = yeniOda("room-a", "A", creator, 2, "sabit");
  const second = yeniOda("room-b", "B", creator, 2, "sabit");
  koltukPuaniniGuncelle(first, 0, 25);
  koltukPuaniniGuncelle(first, 0, -40);

  assert.equal(first.koltukPuanlari[0], -15);
  assert.equal(second.koltukPuanlari[0], 0);
  assert.notEqual(first.koltukPuanlari, second.koltukPuanlari);
});

test("hands an ongoing seat state to its replacement without exposing it publicly", () => {
  const room = yeniOda("room-running", "Devam Masası", creator, 2, "sabit");
  const leaving = {
    socketId: "leaving",
    kullaniciId: "leaving-user",
    isim: "Ayrılan",
    koltukNo: 0,
    eldekiTaslar: [{ id: "tile-1", renk: "mavi", deger: 7 }],
    cekildiMi: true,
    acilisTipi: "series",
    acilisPuani: 104,
    sureBonusuKullanildi: true,
  };
  room.oyuncular.push(leaving);
  koltukDurumunuSakla(room, leaving);

  const publicState = genelDurum(room);
  assert.equal("eldekiTaslar" in publicState.oyuncular[0], false);

  const inherited = koltukDurumunuDevral(room, 0);
  assert.deepEqual(inherited.eldekiTaslar, leaving.eldekiTaslar);
  assert.equal(inherited.cekildiMi, true);
  assert.equal(inherited.acilisTipi, "series");
  assert.equal(inherited.sureBonusuKullanildi, true);
  assert.equal(room.koltukDurumlari[0], null);
});

test("publishes the seat allowed to finish an exhausted deck", () => {
  const room = yeniOda("room-empty-deck", "Deste Sonu", creator, 2, "sabit");
  room.gameState.eliBitirecekKoltukNo = 1;
  room.gameState.desteBitisSonZaman = 123456;

  const state = genelDurum(room);

  assert.equal(state.eliBitirecekKoltukNo, 1);
  assert.equal(state.desteBitisSonZaman, 123456);
});
