import {
  PAIRS_COLUMNS,
  SERIES_COLUMNS,
  TABLE_ROWS,
  groupsFromPlacements,
  nextBarrier,
  previewOpening,
  resolveTile,
  validatePair,
  validateSeriesGroup,
} from "../shared/okey-rules.js";

export const aktifOdalar = Object.create(null);
export const MAKSIMUM_AKTIF_ODA_SAYISI = 5;

export function yeniOdaOlusturulabilir() {
  return Object.keys(aktifOdalar).length < MAKSIMUM_AKTIF_ODA_SAYISI;
}

const renkler = ["kirmizi", "mavi", "siyah", "sari"];
export function desteOlustur() {
  const taslar = [];
  for (let kopya = 0; kopya < 2; kopya++)
    for (const renk of renkler)
      for (let deger = 1; deger <= 13; deger++)
        taslar.push({ id: `${kopya}-${renk}-${deger}`, renk, deger });
  taslar.push(
    { id: "joker-1", renk: "joker", deger: 0 },
    { id: "joker-2", renk: "joker", deger: 0 },
  );
  for (let i = taslar.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [taslar[i], taslar[j]] = [taslar[j], taslar[i]];
  }
  return taslar;
}

export function yeniOda(
  odaId,
  odaAdi,
  oyuncu,
  maksimum = 4,
  kuralTipi = "sabit",
  toplamEl = 5,
) {
  const elSayisi = [5, 10, 20].includes(Number(toplamEl))
    ? Number(toplamEl)
    : 5;
  return {
    odaId,
    odaAdi,
    maksimum,
    kuralTipi: kuralTipi === "katlamali" ? "katlamali" : "sabit",
    toplamEl: elSayisi,
    kurucuSocketId: oyuncu.socketId,
    kurucuId: oyuncu.kullaniciId,
    oyuncular: [],
    izleyiciler: [oyuncu.socketId],
    koltukPuanlari: Array.from({ length: maksimum }, () => 0),
    koltukCezaPuanlari: Array.from({ length: maksimum }, () => 0),
    koltukDurumlari: Array.from({ length: maksimum }, () => null),
    kullaniciKoltuklari: {},
    gameState: {
      oyunBasladi: false,
      siradakiOyuncu: 0,
      deste: [],
      gosterge: null,
      iskartaKutusu: [],
      mevcutBaraj: 101,
      masaZemini: { seri: [], cift: [] },
      tamamlananEl: 0,
      elNo: 0,
      elDurumu: "bekliyor",
      elSonucu: null,
      macKazananlari: [],
      macAktif: false,
      eliBitirecekKoltukNo: null,
      desteBitisSonZaman: null,
      hamleSonZaman: null,
      hamleSuresi: null,
    },
  };
}
export function genelDurum(oda) {
  const g = oda.gameState;
  if (!Array.isArray(oda.koltukPuanlari))
    oda.koltukPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  if (!Array.isArray(oda.koltukCezaPuanlari))
    oda.koltukCezaPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  const oyunSirasi = Array.isArray(g.oyunSirasi) ? g.oyunSirasi : [];
  const okey = g.gosterge
    ? {
        ...g.gosterge,
        deger: g.gosterge.deger === 13 ? 1 : g.gosterge.deger + 1,
      }
    : null;
  return {
    odaId: oda.odaId,
    odaAdi: oda.odaAdi,
    maksimum: oda.maksimum,
    kuralTipi: oda.kuralTipi || "sabit",
    toplamEl: Number(oda.toplamEl || 5),
    kurucuSocketId: oda.kurucuSocketId,
    kurucuId: oda.kurucuId,
    oyuncular: oda.oyuncular.map(
      ({
        socketId,
        kullaniciId,
        isim,
        avatar,
        bot,
        koltukNo,
        acilisTipi,
        acilisPuani,
        devralinanKullaniciId,
        devralmaSonZaman,
      }) => ({
        socketId,
        kullaniciId,
        isim,
        avatar,
        bot: Boolean(bot),
        koltukNo,
        acilisTipi: acilisTipi ?? null,
        acilisPuani: acilisPuani ?? 0,
        geriDonusKullaniciId: devralinanKullaniciId ?? null,
        geriDonusSonZaman: Number(devralmaSonZaman || 0) || null,
        puan: Number(oda.koltukPuanlari[koltukNo] || 0),
        cezaPuani: Number(oda.koltukCezaPuanlari[koltukNo] || 0),
        siraNo: oyunSirasi.includes(koltukNo)
          ? oyunSirasi.indexOf(koltukNo) + 1
          : null,
      }),
    ),
    izleyiciSayisi: oda.izleyiciler.length,
    koltukPuanlari: [...oda.koltukPuanlari],
    koltukCezaPuanlari: [...oda.koltukCezaPuanlari],
    oyunBasladi: g.oyunBasladi,
    siradakiOyuncu: g.siradakiOyuncu,
    mevcutBaraj: g.mevcutBaraj,
    masaZemini: g.masaZemini ?? { seri: [], cift: [] },
    kalanTasSayisi: g.deste.length,
    gosterge: g.gosterge,
    okey,
    iskartaKutusu: g.iskartaKutusu,
    sonAtanKoltukNo: g.sonAtanKoltukNo ?? null,
    sonAtislar: g.sonAtislar ?? {},
    atisGecmisi: g.atisGecmisi ?? {},
    tamamlananEl: Number(g.tamamlananEl || 0),
    elNo: Number(g.elNo || 0),
    elDurumu: g.elDurumu || "bekliyor",
    elSonucu: g.elSonucu || null,
    macKazananlari: g.macKazananlari || [],
    macAktif: Boolean(g.macAktif),
    eliBitirecekKoltukNo: Number.isInteger(g.eliBitirecekKoltukNo)
      ? g.eliBitirecekKoltukNo
      : null,
    desteBitisSonZaman: g.desteBitisSonZaman ?? null,
    hamleSonZaman: g.hamleSonZaman ?? null,
    hamleSuresi: Number(g.hamleSuresi || 0) || null,
  };
}

export function koltukPuaniniGuncelle(oda, koltukNo, fark) {
  if (
    !oda ||
    !Number.isInteger(koltukNo) ||
    koltukNo < 0 ||
    koltukNo >= oda.maksimum
  )
    throw new Error("Gecersiz koltuk");
  if (!Array.isArray(oda.koltukPuanlari))
    oda.koltukPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  oda.koltukPuanlari[koltukNo] =
    Number(oda.koltukPuanlari[koltukNo] || 0) + Number(fark || 0);
  return oda.koltukPuanlari[koltukNo];
}

export function koltukCezasiniGuncelle(oda, koltukNo, fark = 101) {
  if (!Array.isArray(oda.koltukCezaPuanlari))
    oda.koltukCezaPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  oda.koltukCezaPuanlari[koltukNo] =
    Number(oda.koltukCezaPuanlari[koltukNo] || 0) + Number(fark || 0);
  return oda.koltukCezaPuanlari[koltukNo];
}

export function koltukDurumunuSakla(oda, oyuncu) {
  if (!oda || !oyuncu || !Number.isInteger(oyuncu.koltukNo)) return;
  if (!Array.isArray(oda.koltukDurumlari))
    oda.koltukDurumlari = Array.from({ length: oda.maksimum }, () => null);
  oda.koltukDurumlari[oyuncu.koltukNo] = {
    eldekiTaslar: [...(oyuncu.eldekiTaslar || [])],
    cekildiMi: Boolean(oyuncu.cekildiMi),
    acilisTipi: oyuncu.acilisTipi ?? null,
    acilisPuani: Number(oyuncu.acilisPuani || 0),
    yandanAlinanTasId: oyuncu.yandanAlinanTasId ?? null,
    sureBonusuKullanildi: Boolean(oyuncu.sureBonusuKullanildi),
    eldenBitisAdayi: Boolean(oyuncu.eldenBitisAdayi),
  };
}

export function koltukDurumunuDevral(oda, koltukNo) {
  if (!Array.isArray(oda?.koltukDurumlari)) return null;
  const durum = oda.koltukDurumlari[koltukNo];
  if (!durum) return null;
  oda.koltukDurumlari[koltukNo] = null;
  return {
    eldekiTaslar: [...(durum.eldekiTaslar || [])],
    cekildiMi: Boolean(durum.cekildiMi),
    acilisTipi: durum.acilisTipi ?? null,
    acilisPuani: Number(durum.acilisPuani || 0),
    yandanAlinanTasId: durum.yandanAlinanTasId ?? null,
    sureBonusuKullanildi: Boolean(durum.sureBonusuKullanildi),
    eldenBitisAdayi: Boolean(durum.eldenBitisAdayi),
  };
}
export function elDagit(oda) {
  const g = oda.gameState;
  // Ceza sayaci ele ozeldir; ceza puani toplam maca zaten aninda eklenir.
  oda.koltukCezaPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  g.deste = desteOlustur();
  while (g.deste.at(-1)?.renk === "joker") g.deste.unshift(g.deste.pop());
  g.gosterge = g.deste.pop();
  g.iskartaKutusu = [];
  g.sonAtanKoltukNo = null;
  g.sonAtislar = {};
  g.atisGecmisi = {};
  g.mevcutBaraj = 101;
  g.masaZemini = { seri: [], cift: [] };
  g.elNo = Number(g.tamamlananEl || 0) + 1;
  g.elDurumu = "oynaniyor";
  g.elSonucu = null;
  g.macKazananlari = [];
  g.macAktif = true;
  g.eliBitirecekKoltukNo = null;
  g.desteBitisSonZaman = null;
  g.hamleSonZaman = null;
  g.hamleSuresi = null;
  oda.oyuncular.forEach((p) => {
    p.eldekiTaslar = g.deste.splice(
      -(p.koltukNo === g.siradakiOyuncu ? 22 : 21),
    );
    p.cekildiMi = p.koltukNo === g.siradakiOyuncu;
    p.acilisTipi = null;
    p.acilisPuani = 0;
    p.yandanAlinanTasId = null;
    p.sureBonusuKullanildi = false;
    p.eldenBitisAdayi = false;
  });
  g.oyunBasladi = true;
}

export function maciHazirla(oda) {
  const g = oda.gameState;
  oda.koltukPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  oda.koltukCezaPuanlari = Array.from({ length: oda.maksimum }, () => 0);
  oda.koltukDurumlari = Array.from({ length: oda.maksimum }, () => null);
  g.tamamlananEl = 0;
  g.elNo = 0;
  g.elDurumu = "dagitim-bekliyor";
  g.elSonucu = null;
  g.macKazananlari = [];
  g.macAktif = true;
  g.oyunBasladi = false;
  g.eliBitirecekKoltukNo = null;
  g.desteBitisSonZaman = null;
  g.hamleSonZaman = null;
  g.hamleSuresi = null;
}

export function sonrakiElBaslangicOyuncusu(oda) {
  const sira = oda.gameState.oyunSirasi || [];
  if (!sira.length) return 0;
  return sira[Number(oda.gameState.tamamlananEl || 0) % sira.length];
}

export const gercekOkeyMi = (tas, gosterge) =>
  Boolean(tas && resolveTile(tas, gosterge).wildcard);

export function eldeKalanTasPuani(oyuncu, gosterge) {
  return (oyuncu?.eldekiTaslar || []).reduce((toplam, tas) => {
    if (gercekOkeyMi(tas, gosterge)) return toplam + 101;
    return toplam + Number(resolveTile(tas, gosterge).deger || 0);
  }, 0);
}

export function eliTamamla(
  oda,
  kazanan,
  bitisTasi,
  { eldenBitti = false } = {},
) {
  const g = oda.gameState;
  if (!g.oyunBasladi || !kazanan) throw new Error("Aktif el bulunamadi");
  const okeyleBitti = gercekOkeyMi(bitisTasi, g.gosterge);
  const kazananCift = kazanan.acilisTipi === "pairs";
  const bitisCarpani = (okeyleBitti ? 2 : 1) * (kazananCift ? 2 : 1);
  const eldenBitisPuani = 202 * (okeyleBitti ? 2 : 1);
  const puanlar = oda.oyuncular.map((oyuncu) => {
    let elFarki;
    if (eldenBitti)
      elFarki =
        oyuncu.koltukNo === kazanan.koltukNo
          ? -eldenBitisPuani
          : eldenBitisPuani;
    else if (oyuncu.koltukNo === kazanan.koltukNo)
      elFarki = -101 * bitisCarpani;
    else if (!oyuncu.acilisTipi) elFarki = 101 * bitisCarpani;
    else {
      const ciftCarpani = oyuncu.acilisTipi === "pairs" ? 2 : 1;
      elFarki =
        eldeKalanTasPuani(oyuncu, g.gosterge) * ciftCarpani * bitisCarpani;
    }
    // Islenebilir tas cezasi verildigi anda toplam puana eklenmistir. Burada
    // ikinci kez eklemiyor, yalniz el sonucu satirinda eksiksiz gosteriyoruz.
    const ceza = Number(oda.koltukCezaPuanlari?.[oyuncu.koltukNo] || 0);
    const fark = elFarki + ceza;
    koltukPuaniniGuncelle(oda, oyuncu.koltukNo, elFarki);
    return {
      koltukNo: oyuncu.koltukNo,
      isim: oyuncu.isim,
      fark,
      ceza,
      toplam: oda.koltukPuanlari[oyuncu.koltukNo],
    };
  });
  g.tamamlananEl = Number(g.tamamlananEl || 0) + 1;
  g.oyunBasladi = false;
  const macBitti = g.tamamlananEl >= Number(oda.toplamEl || 5);
  g.elDurumu = macBitti ? "mac-tamamlandi" : "tamamlandi";
  if (macBitti) {
    const enDusuk = Math.min(...oda.koltukPuanlari);
    g.macKazananlari = oda.oyuncular
      .filter((oyuncu) => oda.koltukPuanlari[oyuncu.koltukNo] === enDusuk)
      .map((oyuncu) => ({
        koltukNo: oyuncu.koltukNo,
        isim: oyuncu.isim,
        puan: enDusuk,
      }));
  }
  g.elSonucu = {
    elNo: g.elNo,
    kazananKoltukNo: kazanan.koltukNo,
    kazananIsim: kazanan.isim,
    okeyleBitti,
    eldenBitti,
    acilisTipi: kazanan.acilisTipi,
    puanlar,
    macBitti,
  };
  return g.elSonucu;
}

export function eliBerabereTamamla(oda) {
  const g = oda.gameState;
  if (!g.oyunBasladi) throw new Error("Aktif el bulunamadi");
  const puanlar = oda.oyuncular.map((oyuncu) => {
    const elFarki = !oyuncu.acilisTipi
      ? 101
      : eldeKalanTasPuani(oyuncu, g.gosterge) *
        (oyuncu.acilisTipi === "pairs" ? 2 : 1);
    const ceza = Number(oda.koltukCezaPuanlari?.[oyuncu.koltukNo] || 0);
    const fark = elFarki + ceza;
    koltukPuaniniGuncelle(oda, oyuncu.koltukNo, elFarki);
    return {
      koltukNo: oyuncu.koltukNo,
      isim: oyuncu.isim,
      fark,
      ceza,
      toplam: oda.koltukPuanlari[oyuncu.koltukNo],
    };
  });
  g.tamamlananEl = Number(g.tamamlananEl || 0) + 1;
  g.oyunBasladi = false;
  const macBitti = g.tamamlananEl >= Number(oda.toplamEl || 5);
  g.elDurumu = macBitti ? "mac-tamamlandi" : "tamamlandi";
  if (macBitti) {
    const enDusuk = Math.min(...oda.koltukPuanlari);
    g.macKazananlari = oda.oyuncular
      .filter((oyuncu) => oda.koltukPuanlari[oyuncu.koltukNo] === enDusuk)
      .map((oyuncu) => ({
        koltukNo: oyuncu.koltukNo,
        isim: oyuncu.isim,
        puan: enDusuk,
      }));
  }
  g.elSonucu = {
    elNo: g.elNo,
    kazananKoltukNo: null,
    kazananIsim: null,
    puanlar,
    macBitti,
    berabere: true,
    neden: "Deste bitti",
  };
  return g.elSonucu;
}
export function seriElDogrula(oda, socketId, perler) {
  if (!Array.isArray(perler) || !perler.length)
    throw new Error("Gecersiz per");
  const occupiedRows = new Set(
    (oda.gameState.masaZemini?.seri || []).map((cell) => Number(cell.row)),
  );
  let nextRow = 0;
  const placements = perler.flatMap((per) => {
    while (occupiedRows.has(nextRow)) nextRow += 1;
    if (nextRow >= TABLE_ROWS) throw new Error("Masada yeterli satir yok");
    const row = nextRow;
    occupiedRows.add(row);
    nextRow += 1;
    return per.map((tas, col) => ({
      zone: "series",
      row,
      col,
      tasId: tas.id,
    }));
  });
  return masaHamlesiDogrula(oda, socketId, {
    mode: "series",
    placements,
  }).score;
}

const zoneKey = (zone) => (zone === "pairs" ? "cift" : "seri");
const zoneColumns = (zone) =>
  zone === "pairs" ? PAIRS_COLUMNS : SERIES_COLUMNS;
const coordKey = (placement) =>
  `${placement.zone}:${placement.row}:${placement.col}`;

const yeniPerId = (oda, zone) => {
  oda.gameState.perSayaci = Number(oda.gameState.perSayaci || 0) + 1;
  return `${zone}-${oda.gameState.perSayaci}`;
};

const perGruplari = (placements, columns) => {
  const kimlikli = new Map();
  const kimliksiz = [];
  for (const placement of placements || []) {
    if (placement.perId) {
      if (!kimlikli.has(placement.perId)) kimlikli.set(placement.perId, []);
      kimlikli.get(placement.perId).push(placement);
    } else kimliksiz.push(placement);
  }
  return [
    ...kimlikli.values(),
    ...groupsFromPlacements(kimliksiz, columns),
  ].map((group) => [...group].sort((a, b) => a.col - b.col));
};

const masaBolumunuDuzenle = (oda, zone) => {
  const key = zoneKey(zone);
  const columns = zoneColumns(zone);
  const groups = perGruplari(oda.gameState.masaZemini[key] || [], columns);
  if (groups.length > TABLE_ROWS) throw new Error("Masada yeterli satir yok");
  oda.gameState.masaZemini[key] = groups.flatMap((group, row) => {
    const start = Math.max(1, Math.floor((columns - group.length) / 2));
    return group.map((placement, offset) => ({
      ...placement,
      row,
      col: start + offset,
    }));
  });
};

const masaZemininiDuzenle = (oda) => {
  masaBolumunuDuzenle(oda, "series");
  masaBolumunuDuzenle(oda, "pairs");
};

export function atilanTasIslenebilirMi(oda, tas) {
  if (!oda?.gameState?.gosterge || !tas) return false;
  const indicator = oda.gameState.gosterge;
  const seriesWorkable = perGruplari(
    oda.gameState.masaZemini?.seri || [],
    SERIES_COLUMNS,
  ).some((group) => {
    const tiles = group.map((cell) => cell.tas);
    // Basa/sona eklemenin yaninda, ayni sayi gruplari ve araya giren seri
    // taslari da tum olasi konumlarda sinanir.
    for (let index = 0; index <= tiles.length; index += 1) {
      const candidate = [...tiles];
      candidate.splice(index, 0, tas);
      if (validateSeriesGroup(candidate, indicator).valid) return true;
    }
    // Masadaki gercek okeyin temsil ettigi tas atiliyorsa o da isler tastir.
    return tiles.some((tile, index) => {
      if (!resolveTile(tile, indicator).wildcard) return false;
      const candidate = [...tiles];
      candidate[index] = tas;
      return validateSeriesGroup(candidate, indicator).valid;
    });
  });
  if (seriesWorkable) return true;

  return perGruplari(
    oda.gameState.masaZemini?.cift || [],
    PAIRS_COLUMNS,
  ).some((group) => {
    const tiles = group.map((cell) => cell.tas);
    return tiles.some((tile, index) => {
      if (!resolveTile(tile, indicator).wildcard) return false;
      const candidate = [...tiles];
      candidate[index] = tas;
      return validatePair(candidate, indicator).valid;
    });
  });
}

export function atilanTasCezaNedeni(oda, tas, { bitiriyor = false } = {}) {
  if (!tas || bitiriyor) return null;
  if (gercekOkeyMi(tas, oda?.gameState?.gosterge)) return "Okey atildi";
  return atilanTasIslenebilirMi(oda, tas)
    ? "Islenebilecek tas atildi"
    : null;
}

function masaHamlesiDogrulaUnsafe(oda, socketId, payload) {
  const oyuncu = oda?.oyuncular.find((p) => p.socketId === socketId);
  if (!oda || !oyuncu) throw new Error("Oyuncu odada degil");
  if (
    !oda.gameState.oyunBasladi ||
    oda.gameState.siradakiOyuncu !== oyuncu.koltukNo
  )
    throw new Error("Sira sizde degil");
  const mode = payload?.mode === "pairs" ? "pairs" : "series";
  const raw = Array.isArray(payload?.placements) ? payload.placements : [];
  if (!raw.length) throw new Error("Masaya tas dizmelisiniz");
  if (
    oyuncu.yandanAlinanTasId &&
    !raw.some(
      (placement) =>
        String(placement?.tasId) === String(oyuncu.yandanAlinanTasId),
    )
  )
    throw new Error("Yandan aldiginiz tasi bu hamlede masaya islemelisiniz");
  const occupied = [
    ...(oda.gameState.masaZemini.seri || []),
    ...(oda.gameState.masaZemini.cift || []),
  ];
  const occupiedKeys = new Set(occupied.map(coordKey));
  const seenTiles = new Set();
  const placements = raw.map((placement) => {
    const zone = placement.zone === "pairs" ? "pairs" : "series";
    const row = Number(placement.row),
      col = Number(placement.col);
    if (
      !Number.isInteger(row) ||
      row < 0 ||
      row >= TABLE_ROWS ||
      !Number.isInteger(col) ||
      col < 0 ||
      col >= zoneColumns(zone)
    )
      throw new Error("Gecersiz masa koordinati");
    const tas = oyuncu.eldekiTaslar.find(
      (tile) => String(tile.id) === String(placement.tasId),
    );
    if (!tas || seenTiles.has(String(tas.id)))
      throw new Error("Taslar elinizde degil");
    seenTiles.add(String(tas.id));
    const normalized = {
      zone,
      row,
      col,
      tasId: tas.id,
      tas,
      ownerSocketId: socketId,
      ownerKoltukNo: oyuncu.koltukNo,
    };
    if (occupiedKeys.has(coordKey(normalized)))
      throw new Error("Masa hucresi dolu");
    return normalized;
  });

  let score = 0;
  const ilkAcilis = !oyuncu.acilisTipi;
  if (!oyuncu.acilisTipi) {
    if (placements.some((placement) => placement.zone !== mode))
      throw new Error("Taslari secili acma alanina dizmelisiniz");
    const preview = previewOpening({
      placements: placements.map((placement) => ({
        ...placement,
        tile: placement.tas,
      })),
      mode,
      indicator: oda.gameState.gosterge,
      threshold: oda.gameState.mevcutBaraj,
    });
    if (!preview.valid)
      throw new Error(
        mode === "pairs"
          ? "Cift acmak icin 5 gecerli cift gerekli"
          : `Acmak icin en az ${oda.gameState.mevcutBaraj} puan gerekli`,
      );
    score = preview.score;
    preview.groups.forEach((group) => {
      const perId = yeniPerId(oda, mode);
      group.forEach((cell) => {
        const placement = placements.find(
          (item) => coordKey(item) === coordKey(cell),
        );
        if (placement) placement.perId = perId;
      });
    });
    oyuncu.acilisTipi = mode;
    oyuncu.acilisPuani = mode === "series" ? score : preview.pairCount;
    if (mode === "series")
      oda.gameState.mevcutBaraj = nextBarrier(
        oda.kuralTipi,
        oda.gameState.mevcutBaraj,
        score,
      );
  } else {
    for (const zone of ["series", "pairs"]) {
      const additions = placements.filter(
        (placement) => placement.zone === zone,
      );
      if (!additions.length) continue;
      if (oyuncu.acilisTipi === "pairs" && zone === "series")
        throw new Error("Cift acan oyuncu seri perlerine tas isleyemez");
      const committed = oda.gameState.masaZemini[zoneKey(zone)] || [];
      const combined = [...committed, ...additions];
      const groups = groupsFromPlacements(
        combined.map((placement) => ({ ...placement, tile: placement.tas })),
        zoneColumns(zone),
      );
      const affected = groups.filter((group) =>
        group.some((cell) =>
          additions.some((addition) => coordKey(addition) === coordKey(cell)),
        ),
      );
      for (const group of affected) {
        const existingIds = new Set(
          group
            .filter((cell) => cell.perId)
            .map((cell) => String(cell.perId)),
        );
        if (existingIds.size > 1)
          throw new Error("Iki ayri per birlestirilemez");
        const perId = existingIds.values().next().value || yeniPerId(oda, zone);
        group.forEach((cell) => {
          const addition = additions.find(
            (item) => coordKey(item) === coordKey(cell),
          );
          if (addition) addition.perId = perId;
        });
      }
      if (
        zone === "series" &&
        affected.some(
          (group) =>
            !validateSeriesGroup(
              group.map((cell) => cell.tas),
              oda.gameState.gosterge,
            ).valid,
        )
      )
        throw new Error("Islenen seri gecersiz");
      if (
        zone === "pairs" &&
        affected.some(
          (group) =>
            !validatePair(
              group.map((cell) => cell.tas),
              oda.gameState.gosterge,
            ).valid,
        )
      )
        throw new Error("Islenen cift gecersiz");
      if (
        oyuncu.acilisTipi === "series" &&
        zone === "pairs" &&
        !committed.length
      )
        throw new Error("Masada cift acilmadan yeni cift islenemez");
    }
  }

  oyuncu.eldekiTaslar = oyuncu.eldekiTaslar.filter(
    (tile) => !seenTiles.has(String(tile.id)),
  );
  for (const placement of placements)
    oda.gameState.masaZemini[zoneKey(placement.zone)].push(placement);
  // Oyuncunun sectigi koordinatlar korunur; masa kendiliginden toparlanmaz.
  oyuncu.yandanAlinanTasId = null;
  if (ilkAcilis) oyuncu.eldenBitisAdayi = true;
  return { score, placements, oyuncu };
}

// Masa islemi tamamen atomiktir. Dogrulamanin son adiminda (ornegin masa
// yerlestirmesinde) hata cikarsa el, acilis, baraj ve masa eski haline doner.
export function masaHamlesiDogrula(oda, socketId, payload) {
  const oyuncu = oda?.oyuncular?.find((p) => p.socketId === socketId);
  const gameState = oda?.gameState;
  if (!oda || !oyuncu || !gameState)
    return masaHamlesiDogrulaUnsafe(oda, socketId, payload);

  const snapshot = {
    eldekiTaslar: [...(oyuncu.eldekiTaslar || [])],
    cekildiMi: Boolean(oyuncu.cekildiMi),
    acilisTipi: oyuncu.acilisTipi ?? null,
    acilisPuani: Number(oyuncu.acilisPuani || 0),
    yandanAlinanTasId: oyuncu.yandanAlinanTasId ?? null,
    mevcutBaraj: gameState.mevcutBaraj,
    eldenBitisAdayi: Boolean(oyuncu.eldenBitisAdayi),
    perSayaci: gameState.perSayaci,
    masaZemini: {
      seri: (gameState.masaZemini?.seri || []).map((cell) => ({ ...cell })),
      cift: (gameState.masaZemini?.cift || []).map((cell) => ({ ...cell })),
    },
  };

  try {
    return masaHamlesiDogrulaUnsafe(oda, socketId, payload);
  } catch (error) {
    oyuncu.eldekiTaslar = snapshot.eldekiTaslar;
    oyuncu.cekildiMi = snapshot.cekildiMi;
    oyuncu.acilisTipi = snapshot.acilisTipi;
    oyuncu.acilisPuani = snapshot.acilisPuani;
    oyuncu.yandanAlinanTasId = snapshot.yandanAlinanTasId;
    gameState.mevcutBaraj = snapshot.mevcutBaraj;
    oyuncu.eldenBitisAdayi = snapshot.eldenBitisAdayi;
    gameState.perSayaci = snapshot.perSayaci;
    gameState.masaZemini = snapshot.masaZemini;
    throw error;
  }
}

export function jokeriDegistir(oda, socketId, payload) {
  const oyuncu = oda?.oyuncular.find((p) => p.socketId === socketId);
  if (!oda || !oyuncu) throw new Error("Oyuncu odada degil");
  if (
    !oda.gameState.oyunBasladi ||
    oda.gameState.siradakiOyuncu !== oyuncu.koltukNo
  )
    throw new Error("Sira sizde degil");
  if (!oyuncu.acilisTipi)
    throw new Error("Okeyi almak icin once el acmalisiniz");
  if (oyuncu.acilisTipi === "pairs")
    throw new Error("Cift acan oyuncu seri perlerindeki okeyi alamaz");
  if (payload?.zone !== "series")
    throw new Error("Okey yalniz seri alanindan alinabilir");

  const row = Number(payload?.row);
  const col = Number(payload?.col);
  const table = oda.gameState.masaZemini.seri || [];
  const jokerIndex = table.findIndex(
    (cell) => cell.row === row && cell.col === col,
  );
  if (jokerIndex < 0) throw new Error("Bu hucrede okey yok");
  const jokerPlacement = table[jokerIndex];
  if (!resolveTile(jokerPlacement.tas, oda.gameState.gosterge).wildcard)
    throw new Error("Secilen tas gercek okey degil");

  const replacementIndex = oyuncu.eldekiTaslar.findIndex(
    (tile) => String(tile.id) === String(payload?.tasId),
  );
  if (replacementIndex < 0) throw new Error("Tas elinizde degil");
  const replacement = oyuncu.eldekiTaslar[replacementIndex];
  if (resolveTile(replacement, oda.gameState.gosterge).wildcard)
    throw new Error("Okey, baska bir okeyle degistirilemez");

  const group = perGruplari(table, SERIES_COLUMNS).find((cells) =>
    cells.some((cell) => coordKey(cell) === coordKey(jokerPlacement)),
  );
  if (!group) throw new Error("Okeyin bulundugu per bulunamadi");
  const candidate = group.map((cell) =>
    coordKey(cell) === coordKey(jokerPlacement) ? replacement : cell.tas,
  );
  const candidateResult = validateSeriesGroup(
    candidate,
    oda.gameState.gosterge,
  );
  if (!candidateResult.valid)
    throw new Error("Bu tas okeyin temsil ettigi tas degil");
  // Ayni sayili gruptaki gercek okey, ancak dorduncu renk de tamamlaninca
  // geri alinabilir. Uclu bir seti baska bir uclu sete cevirmek yeterli degil.
  if (candidateResult.kind === "set" && group.length !== 4)
    throw new Error(
      "Ayni sayi grubundaki okey ancak dort renk tamamlaninca alinabilir",
    );

  oyuncu.eldekiTaslar.splice(replacementIndex, 1);
  oyuncu.eldekiTaslar.push(jokerPlacement.tas);
  table[jokerIndex] = {
    ...jokerPlacement,
    tasId: replacement.id,
    tas: replacement,
    ownerSocketId: socketId,
    ownerKoltukNo: oyuncu.koltukNo,
  };
  if (String(oyuncu.yandanAlinanTasId) === String(replacement.id))
    oyuncu.yandanAlinanTasId = null;

  const cezaKoltukNo = Number(jokerPlacement.ownerKoltukNo);
  if (Number.isInteger(cezaKoltukNo)) {
    koltukPuaniniGuncelle(oda, cezaKoltukNo, 101);
    koltukCezasiniGuncelle(oda, cezaKoltukNo, 101);
  }
  // Okey degisiminden sonra da mevcut koordinat duzeni korunur.
  return {
    oyuncu,
    cezaKoltukNo: Number.isInteger(cezaKoltukNo) ? cezaKoltukNo : null,
    masaZemini: oda.gameState.masaZemini,
  };
}
