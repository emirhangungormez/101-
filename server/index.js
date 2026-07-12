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

io.on("connection", socket => {
  socket.on("oda-listesi-iste", odaListesi);
  socket.on("oda-olustur", veri => {
    try {
      const odaId = `oda-${Math.random().toString(36).slice(2, 8)}`;
      const maksimum = [2, 3, 4].includes(veri?.maksimum) ? veri.maksimum : 4;
      const oda = yeniOda(odaId, String(veri?.odaAdi || "Yeni Masa").slice(0, 40), { socketId: socket.id, isim: "Oyuncu" }, maksimum);
      aktifOdalar[odaId] = oda; socket.join(odaId); socket.data.izlenenOdaId = odaId;
      socket.emit("oda-olusturuldu", { odaId }); odaDurumu(oda); odaListesi();
    } catch { hata(socket, "Oda olusturulamadi"); }
  });
  socket.on("oda-izle", odaId => { const oda = odaBul(odaId); if (!oda) return hata(socket, "Oda bulunamadi"); socket.join(odaId); socket.data.izlenenOdaId = odaId; if (!oda.oyuncular.some(p => p.socketId === socket.id) && !oda.izleyiciler.includes(socket.id)) oda.izleyiciler.push(socket.id); odaDurumu(oda); odaListesi(); });
  socket.on("oda-sil", odaId => { const oda = odaBul(odaId); if (!oda || oda.kurucuSocketId !== socket.id) return hata(socket, "Oda silinemedi"); io.in(odaId).socketsLeave(odaId); delete aktifOdalar[odaId]; odaListesi(); });
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
    oda.oyuncular.push({ socketId: socket.id, isim: String(veri?.isim || "Oyuncu").slice(0, 20), avatar: String(veri?.avatar || "🙂"), koltukNo: istenenKoltuk, eldekiTaslar: [] });
    socket.emit("oda-katildi", { odaId }); odaDurumu(oda); odaListesi();
  });
  socket.on("oda-ayril", odaId => { const oda = odaBul(odaId); if (!oda) return; odadanCikar(oda, socket.id); if (!oda.izleyiciler.includes(socket.id)) oda.izleyiciler.push(socket.id); socket.data.oynadigiOdaId = null; odaDurumu(oda); odaListesi(); });
  socket.on("robot-ekle", veri => { const oda = odaBul(veri?.odaId ?? veri); if (!oda || oda.kurucuSocketId !== socket.id || oda.oyuncular.length >= oda.maksimum) return hata(socket, "Robot eklenemedi"); const koltukNo = Number.isInteger(veri?.koltukNo) ? veri.koltukNo : bosKoltuk(oda); if (koltukNo < 0 || oda.oyuncular.some(p => p.koltukNo === koltukNo)) return hata(socket, "Koltuk dolu"); oda.oyuncular.push({ socketId: `robot-${Date.now()}-${koltukNo}`, isim: "Robot", avatar: "🤖", bot: true, koltukNo, eldekiTaslar: [] }); odaDurumu(oda); odaListesi(); });
  socket.on("robot-sil", veri => { const oda = odaBul(veri?.odaId ?? veri); if (!oda || oda.kurucuSocketId !== socket.id) return hata(socket, "Robot silinemedi"); const koltukNo = veri?.koltukNo; oda.oyuncular = oda.oyuncular.filter(p => !(p.bot && (koltukNo === undefined || p.koltukNo === koltukNo))); odaDurumu(oda); odaListesi(); });
  socket.on("oyun-baslat", () => { const oda = odaBul(socket.data.oynadigiOdaId); if (!oda || oda.kurucuSocketId !== socket.id || oda.oyuncular.length !== oda.maksimum) return hata(socket, "Oda dolmadan oyun baslatilamaz"); oda.oyuncular.sort((a, b) => a.koltukNo - b.koltukNo); oda.gameState.siradakiOyuncu = 0; elDagit(oda); oda.oyuncular.filter(p => !p.bot).forEach(p => io.to(p.socketId).emit("el-guncelle", p.eldekiTaslar)); odaDurumu(oda); });
  socket.on("tas-cek", kaynak => { const oda = odaBul(socket.data.oynadigiOdaId); const p = oda?.oyuncular.find(x => x.socketId === socket.id); if (!oda || !p || !oda.gameState.oyunBasladi || p.koltukNo !== oda.gameState.siradakiOyuncu) return hata(socket, "Sira sizde degil"); const tas = kaynak === "iskarta" ? oda.gameState.iskartaKutusu.shift() : oda.gameState.deste.pop(); if (!tas) return hata(socket, "Tas kalmadi"); p.eldekiTaslar.push(tas); socket.emit("el-guncelle", p.eldekiTaslar); odaDurumu(oda); });
  socket.on("tas-at", tasId => { const oda = odaBul(socket.data.oynadigiOdaId); const p = oda?.oyuncular.find(x => x.socketId === socket.id); if (!oda || !p || p.koltukNo !== oda.gameState.siradakiOyuncu) return hata(socket, "Sira sizde degil"); const i = p.eldekiTaslar.findIndex(t => t.id === tasId); if (i < 0) return hata(socket, "Tas elinizde degil"); oda.gameState.iskartaKutusu.unshift(p.eldekiTaslar.splice(i, 1)[0]); oda.gameState.siradakiOyuncu = (oda.gameState.siradakiOyuncu + 1) % oda.maksimum; socket.emit("el-guncelle", p.eldekiTaslar); odaDurumu(oda); });
  socket.on("seri-el-ac", perler => { try { const oda = odaBul(socket.data.oynadigiOdaId); if (!oda) throw new Error("Oda bulunamadi"); const toplam = seriElDogrula(oda, socket.id, perler); io.to(oda.odaId).emit("el-acildi", { socketId: socket.id, toplam, masaZemini: oda.gameState.masaZemini, mevcutBaraj: oda.gameState.mevcutBaraj }); const p = oda.oyuncular.find(x => x.socketId === socket.id); socket.emit("el-guncelle", p.eldekiTaslar); } catch (e) { hata(socket, e.message || "El acilamadi"); } });
  socket.on("disconnect", () => { for (const oda of Object.values(aktifOdalar)) { if (!oda.oyuncular.some(p => p.socketId === socket.id) && !oda.izleyiciler.includes(socket.id)) continue; odadanCikar(oda, socket.id); odaTemizle(oda); if (aktifOdalar[oda.odaId]) odaDurumu(oda); } odaListesi(); });
});
app.get("/health", (_, res) => res.json({ ok: true, rooms: Object.keys(aktifOdalar).length }));
const port = Number(process.env.PORT || 4000); httpServer.listen(port, () => console.log(`101 backend listening on :${port}`));
