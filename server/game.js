export const aktifOdalar = Object.create(null);

const renkler = ["kirmizi", "mavi", "siyah", "sari"];
export function desteOlustur() {
  const taslar = [];
  for (let kopya = 0; kopya < 2; kopya++) for (const renk of renkler) for (let deger = 1; deger <= 13; deger++) taslar.push({ id: `${kopya}-${renk}-${deger}`, renk, deger });
  taslar.push({ id: "joker-1", renk: "joker", deger: 0 }, { id: "joker-2", renk: "joker", deger: 0 });
  for (let i = taslar.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [taslar[i], taslar[j]] = [taslar[j], taslar[i]]; }
  return taslar;
}

export function yeniOda(odaId, odaAdi, oyuncu, maksimum = 4) { return { odaId, odaAdi, maksimum, kurucuSocketId: oyuncu.socketId, oyuncular: [], izleyiciler: [oyuncu.socketId], gameState: { oyunBasladi: false, siradakiOyuncu: 0, deste: [], gosterge: null, iskartaKutusu: [], mevcutBaraj: 101, masaZemini: { seri: [], cift: [] } } }; }
export function genelDurum(oda) { return { odaId: oda.odaId, odaAdi: oda.odaAdi, maksimum: oda.maksimum, kurucuSocketId: oda.kurucuSocketId, oyuncular: oda.oyuncular.map(({ socketId, isim, koltukNo }) => ({ socketId, isim, koltukNo })), izleyiciSayisi: oda.izleyiciler.length, oyunBasladi: oda.gameState.oyunBasladi, siradakiOyuncu: oda.gameState.siradakiOyuncu, mevcutBaraj: oda.gameState.mevcutBaraj }; }
export function elDagit(oda) { const g = oda.gameState; g.deste = desteOlustur(); g.gosterge = g.deste.pop(); g.iskartaKutusu = []; g.masaZemini = { seri: [], cift: [] }; oda.oyuncular.forEach((p, i) => { p.eldekiTaslar = g.deste.splice(-((i === g.siradakiOyuncu) ? 22 : 21)); }); g.oyunBasladi = true; }
function ayniTas(a, b) { return a && b && a.id === b.id; }
export function siraliPerGecerli(per) { if (!Array.isArray(per) || per.length < 3) return false; if (per.some(t => t.renk === "joker")) return false; const renkAyni = per.every(t => t.renk === per[0].renk); const degerler = per.map(t => t.deger).sort((a, b) => a - b); const ard = degerler.every((v, i) => i === 0 || v === degerler[i - 1] + 1); const grup = new Set(per.map(t => t.deger)).size === 1 && new Set(per.map(t => t.renk)).size === per.length; return (renkAyni && ard) || grup; }
export function seriElDogrula(oda, socketId, perler) { const oyuncu = oda.oyuncular.find(p => p.socketId === socketId); if (!oyuncu) throw new Error("Oyuncu odada degil"); const taslar = perler.flat(); if (!perler.length || perler.some(p => !siraliPerGecerli(p))) throw new Error("Gecersiz per"); if (new Set(taslar.map(t => t.id)).size !== taslar.length || taslar.some(t => !oyuncu.eldekiTaslar.some(x => ayniTas(x, t)))) throw new Error("Taslar oyuncunun elinde degil"); const toplam = taslar.reduce((n, t) => n + (t.renk === "joker" ? 0 : t.deger), 0); if (toplam < oda.gameState.mevcutBaraj) throw new Error(`Baraj ${oda.gameState.mevcutBaraj}`); oyuncu.eldekiTaslar = oyuncu.eldekiTaslar.filter(t => !taslar.some(x => ayniTas(x, t))); oda.gameState.masaZemini.seri.push(...perler); oda.gameState.mevcutBaraj = toplam + 1; return toplam; }
