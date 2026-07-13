import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { aktifOdalar, yeniOda, genelDurum, elDagit, seriElDogrula } from "./game.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
const hata = (socket, message) => socket.emit("hata", { message });
const odaBul = (id) => aktifOdalar[id];
const odaDurumu = (oda) => io.to(oda.odaId).emit("oda-durum", genelDurum(oda));
const odaListesi = () => io.emit("oda-listesi", Object.values(aktifOdalar).map(genelDurum));
const bosKoltuk = (oda) => Array.from({ length: oda.maksimum }, (_, i) => i).find(i => !oda.oyuncular.some(p => p.koltukNo === i));
const odadanCikar = (oda, socketId) => { oda.oyuncular = oda.oyuncular.filter(p => p.socketId !== socketId); oda.izleyiciler = oda.izleyiciler.filter(id => id !== socketId); };
const odaTemizle = (oda) => { if (!oda.oyuncular.length && !oda.izleyiciler.length) delete aktifOdalar[oda.odaId]; };
const elGonder = (socket, oyuncu) => socket.emit("el-guncelle", { taslar: oyuncu.eldekiTaslar, cekildiMi: Boolean(oyuncu.cekildiMi) });
const oyunDurumu = oda => io.to(oda.odaId).emit("oyun-durum", genelDurum(oda));
const sonrakiOyuncu = oda => { const sira=oda.gameState.oyunSirasi || []; const index=sira.indexOf(oda.gameState.siradakiOyuncu); oda.gameState.siradakiOyuncu = sira[(index+1)%sira.length]; };
const robotTurunuBaslat = oda => {
  const turdaki = () => oda.oyuncular.find(p => p.koltukNo === oda.gameState.siradakiOyuncu);
  if (!oda.gameState.oyunBasladi || !turdaki()?.bot) return;
  setTimeout(() => {
    if (!aktifOdalar[oda.odaId] || !oda.gameState.oyunBasladi) return;
    const robot = turdaki(); if (!robot?.bot) return;
    if (!robot.cekildiMi) { const tas = oda.gameState.deste.pop(); if (!tas) return; robot.eldekiTaslar.push(tas); robot.cekildiMi = true; io.to(oda.odaId).emit("tas-cekildi", { koltukNo:robot.koltukNo, kaynak:"deste" }); oyunDurumu(oda); }
    setTimeout(() => {
      if (!aktifOdalar[oda.odaId] || turdaki()?.socketId!==robot.socketId) return;
      const index = Math.floor(Math.random() * robot.eldekiTaslar.length);
      const atilan = robot.eldekiTaslar.splice(index, 1)[0];
      oda.gameState.iskartaKutusu.unshift(atilan); oda.gameState.sonAtanKoltukNo = robot.koltukNo; oda.gameState.sonAtislar[robot.koltukNo]=atilan; oda.gameState.atisGecmisi[robot.koltukNo]=[atilan,...(oda.gameState.atisGecmisi[robot.koltukNo]||[])].slice(0,3); robot.cekildiMi = false; io.to(oda.odaId).emit("tas-atildi", { koltukNo:robot.koltukNo, tas:atilan });
      sonrakiOyuncu(oda); oyunDurumu(oda); odaDurumu(oda); robotTurunuBaslat(oda);
    }, 850);
  }, 450);
};
const taslariDagit = oda => {
  if (!oda || oda.gameState.oyunBasladi) return;
  elDagit(oda);
  oda.oyuncular.filter(p => !p.bot).forEach(p => elGonder(io.to(p.socketId), p));
  io.to(oda.odaId).emit("taslar-dagitildi", { odaId: oda.odaId, oda: genelDurum(oda) });
  oyunDurumu(oda); odaDurumu(oda); robotTurunuBaslat(oda);
};

io.on("connection", socket => {
  socket.on("oda-listesi-iste", odaListesi);
  socket.on("oda-olustur", veri => {
    try {
      const odaId = `oda-${Math.random().toString(36).slice(2, 8)}`;
      const maksimum = [2, 3, 4].includes(veri?.maksimum) ? veri.maksimum : 4;
      const oda = yeniOda(odaId, String(veri?.odaAdi || "Yeni Masa").slice(0, 40), { socketId: socket.id, kullaniciId: String(veri?.kullaniciId || socket.id), isim: "Oyuncu" }, maksimum);
      aktifOdalar[odaId] = oda; socket.join(odaId); socket.data.izlenenOdaId = odaId;
      socket.emit("oda-olusturuldu", { odaId }); odaDurumu(oda); odaListesi();
    } catch { hata(socket, "Oda olusturulamadi"); }
  });
  socket.on("oda-izle", odaId => { const oda = odaBul(odaId); if (!oda) return hata(socket, "Oda bulunamadi"); socket.join(odaId); socket.data.izlenenOdaId = odaId; if (!oda.oyuncular.some(p => p.socketId === socket.id) && !oda.izleyiciler.includes(socket.id)) oda.izleyiciler.push(socket.id); odaDurumu(oda); odaListesi(); });
  socket.on("oda-sil", veri => { const odaId = veri?.odaId ?? veri; const oda = odaBul(odaId); if (!oda || oda.kurucuId !== veri?.kullaniciId) return hata(socket, "Oda silinemedi"); io.in(odaId).socketsLeave(odaId); delete aktifOdalar[odaId]; odaListesi(); });
  socket.on("oda-katil", veri => {
    const odaId = typeof veri === "string" || typeof veri === "number" ? veri : veri?.odaId;
    const oda = odaBul(odaId); if (!oda) return hata(socket, "Oda bulunamadi");
    const onceki = odaBul(socket.data.oynadigiOdaId);
    if (onceki && onceki.odaId !== odaId) { odadanCikar(onceki, socket.id); socket.leave(onceki.odaId); odaTemizle(onceki); if (aktifOdalar[onceki.odaId]) odaDurumu(onceki); }
    if (oda.oyuncular.some(p => p.socketId === socket.id)) return socket.emit("oda-katildi", { odaId });
    if (oda.oyuncular.length >= oda.maksimum) return hata(socket, "Oda dolu");
    const istenenKoltuk = Number.isInteger(veri?.koltukNo) ? veri.koltukNo : bosKoltuk(oda);
    if (istenenKoltuk < 0 || istenenKoltuk >= oda.maksimum || oda.oyuncular.some(p => p.koltukNo === istenenKoltuk)) return hata(socket, "Koltuk dolu");
    oda.izleyiciler = oda.izleyiciler.filter(id => id !== socket.id); socket.join(odaId); socket.data.oynadigiOdaId = odaId;
    oda.oyuncular.push({ socketId: socket.id, kullaniciId: String(veri?.kullaniciId || socket.id), isim: String(veri?.isim || "Oyuncu").slice(0, 20), avatar: String(veri?.avatar || "🙂"), koltukNo: istenenKoltuk, eldekiTaslar: [] });
    socket.emit("oda-katildi", { odaId }); odaDurumu(oda); odaListesi();
  });
  socket.on("oda-ayril", odaId => { const oda = odaBul(odaId); if (!oda) return; odadanCikar(oda, socket.id); if (!oda.izleyiciler.includes(socket.id)) oda.izleyiciler.push(socket.id); socket.data.oynadigiOdaId = null; odaDurumu(oda); odaListesi(); });
  socket.on("robot-ekle", veri => { const oda = odaBul(veri?.odaId ?? veri); const insanSayisi = oda?.oyuncular.filter(p => !p.bot).length ?? 0; const robotSayisi = oda?.oyuncular.filter(p => p.bot).length ?? 0; if (!oda || !insanSayisi || robotSayisi >= oda.maksimum - 1 || oda.oyuncular.length >= oda.maksimum) return hata(socket, "Oda tamamen robotlarla doldurulamaz"); const koltukNo = Number.isInteger(veri?.koltukNo) ? veri.koltukNo : bosKoltuk(oda); if (koltukNo < 0 || oda.oyuncular.some(p => p.koltukNo === koltukNo)) return hata(socket, "Koltuk dolu"); oda.oyuncular.push({ socketId: `robot-${Date.now()}-${koltukNo}`, isim: "Robot", avatar: "🤖", bot: true, koltukNo, eldekiTaslar: [] }); odaDurumu(oda); odaListesi(); });
  socket.on("robot-sil", veri => { const oda = odaBul(veri?.odaId ?? veri); if (!oda) return hata(socket, "Robot silinemedi"); const koltukNo = veri?.koltukNo; oda.oyuncular = oda.oyuncular.filter(p => !(p.bot && (koltukNo === undefined || p.koltukNo === koltukNo))); odaDurumu(oda); odaListesi(); });
  socket.on("oyun-baslat", () => { const oda = odaBul(socket.data.oynadigiOdaId); if (!oda || oda.kurucuSocketId !== socket.id || oda.oyuncular.length !== oda.maksimum) return hata(socket, "Oda dolmadan oyun baslatilamaz"); oda.gameState.oyunSirasi=[...oda.oyuncular].sort((a,b)=>a.koltukNo-b.koltukNo).map(p=>p.koltukNo); oda.gameState.baslangicOyuncu=oda.gameState.oyunSirasi[0]; oda.gameState.siradakiOyuncu=oda.gameState.baslangicOyuncu; oda.gameState.oyunBasladi=false; io.to(oda.odaId).emit("oyun-hazir", { odaId: oda.odaId, oda: genelDurum(oda) }); odaDurumu(oda); const ilkOyuncu=oda.oyuncular.find(p=>p.koltukNo===oda.gameState.baslangicOyuncu); if (ilkOyuncu?.bot) setTimeout(()=>taslariDagit(oda),700); });
  socket.on("taslari-dagit", () => { const oda = odaBul(socket.data.oynadigiOdaId); const p=oda?.oyuncular.find(x=>x.socketId===socket.id); if (!oda || !p || oda.gameState.oyunBasladi || p.koltukNo!==oda.gameState.baslangicOyuncu) return hata(socket,"Taşları yalnızca ilk oyuncu dağıtabilir"); taslariDagit(oda); });
  socket.on("tas-cek", kaynak => { const oda = odaBul(socket.data.oynadigiOdaId); const p = oda?.oyuncular.find(x => x.socketId === socket.id); if (!oda || !p || !oda.gameState.oyunBasladi || p.koltukNo !== oda.gameState.siradakiOyuncu) return hata(socket, "Sira sizde degil"); if (p.cekildiMi) return hata(socket, "Taşı zaten çektin, taş atmalısın"); if (kaynak === "iskarta") return hata(socket, "Yandan taş, yalnızca eli bitirecek hamlede alınabilir"); const tas = oda.gameState.deste.pop(); if (!tas) return hata(socket, "Deste bitti"); p.eldekiTaslar.push(tas); p.cekildiMi = true; io.to(oda.odaId).emit("tas-cekildi", { koltukNo:p.koltukNo, kaynak:"deste" }); elGonder(socket, p); oyunDurumu(oda); odaDurumu(oda); });
  socket.on("tas-at", tasId => { const oda = odaBul(socket.data.oynadigiOdaId); const p = oda?.oyuncular.find(x => x.socketId === socket.id); if (!oda || !p || p.koltukNo !== oda.gameState.siradakiOyuncu) return hata(socket, "Sira sizde degil"); if (!p.cekildiMi) return hata(socket, "Önce taş çekmelisin"); const i = p.eldekiTaslar.findIndex(t => String(t.id) === String(tasId)); if (i < 0) return hata(socket, "Tas elinizde degil"); const atilan=p.eldekiTaslar.splice(i, 1)[0]; oda.gameState.iskartaKutusu.unshift(atilan); oda.gameState.sonAtanKoltukNo = p.koltukNo; oda.gameState.sonAtislar[p.koltukNo]=atilan; oda.gameState.atisGecmisi[p.koltukNo]=[atilan,...(oda.gameState.atisGecmisi[p.koltukNo]||[])].slice(0,3); p.cekildiMi = false; sonrakiOyuncu(oda); io.to(oda.odaId).emit("tas-atildi", { koltukNo:p.koltukNo, tas:atilan }); elGonder(socket, p); oyunDurumu(oda); odaDurumu(oda); robotTurunuBaslat(oda); });
  socket.on("seri-el-ac", perler => { try { const oda = odaBul(socket.data.oynadigiOdaId); if (!oda) throw new Error("Oda bulunamadi"); const toplam = seriElDogrula(oda, socket.id, perler); io.to(oda.odaId).emit("el-acildi", { socketId: socket.id, toplam, masaZemini: oda.gameState.masaZemini, mevcutBaraj: oda.gameState.mevcutBaraj }); const p = oda.oyuncular.find(x => x.socketId === socket.id); socket.emit("el-guncelle", p.eldekiTaslar); } catch (e) { hata(socket, e.message || "El acilamadi"); } });
  socket.on("disconnect", () => { for (const oda of Object.values(aktifOdalar)) { if (!oda.oyuncular.some(p => p.socketId === socket.id) && !oda.izleyiciler.includes(socket.id)) continue; odadanCikar(oda, socket.id); if (!oda.oyuncular.length && !oda.izleyiciler.length) setTimeout(() => { const current = aktifOdalar[oda.odaId]; if (current && !current.oyuncular.length && !current.izleyiciler.length) { delete aktifOdalar[oda.odaId]; odaListesi(); } }, 30000); else odaDurumu(oda); } odaListesi(); });
});
app.get("/health", (_, res) => res.json({ ok: true, rooms: Object.keys(aktifOdalar).length }));
const port = Number(process.env.PORT || 4000); httpServer.listen(port, () => console.log(`101 backend listening on :${port}`));
