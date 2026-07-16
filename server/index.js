import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  aktifOdalar,
  yeniOdaOlusturulabilir,
  yeniOda,
  genelDurum,
  elDagit,
  masaHamlesiDogrula,
  seriElDogrula,
  koltukDurumunuSakla,
  koltukDurumunuDevral,
  eliTamamla,
  eliBerabereTamamla,
  maciHazirla,
  sonrakiElBaslangicOyuncusu,
  atilanTasIslenebilirMi,
  atilanTasCezaNedeni,
  jokeriDegistir,
  koltukPuaniniGuncelle,
  koltukCezasiniGuncelle,
} from "./game.js";
import { botAtisSec, botMasaPlani } from "./bot.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});
const desteBitisZamanlayicilari = new Map();
const hamleZamanlayicilari = new Map();
const ayrilmaZamanlayicilari = new Map();
const GERI_DONUS_SURESI = 2 * 60 * 1000;
const hata = (socket, message) => socket.emit("hata", { message });
const odaBul = (id) => aktifOdalar[id];
const odaDurumu = (oda) => io.to(oda.odaId).emit("oda-durum", genelDurum(oda));
const odaListesi = () =>
  io.emit("oda-listesi", Object.values(aktifOdalar).map(genelDurum));
const odadaGercekOyuncuVar = (oda) =>
  oda.oyuncular.some((oyuncu) => !oyuncu.bot);
const odayiSil = (oda) => {
  clearTimeout(hamleZamanlayicilari.get(oda.odaId));
  clearTimeout(desteBitisZamanlayicilari.get(oda.odaId));
  hamleZamanlayicilari.delete(oda.odaId);
  desteBitisZamanlayicilari.delete(oda.odaId);
  for (const [anahtar, zamanlayici] of ayrilmaZamanlayicilari)
    if (anahtar.startsWith(`${oda.odaId}:`)) {
      clearTimeout(zamanlayici);
      ayrilmaZamanlayicilari.delete(anahtar);
    }
  io.in(oda.odaId).socketsLeave(oda.odaId);
  delete aktifOdalar[oda.odaId];
};
const odaSahibiniDevret = (oda, ayrilanKullaniciId = null) => {
  if (ayrilanKullaniciId && oda.kurucuId !== ayrilanKullaniciId) return;
  const yeniSahip = oda.oyuncular.find((oyuncu) => !oyuncu.bot);
  oda.kurucuId = yeniSahip?.kullaniciId ?? null;
  oda.kurucuSocketId = yeniSahip?.socketId ?? null;
};
const oyuncuyuRobotaDevret = (oda, oyuncu) => {
  const sonZaman = Date.now() + GERI_DONUS_SURESI;
  const robot = {
    ...oyuncu,
    socketId: `robot-devralan-${Date.now()}-${oyuncu.koltukNo}`,
    kullaniciId: null,
    isim: "Robot",
    avatar: "🤖",
    bot: true,
    devralinanKullaniciId: oyuncu.kullaniciId,
    devralinanIsim: oyuncu.isim,
    devralinanAvatar: oyuncu.avatar,
    devralmaSonZaman: sonZaman,
  };
  const index = oda.oyuncular.indexOf(oyuncu);
  if (index >= 0) oda.oyuncular[index] = robot;
  return robot;
};
const bosKoltuk = (oda) =>
  Array.from({ length: oda.maksimum }, (_, i) => i).find(
    (i) => !oda.oyuncular.some((p) => p.koltukNo === i),
  );
const odadanCikar = (oda, socketId) => {
  const ayrilan = oda.oyuncular.find((p) => p.socketId === socketId);
  if (ayrilan) koltukDurumunuSakla(oda, ayrilan);
  if (ayrilan && !ayrilan.bot && ayrilan.kullaniciId) {
    oda.kullaniciKoltuklari ||= {};
    oda.kullaniciKoltuklari[ayrilan.kullaniciId] = ayrilan.koltukNo;
  }
  oda.oyuncular = oda.oyuncular.filter((p) => p.socketId !== socketId);
  oda.izleyiciler = oda.izleyiciler.filter((id) => id !== socketId);
};
const odaTemizle = (oda) => {
  if (!odadaGercekOyuncuVar(oda)) odayiSil(oda);
};
const elGonder = (socket, oyuncu) =>
  socket.emit("el-guncelle", {
    taslar: oyuncu.eldekiTaslar,
    cekildiMi: Boolean(oyuncu.cekildiMi),
    yandanAlinanTasId: oyuncu.yandanAlinanTasId ?? null,
  });
const oyunDurumu = (oda) =>
  io.to(oda.odaId).emit("oyun-durum", genelDurum(oda));
const sonrakiOyuncu = (oda) => {
  const sira = oda.gameState.oyunSirasi || [];
  const index = sira.indexOf(oda.gameState.siradakiOyuncu);
  oda.gameState.siradakiOyuncu = sira[(index + 1) % sira.length];
  const siradaki = oda.oyuncular.find(
    (oyuncu) => oyuncu.koltukNo === oda.gameState.siradakiOyuncu,
  );
  if (siradaki) siradaki.sureBonusuKullanildi = false;
  hamleZamanlayicisiniKur(oda);
};
const oncekiOyuncuKoltugu = (oda) => {
  const sira = oda.gameState.oyunSirasi || [];
  const index = sira.indexOf(oda.gameState.siradakiOyuncu);
  return index < 0 ? null : sira[(index - 1 + sira.length) % sira.length];
};
const yandanTasiAl = (oda, oyuncu) => {
  const oncekiKoltuk = oncekiOyuncuKoltugu(oda);
  if (
    oncekiKoltuk === null ||
    oda.gameState.sonAtanKoltukNo !== oncekiKoltuk ||
    !oda.gameState.iskartaKutusu.length
  )
    throw new Error("Yandan alinabilecek tas yok");
  const tas = oda.gameState.iskartaKutusu.shift();
  const gecmis = oda.gameState.atisGecmisi[oncekiKoltuk] || [];
  const index = gecmis.findIndex((item) => String(item.id) === String(tas.id));
  if (index >= 0) gecmis.splice(index, 1);
  oda.gameState.atisGecmisi[oncekiKoltuk] = gecmis;
  if (gecmis[0]) oda.gameState.sonAtislar[oncekiKoltuk] = gecmis[0];
  else delete oda.gameState.sonAtislar[oncekiKoltuk];
  oyuncu.eldekiTaslar.push(tas);
  oyuncu.cekildiMi = true;
  oyuncu.yandanAlinanTasId = tas.id;
  return { tas, oncekiKoltuk };
};
const yandanTasiIadeEt = (oda, oyuncu) => {
  const tasId = oyuncu.yandanAlinanTasId;
  if (!tasId) throw new Error("Iade edilecek yandan tas yok");
  const index = oyuncu.eldekiTaslar.findIndex(
    (tas) => String(tas.id) === String(tasId),
  );
  if (index < 0) throw new Error("Yandan alinan tas bulunamadi");
  const tas = oyuncu.eldekiTaslar.splice(index, 1)[0];
  const oncekiKoltuk = oncekiOyuncuKoltugu(oda);
  oda.gameState.iskartaKutusu.unshift(tas);
  oda.gameState.sonAtanKoltukNo = oncekiKoltuk;
  oda.gameState.sonAtislar[oncekiKoltuk] = tas;
  oda.gameState.atisGecmisi[oncekiKoltuk] = [
    tas,
    ...(oda.gameState.atisGecmisi[oncekiKoltuk] || []),
  ].slice(0, 3);
  oyuncu.cekildiMi = false;
  oyuncu.yandanAlinanTasId = null;
  return tas;
};
const atisiKaydet = (oda, oyuncu, atilan) => {
  oda.gameState.iskartaKutusu.unshift(atilan);
  oda.gameState.sonAtanKoltukNo = oyuncu.koltukNo;
  oda.gameState.sonAtislar[oyuncu.koltukNo] = atilan;
  oda.gameState.atisGecmisi[oyuncu.koltukNo] = [
    atilan,
    ...(oda.gameState.atisGecmisi[oyuncu.koltukNo] || []),
  ].slice(0, 3);
  oyuncu.cekildiMi = false;
  oyuncu.eldenBitisAdayi = false;
};
const atisCezasiUygula = (oda, oyuncu, tas, { bitiriyor = false } = {}) => {
  const neden = atilanTasCezaNedeni(oda, tas, { bitiriyor });
  if (!neden) return null;
  const toplam = koltukPuaniniGuncelle(oda, oyuncu.koltukNo, 101);
  const cezaToplami = koltukCezasiniGuncelle(oda, oyuncu.koltukNo, 101);
  const ceza = {
    koltukNo: oyuncu.koltukNo,
    socketId: oyuncu.socketId,
    isim: oyuncu.isim,
    puan: 101,
    toplam,
    cezaToplami,
    neden,
  };
  io.to(oda.odaId).emit("ceza-uygulandi", ceza);
  return ceza;
};
const eliBitir = (oda, oyuncu, atilan, options = {}) => {
  clearTimeout(hamleZamanlayicilari.get(oda.odaId));
  hamleZamanlayicilari.delete(oda.odaId);
  oda.gameState.hamleSonZaman = null;
  oda.gameState.hamleSuresi = null;
  clearTimeout(desteBitisZamanlayicilari.get(oda.odaId));
  desteBitisZamanlayicilari.delete(oda.odaId);
  const sonuc = eliTamamla(oda, oyuncu, atilan, options);
  io.to(oda.odaId).emit("el-tamamlandi", {
    sonuc,
    oda: genelDurum(oda),
  });
  oyunDurumu(oda);
  odaDurumu(oda);
  if (sonuc.macBitti) odayiSil(oda);
  odaListesi();
};
const eliBerabereBitir = (oda) => {
  clearTimeout(hamleZamanlayicilari.get(oda.odaId));
  hamleZamanlayicilari.delete(oda.odaId);
  oda.gameState.hamleSonZaman = null;
  oda.gameState.hamleSuresi = null;
  clearTimeout(desteBitisZamanlayicilari.get(oda.odaId));
  desteBitisZamanlayicilari.delete(oda.odaId);
  const sonuc = eliBerabereTamamla(oda);
  io.to(oda.odaId).emit("el-tamamlandi", {
    sonuc,
    oda: genelDurum(oda),
  });
  oyunDurumu(oda);
  odaDurumu(oda);
  if (sonuc.macBitti) odayiSil(oda);
  odaListesi();
};
const desteBittiBildir = (oda, sonOyuncu = null) => {
  const g = oda.gameState;
  clearTimeout(hamleZamanlayicilari.get(oda.odaId));
  hamleZamanlayicilari.delete(oda.odaId);
  if (!Number.isInteger(g.eliBitirecekKoltukNo)) {
    const botVar = oda.oyuncular.some((oyuncu) => oyuncu.bot);
    const kurucuInsan = oda.oyuncular.find(
      (oyuncu) => !oyuncu.bot && oyuncu.kullaniciId === oda.kurucuId,
    );
    const ilkInsan = oda.oyuncular.find((oyuncu) => !oyuncu.bot);
    g.eliBitirecekKoltukNo = botVar
      ? (kurucuInsan ?? ilkInsan)?.koltukNo ?? g.siradakiOyuncu
      : sonOyuncu?.koltukNo ?? g.siradakiOyuncu;
    g.desteBitisSonZaman = Date.now() + 30_000;
    const beklenenSonZaman = g.desteBitisSonZaman;
    const zamanlayici = setTimeout(() => {
      if (
        aktifOdalar[oda.odaId] &&
        g.oyunBasladi &&
        g.deste.length === 0 &&
        g.desteBitisSonZaman === beklenenSonZaman
      )
        eliBerabereBitir(oda);
    }, 30_000);
    desteBitisZamanlayicilari.set(oda.odaId, zamanlayici);
  }
  g.hamleSonZaman = g.desteBitisSonZaman;
  g.hamleSuresi = 30;
  io.to(oda.odaId).emit("deste-bitti", {
    message: "Taş kalmadı, el 30 saniye içinde bitecek",
    eliBitirecekKoltukNo: g.eliBitirecekKoltukNo,
    sonZaman: g.desteBitisSonZaman,
  });
  oyunDurumu(oda);
  odaDurumu(oda);
};

const guvenliAtisSec = (oda, oyuncu) => {
  const guvenliTaslar = oyuncu.eldekiTaslar.filter(
    (tas) => !atilanTasIslenebilirMi(oda, tas),
  );
  return botAtisSec(
    {
      ...oyuncu,
      eldekiTaslar: guvenliTaslar.length
        ? guvenliTaslar
        : oyuncu.eldekiTaslar,
    },
    oda.gameState.gosterge,
  );
};

const hamleZamanlayicisiniKur = (
  oda,
  { mevcutSureyiKoru = false, ekSure = 0 } = {},
) => {
  clearTimeout(hamleZamanlayicilari.get(oda.odaId));
  hamleZamanlayicilari.delete(oda.odaId);
  const g = oda?.gameState;
  const oyuncu = oda?.oyuncular.find(
    (item) => item.koltukNo === g?.siradakiOyuncu,
  );
  if (!g?.oyunBasladi || !oyuncu || g.deste.length === 0) {
    if (g && g.deste.length > 0) {
      g.hamleSonZaman = null;
      g.hamleSuresi = null;
    }
    return;
  }

  const ilkAtis = g.sonAtanKoltukNo == null && Boolean(oyuncu.cekildiMi);
  const varsayilanSure = ilkAtis ? 120 : 60;
  const simdi = Date.now();
  const bonus = Math.max(0, Number(ekSure) || 0);
  const mevcutKalanMs = Math.max(0, Number(g.hamleSonZaman || 0) - simdi);
  const sureMs =
    mevcutSureyiKoru && mevcutKalanMs > 0
      ? mevcutKalanMs + bonus * 1000
      : (varsayilanSure + bonus) * 1000;
  const sureLimiti =
    mevcutSureyiKoru && mevcutKalanMs > 0
      ? Math.max(varsayilanSure, Number(g.hamleSuresi) || varsayilanSure) + bonus
      : varsayilanSure + bonus;
  const beklenenKoltuk = oyuncu.koltukNo;
  const beklenenCekmeDurumu = Boolean(oyuncu.cekildiMi);
  g.hamleSuresi = sureLimiti;
  g.hamleSonZaman = simdi + sureMs;

  const zamanlayici = setTimeout(() => {
    const aktifOda = aktifOdalar[oda.odaId];
    const aktifOyuncu = aktifOda?.oyuncular.find(
      (item) => item.koltukNo === aktifOda.gameState.siradakiOyuncu,
    );
    if (
      !aktifOda?.gameState.oyunBasladi ||
      aktifOyuncu?.koltukNo !== beklenenKoltuk ||
      Boolean(aktifOyuncu.cekildiMi) !== beklenenCekmeDurumu
    )
      return;

    if (!aktifOyuncu.cekildiMi) {
      const tas = aktifOda.gameState.deste.pop();
      if (!tas) return desteBittiBildir(aktifOda, aktifOyuncu);
      aktifOyuncu.eldekiTaslar.push(tas);
      aktifOyuncu.cekildiMi = true;
      aktifOyuncu.yandanAlinanTasId = null;
      io.to(aktifOda.odaId).emit("tas-cekildi", {
        koltukNo: aktifOyuncu.koltukNo,
        kaynak: "deste",
        otomatik: true,
      });
      elGonder(io.to(aktifOyuncu.socketId), aktifOyuncu);
    }

    // Yandan alinan tas zamaninda islenmediyse geri koyup desteden cekerek
    // turu guvenli bir otomatik atisla tamamla.
    if (aktifOyuncu.yandanAlinanTasId) {
      yandanTasiIadeEt(aktifOda, aktifOyuncu);
      const yedek = aktifOda.gameState.deste.pop();
      if (!yedek) return desteBittiBildir(aktifOda, aktifOyuncu);
      aktifOyuncu.eldekiTaslar.push(yedek);
      aktifOyuncu.cekildiMi = true;
    }
    const secilen = guvenliAtisSec(aktifOda, aktifOyuncu);
    const index = aktifOyuncu.eldekiTaslar.findIndex(
      (tas) => String(tas.id) === String(secilen?.id),
    );
    const atilan = aktifOyuncu.eldekiTaslar.splice(index >= 0 ? index : 0, 1)[0];
    if (!atilan) return;
    const bitiriyor =
      aktifOyuncu.eldekiTaslar.length === 0 && aktifOyuncu.acilisTipi;
    const eldenBitti = Boolean(aktifOyuncu.eldenBitisAdayi && bitiriyor);
    atisCezasiUygula(aktifOda, aktifOyuncu, atilan, { bitiriyor });
    atisiKaydet(aktifOda, aktifOyuncu, atilan);
    io.to(aktifOda.odaId).emit("tas-atildi", {
      koltukNo: aktifOyuncu.koltukNo,
      tas: atilan,
      otomatik: true,
    });
    elGonder(io.to(aktifOyuncu.socketId), aktifOyuncu);
    if (bitiriyor)
      return eliBitir(aktifOda, aktifOyuncu, atilan, { eldenBitti });
    sonrakiOyuncu(aktifOda);
    oyunDurumu(aktifOda);
    odaDurumu(aktifOda);
    robotTurunuBaslat(aktifOda);
  }, sureMs);
  hamleZamanlayicilari.set(oda.odaId, zamanlayici);
};

const robotTurunuBaslat = (oda) => {
  const turdaki = () =>
    oda.oyuncular.find((p) => p.koltukNo === oda.gameState.siradakiOyuncu);
  if (!oda.gameState.oyunBasladi || !turdaki()?.bot) return;
  setTimeout(() => {
    if (!aktifOdalar[oda.odaId] || !oda.gameState.oyunBasladi) return;
    const robot = turdaki();
    if (!robot?.bot) return;
    if (!robot.cekildiMi) {
      let kaynak = "deste";
      let tas;
      const yandaki = oda.gameState.iskartaKutusu[0];
      if (
        yandaki &&
        oda.gameState.sonAtanKoltukNo === oncekiOyuncuKoltugu(oda)
      ) {
        robot.eldekiTaslar.push(yandaki);
        const yandanPlan = botMasaPlani(oda, robot);
        robot.eldekiTaslar.pop();
        if (
          yandanPlan?.placements.some(
            (placement) => String(placement.tasId) === String(yandaki.id),
          )
        ) {
          tas = yandanTasiAl(oda, robot).tas;
          kaynak = "yan";
        }
      }
      if (!tas) {
        tas = oda.gameState.deste.pop();
        if (!tas) return desteBittiBildir(oda, robot);
        robot.eldekiTaslar.push(tas);
        robot.cekildiMi = true;
        robot.yandanAlinanTasId = null;
      }
      io.to(oda.odaId).emit("tas-cekildi", {
        koltukNo: robot.koltukNo,
        kaynak,
        tas: kaynak === "yan" ? tas : undefined,
      });
      oyunDurumu(oda);
    }
    setTimeout(() => {
      if (!aktifOdalar[oda.odaId] || turdaki()?.socketId !== robot.socketId)
        return;
      const plan = botMasaPlani(oda, robot);
      if (plan) {
        try {
          masaHamlesiDogrula(oda, robot.socketId, plan);
          io.to(oda.odaId).emit("robot-masa-hamlesi", {
            koltukNo: robot.koltukNo,
            mode: plan.mode,
          });
          oyunDurumu(oda);
        } catch {
          if (robot.yandanAlinanTasId) {
            yandanTasiIadeEt(oda, robot);
            const yedekTas = oda.gameState.deste.pop();
            if (!yedekTas) return desteBittiBildir(oda, robot);
            robot.eldekiTaslar.push(yedekTas);
            robot.cekildiMi = true;
            io.to(oda.odaId).emit("tas-cekildi", {
              koltukNo: robot.koltukNo,
              kaynak: "deste",
            });
          }
        }
      }
      // Bot, masadaki gecerli bir peri uzatabilecek tasi ancak baska secenegi
      // yoksa atar. Boylece bilerek 101 ceza toplamaya devam etmez.
      const secilen = guvenliAtisSec(oda, robot);
      const index = robot.eldekiTaslar.findIndex((tile) => tile.id === secilen?.id);
      const atilan = robot.eldekiTaslar.splice(index >= 0 ? index : 0, 1)[0];
      if (!atilan) return;
      const bitiriyor = robot.eldekiTaslar.length === 0 && robot.acilisTipi;
      const eldenBitti = Boolean(robot.eldenBitisAdayi && bitiriyor);
      atisCezasiUygula(oda, robot, atilan, { bitiriyor });
      atisiKaydet(oda, robot, atilan);
      io.to(oda.odaId).emit("tas-atildi", {
        koltukNo: robot.koltukNo,
        tas: atilan,
      });
      if (bitiriyor) {
        eliBitir(oda, robot, atilan, { eldenBitti });
        return;
      }
      sonrakiOyuncu(oda);
      oyunDurumu(oda);
      odaDurumu(oda);
      robotTurunuBaslat(oda);
    }, 850);
  }, 450);
};
const taslariDagit = (oda) => {
  if (!oda || oda.gameState.oyunBasladi) return;
  elDagit(oda);
  hamleZamanlayicisiniKur(oda);
  io.to(oda.odaId).emit("taslar-dagitiliyor", { odaId: oda.odaId });
  oda.oyuncular
    .filter((p) => !p.bot)
    .forEach((p) => elGonder(io.to(p.socketId), p));
  io.to(oda.odaId).emit("taslar-dagitildi", {
    odaId: oda.odaId,
    oda: genelDurum(oda),
  });
  oyunDurumu(oda);
  odaDurumu(oda);
  robotTurunuBaslat(oda);
};

io.on("connection", (socket) => {
  socket.on("oda-listesi-iste", odaListesi);
  socket.on("oda-olustur", (veri) => {
    try {
      if (!yeniOdaOlusturulabilir()) {
        return hata(socket, "En fazla 5 aktif oda olusturulabilir");
      }
      const odaId = `oda-${Math.random().toString(36).slice(2, 8)}`;
      const maksimum = [2, 3, 4].includes(veri?.maksimum) ? veri.maksimum : 4;
      const oda = yeniOda(
        odaId,
        String(veri?.odaAdi || "Yeni Masa").slice(0, 40),
        {
          socketId: socket.id,
          kullaniciId: String(veri?.kullaniciId || socket.id),
          isim: "Oyuncu",
        },
        maksimum,
        veri?.kuralTipi,
        veri?.toplamEl,
      );
      aktifOdalar[odaId] = oda;
      socket.join(odaId);
      socket.data.izlenenOdaId = odaId;
      socket.emit("oda-olusturuldu", { odaId });
      odaDurumu(oda);
      odaListesi();
    } catch {
      hata(socket, "Oda olusturulamadi");
    }
  });
  socket.on("oda-sil", (veri) => {
    const odaId = veri?.odaId ?? veri;
    const oda = odaBul(odaId);
    if (!oda || oda.kurucuId !== veri?.kullaniciId)
      return hata(socket, "Oda silinemedi");
    odayiSil(oda);
    odaListesi();
  });
  socket.on("oda-katil", (veri) => {
    const odaId =
      typeof veri === "string" || typeof veri === "number" ? veri : veri?.odaId;
    const oda = odaBul(odaId);
    if (!oda) return hata(socket, "Oda bulunamadi");
    if (oda.gameState.elDurumu === "mac-tamamlandi")
      return hata(socket, "Bu oyun tamamlandi");
    const kullaniciId = String(veri?.kullaniciId || socket.id);
    const onceki = odaBul(socket.data.oynadigiOdaId);
    if (onceki && onceki.odaId !== odaId) {
      odadanCikar(onceki, socket.id);
      socket.leave(onceki.odaId);
      odaTemizle(onceki);
      if (aktifOdalar[onceki.odaId]) odaDurumu(onceki);
    }
    if (oda.oyuncular.some((p) => p.socketId === socket.id))
      return socket.emit("oda-katildi", { odaId });
    const yenidenBaglanan = oda.oyuncular.find(
      (p) => !p.bot && p.kullaniciId === kullaniciId,
    );
    if (yenidenBaglanan) {
      const ayrilmaAnahtari = `${oda.odaId}:${kullaniciId}`;
      clearTimeout(ayrilmaZamanlayicilari.get(ayrilmaAnahtari));
      ayrilmaZamanlayicilari.delete(ayrilmaAnahtari);
      yenidenBaglanan.socketId = socket.id;
      socket.join(odaId);
      socket.data.oynadigiOdaId = odaId;
      socket.data.izlenenOdaId = odaId;
      oda.izleyiciler = oda.izleyiciler.filter((id) => id !== socket.id);
      if (yenidenBaglanan.kullaniciId === oda.kurucuId)
        oda.kurucuSocketId = socket.id;
      if (oda.gameState.oyunBasladi) elGonder(socket, yenidenBaglanan);
      socket.emit("oda-katildi", {
        odaId,
        oyunBasladi: Boolean(oda.gameState.oyunBasladi),
        oda: genelDurum(oda),
      });
      odaDurumu(oda);
      odaListesi();
      return;
    }
    const devralanRobot = oda.oyuncular.find(
      (p) =>
        p.bot &&
        p.devralinanKullaniciId === kullaniciId &&
        Number(p.devralmaSonZaman || 0) >= Date.now(),
    );
    if (devralanRobot) {
      devralanRobot.socketId = socket.id;
      devralanRobot.kullaniciId = kullaniciId;
      devralanRobot.isim = String(
        veri?.isim || devralanRobot.devralinanIsim || "Oyuncu",
      ).slice(0, 20);
      devralanRobot.avatar = String(
        veri?.avatar || devralanRobot.devralinanAvatar || "🙂",
      );
      devralanRobot.bot = false;
      delete devralanRobot.devralinanKullaniciId;
      delete devralanRobot.devralinanIsim;
      delete devralanRobot.devralinanAvatar;
      delete devralanRobot.devralmaSonZaman;
      socket.join(odaId);
      socket.data.oynadigiOdaId = odaId;
      socket.data.izlenenOdaId = odaId;
      if (oda.gameState.oyunBasladi) elGonder(socket, devralanRobot);
      socket.emit("oda-katildi", {
        odaId,
        oyunBasladi: Boolean(oda.gameState.oyunBasladi),
        oda: genelDurum(oda),
      });
      odaDurumu(oda);
      odaListesi();
      return;
    }
    if (oda.gameState.macAktif)
      return hata(socket, "Devam eden oyuna yeni oyuncu katilamaz");
    if (oda.oyuncular.length >= oda.maksimum) return hata(socket, "Oda dolu");
    const kayitliKoltuk = oda.kullaniciKoltuklari?.[kullaniciId];
    const istenenKoltuk = Number.isInteger(veri?.koltukNo)
      ? veri.koltukNo
      : Number.isInteger(kayitliKoltuk)
        ? kayitliKoltuk
        : bosKoltuk(oda);
    if (
      istenenKoltuk < 0 ||
      istenenKoltuk >= oda.maksimum ||
      oda.oyuncular.some((p) => p.koltukNo === istenenKoltuk)
    )
      return hata(socket, "Koltuk dolu");
    oda.izleyiciler = oda.izleyiciler.filter((id) => id !== socket.id);
    socket.join(odaId);
    socket.data.oynadigiOdaId = odaId;
    oda.kullaniciKoltuklari ||= {};
    oda.kullaniciKoltuklari[kullaniciId] = istenenKoltuk;
    const devralinan = koltukDurumunuDevral(oda, istenenKoltuk);
    const yeniOyuncu = {
      socketId: socket.id,
      kullaniciId,
      isim: String(veri?.isim || "Oyuncu").slice(0, 20),
      avatar: String(veri?.avatar || "🙂"),
      koltukNo: istenenKoltuk,
      eldekiTaslar: devralinan?.eldekiTaslar || [],
      cekildiMi: Boolean(devralinan?.cekildiMi),
      acilisTipi: devralinan?.acilisTipi ?? null,
      acilisPuani: Number(devralinan?.acilisPuani || 0),
      yandanAlinanTasId: devralinan?.yandanAlinanTasId ?? null,
      sureBonusuKullanildi: Boolean(devralinan?.sureBonusuKullanildi),
      puan: Number(oda.koltukPuanlari?.[istenenKoltuk] || 0),
    };
    oda.oyuncular.push(yeniOyuncu);
    if (yeniOyuncu.kullaniciId === oda.kurucuId)
      oda.kurucuSocketId = socket.id;
    if (oda.gameState.oyunBasladi) elGonder(socket, yeniOyuncu);
    socket.emit("oda-katildi", {
      odaId,
      oyunBasladi: Boolean(oda.gameState.oyunBasladi),
      oda: genelDurum(oda),
    });
    odaDurumu(oda);
    odaListesi();
  });
  socket.on("oda-ayril", (odaId) => {
    const oda = odaBul(odaId);
    if (!oda) return;
    const ayrilan = oda.oyuncular.find((p) => p.socketId === socket.id);
    const aktifMac = Boolean(
      oda.gameState.macAktif || oda.gameState.oyunBasladi,
    );
    if (ayrilan && !ayrilan.bot && aktifMac) {
      oyuncuyuRobotaDevret(oda, ayrilan);
      odaSahibiniDevret(oda, ayrilan.kullaniciId);
    } else {
      const ayrilanKullaniciId = ayrilan?.kullaniciId ?? null;
      odadanCikar(oda, socket.id);
      odaSahibiniDevret(oda, ayrilanKullaniciId);
    }
    socket.leave(oda.odaId);
    socket.data.oynadigiOdaId = null;
    socket.data.izlenenOdaId = null;
    if (!odadaGercekOyuncuVar(oda)) {
      odayiSil(oda);
      odaListesi();
      return;
    }
    odaTemizle(oda);
    if (aktifOdalar[oda.odaId]) {
      odaDurumu(oda);
      if (oda.gameState.siradakiOyuncu === ayrilan?.koltukNo)
        robotTurunuBaslat(oda);
    }
    odaListesi();
  });
  socket.on("profil-guncelle", (veri) => {
    const oda = odaBul(veri?.odaId ?? socket.data.oynadigiOdaId);
    if (!oda) return hata(socket, "Oda bulunamadi");
    const oyuncu = oda.oyuncular.find((p) => p.socketId === socket.id);
    if (!oyuncu || oyuncu.bot) return hata(socket, "Profil guncellenemedi");
    const isim = String(veri?.isim || "").trim().slice(0, 20);
    const avatar = String(veri?.avatar || "").slice(0, 8);
    if (!isim || !avatar) return hata(socket, "Profil bilgileri gecersiz");
    oyuncu.isim = isim;
    oyuncu.avatar = avatar;
    odaDurumu(oda);
    odaListesi();
  });
  socket.on("robot-ekle", (veri) => {
    const oda = odaBul(veri?.odaId ?? veri);
    const insanSayisi = oda?.oyuncular.filter((p) => !p.bot).length ?? 0;
    const robotSayisi = oda?.oyuncular.filter((p) => p.bot).length ?? 0;
    if (
      !oda ||
      oda.gameState.macAktif ||
      !insanSayisi ||
      robotSayisi >= oda.maksimum - 1 ||
      oda.oyuncular.length >= oda.maksimum
    )
      return hata(socket, "Oda tamamen robotlarla doldurulamaz");
    const koltukNo = Number.isInteger(veri?.koltukNo)
      ? veri.koltukNo
      : bosKoltuk(oda);
    if (koltukNo < 0 || oda.oyuncular.some((p) => p.koltukNo === koltukNo))
      return hata(socket, "Koltuk dolu");
    oda.oyuncular.push({
      socketId: `robot-${Date.now()}-${koltukNo}`,
      isim: "Robot",
      avatar: "🤖",
      bot: true,
      koltukNo,
      eldekiTaslar: [],
      puan: Number(oda.koltukPuanlari?.[koltukNo] || 0),
    });
    odaDurumu(oda);
    odaListesi();
  });
  socket.on("robot-sil", (veri) => {
    const oda = odaBul(veri?.odaId ?? veri);
    if (!oda || oda.gameState.macAktif)
      return hata(socket, "Aktif mac sirasinda robot degistirilemez");
    const koltukNo = veri?.koltukNo;
    oda.oyuncular = oda.oyuncular.filter(
      (p) => !(p.bot && (koltukNo === undefined || p.koltukNo === koltukNo)),
    );
    odaDurumu(oda);
    odaListesi();
  });
  socket.on("oyun-baslat", () => {
    const oda = odaBul(socket.data.oynadigiOdaId);
    if (
      !oda ||
      oda.kurucuSocketId !== socket.id ||
      oda.oyuncular.length !== oda.maksimum ||
      oda.gameState.macAktif
    )
      return hata(socket, "Oda dolmadan oyun baslatilamaz");
    oda.gameState.oyunSirasi = [...oda.oyuncular]
      .sort((a, b) => a.koltukNo - b.koltukNo)
      .map((p) => p.koltukNo);
    oda.gameState.baslangicOyuncu = oda.gameState.oyunSirasi[0];
    oda.gameState.siradakiOyuncu = oda.gameState.baslangicOyuncu;
    maciHazirla(oda);
    io.to(oda.odaId).emit("oyun-hazir", {
      odaId: oda.odaId,
      oda: genelDurum(oda),
    });
    odaDurumu(oda);
    const ilkOyuncu = oda.oyuncular.find(
      (p) => p.koltukNo === oda.gameState.baslangicOyuncu,
    );
    if (ilkOyuncu?.bot) setTimeout(() => taslariDagit(oda), 700);
  });
  socket.on("taslari-dagit", () => {
    const oda = odaBul(socket.data.oynadigiOdaId);
    const p = oda?.oyuncular.find((x) => x.socketId === socket.id);
    if (
      !oda ||
      !p ||
      oda.gameState.oyunBasladi ||
      p.koltukNo !== oda.gameState.baslangicOyuncu
    )
      return hata(socket, "Taşları yalnızca ilk oyuncu dağıtabilir");
    taslariDagit(oda);
  });
  socket.on("seri-sure-bonusu", (ack) => {
    try {
      const oda = odaBul(socket.data.oynadigiOdaId);
      const oyuncu = oda?.oyuncular.find(
        (item) => item.socketId === socket.id,
      );
      if (!oda?.gameState.oyunBasladi || !oyuncu)
        throw new Error("Aktif el bulunamadı");
      if (oyuncu.koltukNo !== oda.gameState.siradakiOyuncu)
        throw new Error("Sıra sizde değil");
      if (oyuncu.sureBonusuKullanildi) {
        if (typeof ack === "function") ack({ ok: true, uygulandi: false });
        return;
      }

      oyuncu.sureBonusuKullanildi = true;
      hamleZamanlayicisiniKur(oda, {
        mevcutSureyiKoru: true,
        ekSure: 30,
      });
      oyunDurumu(oda);
      odaDurumu(oda);
      if (typeof ack === "function")
        ack({
          ok: true,
          uygulandi: true,
          hamleSonZaman: oda.gameState.hamleSonZaman,
          hamleSuresi: oda.gameState.hamleSuresi,
        });
    } catch (error) {
      const message = error?.message || "Süre bonusu uygulanamadı";
      if (typeof ack === "function") ack({ ok: false, error: message });
    }
  });
  socket.on("sonraki-el", () => {
    const oda = odaBul(socket.data.oynadigiOdaId);
    if (!oda || oda.kurucuSocketId !== socket.id)
      return hata(socket, "Yeni eli yalnizca oda kurucusu baslatabilir");
    if (oda.gameState.elDurumu !== "tamamlandi")
      return hata(socket, "Yeni el henuz baslatilamaz");
    oda.gameState.baslangicOyuncu = sonrakiElBaslangicOyuncusu(oda);
    oda.gameState.siradakiOyuncu = oda.gameState.baslangicOyuncu;
    taslariDagit(oda);
  });
  socket.on("tas-cek", (kaynak) => {
    const oda = odaBul(socket.data.oynadigiOdaId);
    const p = oda?.oyuncular.find((x) => x.socketId === socket.id);
    if (
      !oda ||
      !p ||
      !oda.gameState.oyunBasladi ||
      p.koltukNo !== oda.gameState.siradakiOyuncu
    )
      return hata(socket, "Sira sizde degil");
    if (p.cekildiMi) return hata(socket, "Taşı zaten çektin, taş atmalısın");
    if (kaynak === "iskarta") {
      try {
        const { tas, oncekiKoltuk } = yandanTasiAl(oda, p);
        hamleZamanlayicisiniKur(oda, { mevcutSureyiKoru: true });
        io.to(oda.odaId).emit("tas-cekildi", {
          koltukNo: p.koltukNo,
          atanKoltukNo: oncekiKoltuk,
          kaynak: "yan",
          tas,
        });
        elGonder(socket, p);
        oyunDurumu(oda);
        odaDurumu(oda);
      } catch (error) {
        hata(socket, error?.message || "Yandan tas alinamadi");
      }
      return;
    }
    /* Legacy side-draw rejection is kept unreachable below. */
    if (false)
      return hata(
        socket,
        "Yandan taş, yalnızca eli bitirecek hamlede alınabilir",
      );
    const tas = oda.gameState.deste.pop();
    if (!tas) {
      hata(socket, "Taş kalmadı, eli bitirmelisin");
      desteBittiBildir(oda, p);
      return;
    }
    p.eldekiTaslar.push(tas);
    p.cekildiMi = true;
    p.yandanAlinanTasId = null;
    hamleZamanlayicisiniKur(oda, { mevcutSureyiKoru: true });
    io.to(oda.odaId).emit("tas-cekildi", {
      koltukNo: p.koltukNo,
      kaynak: "deste",
    });
    elGonder(socket, p);
    oyunDurumu(oda);
    odaDurumu(oda);
  });
  socket.on("eli-bitir", () => {
    try {
      const oda = odaBul(socket.data.oynadigiOdaId);
      const p = oda?.oyuncular.find((x) => x.socketId === socket.id);
      if (!oda || !p || !oda.gameState.oyunBasladi)
        throw new Error("Aktif el bulunamadı");
      if (oda.gameState.deste.length > 0)
        throw new Error("Ortada hâlâ taş var");
      if (p.koltukNo !== oda.gameState.eliBitirecekKoltukNo)
        throw new Error("Bu eli yalnızca belirlenen oyuncu bitirebilir");
      eliBerabereBitir(oda);
    } catch (error) {
      hata(socket, error?.message || "El bitirilemedi");
    }
  });
  socket.on("deste-bitti-hazirla", () => {
    const oda = odaBul(socket.data.oynadigiOdaId);
    const oyuncu = oda?.oyuncular.find((item) => item.socketId === socket.id);
    if (
      !oda ||
      !oyuncu ||
      !oda.gameState.oyunBasladi ||
      oda.gameState.deste.length > 0
    )
      return;
    desteBittiBildir(oda, oyuncu);
  });
  socket.on("yandan-tas-iade", () => {
    try {
      const oda = odaBul(socket.data.oynadigiOdaId);
      const p = oda?.oyuncular.find((x) => x.socketId === socket.id);
      if (
        !oda ||
        !p ||
        p.koltukNo !== oda.gameState.siradakiOyuncu ||
        !oda.gameState.oyunBasladi
      )
        throw new Error("Yandan tas su anda iade edilemez");
      yandanTasiIadeEt(oda, p);
      hamleZamanlayicisiniKur(oda, { mevcutSureyiKoru: true });
      elGonder(socket, p);
      oyunDurumu(oda);
      odaDurumu(oda);
    } catch (error) {
      hata(socket, error?.message || "Yandan tas iade edilemedi");
    }
  });
  socket.on("tas-at", (tasId) => {
    const oda = odaBul(socket.data.oynadigiOdaId);
    const p = oda?.oyuncular.find((x) => x.socketId === socket.id);
    if (!oda || !p || p.koltukNo !== oda.gameState.siradakiOyuncu)
      return hata(socket, "Sira sizde degil");
    if (!p.cekildiMi) return hata(socket, "Önce taş çekmelisin");
    if (p.yandanAlinanTasId)
      return hata(socket, "Yandan aldiginiz tasi masaya islemelisiniz");
    const i = p.eldekiTaslar.findIndex((t) => String(t.id) === String(tasId));
    if (i < 0) return hata(socket, "Tas elinizde degil");
    const atilan = p.eldekiTaslar.splice(i, 1)[0];
    const bitiriyor = p.eldekiTaslar.length === 0 && p.acilisTipi;
    const eldenBitti = Boolean(p.eldenBitisAdayi && bitiriyor);
    atisCezasiUygula(oda, p, atilan, { bitiriyor });
    atisiKaydet(oda, p, atilan);
    io.to(oda.odaId).emit("tas-atildi", { koltukNo: p.koltukNo, tas: atilan });
    elGonder(socket, p);
    if (bitiriyor) {
      eliBitir(oda, p, atilan, { eldenBitti });
      return;
    }
    sonrakiOyuncu(oda);
    oyunDurumu(oda);
    odaDurumu(oda);
    robotTurunuBaslat(oda);
  });
  socket.on("seri-el-ac", (perler) => {
    try {
      const oda = odaBul(socket.data.oynadigiOdaId);
      if (!oda) throw new Error("Oda bulunamadi");
      const toplam = seriElDogrula(oda, socket.id, perler);
      io.to(oda.odaId).emit("el-acildi", {
        socketId: socket.id,
        toplam,
        masaZemini: oda.gameState.masaZemini,
        mevcutBaraj: oda.gameState.mevcutBaraj,
      });
      const p = oda.oyuncular.find((x) => x.socketId === socket.id);
      socket.emit("el-guncelle", p.eldekiTaslar);
    } catch (e) {
      hata(socket, e.message || "El acilamadi");
    }
  });
  socket.on("masa-hamlesi-onayla", (payload, ack) => {
    try {
      const oda = odaBul(socket.data.oynadigiOdaId);
      if (!oda) throw new Error("Oda bulunamadi");
      const result = masaHamlesiDogrula(oda, socket.id, payload);
      elGonder(socket, result.oyuncu);
      oyunDurumu(oda);
      odaDurumu(oda);
      if (typeof ack === "function")
        ack({
          ok: true,
          mevcutBaraj: oda.gameState.mevcutBaraj,
          masaZemini: oda.gameState.masaZemini,
        });
    } catch (error) {
      const message = error?.message || "Taslar islenemedi";
      hata(socket, message);
      if (typeof ack === "function") ack({ ok: false, error: message });
    }
  });
  socket.on("joker-degistir", (payload, ack) => {
    let yandanAlindi = false;
    let oda;
    let oyuncu;
    try {
      oda = odaBul(socket.data.oynadigiOdaId);
      if (!oda) throw new Error("Oda bulunamadi");
      oyuncu = oda.oyuncular.find((player) => player.socketId === socket.id);
      if (!oyuncu) throw new Error("Oyuncu odada degil");
      if (payload?.kaynak === "iskarta") {
        if (oyuncu.cekildiMi)
          throw new Error("Tasi zaten cektiniz, tas atmalisiniz");
        const ustTas = oda.gameState.iskartaKutusu[0];
        if (!ustTas || String(ustTas.id) !== String(payload?.tasId))
          throw new Error("Yandaki en ust tas degisti, tekrar deneyin");
        const { tas } = yandanTasiAl(oda, oyuncu);
        payload = { ...payload, tasId: tas.id };
        yandanAlindi = true;
      }
      const result = jokeriDegistir(oda, socket.id, payload);
      if (yandanAlindi)
        hamleZamanlayicisiniKur(oda, { mevcutSureyiKoru: true });
      elGonder(socket, result.oyuncu);
      if (result.cezaKoltukNo !== null) {
        const cezali = oda.oyuncular.find(
          (player) => player.koltukNo === result.cezaKoltukNo,
        );
        io.to(oda.odaId).emit("ceza-uygulandi", {
          koltukNo: result.cezaKoltukNo,
          socketId: cezali?.socketId,
          isim: cezali?.isim || "Oyuncu",
          puan: 101,
          toplam: oda.koltukPuanlari[result.cezaKoltukNo],
          cezaToplami: oda.koltukCezaPuanlari[result.cezaKoltukNo],
          neden: "Masadaki okey degistirildi",
        });
      }
      oyunDurumu(oda);
      odaDurumu(oda);
      if (typeof ack === "function")
        ack({ ok: true, masaZemini: result.masaZemini });
    } catch (error) {
      if (yandanAlindi && oda && oyuncu?.yandanAlinanTasId) {
        try {
          yandanTasiIadeEt(oda, oyuncu);
          elGonder(socket, oyuncu);
          oyunDurumu(oda);
          odaDurumu(oda);
        } catch {
          // Asil dogrulama hatasi istemciye gonderilir.
        }
      }
      const message = error?.message || "Okey degistirilemedi";
      hata(socket, message);
      if (typeof ack === "function") ack({ ok: false, error: message });
    }
  });
  socket.on("disconnect", () => {
    for (const oda of Object.values(aktifOdalar)) {
      if (
        !oda.oyuncular.some((p) => p.socketId === socket.id) &&
        !oda.izleyiciler.includes(socket.id)
      )
        continue;
      const oyuncu = oda.oyuncular.find((p) => p.socketId === socket.id);
      if (oyuncu && !oyuncu.bot) {
        const kullaniciId = oyuncu.kullaniciId;
        const koltukNo = oyuncu.koltukNo;
        const ayrilmaAnahtari = `${oda.odaId}:${kullaniciId}`;
        oyuncu.socketId = null;
        if (oyuncu.kullaniciId === oda.kurucuId) oda.kurucuSocketId = null;
        clearTimeout(ayrilmaZamanlayicilari.get(ayrilmaAnahtari));
        const zamanlayici = setTimeout(() => {
          ayrilmaZamanlayicilari.delete(ayrilmaAnahtari);
          const current = aktifOdalar[oda.odaId];
          const bekleyen = current?.oyuncular.find(
            (p) =>
              !p.bot &&
              !p.socketId &&
              p.kullaniciId === kullaniciId &&
              p.koltukNo === koltukNo,
          );
          if (!current || !bekleyen) return;
          const aktifMac = Boolean(
            current.gameState.macAktif || current.gameState.oyunBasladi,
          );
          if (aktifMac) oyuncuyuRobotaDevret(current, bekleyen);
          else
            current.oyuncular = current.oyuncular.filter(
              (p) => p !== bekleyen,
            );
          odaSahibiniDevret(current, kullaniciId);
          if (!odadaGercekOyuncuVar(current)) {
            odayiSil(current);
            odaListesi();
            return;
          }
          odaDurumu(current);
          odaListesi();
          if (aktifMac && current.gameState.siradakiOyuncu === koltukNo)
            robotTurunuBaslat(current);
        }, GERI_DONUS_SURESI);
        ayrilmaZamanlayicilari.set(ayrilmaAnahtari, zamanlayici);
      }
      oda.izleyiciler = oda.izleyiciler.filter((id) => id !== socket.id);
      odaDurumu(oda);
    }
    odaListesi();
  });
});
app.get("/health", (_, res) =>
  res.json({ ok: true, rooms: Object.keys(aktifOdalar).length }),
);
const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => console.log(`101 backend listening on :${port}`));
