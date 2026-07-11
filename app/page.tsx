"use client";

import { useMemo, useState } from "react";

type Color = "red" | "blue" | "black" | "yellow" | "joker";
type Tile = { id: number; value: number | "J"; color: Color };
type RackCell = Tile | null;
type TableTile = Tile & { origin: number };
type Zone = "series" | "pairs";

const colors: Color[] = ["red", "blue", "black", "yellow"];
const initialTiles: Tile[] = [
  [3,"red"],[4,"red"],[5,"red"],[8,"blue"],[8,"black"],[8,"yellow"],[11,"black"],[12,"black"],[13,"black"],[1,"yellow"],[2,"yellow"],[3,"yellow"],[6,"blue"],[6,"red"],[9,"yellow"],[10,"yellow"],[11,"yellow"],[4,"blue"],[5,"blue"],[7,"red"],[12,"blue"],["J","joker"],
].map(([value,color], id) => ({ id: id + 1, value: value as number | "J", color: color as Color }));

const blankRack = (): RackCell[] => Array.from({ length: 44 }, (_, i) => initialTiles[i] ?? null);
const blankTable = () => ({ series: Array<TableTile | null>(72).fill(null), pairs: Array<TableTile | null>(36).fill(null) });

function TileView({ tile, compact = false, draggable = false, onDragStart, onDoubleClick }: { tile: Tile; compact?: boolean; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDoubleClick?: () => void }) {
  return <div className={`tile tile-${tile.color} ${compact ? "compact" : ""}`} draggable={draggable} onDragStart={onDragStart} onDoubleClick={onDoubleClick} role="button" tabIndex={0} aria-label={`${tile.color} ${tile.value} taşı`}><span>{tile.value}</span><i>{tile.color === "joker" ? "◆" : "•"}</i></div>;
}

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "lobby" | "room" | "game">("menu");
  const [roomSize, setRoomSize] = useState<2 | 4>(4);
  const [roomName, setRoomName] = useState("101 Masası");
  const [rooms, setRooms] = useState([{ id: 1, name: "Akşam Oyunu", owner: "Mert", players: 2, max: 4, status: "OYUN BEKLİYOR" }]);
  const [selectedRoom, setSelectedRoom] = useState(1);
  const [bots, setBots] = useState(0);
  const [rack, setRack] = useState<RackCell[]>(blankRack);
  const [table, setTable] = useState(blankTable);
  const [discard, setDiscard] = useState<Tile[]>([{ id: 90, value: 7, color: "blue" }, { id: 91, value: 12, color: "red" }]);
  const [game, setGame] = useState({ siradakiOyuncu: 0, mevcutBaraj: 101, gostergeTas: { id: 99, value: 5, color: "yellow" } as Tile, kalanTasSayisi: 42, tur: 49, opened: false });
  const [notice, setNotice] = useState("Sıra sizde — desteden veya yerden taş çekin");
  const [hasDrawn, setHasDrawn] = useState(false);
  const isMyTurn = game.siradakiOyuncu === 0;
  const pending = [...table.series, ...table.pairs].filter(Boolean) as TableTile[];
  const score = pending.reduce((sum, tile) => sum + (typeof tile.value === "number" ? tile.value : 0), 0);
  const buttonActivity = { canSeriAc: isMyTurn && pending.length >= 3, canCiftAc: isMyTurn && table.pairs.filter(Boolean).length >= 2, canGeriTopla: pending.length > 0, canTasIsle: isMyTurn && game.opened && pending.length > 0 };

  const dragData = (e: React.DragEvent) => { try { return JSON.parse(e.dataTransfer.getData("application/json")); } catch { return null; } };
  const beginDrag = (e: React.DragEvent, source: string, index: number) => e.dataTransfer.setData("application/json", JSON.stringify({ source, index }));
  const reject = () => setNotice("Bu hamle şu anda yapılamaz");

  const dropTable = (e: React.DragEvent, zone: Zone, index: number) => {
    e.preventDefault(); const data = dragData(e);
    if (!isMyTurn || !data || data.source !== "rack" || table[zone][index]) return reject();
    const tile = rack[data.index]; if (!tile) return;
    setRack(old => old.map((v, i) => i === data.index ? null : v));
    setTable(old => ({ ...old, [zone]: old[zone].map((v, i) => i === index ? { ...tile, origin: data.index } : v) }));
    setNotice(`${zone === "series" ? "Seri" : "Çift"} alanına taş yerleştirildi`);
  };

  const drawTile = (source: "deck" | "discard", target?: number) => {
    if (!isMyTurn || hasDrawn) return reject();
    const empty = target ?? rack.findIndex(v => !v); if (empty < 0 || rack[empty]) return setNotice("Istakada boş yer yok");
    const tile = source === "discard" ? discard.at(-1) : { id: Date.now(), value: ((game.tur % 13) + 1), color: colors[game.tur % 4] } as Tile;
    if (!tile) return;
    setRack(old => old.map((v, i) => i === empty ? tile : v));
    if (source === "discard") setDiscard(old => old.slice(0, -1)); else setGame(g => ({ ...g, kalanTasSayisi: g.kalanTasSayisi - 1, tur: g.tur + 1 }));
    setHasDrawn(true); setNotice("Bir taş çektiniz — hamlenizi tamamlayın");
  };

  const dropRack = (e: React.DragEvent, index: number) => {
    e.preventDefault(); const data = dragData(e); if (!data || rack[index]) return;
    if (data.source === "deck" || data.source === "discard") return drawTile(data.source, index);
    if (data.source === "rack") { setRack(old => { const n=[...old]; n[index]=n[data.index]; n[data.index]=null; return n; }); }
  };

  const collect = () => { const next=[...rack]; pending.forEach(t => { const pos = next[t.origin] ? next.findIndex(v => !v) : t.origin; if (pos >= 0) next[pos] = { id:t.id,value:t.value,color:t.color }; }); setRack(next); setTable(blankTable()); setNotice("Bekleyen taşlar ıstakaya geri alındı"); };
  const openHand = (kind: "series" | "pairs") => { const needed = kind === "series" ? game.mevcutBaraj : 5; const count = table[kind].filter(Boolean).length; if ((kind === "series" && score < needed) || (kind === "pairs" && count < needed)) return setNotice(kind === "series" ? `Toplam ${score}. Açmak için en az ${needed} puan gerekli` : "Çift açmak için en az 5 çift gerekli"); setGame(g => ({ ...g, opened: true, mevcutBaraj: Math.max(g.mevcutBaraj, score + 1) })); setNotice(kind === "series" ? `${score} puanla el açıldı` : "Çift el açıldı"); };
  const discardTile = (e: React.DragEvent) => { e.preventDefault(); const d=dragData(e); if (!isMyTurn || !hasDrawn || d?.source !== "rack") return reject(); const tile=rack[d.index]; if(!tile)return; setRack(r=>r.map((v,i)=>i===d.index?null:v)); setDiscard(s=>[...s,tile]); setHasDrawn(false); setGame(g=>({...g,siradakiOyuncu:1,tur:g.tur+1})); setNotice("Taş atıldı — sıra Kuzen_1'de"); setTimeout(()=>{setGame(g=>({...g,siradakiOyuncu:0}));setNotice("Sıra yeniden sizde");},1200); };
  const sortRack = (mode:"series"|"pairs") => { const tiles=rack.filter(Boolean) as Tile[]; tiles.sort(mode==="series" ? (a,b)=>colors.indexOf(a.color)-colors.indexOf(b.color)||(Number(a.value)||99)-(Number(b.value)||99) : (a,b)=>(Number(a.value)||99)-(Number(b.value)||99)||colors.indexOf(a.color)-colors.indexOf(b.color)); setRack([...tiles,...Array(44-tiles.length).fill(null)]); setNotice(mode==="series"?"Taşlar serilere göre dizildi":"Taşlar çiftlere göre dizildi"); };

  const players = [{name:"Siz",count:rack.filter(Boolean).length},{name:bots > 0 ? "Bilgisayar_1" : "Kuzen_1",count:21},{name:bots > 1 ? "Bilgisayar_2" : "Zeynep",count:20},{name:bots > 2 ? "Bilgisayar_3" : "Mert",count:19}];
  const createRoom = () => { const id = Date.now(); setRooms(old => [...old, { id, name: roomName || "Yeni Masa", owner: "Siz", players: 1, max: roomSize, status: "SİZİN ODA" }]); setSelectedRoom(id); setBots(0); setScreen("room"); };
  const joinRoom = (id: number) => { setSelectedRoom(id); setScreen("room"); };
  const addComputer = () => setBots(old => Math.min(roomSize - 1, old + 1));
  if (screen === "menu") return <StartMenu onStart={() => setScreen("lobby")} onSettings={() => setNotice("Ayarlar yakında eklenecek")} notice={notice} />;
  if (screen === "lobby") return <Lobby rooms={rooms} roomName={roomName} setRoomName={setRoomName} roomSize={roomSize} setRoomSize={setRoomSize} onCreate={createRoom} onJoin={joinRoom} onBack={() => setScreen("menu")} />;
  if (screen === "room") { const room = rooms.find(r => r.id === selectedRoom) ?? rooms[0]; return <RoomView room={room} bots={bots} onAddComputer={addComputer} onStart={() => setScreen("game")} onBack={() => setScreen("lobby")} />; }
  return <main className="game-shell">
    <header className="topbar"><div><b>101</b><span>OKEY</span></div><p>MASA 07 <em>•</em> 4 OYUNCU</p><button aria-label="Ayarlar">•••</button></header>
    <section className="game-area">
      <Opponent p={players[1]} active={game.siradakiOyuncu===1} className="opponent top-left" />
      <Opponent p={players[2]} active={game.siradakiOyuncu===2} className="opponent top-right" />
      <div className="table-head"><div><span>SERİ ALANI</span><small>ARDIŞIK & GRUP PERLER</small></div><div><span>ÇİFT ALANI</span><small>ÇİFT PERLER</small></div></div>
      <div className="table-matrix">
        <Grid cells={table.series} zone="series" onDrop={dropTable} />
        <Grid cells={table.pairs} zone="pairs" onDrop={dropTable} />
      </div>
      <Opponent p={players[3]} active={game.siradakiOyuncu===3} className="opponent bottom-left" />
      <div className="status-line"><span className={isMyTurn?"pulse":""}/>{notice}</div>
    </section>
    <aside className="sidebar">
      <div className="rules"><span>EŞLİ</span><span>YARDIMLI</span><span>KATLAMALI</span></div>
      <div className="side-content">
        <div className="deck-column"><label>GÖSTERGE</label><TileView tile={game.gostergeTas}/><label>KAPALI DESTE</label><div className="deck" draggable onDragStart={e=>beginDrag(e,"deck",0)} onDoubleClick={()=>drawTile("deck")}><strong>{game.kalanTasSayisi}</strong><span>TAŞ</span></div><label>TUR SAYACI</label><output>[ {String(game.tur).padStart(3,"0")} ]</output><small>Baraj <b>{game.mevcutBaraj}</b></small></div>
        <div className="discard-column" onDragOver={e=>e.preventDefault()} onDrop={discardTile}><label>ATILAN TAŞLAR</label><div className="discard-stack">{discard.slice(-5).map((t,i)=><div key={t.id} style={{top:i*18,zIndex:i}}><TileView tile={t} compact draggable={i===Math.min(4,discard.length-1)} onDragStart={e=>beginDrag(e,"discard",discard.length-1)} onDoubleClick={i===Math.min(4,discard.length-1)?()=>drawTile("discard"):undefined}/></div>)}</div><small>SON ATILAN</small></div>
        <div className="actions"><button disabled={!buttonActivity.canSeriAc} onClick={()=>openHand("series")}><b>SERİ AÇ</b><span>{score || "—"} PUAN</span></button><button disabled={!buttonActivity.canCiftAc} onClick={()=>openHand("pairs")}><b>ÇİFT AÇ</b><span>{table.pairs.filter(Boolean).length}/5 ÇİFT</span></button><button disabled={!buttonActivity.canGeriTopla} onClick={collect}><b>GERİ TOPLA</b><span>↶</span></button><button disabled={!buttonActivity.canTasIsle}><b>TAŞLARI İŞLE</b><span>→</span></button></div>
      </div>
    </aside>
    <section className="rack-area"><div className="self"><span className="active-line"/><b>SİZ</b><small>{players[0].count} TAŞ</small></div><button className="sort" onClick={()=>sortRack("pairs")}>ÇİFT<br/>DİZ <span>↕</span></button><div className="rack-grid">{rack.map((tile,i)=><div className="rack-cell" key={i} onDragOver={e=>e.preventDefault()} onDrop={e=>dropRack(e,i)}>{tile&&<TileView tile={tile} draggable={isMyTurn} onDragStart={e=>beginDrag(e,"rack",i)}/>}</div>)}</div><button className="sort" onClick={()=>sortRack("series")}>SERİ<br/>DİZ <span>↕</span></button></section>
  </main>;
}

function Grid({cells,zone,onDrop}:{cells:(TableTile|null)[];zone:Zone;onDrop:(e:React.DragEvent,z:Zone,i:number)=>void}) { return <div className={`grid ${zone}`}>{cells.map((tile,i)=><div className="grid-cell" key={i} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,zone,i)}>{tile&&<TileView tile={tile} compact/>}</div>)}</div>; }
function Opponent({p,active,className}:{p:{name:string;count:number};active:boolean;className:string}) { return <div className={`${className} ${active?"active":""}`}><span/><b>{p.name}</b><small>{p.count} TAŞ</small></div>; }

function StartMenu({onStart,onSettings,notice}:{onStart:()=>void;onSettings:()=>void;notice:string}) { return <main className="start-screen"><div className="start-card"><div className="brand-mark"><b>101</b><span>OKEY</span></div><p className="eyebrow">MINIMAL MASA · 07</p><h1>Oyuna hazır mısınız?</h1><p className="start-copy">Bir oda oluşturun ya da aktif bir masaya katılın.</p><div className="menu-actions"><button className="primary-action" onClick={onStart}>BAŞLA <span>→</span></button><button className="ghost-action" onClick={onSettings}>AYARLAR <span>⚙</span></button></div><small className="menu-note">{notice === "Sıra sizde — desteden veya yerden taş çekin" ? "101 Okey · v1.0" : notice}</small></div></main>; }

function Lobby({rooms,roomName,setRoomName,roomSize,setRoomSize,onCreate,onJoin,onBack}:{rooms:{id:number;name:string;owner:string;players:number;max:number;status:string}[];roomName:string;setRoomName:(v:string)=>void;roomSize:2|4;setRoomSize:(v:2|4)=>void;onCreate:()=>void;onJoin:(id:number)=>void;onBack:()=>void}) { return <main className="lobby-screen"><header className="lobby-top"><button className="back-link" onClick={onBack}>← ANA MENÜ</button><div className="mini-brand"><b>101</b><span>OKEY</span></div><span className="lobby-meta">MASA SEÇİMİ</span></header><section className="lobby-content"><div className="create-panel"><p className="eyebrow">YENİ MASA</p><h1>Oda oluştur</h1><p className="panel-copy">Kendi masanızı kurun, arkadaşlarınızı veya bilgisayar oyuncularını davet edin.</p><label>ODA ADI<input value={roomName} onChange={e=>setRoomName(e.target.value)} /></label><label>OYUNCU SAYISI</label><div className="size-picker"><button className={roomSize===2?"selected":""} onClick={()=>setRoomSize(2)}>2 KİŞİ</button><button className={roomSize===4?"selected":""} onClick={()=>setRoomSize(4)}>4 KİŞİ</button></div><button className="create-button" onClick={onCreate}>ODA OLUŞTUR <span>→</span></button></div><div className="lobby-divider"/><div className="rooms-panel"><div className="rooms-heading"><div><p className="eyebrow">MASALAR</p><h2>Aktif odalar</h2></div><span>{rooms.length} AÇIK</span></div><div className="room-list">{rooms.map(room=><button className="room-row" key={room.id} onClick={()=>onJoin(room.id)}><span className="room-dot"/><span className="room-main"><b>{room.name}</b><small>{room.owner} tarafından oluşturuldu</small></span><span className="room-count">{room.players}/{room.max}</span><span className="room-status">{room.status} <i>→</i></span></button>)}</div><p className="rooms-footnote">Oda seçerek içeri girebilir veya soldan yeni bir masa kurabilirsiniz.</p></div></section></main>; }

function RoomView({room,bots,onAddComputer,onStart,onBack}:{room:{name:string;owner:string;players:number;max:number;status:string};bots:number;onAddComputer:()=>void;onStart:()=>void;onBack:()=>void}) { const total = Math.min(room.max, 1 + bots); return <main className="room-screen"><header className="lobby-top"><button className="back-link" onClick={onBack}>← ODALARA DÖN</button><div className="mini-brand"><b>101</b><span>OKEY</span></div><span className="lobby-meta">ODA KODU · 07A</span></header><section className="room-content"><div className="room-title"><p className="eyebrow">ODA KURUCUSU · SİZ</p><h1>{room.name}</h1><p>Oyun otomatik olarak başlayacak. Masayı tamamlamak için bilgisayar oyuncusu ekleyebilirsiniz.</p></div><div className="seat-grid">{Array.from({length:room.max},(_,i)=>i===0?<div className="seat occupied" key={i}><span className="seat-index">01</span><b>Siz</b><small>ODA KURUCUSU</small><i>✓</i></div>:i<=bots?<div className="seat occupied" key={i}><span className="seat-index">0{i+1}</span><b>Bilgisayar_{i}</b><small>HAZIR</small><i>✓</i></div>:<button className="seat empty" key={i} onClick={onAddComputer}><span className="seat-index">0{i+1}</span><strong>+</strong><b>BİLGİSAYAR EKLE</b><small>BOŞ KOLTUK</small></button>)}</div><div className="room-actions"><div className="room-rule"><span>OYUNCU</span><b>{total} / {room.max}</b><small>{room.max === 2 ? "İKİLİ MASA" : "DÖRTLÜ MASA"}</small></div><button className="start-game" onClick={onStart} disabled={total < 2}>OYUNU BAŞLAT <span>→</span></button></div><p className="room-note">İlk oyun hazır olduğunuz anda başlayacak · Ayarlar daha sonra düzenlenebilir</p></section></main>; }
