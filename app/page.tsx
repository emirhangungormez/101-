"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { io, type Socket } from "socket.io-client";
import {
  groupsFromPlacements,
  PAIRS_COLUMNS,
  SERIES_COLUMNS,
  TABLE_ROWS,
  previewOpening,
  validatePair,
  validateSeriesGroup,
} from "../shared/okey-rules.js";

type Color = "red" | "blue" | "black" | "yellow" | "joker";
type Tile = {
  id: number | string;
  value: number | "J" | "?";
  color: Color;
  isOkey?: boolean;
};
type RackCell = Tile | null;
type TableTile = Tile & {
  origin: number;
  committed?: boolean;
  ownerSocketId?: string;
  ownerKoltukNo?: number;
};
type Zone = "series" | "pairs";
type RoomRule = "sabit" | "katlamali";
type MatchHands = 5 | 10 | 20;
type GameTheme = "burgundy" | "blue" | "green";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const colors: Color[] = ["red", "blue", "black", "yellow"];
const gameThemes: GameTheme[] = ["burgundy", "blue", "green"];
const gameThemeNames: Record<GameTheme, string> = {
  burgundy: "Bordo",
  blue: "Mavi",
  green: "Yeşil",
};
const createClientId = () => {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  return `okey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};
const profileNames = [
  "Ada",
  "Deniz",
  "Ece",
  "Emir",
  "Lale",
  "Mert",
  "Selin",
  "Yaman",
  "Zeynep",
  "Arda",
];
const profileEmojis = [
  "🧒",
  "👧",
  "🧑",
  "👩",
  "👨",
  "🧕",
  "👵",
  "🧓",
  "😎",
  "🤖",
  "🦊",
  "🐼",
  "🎮",
  "🎨",
];
const initialTiles: Tile[] = [
  [3, "red"],
  [4, "red"],
  [5, "red"],
  [8, "blue"],
  [8, "black"],
  [8, "yellow"],
  [11, "black"],
  [12, "black"],
  [13, "black"],
  [1, "yellow"],
  [2, "yellow"],
  [3, "yellow"],
  [6, "blue"],
  [6, "red"],
  [9, "yellow"],
  [10, "yellow"],
  [11, "yellow"],
  [4, "blue"],
  [5, "blue"],
  [7, "red"],
  [12, "blue"],
  ["J", "joker"],
].map(([value, color], id) => ({
  id: id + 1,
  value: value as number | "J",
  color: color as Color,
}));

const blankRack = (): RackCell[] =>
  Array.from({ length: 44 }, (_, i) => initialTiles[i] ?? null);
const SERIES_TABLE_CELLS = SERIES_COLUMNS * TABLE_ROWS;
const PAIRS_TABLE_CELLS = PAIRS_COLUMNS * TABLE_ROWS;
const resizeTableCells = (cells: (TableTile | null)[], size: number) => [
  ...cells.slice(0, size),
  ...Array<TableTile | null>(Math.max(0, size - cells.length)).fill(null),
];
const blankTable = () => ({
  series: Array<TableTile | null>(SERIES_TABLE_CELLS).fill(null),
  pairs: Array<TableTile | null>(PAIRS_TABLE_CELLS).fill(null),
});
const serverTileToTile = (tile: any): Tile => ({
  id: tile.id,
  value: tile.deger === 0 ? "J" : tile.deger,
  color:
    (
      {
        kirmizi: "red",
        mavi: "blue",
        siyah: "black",
        sari: "yellow",
        joker: "joker",
      } as Record<string, Color>
    )[tile.renk] ||
    tile.color ||
    "black",
});
const isOkeyTile = (tile: Tile, indicator: Tile) =>
  tile.color === indicator.color &&
  typeof tile.value === "number" &&
  typeof indicator.value === "number" &&
  tile.value === (indicator.value === 13 ? 1 : indicator.value + 1);
const tableFromServer = (ground: any, indicator?: Tile) => {
  const next = blankTable();
  for (const zone of ["series", "pairs"] as Zone[]) {
    const source = zone === "series" ? ground?.seri : ground?.cift;
    const columns = zone === "series" ? SERIES_COLUMNS : PAIRS_COLUMNS;
    for (const placement of source || []) {
      const index = Number(placement.row) * columns + Number(placement.col);
      if (index >= 0 && index < next[zone].length && placement.tas) {
        const tile = serverTileToTile(placement.tas);
        next[zone][index] = {
          ...tile,
          isOkey: indicator ? isOkeyTile(tile, indicator) : false,
          origin: -1,
          committed: true,
          ownerSocketId: placement.ownerSocketId,
          ownerKoltukNo: placement.ownerKoltukNo,
        };
      }
    }
  }
  return next;
};
const tableGroundSignature = (ground: any) =>
  (["seri", "cift"] as const)
    .map((key) =>
      (ground?.[key] || [])
        .map(
          (placement: any) =>
            `${placement.row}:${placement.col}:${placement.tas?.id}:${placement.ownerKoltukNo ?? ""}`,
        )
        .sort()
        .join("|"),
    )
    .join("//");
const serverPlacementCells = (ground: any, zone: Zone) => {
  const source = zone === "series" ? ground?.seri : ground?.cift;
  const columns = zone === "series" ? SERIES_COLUMNS : PAIRS_COLUMNS;
  return new Set<number>(
    (source || []).flatMap((placement: any) => {
      const row = Number(placement.row);
      const col = Number(placement.col);
      const index = row * columns + col;
      return row >= 0 && row < TABLE_ROWS && col >= 0 && col < columns
        ? [index]
        : [];
    }),
  );
};
const reconcileRack = (
  current: RackCell[],
  serverTiles: Tile[],
  preferredIndex: number | null = null,
) => {
  const remaining = new Map(serverTiles.map((tile) => [String(tile.id), tile]));
  const next = current.map((tile) => {
    if (!tile) return null;
    const match = remaining.get(String(tile.id));
    if (!match) return null;
    remaining.delete(String(tile.id));
    return match;
  });
  for (const tile of remaining.values()) {
    const preferred =
      preferredIndex !== null && !next[preferredIndex] ? preferredIndex : -1;
    const index =
      preferred >= 0 ? preferred : next.findIndex((value) => !value);
    if (index >= 0) next[index] = tile;
    preferredIndex = null;
  }
  return next;
};
const previousPlayerSeat = (players: any[], seat: number | null) => {
  if (seat === null) return -1;
  const mine = players.find((player) => player.koltukNo === seat);
  if (!mine?.siraNo) return -1;
  const previousOrder = mine.siraNo === 1 ? players.length : mine.siraNo - 1;
  return (
    players.find((player) => player.siraNo === previousOrder)?.koltukNo ?? -1
  );
};
const nextPlayerSeat = (players: any[], seat: number | null) => {
  if (seat === null) return -1;
  const mine = players.find((player) => player.koltukNo === seat);
  if (!mine?.siraNo) return -1;
  const nextOrder = mine.siraNo === players.length ? 1 : mine.siraNo + 1;
  return players.find((player) => player.siraNo === nextOrder)?.koltukNo ?? -1;
};
function TileView({
  tile,
  compact = false,
  draggable = false,
  onDragStart,
  onDoubleClick,
}: {
  tile: Tile;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDoubleClick?: () => void;
}) {
  return (
    <div
      className={`tile tile-${tile.color} ${compact ? "compact" : ""} ${tile.isOkey ? "okey-glow" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDoubleClick={onDoubleClick}
      role="button"
      tabIndex={0}
      aria-label={
        tile.color === "joker"
          ? "Sahte okey taşı"
          : `${tile.color} ${tile.value} taşı`
      }
    >
      <span>{tile.color === "joker" ? "★" : tile.value}</span>
      <i>{tile.color === "joker" ? "★" : "•"}</i>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<
    "menu" | "lobby" | "room" | "game" | "settings"
  >("menu");
  const [routeReady, setRouteReady] = useState(false);
  const [userId] = useState(() => {
    if (typeof window === "undefined") return "server";
    const saved = window.localStorage.getItem("okey-user-id");
    if (saved) return saved;
    const id = createClientId();
    window.localStorage.setItem("okey-user-id", id);
    return id;
  });
  const [profileName, setProfileName] = useState(
    () => profileNames[Math.floor(Math.random() * profileNames.length)],
  );
  const [profileEmoji, setProfileEmoji] = useState(
    () => profileEmojis[Math.floor(Math.random() * profileEmojis.length)],
  );
  const [soundOn, setSoundOn] = useState(true);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [mobileInstallTarget, setMobileInstallTarget] = useState(false);
  const [iosInstallTarget, setIosInstallTarget] = useState(false);
  const [installHint, setInstallHint] = useState("");
  const [gameTheme, setGameTheme] = useState<GameTheme>(() => {
    if (typeof window === "undefined") return "burgundy";
    const saved = window.localStorage.getItem("okey-game-theme");
    return gameThemes.includes(saved as GameTheme)
      ? (saved as GameTheme)
      : "burgundy";
  });
  const [roomSize, setRoomSize] = useState<2 | 3 | 4>(4);
  const [roomRule, setRoomRule] = useState<RoomRule>("sabit");
  const [roomHands, setRoomHands] = useState<MatchHands>(5);
  const [roomName, setRoomName] = useState("101 Masası");
  const [rooms, setRooms] = useState<
    {
      id: number | string;
      name: string;
      owner: string;
      players: number;
      max: number;
      status: string;
      rule?: RoomRule;
      hands?: MatchHands;
      started?: boolean;
      currentHand?: number;
      completedHands?: number;
    }[]
  >(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem("okey-rooms") || "[]");
    } catch {
      return [];
    }
  });
  const [roomSnapshots, setRoomSnapshots] = useState<any[]>([]);
  const [gameRoster, setGameRoster] = useState<any[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        window.localStorage.getItem("okey-game-roster") || "[]",
      );
    } catch {
      return [];
    }
  });
  const [selectedRoom, setSelectedRoom] = useState<number | string>(() => {
    if (typeof window === "undefined") return 1;
    return window.localStorage.getItem("okey-selected-room") || 1;
  });
  const [joinedRoomId, setJoinedRoomId] = useState<number | string | null>(
    null,
  );
  const [bots, setBots] = useState(0);
  const [botSeats, setBotSeats] = useState<number[]>([]);
  const [joinedSeat, setJoinedSeat] = useState<number | null>(null);
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [rack, setRack] = useState<RackCell[]>(() => Array(44).fill(null));
  const [table, setTable] = useState(blankTable);
  const [discard, setDiscard] = useState<Tile[]>([]);
  const [playerDiscards, setPlayerDiscards] = useState<Record<string, Tile>>(
    {},
  );
  const [playerDiscardHistories, setPlayerDiscardHistories] = useState<
    Record<string, Tile[]>
  >({});
  const [myDiscards, setMyDiscards] = useState<Tile[]>([]);
  const [incomingDiscards, setIncomingDiscards] = useState<Tile[]>([]);
  const [onlineGame, setOnlineGame] = useState(false);
  const [gamePrepared, setGamePrepared] = useState(false);
  const [dealAnimationKey, setDealAnimationKey] = useState(0);
  const [dealAnimating, setDealAnimating] = useState(false);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [drawAnimation, setDrawAnimation] = useState<{
    seat: number;
    source: "deste" | "yan";
    tile?: Tile;
  } | null>(null);
  const [takenProfileDiscard, setTakenProfileDiscard] = useState<{
    seat: number;
    tile: Tile;
  } | null>(null);
  const [openingMode, setOpeningMode] = useState<Zone>("series");
  const [selectedRackIndex, setSelectedRackIndex] = useState<number | null>(
    null,
  );
  const [rackPointerDrag, setRackPointerDrag] = useState<{
    source: "rack" | "discard" | "deck" | "table" | "inspect";
    index: number;
    zone?: Zone;
    tile: Tile;
    x: number;
    y: number;
    centerOffsetX: number;
    centerOffsetY: number;
  } | null>(null);
  const rackGridRef = useRef<HTMLDivElement>(null);
  const rackThrowRef = useRef<HTMLDivElement>(null);
  const seriesGridRef = useRef<HTMLDivElement>(null);
  const pairsGridRef = useRef<HTMLDivElement>(null);
  const serverTableCellsRef = useRef<{ series: Set<number>; pairs: Set<number> }>(
    { series: new Set(), pairs: new Set() },
  );
  const serverTableRoomRef = useRef<string | null>(null);
  const serverTableHandRef = useRef<string | null>(null);
  const serverTableReadyRef = useRef(false);
  const serverTableSignatureRef = useRef<string | null>(null);
  const focusedOpeningZonesRef = useRef({ series: false, pairs: false });
  const rackSnapshotRef = useRef<RackCell[] | null>(null);
  const rackOrderRef = useRef<RackCell[]>(rack);
  const tableOrderRef = useRef(table);
  const gameRosterRef = useRef(gameRoster);
  const pendingDrawTargetRef = useRef<number | null>(null);
  const pendingSideTableRef = useRef<{
    zone: Zone;
    index: number;
    replaceJoker?: boolean;
  } | null>(null);
  const [game, setGame] = useState({
    siradakiOyuncu: 0,
    mevcutBaraj: 101,
    gostergeTas: { id: 99, value: 5, color: "yellow" } as Tile,
    kalanTasSayisi: 0,
    tur: 0,
    opened: false,
    toplamEl: 5,
    tamamlananEl: 0,
    elNo: 0,
    elDurumu: "bekliyor",
    elSonucu: null as any,
    macKazananlari: [] as any[],
    roomOwnerSocketId: "",
    ilkHamle: false,
    eliBitirecekKoltukNo: null as number | null,
    desteBitisSonZaman: null as number | null,
    hamleSonZaman: null as number | null,
    hamleSuresi: null as number | null,
  });
  const [notice, setNotice] = useState("Oyun başlamayı bekliyor");
  const [penaltyAlert, setPenaltyAlert] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [sideDrawTileId, setSideDrawTileId] = useState<string | null>(null);
  const [turnPhase, setTurnPhase] = useState<"draw" | "discard">("draw");
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const mobile =
      window.matchMedia("(max-width: 900px)").matches ||
      navigator.maxTouchPoints > 1;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setMobileInstallTarget(mobile && !standalone);
    setIosInstallTarget(mobile && ios && !standalone);

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (mobile && !standalone)
        setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installed = () => {
      setInstallPrompt(null);
      setMobileInstallTarget(false);
      setInstallHint("");
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", installed);
    if (import.meta.env.PROD && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  useEffect(() => {
    setTable((current) => ({
      series: resizeTableCells(current.series, SERIES_TABLE_CELLS),
      pairs: resizeTableCells(current.pairs, PAIRS_TABLE_CELLS),
    }));
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const updateGameViewport = () => {
      const isMobile = Math.min(window.innerWidth, window.innerHeight) <= 900;
      const isPortrait = window.innerHeight > window.innerWidth;
      root.classList.toggle("app-mobile-portrait", isMobile && isPortrait);
      root.classList.toggle(
        "game-mobile-portrait",
        screen === "game" && isMobile && isPortrait,
      );
      root.classList.toggle(
        "game-mobile-landscape",
        screen === "game" && isMobile && !isPortrait,
      );
      if (screen !== "game" || !isMobile || isPortrait) {
        root.style.removeProperty("--game-mobile-scale");
        return;
      }
      const availableWidth = window.innerWidth;
      const availableHeight = window.innerHeight;
      const scale = Math.min(availableWidth / 1600, availableHeight / 900);
      root.style.setProperty("--game-mobile-scale", String(scale));
    };
    updateGameViewport();
    window.addEventListener("resize", updateGameViewport);
    window.addEventListener("orientationchange", updateGameViewport);
    return () => {
      window.removeEventListener("resize", updateGameViewport);
      window.removeEventListener("orientationchange", updateGameViewport);
      root.classList.remove(
        "app-mobile-portrait",
        "game-mobile-portrait",
        "game-mobile-landscape",
      );
      root.style.removeProperty("--game-mobile-scale");
    };
  }, [screen]);
  useEffect(() => {
    setTable((current) => {
      let changed = false;
      const markOkeys = (cells: (TableTile | null)[]) =>
        cells.map((tile) => {
          if (!tile) return null;
          const nextIsOkey = isOkeyTile(tile, game.gostergeTas);
          if (Boolean(tile.isOkey) === nextIsOkey) return tile;
          changed = true;
          return { ...tile, isOkey: nextIsOkey };
        });
      const next = {
        series: markOkeys(current.series),
        pairs: markOkeys(current.pairs),
      };
      return changed ? next : current;
    });
  }, [game.gostergeTas.color, game.gostergeTas.value]);
  useEffect(() => {
    rackOrderRef.current = rack;
  }, [rack]);
  useEffect(() => {
    tableOrderRef.current = table;
  }, [table]);
  useEffect(() => {
    gameRosterRef.current = gameRoster;
  }, [gameRoster]);
  useEffect(() => {
    if (!onlineGame && !gamePrepared) return;
    const frame = window.requestAnimationFrame(() => {
      [seriesGridRef.current, pairsGridRef.current].forEach((grid) => {
        if (!grid) return;
        grid.scrollLeft = Math.max(0, (grid.scrollWidth - grid.clientWidth) / 2);
        grid.scrollTop = Math.max(0, (grid.scrollHeight - grid.clientHeight) / 2);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onlineGame, gamePrepared, game.elNo]);

  const focusNewTableCells = (zone: Zone, indices: number[]) => {
    if (!indices.length) return;
    const grid = zone === "series" ? seriesGridRef.current : pairsGridRef.current;
    if (!grid) return;
    window.requestAnimationFrame(() => {
      const cells = indices
        .map((index) =>
          grid.querySelector<HTMLElement>(`[data-table-cell="${index}"]`),
        )
        .filter((cell): cell is HTMLElement => Boolean(cell));
      if (!cells.length) return;
      const left = Math.min(...cells.map((cell) => cell.offsetLeft));
      const top = Math.min(...cells.map((cell) => cell.offsetTop));
      const right = Math.max(
        ...cells.map((cell) => cell.offsetLeft + cell.offsetWidth),
      );
      const bottom = Math.max(
        ...cells.map((cell) => cell.offsetTop + cell.offsetHeight),
      );
      grid.scrollTo({
        left: Math.max(0, (left + right - grid.clientWidth) / 2),
        top: Math.max(0, (top + bottom - grid.clientHeight) / 2),
        behavior: "smooth",
      });
    });
  };
  useEffect(() => {
    if (!socket) return;
    const keepRackOrder = (payload: any) => {
      const raw = Array.isArray(payload) ? payload : payload.taslar;
      const tiles = (raw || []).map(serverTileToTile).map((tile: Tile) => ({
        ...tile,
        isOkey: isOkeyTile(tile, game.gostergeTas),
      }));
      // Sunucu, onaylanana kadar gecici masa taslarini oyuncunun elinde
      // tutar. Bu taslari tekrar istakaya eklemek istemcide kopya olusturur.
      const stagedTileIds = new Set(
        [...tableOrderRef.current.series, ...tableOrderRef.current.pairs]
          .filter((tile): tile is TableTile => Boolean(tile && !tile.committed))
          .map((tile) => String(tile.id)),
      );
      const rackTiles = tiles.filter(
        (tile: Tile) => !stagedTileIds.has(String(tile.id)),
      );
      const reconciled = reconcileRack(
        rackOrderRef.current,
        rackTiles,
        pendingDrawTargetRef.current,
      );
      const pendingTable = pendingSideTableRef.current;
      const sideTileId =
        payload?.yandanAlinanTasId == null
          ? null
          : String(payload.yandanAlinanTasId);
      if (pendingTable && sideTileId) {
        const rackIndex = reconciled.findIndex(
          (tile) => tile && String(tile.id) === sideTileId,
        );
        const drawnTile = rackIndex >= 0 ? reconciled[rackIndex] : null;
        if (drawnTile) {
          if (pendingTable.replaceJoker) {
            pendingSideTableRef.current = null;
            socket.emit(
              "joker-degistir",
              {
                zone: "series",
                row: Math.floor(pendingTable.index / SERIES_COLUMNS),
                col: pendingTable.index % SERIES_COLUMNS,
                tasId: drawnTile.id,
                kaynak: "el",
              },
              (response: any) => {
                if (!response?.ok) {
                  socket.emit("yandan-tas-iade");
                  setNotice(response?.error || "Okey değiştirilemedi");
                  return;
                }
                setTable(
                  tableFromServer(response.masaZemini, game.gostergeTas),
                );
                socket.emit("seri-sure-bonusu");
                rackSnapshotRef.current = null;
                setNotice("Taş yerine kondu, okey ıstakana alındı");
              },
            );
          } else {
            if (!rackSnapshotRef.current)
              rackSnapshotRef.current = [...rackOrderRef.current];
            reconciled[rackIndex] = null;
            setTable((current) => ({
              ...current,
              [pendingTable.zone]: current[pendingTable.zone].map(
                (tile, index) =>
                  index === pendingTable.index
                    ? {
                        ...drawnTile,
                        origin: rackIndex,
                        committed: false,
                      }
                    : tile,
              ),
            }));
            if (pendingTable.zone === "series")
              socket.emit("seri-sure-bonusu");
            setNotice("Yandan alınan taş seri alanına yerleştirildi");
          }
        }
      }
      setRack(reconciled);
      pendingDrawTargetRef.current = null;
      pendingSideTableRef.current = null;
      setSideDrawTileId(
        sideTileId,
      );
    };
    socket.on("el-guncelle", keepRackOrder);
    return () => {
      socket.off("el-guncelle", keepRackOrder);
    };
  }, [socket, game.gostergeTas]);
  useEffect(() => {
    setRack((old) =>
      old.map((tile) =>
        tile ? { ...tile, isOkey: isOkeyTile(tile, game.gostergeTas) } : null,
      ),
    );
  }, [game.gostergeTas]);
  useEffect(() => {
    if (gamePrepared) {
      setIncomingDiscards([]);
      setMyDiscards([]);
      setPlayerDiscards({});
      setPlayerDiscardHistories({});
      setTable(blankTable());
      rackSnapshotRef.current = null;
    }
  }, [gamePrepared]);
  useEffect(() => {
    if (!socket) return;
    const handleDiscard = ({ koltukNo, tas }: any) => {
      const tile = serverTileToTile(tas);
      const player = gameRoster.find((item) => item.koltukNo === koltukNo);
      const self = gameRoster.find((item) => item.socketId === socket.id);
      const selfSeat = self?.koltukNo ?? mySeat;
      const previous = previousPlayerSeat(gameRoster, selfSeat);
      if (player)
        setPlayerDiscards((old) => ({
          ...old,
          [String(koltukNo)]: tile,
        }));
      if (player)
        setPlayerDiscardHistories((old) => ({
          ...old,
          [String(koltukNo)]: [
            ...(old[String(koltukNo)] || []),
            tile,
          ].slice(-3),
        }));
      if (koltukNo === selfSeat)
        setMyDiscards((old) => [...old, tile].slice(-3));
      if (koltukNo === previous)
        setIncomingDiscards((old) => [...old, tile].slice(-3));
    };
    socket.on("tas-atildi", handleDiscard);
    return () => {
      socket.off("tas-atildi", handleDiscard);
    };
  }, [socket, gameRoster, mySeat]);
  useEffect(() => {
    const socketUrl =
      import.meta.env.VITE_SOCKET_URL ||
      `${window.location.protocol}//${window.location.hostname}:4000`;
    const s = io(socketUrl, {
      transports: ["websocket"],
    });
    setSocket(s);
    const rememberRoster = (room: any) => {
      if (!room?.oyuncular?.length) return;
      if (
        room.macAktif || room.oyunBasladi ||
        String(room.odaId) ===
          String(window.localStorage.getItem("okey-selected-room"))
      )
        setGameRoster(room.oyuncular);
    };
    const applyGame = (room: any) => {
      if (!room) return;
      setOnlineGame(Boolean(room.oyunBasladi));
      setGamePrepared(false);
      setGameRoster(room.oyuncular || []);
      setGame((old) => ({
        ...old,
        siradakiOyuncu: room.siradakiOyuncu,
        kalanTasSayisi: room.kalanTasSayisi ?? old.kalanTasSayisi,
        gostergeTas: room.gosterge
          ? serverTileToTile(room.gosterge)
          : old.gostergeTas,
        mevcutBaraj: room.mevcutBaraj ?? old.mevcutBaraj,
        toplamEl: Number(room.toplamEl || 5),
        tamamlananEl: Number(room.tamamlananEl || 0),
        elNo: Number(room.elNo || 0),
        elDurumu: room.elDurumu || "bekliyor",
        elSonucu: room.elSonucu || null,
        macKazananlari: room.macKazananlari || [],
        roomOwnerSocketId: room.kurucuSocketId || "",
        eliBitirecekKoltukNo: Number.isInteger(room.eliBitirecekKoltukNo)
          ? room.eliBitirecekKoltukNo
          : null,
        desteBitisSonZaman: room.desteBitisSonZaman ?? null,
        hamleSonZaman: room.hamleSonZaman ?? null,
        hamleSuresi: Number(room.hamleSuresi || 0) || null,
        ilkHamle:
          Boolean(room.oyunBasladi) && room.sonAtanKoltukNo == null,
      }));
      const mine = (room.oyuncular || []).find((p: any) => p.socketId === s.id);
      setMySeat(mine?.koltukNo ?? null);
      const previous = mine
        ? previousPlayerSeat(room.oyuncular || [], mine.koltukNo)
        : -1;
      setIncomingDiscards(
        room.sonAtanKoltukNo === previous
          ? (room.iskartaKutusu || []).slice(0, 3).map(serverTileToTile)
          : [],
      );
    };
    const prepareGame = (odaId: any, room: any) => {
      const mine = (room?.oyuncular || []).find(
        (p: any) => p.socketId === s.id,
      );
      setMySeat(mine?.koltukNo ?? null);
      setSelectedRoom(odaId);
      rememberRoster(room);
      setGameRoster(room?.oyuncular || []);
      setOnlineGame(false);
      setGamePrepared(true);
      setIncomingDiscards([]);
      setMyDiscards([]);
      setRack(Array(44).fill(null));
      setScreen("game");
    };
    const mapRooms = (list: any[]) => {
      setRoomSnapshots(list);
      const storedRoomId = window.localStorage.getItem("okey-selected-room");
      list.forEach((room) => {
        rememberRoster(room);
        if (room.oyuncular.some((p: any) => p.socketId === s.id))
          applyGame(room);
        if (
          room.elDurumu === "dagitim-bekliyor" &&
          String(room.odaId) === String(storedRoomId) &&
          room.oyuncular.some(
            (p: any) => Number.isInteger(p.siraNo) && p.socketId === s.id,
          )
        )
          prepareGame(room.odaId, room);
      });
      const joined = list.find((d) =>
        d.oyuncular.some((p: any) => p.socketId === s.id),
      );
      setJoinedRoomId(joined?.odaId ?? null);
      setRooms(
        list.map((d) => ({
          id: d.odaId,
          name: d.odaAdi,
          owner: d.kurucuId === userId ? "Siz" : "Oyuncu",
          players: d.oyuncular.length,
          max: d.maksimum || 4,
          status: "",
          rule: d.kuralTipi === "katlamali" ? "katlamali" : "sabit",
          hands: Number(d.toplamEl || 5) as MatchHands,
          started: Boolean(d.macAktif || d.oyunBasladi),
          currentHand: d.oyunBasladi
            ? Math.max(1, Number(d.elNo || 1))
            : d.macAktif
              ? Math.min(
                  Number(d.toplamEl || 5),
                  Number(d.tamamlananEl || 0) + 1,
                )
              : undefined,
          completedHands: Number(d.tamamlananEl || 0),
        })),
      );
    };
    s.on("connect", () => s.emit("oda-listesi-iste"));
    s.on("oda-listesi", mapRooms);
    s.on("oda-durum", (room) => {
      rememberRoster(room);
      applyGame(room);
      if (
        room.elDurumu === "dagitim-bekliyor" &&
        room.oyuncular.some(
          (p: any) => Number.isInteger(p.siraNo) && p.socketId === s.id,
        )
      )
        prepareGame(room.odaId, room);
      s.emit("oda-listesi-iste");
    });
    s.on("oyun-durum", applyGame);
    s.on("el-guncelle", (payload) => {
      setHasDrawn(Boolean(payload?.cekildiMi));
      setTurnPhase(payload?.cekildiMi ? "discard" : "draw");
      setSideDrawTileId(
        payload?.yandanAlinanTasId == null
          ? null
          : String(payload.yandanAlinanTasId),
      );
    });
    s.on("tas-cekildi", ({ koltukNo, atanKoltukNo, kaynak, tas }) => {
      if (kaynak === "deste") {
        setDrawAnimation({
          seat: koltukNo,
          source: kaynak,
          tile: tas ? serverTileToTile(tas) : undefined,
        });
        window.setTimeout(() => setDrawAnimation(null), 700);
      }
      const sourceSeat = Number.isInteger(atanKoltukNo)
        ? atanKoltukNo
        : previousPlayerSeat(gameRosterRef.current, koltukNo);
      if (kaynak === "yan" && sourceSeat >= 0) {
        setTakenProfileDiscard({
          seat: sourceSeat,
          tile: serverTileToTile(tas),
        });
        window.setTimeout(() => {
          setPlayerDiscards((old) => {
            const next = { ...old };
            delete next[String(sourceSeat)];
            return next;
          });
          setPlayerDiscardHistories((old) => ({
            ...old,
            [String(sourceSeat)]: (old[String(sourceSeat)] || []).filter(
              (tile) => String(tile.id) !== String(tas?.id),
            ),
          }));
          setTakenProfileDiscard((current) =>
            current?.seat === sourceSeat ? null : current,
          );
        }, 420);
      }
    });
    s.on("hata", ({ message }) => {
      pendingDrawTargetRef.current = null;
      setNotice(message);
    });
    s.on(
      "ceza-uygulandi",
      ({ socketId, isim, cezaToplami }) => {
      const mine = socketId === s.id;
      const message =
        mine
          ? "İşlenecek taşı attın, 101 ceza yazıldı"
          : `${isim || "Oyuncu"}, işlenecek taşı attı; ${Number(cezaToplami || 101)} ceza yedi`;
      setPenaltyAlert(message);
      window.setTimeout(() => setPenaltyAlert(null), 4200);
      },
    );
    s.on(
      "deste-bitti",
      ({ message, eliBitirecekKoltukNo, sonZaman }) => {
        setNotice(message);
        setGame((current) => ({
          ...current,
          kalanTasSayisi: 0,
          eliBitirecekKoltukNo: Number.isInteger(eliBitirecekKoltukNo)
            ? eliBitirecekKoltukNo
            : current.eliBitirecekKoltukNo,
          desteBitisSonZaman: sonZaman ?? current.desteBitisSonZaman,
          hamleSonZaman: sonZaman ?? current.hamleSonZaman,
          hamleSuresi: 30,
        }));
      },
    );
    s.on("oyun-hazir", ({ odaId, oda }) => prepareGame(odaId, oda));
    s.on("taslar-dagitiliyor", () => {
      setRack(Array(44).fill(null));
      setDealAnimationKey((value) => value + 1);
      setDealAnimating(true);
    });
    s.on("taslar-dagitildi", ({ oda }) => {
      setIncomingDiscards([]);
      setMyDiscards([]);
      setPlayerDiscards({});
      setPlayerDiscardHistories({});
      setTable(blankTable());
      rackSnapshotRef.current = null;
      window.setTimeout(() => setDealAnimating(false), 1050);
      applyGame(oda);
    });
    s.on("el-tamamlandi", ({ oda }) => {
      applyGame(oda);
      setHasDrawn(false);
      setTurnPhase("draw");
      setScreen("game");
    });
    s.on("oda-katildi", ({ odaId, oyunBasladi, oda }) => {
      setJoinedRoomId(odaId);
      if ((oyunBasladi || oda?.macAktif) && oda) {
        applyGame(oda);
        setScreen("game");
      }
    });
    s.on("oda-izleniyor", ({ odaId, oyunBasladi, oda }) => {
      setSelectedRoom(odaId);
      if (oyunBasladi || oda?.macAktif) {
        applyGame(oda);
        setScreen("game");
      } else setScreen("room");
    });
    s.on("oda-olusturuldu", ({ odaId }) => {
      setSelectedRoom(odaId);
      setScreen("room");
    });
    return () => {
      s.disconnect();
    };
  }, [userId]);
  useEffect(() => {
    if (!socket) return;
    const syncDiscardViews = (room: any) => {
      const players = room?.oyuncular || [];
      const socketId = socket.id;
      const self = players.find((player: any) => player.socketId === socketId);
      if (!self) return;
      const previous = previousPlayerSeat(players, self.koltukNo ?? mySeat);
      setIncomingDiscards(
        [...(room.atisGecmisi?.[previous] || [])]
          .reverse()
          .map(serverTileToTile),
      );
      setPlayerDiscards(() => {
        const next: Record<string, Tile> = {};
        Object.entries(room.sonAtislar || {}).forEach(([seat, tile]) => {
          const player = players.find(
            (item: any) => item.koltukNo === Number(seat),
          );
          if (player) next[String(seat)] = serverTileToTile(tile);
        });
        return next;
      });
      setPlayerDiscardHistories(() => {
        const next: Record<string, Tile[]> = {};
        Object.entries(room.atisGecmisi || {}).forEach(([seat, tiles]) => {
          next[String(seat)] = [...((tiles as any[]) || [])]
            .slice(0, 3)
            .reverse()
            .map(serverTileToTile);
        });
        return next;
      });
    };
    const syncRoomList = (rooms: any[]) => {
      const room = rooms.find(
        (item) =>
          (item.macAktif || item.oyunBasladi) &&
          item.oyuncular?.some((player: any) => player.socketId === socket.id),
      );
      if (room) syncDiscardViews(room);
    };
    socket.on("oyun-durum", syncDiscardViews);
    socket.on("oda-durum", syncDiscardViews);
    socket.on("oda-listesi", syncRoomList);
    return () => {
      socket.off("oyun-durum", syncDiscardViews);
      socket.off("oda-durum", syncDiscardViews);
      socket.off("oda-listesi", syncRoomList);
    };
  }, [socket, mySeat]);
  useEffect(() => {
    if (!socket) return;
    const syncTableState = (room: any) => {
      if (!room?.macAktif && !room?.oyunBasladi) return;
      setRoomRule(room.kuralTipi === "katlamali" ? "katlamali" : "sabit");
      const roomId = String(room.odaId || "");
      const handKey = `${roomId}:${Number(room.elNo || 0)}`;
      if (
        serverTableRoomRef.current !== roomId ||
        serverTableHandRef.current !== handKey
      ) {
        serverTableRoomRef.current = roomId;
        serverTableHandRef.current = handKey;
        serverTableReadyRef.current = false;
        serverTableSignatureRef.current = null;
        serverTableCellsRef.current = { series: new Set(), pairs: new Set() };
        focusedOpeningZonesRef.current = { series: false, pairs: false };
      }
      const signature = tableGroundSignature(room.masaZemini);
      if (serverTableSignatureRef.current === signature) return;
      const canonical = tableFromServer(
        room.masaZemini,
        room.gosterge ? serverTileToTile(room.gosterge) : undefined,
      );
      const nextServerCells = {
        series: serverPlacementCells(room.masaZemini, "series"),
        pairs: serverPlacementCells(room.masaZemini, "pairs"),
      };
      const newSeries = [...nextServerCells.series].filter(
        (index) => !serverTableCellsRef.current.series.has(index),
      );
      const newPairs = [...nextServerCells.pairs].filter(
        (index) => !serverTableCellsRef.current.pairs.has(index),
      );
      // Her elde her alan yalniz ilk kez tas aldiginda acilan perlere
      // ortalanir. Sonraki oyuncu acilislarinda ve tas islemelerinde
      // kullanicinin elle sectigi gorunum kesinlikle degismez.
      if (
        !focusedOpeningZonesRef.current.series &&
        nextServerCells.series.size > 0
      ) {
        focusNewTableCells(
          "series",
          newSeries.length ? newSeries : [...nextServerCells.series],
        );
        focusedOpeningZonesRef.current.series = true;
      }
      if (
        !focusedOpeningZonesRef.current.pairs &&
        nextServerCells.pairs.size > 0
      ) {
        focusNewTableCells(
          "pairs",
          newPairs.length ? newPairs : [...nextServerCells.pairs],
        );
        focusedOpeningZonesRef.current.pairs = true;
      }
      serverTableCellsRef.current = nextServerCells;
      serverTableReadyRef.current = true;
      serverTableSignatureRef.current = signature;
      setTable((current) => ({
        series: canonical.series.map(
          (tile, index) =>
            tile ??
            (!current.series[index]?.committed ? current.series[index] : null),
        ),
        pairs: canonical.pairs.map(
          (tile, index) =>
            tile ??
            (!current.pairs[index]?.committed ? current.pairs[index] : null),
        ),
      }));
    };
    const syncList = (rooms: any[]) => {
      const room = rooms.find(
        (item) =>
          (item.macAktif || item.oyunBasladi) &&
          item.oyuncular?.some((player: any) => player.socketId === socket.id),
      );
      if (room) syncTableState(room);
    };
    socket.on("oyun-durum", syncTableState);
    socket.on("oda-durum", syncTableState);
    socket.on("oda-listesi", syncList);
    return () => {
      socket.off("oyun-durum", syncTableState);
      socket.off("oda-durum", syncTableState);
      socket.off("oda-listesi", syncList);
    };
  }, [socket]);
  useEffect(() => {
    const path = window.location.pathname.replace(/^\//, "");
    if (["lobby", "room", "game", "settings"].includes(path))
      setScreen(path as "lobby" | "room" | "game" | "settings");
    setRouteReady(true);
    const onPopState = () => {
      const next = window.location.pathname.replace(/^\//, "");
      setScreen(
        ["lobby", "room", "game", "settings"].includes(next)
          ? (next as "lobby" | "room" | "game" | "settings")
          : "menu",
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("okey-rooms", JSON.stringify(rooms));
  }, [rooms]);
  useEffect(() => {
    window.localStorage.setItem("okey-game-roster", JSON.stringify(gameRoster));
  }, [gameRoster]);
  useEffect(() => {
    window.localStorage.setItem("okey-selected-room", String(selectedRoom));
  }, [selectedRoom]);
  useEffect(() => {
    window.localStorage.setItem("okey-game-theme", gameTheme);
  }, [gameTheme]);
  useEffect(() => {
    if (!routeReady) return;
    const path = screen === "menu" ? "/" : `/${screen}`;
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
  }, [screen, routeReady]);
  const isSpectator = Boolean(
    (onlineGame || gamePrepared) &&
    gameRoster.length &&
    !gameRoster.some((player: any) => player.socketId === socket?.id),
  );
  const isMyTurn =
    !isSpectator &&
    (onlineGame ? game.siradakiOyuncu === mySeat : game.siradakiOyuncu === 0);
  useEffect(() => {
    if (
      onlineGame &&
      socket?.connected &&
      game.kalanTasSayisi === 0 &&
      game.elDurumu === "oynaniyor" &&
      !Number.isInteger(game.eliBitirecekKoltukNo) &&
      !game.desteBitisSonZaman
    )
      socket.emit("deste-bitti-hazirla");
  }, [
    onlineGame,
    socket,
    game.kalanTasSayisi,
    game.elDurumu,
    game.eliBitirecekKoltukNo,
    game.desteBitisSonZaman,
  ]);
  const turnLimit = game.kalanTasSayisi === 0 ? 30 : game.ilkHamle ? 120 : 60;
  const pending = [...table.series, ...table.pairs].filter(
    (tile): tile is TableTile => Boolean(tile && !tile.committed),
  );
  const pendingPlacements = (["series", "pairs"] as Zone[]).flatMap((zone) =>
    table[zone].flatMap((tile, index) =>
      tile && !tile.committed
        ? [
            {
              zone,
              row: Math.floor(
                index / (zone === "series" ? SERIES_COLUMNS : PAIRS_COLUMNS),
              ),
              col: index % (zone === "series" ? SERIES_COLUMNS : PAIRS_COLUMNS),
              tasId: tile.id,
              tile,
            },
          ]
        : [],
    ),
  );
  const ownPlayer = gameRoster.find(
    (player: any) => player.socketId === socket?.id,
  );
  const openingPreview = previewOpening({
    placements: pendingPlacements.filter((item) => item.zone === openingMode),
    mode: openingMode,
    indicator: game.gostergeTas,
    threshold: game.mevcutBaraj,
  });
  const score = openingPreview.score;
  const hasOpened = Boolean(ownPlayer?.acilisTipi);
  const pendingKeys = new Set(
    pendingPlacements.map((item) => `${item.zone}:${item.row}:${item.col}`),
  );
  const openedMoveValid = (["series", "pairs"] as Zone[]).every((zone) => {
    const additions = pendingPlacements.filter((item) => item.zone === zone);
    if (!additions.length) return true;
    const columns = zone === "series" ? SERIES_COLUMNS : PAIRS_COLUMNS;
    const placements = table[zone].flatMap((tile, index) =>
      tile
        ? [
            {
              zone,
              row: Math.floor(index / columns),
              col: index % columns,
              tile,
            },
          ]
        : [],
    );
    const affected = groupsFromPlacements(placements, columns).filter((group) =>
      group.some((cell) => pendingKeys.has(`${zone}:${cell.row}:${cell.col}`)),
    );
    if (!affected.length) return false;
    return affected.every((group) =>
      zone === "series"
        ? validateSeriesGroup(
            group.map((cell) => cell.tile),
            game.gostergeTas,
          ).valid
        : validatePair(
            group.map((cell) => cell.tile),
            game.gostergeTas,
          ).valid,
    );
  });
  const buttonActivity = {
    canSeriAc: !isSpectator,
    canCiftAc: !isSpectator,
    canGeriTopla: pending.length > 0 || Boolean(sideDrawTileId),
    canTasIsle:
      isMyTurn &&
      pending.length > 0 &&
      (!sideDrawTileId ||
        pending.some((tile) => String(tile.id) === sideDrawTileId)) &&
      ((hasOpened && openedMoveValid) ||
        (pendingPlacements.every((item) => item.zone === openingMode) &&
          openingPreview.valid)),
  };

  const dragData = (e: React.DragEvent) => {
    try {
      return JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return null;
    }
  };
  const beginDrag = (e: React.DragEvent, source: string, index: number) =>
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({ source, index }),
    );
  const reject = () => setNotice("Bu hamle şu anda yapılamaz");
  const requestSeriesTimeBonus = () => {
    if (onlineGame && socket?.connected) socket.emit("seri-sure-bonusu");
  };

  const dropTable = (e: React.DragEvent, zone: Zone, index: number) => {
    e.preventDefault();
    const data = dragData(e);
    if (!isMyTurn || !data || data.source !== "rack" || table[zone][index])
      return reject();
    const tile = rack[data.index];
    if (!tile) return;
    if (!rackSnapshotRef.current) rackSnapshotRef.current = [...rack];
    setRack((old) => old.map((v, i) => (i === data.index ? null : v)));
    setTable((old) => ({
      ...old,
      [zone]: old[zone].map((v, i) =>
        i === index ? { ...tile, origin: data.index, committed: false } : v,
      ),
    }));
    if (zone === "series") requestSeriesTimeBonus();
    setNotice(
      `${zone === "series" ? "Seri" : "Çift"} alanına taş yerleştirildi`,
    );
  };

  const drawTile = (source: "deck" | "discard", target?: number) => {
    if (isSpectator) return setNotice("İzleyici modunda hamle yapılamaz");
    if (onlineGame && socket?.connected) {
      if (target !== undefined) pendingDrawTargetRef.current = target;
      socket.emit("tas-cek", source === "discard" ? "iskarta" : "deste");
      return;
    }
    if (!isMyTurn) return reject();
    if (hasDrawn) return setNotice("Taşı zaten çektin, taş atmalısın");
    const empty = target ?? rack.findIndex((v) => !v);
    if (empty < 0 || rack[empty]) return setNotice("Istakada boş yer yok");
    const tile =
      source === "discard"
        ? discard.at(-1)
        : ({
            id: Date.now(),
            value: (game.tur % 13) + 1,
            color: colors[game.tur % 4],
          } as Tile);
    if (!tile) return;
    setRack((old) => old.map((v, i) => (i === empty ? tile : v)));
    if (source === "discard") setDiscard((old) => old.slice(0, -1));
    else
      setGame((g) => ({
        ...g,
        kalanTasSayisi: g.kalanTasSayisi - 1,
        tur: g.tur + 1,
      }));
    setHasDrawn(true);
    setTurnPhase("discard");
    setTurnSeconds(60);
    setNotice("Taş çektin, taş atmalısın");
  };

  const dropRack = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const grid = (
      e.currentTarget.classList.contains("rack-grid")
        ? e.currentTarget
        : e.currentTarget.parentElement
    )?.getBoundingClientRect();
    let targetIndex = index;
    if (grid) {
      const col = Math.max(
        0,
        Math.min(
          15,
          Math.round((e.clientX - grid.left) / (grid.width / 16) - 0.5),
        ),
      );
      const row = Math.max(
        0,
        Math.min(
          1,
          Math.round((e.clientY - grid.top) / (grid.height / 2) - 0.5),
        ),
      );
      targetIndex = row * 16 + col;
    }
    const data = dragData(e);
    if (!data) return;
    if (data.source === "rack") {
      if (data.index === targetIndex) return;
      setRack((old) => {
        const next = [...old];
        [next[targetIndex], next[data.index]] = [
          next[data.index],
          next[targetIndex],
        ];
        return next;
      });
      return;
    }
    if (rack[targetIndex]) return;
    if (data.source === "deck" || data.source === "discard")
      return drawTile(data.source, targetIndex);
  };
  const moveRackByClick = (index: number) => {
    if (rack[index]) return setSelectedRackIndex(index);
    if (selectedRackIndex === null) return;
    setRack((old) => {
      const next = [...old];
      next[index] = next[selectedRackIndex];
      next[selectedRackIndex] = null;
      return next;
    });
    setSelectedRackIndex(null);
  };
  const rackIndexFromPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.max(
      0,
      Math.min(
        15,
        Math.round((e.clientX - rect.left) / (rect.width / 16) - 0.5),
      ),
    );
    const row = Math.max(
      0,
      Math.min(1, Math.round((e.clientY - rect.top) / (rect.height / 2) - 0.5)),
    );
    return row * 16 + col;
  };
  const discardRackIndex = (rackIndex: number) => {
    if (isSpectator) return setNotice("İzleyici modunda hamle yapılamaz");
    if (!rack[rackIndex]) return reject();
    if (sideDrawTileId)
      return setNotice("Yandan aldığın taşı önce masaya işlemelisin");
    if (pending.length)
      return setNotice("Önce masadaki taşları işle veya geri topla");
    if (onlineGame && socket?.connected) {
      socket.emit("tas-at", rack[rackIndex]!.id);
      return;
    }
    if (!isMyTurn) return reject();
    if (!hasDrawn) return setNotice("Önce taş çekmelisin");
    const tile = rack[rackIndex]!;
    setRack((old) =>
      old.map((value, index) => (index === rackIndex ? null : value)),
    );
    setMyDiscards((old) => [...old, tile]);
    setPlayerDiscards((old) => ({ ...old, [profileName]: tile }));
    setSelectedRackIndex(null);
    setHasDrawn(false);
    setTurnPhase("draw");
    setTurnSeconds(60);
    setGame((g) => ({ ...g, tur: g.tur + 1 }));
    setNotice("Taş atıldı, taş çekmelisin");
  };
  const discardSelected = () => {
    if (selectedRackIndex === null) return reject();
    discardRackIndex(selectedRackIndex);
  };
  const startRackPointerDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    source: "rack" | "discard" | "deck" | "table" | "inspect",
    index: number,
    tile: Tile,
    zone?: Zone,
  ) => {
    if (isSpectator) {
      setNotice("İzleyici modunda hamle yapılamaz");
      return;
    }
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setRackPointerDrag({
      source,
      index,
      zone,
      tile,
      x: e.clientX,
      y: e.clientY,
      centerOffsetX: rect.left + rect.width / 2 - e.clientX,
      centerOffsetY: rect.top + rect.height / 2 - e.clientY,
    });
  };
  const moveRackPointerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rackPointerDrag) return;
    setRackPointerDrag((current) =>
      current ? { ...current, x: e.clientX, y: e.clientY } : null,
    );
  };
  const nearestTableCell = (centerX: number, centerY: number) => {
    let best: { zone: Zone; index: number; distance: number } | null = null;
    for (const [zone, ref] of [
      ["series", seriesGridRef],
      ["pairs", pairsGridRef],
    ] as const) {
      const rect = ref.current?.getBoundingClientRect();
      if (
        !rect ||
        centerX < rect.left - 36 ||
        centerX > rect.right + 36 ||
        centerY < rect.top - 36 ||
        centerY > rect.bottom + 36
      )
        continue;
      ref.current
        ?.querySelectorAll<HTMLElement>(".grid-cell")
        .forEach((cell, index) => {
          const isSourceCell =
            rackPointerDrag?.source === "table" &&
            rackPointerDrag.zone === zone &&
            rackPointerDrag.index === index;
          const existing = table[zone][index];
          const canReplaceJoker = Boolean(
            (rackPointerDrag?.source === "rack" ||
              rackPointerDrag?.source === "discard") &&
              existing?.committed &&
              zone === "series" &&
              isOkeyTile(existing, game.gostergeTas),
          );
          if (existing && !isSourceCell && !canReplaceJoker) return;
          const cellRect = cell.getBoundingClientRect();
          const dx = centerX - (cellRect.left + cellRect.width / 2);
          const dy = centerY - (cellRect.top + cellRect.height / 2);
          const distance = dx * dx + dy * dy;
          if (!best || distance < best.distance)
            best = { zone, index, distance };
        });
    }
    return best as { zone: Zone; index: number; distance: number } | null;
  };
  const nearestRackCell = (centerX: number, centerY: number) => {
    const rect = rackGridRef.current?.getBoundingClientRect();
    if (
      !rect ||
      centerX < rect.left - 36 ||
      centerX > rect.right + 36 ||
      centerY < rect.top - 36 ||
      centerY > rect.bottom + 36
    )
      return -1;
    let target = -1;
    let distance = Infinity;
    rackGridRef.current
      ?.querySelectorAll<HTMLElement>(".rack-cell")
      .forEach((cell, index) => {
        const cellRect = cell.getBoundingClientRect();
        const dx = centerX - (cellRect.left + cellRect.width / 2);
        const dy = centerY - (cellRect.top + cellRect.height / 2);
        const next = dx * dx + dy * dy;
        if (next < distance) {
          distance = next;
          target = index;
        }
      });
    return target;
  };
  const finishRackPointerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rackPointerDrag) return;
    const centerX = e.clientX + rackPointerDrag.centerOffsetX,
      centerY = e.clientY + rackPointerDrag.centerOffsetY;
    // History tiles can be pulled aside to reveal the stack, but inspecting
    // them must never become a game action or alter either board.
    if (rackPointerDrag.source === "inspect") {
      setRackPointerDrag(null);
      return;
    }
    const tableTarget = nearestTableCell(centerX, centerY);
    if (
      (rackPointerDrag.source === "rack" ||
        rackPointerDrag.source === "table" ||
        rackPointerDrag.source === "discard") &&
      tableTarget
    ) {
      const sourceZone = rackPointerDrag.zone;
      const sourceIndex = rackPointerDrag.index;
      const destination = table[tableTarget.zone][tableTarget.index];
      const sameCell =
        rackPointerDrag.source === "table" &&
        sourceZone === tableTarget.zone &&
        sourceIndex === tableTarget.index;
      const replacingJoker = Boolean(
        (rackPointerDrag.source === "rack" ||
          rackPointerDrag.source === "discard") &&
          destination?.committed &&
          tableTarget.zone === "series" &&
          isOkeyTile(destination, game.gostergeTas),
      );
      if (!isMyTurn) reject();
      else if (replacingJoker) {
        if (rackPointerDrag.source === "discard" && hasDrawn)
          setNotice("Taşı zaten çektin, taş atmalısın");
        else if (!onlineGame || !socket?.connected)
          setNotice("Okey değiştirme yalnız çevrimiçi oyunda kullanılabilir");
        else if (rackPointerDrag.source === "discard") {
          pendingSideTableRef.current = {
            ...tableTarget,
            replaceJoker: true,
          };
          socket.emit("tas-cek", "iskarta");
        } else
          socket.emit(
            "joker-degistir",
            {
              zone: "series",
              row: Math.floor(tableTarget.index / SERIES_COLUMNS),
              col: tableTarget.index % SERIES_COLUMNS,
              tasId: rackPointerDrag.tile.id,
              kaynak:
                rackPointerDrag.source === "discard" ? "iskarta" : "el",
            },
            (response: any) => {
              if (!response?.ok)
                return setNotice(response?.error || "Okey değiştirilemedi");
              setTable(tableFromServer(response.masaZemini, game.gostergeTas));
              requestSeriesTimeBonus();
              rackSnapshotRef.current = null;
              setNotice("Taş yerine kondu, okey ıstakana alındı");
            },
          );
      } else if (rackPointerDrag.source === "discard") {
        if (hasDrawn) setNotice("Taşı zaten çektin, taş atmalısın");
        else if (destination) setNotice("Bu masa hücresi dolu");
        else if (!onlineGame || !socket?.connected)
          setNotice("Yandan taş yalnız çevrimiçi oyunda alınabilir");
        else {
          pendingSideTableRef.current = tableTarget;
          socket.emit("tas-cek", "iskarta");
        }
      } else if (!sameCell && destination)
        setNotice("Bu masa hücresi dolu");
      else if (!sameCell) {
        if (!rackSnapshotRef.current) rackSnapshotRef.current = [...rack];
        if (rackPointerDrag.source === "rack")
          setRack((old) =>
            old.map((tile, index) => (index === sourceIndex ? null : tile)),
          );
        setTable((old) => {
          const next = {
            series: [...old.series],
            pairs: [...old.pairs],
          };
          if (rackPointerDrag.source === "table" && sourceZone)
            next[sourceZone][sourceIndex] = null;
          next[tableTarget.zone][tableTarget.index] = {
            ...rackPointerDrag.tile,
            origin:
              rackPointerDrag.source === "rack"
                ? sourceIndex
                : (rackPointerDrag.tile as TableTile).origin,
            committed: false,
          };
          return next;
        });
        if (
          tableTarget.zone === "series" &&
          !(rackPointerDrag.source === "table" && sourceZone === "series")
        )
          requestSeriesTimeBonus();
        setNotice(
          `${tableTarget.zone === "series" ? "Seri" : "Çift"} alanına taş yerleştirildi`,
        );
      }
      setRackPointerDrag(null);
      return;
    }
    if (rackPointerDrag.source === "table" && rackPointerDrag.zone) {
      const target = nearestRackCell(centerX, centerY);
      if (target >= 0) {
        const emptyTarget = rack[target]
          ? rack.findIndex((tile) => !tile)
          : target;
        if (emptyTarget >= 0) {
          setRack((old) =>
            old.map((tile, index) =>
              index === emptyTarget ? rackPointerDrag.tile : tile,
            ),
          );
          setTable((old) => ({
            ...old,
            [rackPointerDrag.zone!]: old[rackPointerDrag.zone!].map(
              (tile, index) => (index === rackPointerDrag.index ? null : tile),
            ),
          }));
        } else setNotice("Istakada boş yer yok");
      }
      setRackPointerDrag(null);
      return;
    }
    const throwRect = rackThrowRef.current?.getBoundingClientRect();
    if (
      rackPointerDrag.source === "rack" &&
      throwRect &&
      centerX >= throwRect.left &&
      centerX <= throwRect.right &&
      centerY >= throwRect.top &&
      centerY <= throwRect.bottom
    )
      discardRackIndex(rackPointerDrag.index);
    else {
      const target = nearestRackCell(centerX, centerY);
      if (target >= 0) {
        if (rackPointerDrag.source === "discard") {
          if (isMyTurn && !hasDrawn && !rack[target]) {
            if (onlineGame && socket?.connected) {
              drawTile("discard", target);
              setRackPointerDrag(null);
              return;
            }
            const tile = rackPointerDrag.tile;
            setRack((old) =>
              old.map((value, index) => (index === target ? tile : value)),
            );
            setIncomingDiscards((old) =>
              old.filter((item) => item.id !== tile.id),
            );
            setDiscard((old) => old.filter((item) => item.id !== tile.id));
            setHasDrawn(true);
            setTurnPhase("discard");
            setTurnSeconds(60);
            setNotice("Atılan taş alındı, taş atmalısın");
          }
        } else if (rackPointerDrag.source === "rack")
          setRack((old) => {
            const next = [...old];
            [next[target], next[rackPointerDrag.index]] = [
              next[rackPointerDrag.index],
              next[target],
            ];
            return next;
          });
      }
    }
    setRackPointerDrag(null);
  };

  const finishDeckPointerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rackPointerDrag || rackPointerDrag.source !== "deck") return;
    const centerX = e.clientX + rackPointerDrag.centerOffsetX,
      centerY = e.clientY + rackPointerDrag.centerOffsetY;
    const cells =
      rackGridRef.current?.querySelectorAll<HTMLElement>(".rack-cell");
    if (cells?.length) {
      let target = -1,
        distance = Infinity;
      cells.forEach((cell, index) => {
        const rect = cell.getBoundingClientRect(),
          dx = centerX - (rect.left + rect.width / 2),
          dy = centerY - (rect.top + rect.height / 2),
          next = dx * dx + dy * dy;
        if (next < distance) {
          distance = next;
          target = index;
        }
      });
      const gridRect = rackGridRef.current?.getBoundingClientRect();
      if (
        gridRect &&
        centerX >= gridRect.left - 28 &&
        centerX <= gridRect.right + 28 &&
        centerY >= gridRect.top - 28 &&
        centerY <= gridRect.bottom + 28 &&
        target >= 0 &&
        !rack[target]
      ) {
        pendingDrawTargetRef.current = target;
        drawTile("deck", target);
      }
    }
    setRackPointerDrag(null);
  };
  const collect = () => {
    if (rackSnapshotRef.current) setRack(rackSnapshotRef.current);
    else {
      const next = [...rack];
      pending.forEach((tile) => {
        const position = next[tile.origin]
          ? next.findIndex((value) => !value)
          : tile.origin;
        if (position >= 0)
          next[position] = {
            id: tile.id,
            value: tile.value,
            color: tile.color,
            isOkey: tile.isOkey,
          };
      });
      setRack(next);
    }
    setTable((current) => ({
      series: current.series.map((tile) => (tile?.committed ? tile : null)),
      pairs: current.pairs.map((tile) => (tile?.committed ? tile : null)),
    }));
    rackSnapshotRef.current = null;
    returnSideTileIfNeeded();
    setNotice("Bekleyen taşlar ıstakaya geri alındı");
  };
  const returnSideTileIfNeeded = () => {
    if (onlineGame && sideDrawTileId) socket?.emit("yandan-tas-iade");
  };
  const commitTable = () => {
    if (!buttonActivity.canTasIsle)
      return setNotice(
        openingMode === "series"
            ? `Geçerli perlerle en az ${game.mevcutBaraj} puana ulaşmalısın`
            : "En az 5 geçerli çift dizmelisin",
      );
    const payload = {
      mode: openingMode,
      placements: pendingPlacements.map(({ zone, row, col, tasId }) => ({
        zone,
        row,
        col,
        tasId,
      })),
    };
    if (onlineGame && socket?.connected) {
      socket.emit("masa-hamlesi-onayla", payload, (response: any) => {
        if (!response?.ok)
          return setNotice(response?.error || "Taşlar işlenemedi");
        setTable(tableFromServer(response.masaZemini, game.gostergeTas));
        rackSnapshotRef.current = null;
        setGame((current) => ({
          ...current,
          mevcutBaraj: response.mevcutBaraj ?? current.mevcutBaraj,
        }));
        setNotice("Taşlar masaya işlendi");
      });
      return;
    }
    setTable((current) => ({
      series: current.series.map((tile) =>
        tile ? { ...tile, committed: true } : null,
      ),
      pairs: current.pairs.map((tile) =>
        tile ? { ...tile, committed: true } : null,
      ),
    }));
    rackSnapshotRef.current = null;
    setNotice("Taşlar masaya işlendi");
  };
  const discardTile = (e: React.DragEvent) => {
    e.preventDefault();
    const d = dragData(e);
    if (!isMyTurn || d?.source !== "rack") return reject();
    const tile = rack[d.index];
    if (!tile) return;
    setRack((r) => r.map((v, i) => (i === d.index ? null : v)));
    setMyDiscards((old) => [...old, tile]);
    setPlayerDiscards((old) => ({ ...old, [profileName]: tile }));
    setHasDrawn(false);
    setGame((g) => ({ ...g, tur: g.tur + 1 }));
    setNotice("Taş atıldı");
  };
  const sortRack = (mode: "series" | "pairs") => {
    const tiles = rack.filter(Boolean) as Tile[];
    tiles.sort(
      mode === "series"
        ? (a, b) =>
            colors.indexOf(a.color) - colors.indexOf(b.color) ||
            (Number(a.value) || 99) - (Number(b.value) || 99)
        : (a, b) =>
            (Number(a.value) || 99) - (Number(b.value) || 99) ||
            colors.indexOf(a.color) - colors.indexOf(b.color),
    );
    setRack([...tiles, ...Array(44 - tiles.length).fill(null)]);
    setNotice(
      mode === "series"
        ? "Taşlar serilere göre dizildi"
        : "Taşlar çiftlere göre dizildi",
    );
  };

  const activeRoom = roomSnapshots.find((room) => room.odaId === selectedRoom);
  const roomPlayers = [
    ...(activeRoom?.oyuncular?.length
      ? activeRoom.oyuncular
      : onlineGame || gamePrepared
        ? gameRoster
        : []),
  ].sort((a: any, b: any) => a.koltukNo - b.koltukNo);
  const me = roomPlayers.find(
    (player: any) =>
      player.socketId === socket?.id ||
      (!socket?.id && !player.bot && player.isim === profileName),
  );
  const playerBeforeMe = previousPlayerSeat(roomPlayers, me?.koltukNo ?? null);
  const playerAfterMe = nextPlayerSeat(roomPlayers, me?.koltukNo ?? null);
  const previousPlayer = roomPlayers.find(
    (player: any) => player.koltukNo === playerBeforeMe,
  );
  const nextPlayer = roomPlayers.find(
    (player: any) => player.koltukNo === playerAfterMe,
  );
  const topPlayers = roomPlayers.filter(
    (player: any) =>
      player !== me &&
      player.koltukNo !== playerBeforeMe &&
      player.koltukNo !== playerAfterMe,
  );
  const headerPlayers = me
    ? [
        ...(previousPlayer
          ? [{ ...previousPlayer, tablePosition: "right" }]
          : []),
        ...topPlayers.map((player: any) => ({
          ...player,
          tablePosition: "top",
        })),
        ...(nextPlayer && nextPlayer.koltukNo !== playerBeforeMe
          ? [{ ...nextPlayer, tablePosition: "left" }]
          : []),
      ]
    : roomPlayers
        .filter((player: any) => player !== me)
        .sort(
          (a: any, b: any) =>
            (a.siraNo ?? a.koltukNo) - (b.siraNo ?? b.koltukNo),
        );
  const cornerDiscardPlayers = headerPlayers
    .filter((player: any) => player.koltukNo !== playerBeforeMe)
    .slice(0, 2);
  const canDistribute = Boolean(
    gamePrepared && me && me.siraNo === 1 && !me.bot,
  );
  useEffect(() => {
    if (!onlineGame) return;
    if (isMyTurn) {
      if (sideDrawTileId) {
        setTurnPhase("discard");
        setNotice("Yandan aldığın taşı bu turda masaya işlemelisin");
        return;
      }
      const mustDiscard = hasDrawn || rack.filter(Boolean).length === 22;
      setTurnPhase(mustDiscard ? "discard" : "draw");
      setNotice(
        mustDiscard
          ? "Taş atmalısın"
          : game.kalanTasSayisi === 0
            ? "Taş kalmadı, eli bitirmelisin"
            : "Ortadan taş çekmelisin",
      );
      return;
    }
    const active = gameRoster.find(
      (player) => player.koltukNo === game.siradakiOyuncu,
    );
    setNotice(
      active
        ? `${active.isim || (active.bot ? "Robot" : "Oyuncu")} oynuyor`
        : "Sıra diğer oyuncuda",
    );
  }, [
    onlineGame,
    isMyTurn,
    hasDrawn,
    game.siradakiOyuncu,
    gameRoster,
    rack,
    sideDrawTileId,
    game.kalanTasSayisi,
  ]);
  const selfPlayer = me ?? { isim: profileName, avatar: profileEmoji };
  const players = [
    selfPlayer,
    ...roomPlayers.filter((player: any) => player !== me),
  ]
    .map((player: any, index: number) => ({
      name: player.isim || (player.bot ? "Robot" : "Oyuncu"),
      count: index === 0 ? rack.filter(Boolean).length : 21,
    }))
    .concat(
      Array.from({ length: Math.max(0, 4 - roomPlayers.length) }, () => ({
        name: "",
        count: 0,
      })),
    );
  const gridInteractionKey = `${isMyTurn}:${hasDrawn}:${onlineGame}:${Boolean(socket?.connected)}:${String(game.gostergeTas.id)}:${rack.map((tile) => tile?.id ?? "-").join(",")}`;
  const runRobotTurns = () => {
    const robots = roomPlayers.filter((player: any) => player.bot);
    robots.forEach((robot: any, index: number) =>
      setTimeout(
        () => {
          const tile: Tile = {
            id: Date.now() + index,
            value: ((game.tur + index + 3) % 13) + 1,
            color: colors[(game.tur + index) % 4],
          };
          setDiscard((old) => [...old, tile]);
          if (index === robots.length - 1)
            setIncomingDiscards((old) => [...old, tile]);
          setPlayerDiscards((old) => ({ ...old, [robot.socketId]: tile }));
          setPlayerDiscardHistories((old) => ({
            ...old,
            [robot.socketId]: [...(old[robot.socketId] || []), tile].slice(-3),
          }));
          setGame((current) => ({
            ...current,
            siradakiOyuncu: index + 1,
            tur: current.tur + 1,
          }));
          setNotice(`${robot.isim} taş attı`);
        },
        900 * (index + 1),
      ),
    );
    setTimeout(
      () => {
        setGame((current) => ({ ...current, siradakiOyuncu: 0 }));
        setNotice("Sıra sizde");
      },
      900 * (robots.length + 1),
    );
  };
  const createRoom = () => {
    setJoinedRoom(false);
    if (socket?.connected) {
      socket.emit("oda-olustur", {
        odaAdi: roomName || "Yeni Masa",
        maksimum: roomSize,
        kullaniciId: userId,
        kuralTipi: roomRule,
        toplamEl: roomHands,
      });
      return;
    }
    const id = Date.now();
    setRooms((old) => [
      ...old,
      {
        id,
        name: roomName || "Yeni Masa",
        owner: "Siz",
        players: 0,
        max: roomSize,
        status: "",
        rule: roomRule,
        hands: roomHands,
        started: false,
      },
    ]);
    setSelectedRoom(id);
    setBots(0);
    setScreen("room");
  };
  const deleteRoom = (id: number) => {
    socket?.emit("oda-sil", { odaId: id, kullaniciId: userId });
    setRooms((old) =>
      old.filter((room) => !(room.id === id && room.owner === "Siz")),
    );
  };
  const joinRoom = (id: number | string) => {
    setSelectedRoom(id);
    setScreen("room");
  };
  const watchRoom = () => socket?.emit("oda-izle", selectedRoom);
  const addComputer = (seat = 0) =>
    socket?.emit("robot-ekle", {
      odaId: selectedRoom,
      koltukNo: seat,
      kullaniciId: userId,
    });
  const removeComputer = (seat = 0) =>
    socket?.emit("robot-sil", {
      odaId: selectedRoom,
      koltukNo: seat,
      kullaniciId: userId,
    });
  const joinSeat = (seat = 0) =>
    socket?.emit("oda-katil", {
      odaId: selectedRoom,
      koltukNo: seat,
      isim: profileName,
      avatar: profileEmoji,
      kullaniciId: userId,
    });
  const leaveSeat = () => socket?.emit("oda-ayril", selectedRoom);
  const leaveRoom = () => {
    socket?.emit("oda-ayril", selectedRoom);
    setJoinedRoomId(null);
    setOnlineGame(false);
    setGamePrepared(false);
    setRack(Array(44).fill(null));
    setTable(blankTable());
    setScreen("lobby");
  };
  const leaveGame = leaveRoom;
  const installApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallHint("Uygulama kuruluyor");
      setInstallPrompt(null);
      return;
    }
    if (iosInstallTarget) {
      setInstallHint("Safari'de Paylaş'a, ardından Ana Ekrana Ekle'ye dokun");
      return;
    }
    setInstallHint("Kurulum için siteyi HTTPS adresinden aç");
  };
  if (screen === "menu")
    return (
      <StartMenu
        onStart={() => setScreen("lobby")}
        onSettings={() => setScreen("settings")}
        onInstall={installApp}
        showInstall={
          mobileInstallTarget && Boolean(installPrompt || iosInstallTarget)
        }
        installHint={installHint}
        notice={notice}
      />
    );
  if (screen === "settings")
    return (
      <SettingsView
        name={profileName}
        emoji={profileEmoji}
        soundOn={soundOn}
        onNameChange={setProfileName}
        onEmojiChange={setProfileEmoji}
        onSoundChange={setSoundOn}
        onBack={() => setScreen("menu")}
      />
    );
  if (screen === "lobby")
    return (
      <Lobby
        rooms={rooms}
        joinedRoomId={joinedRoomId}
        roomName={roomName}
        setRoomName={setRoomName}
        roomSize={roomSize}
        setRoomSize={setRoomSize}
        roomRule={roomRule}
        setRoomRule={setRoomRule}
        roomHands={roomHands}
        setRoomHands={setRoomHands}
        onCreate={createRoom}
        onDelete={deleteRoom}
        onJoin={joinRoom}
        onBack={() => setScreen("menu")}
      />
    );
  if (screen === "room") {
    const room =
      roomSnapshots.find((r) => r.odaId === selectedRoom) ??
      rooms.find((r) => r.id === selectedRoom) ??
      rooms[0];
    return (
      <RoomView
        room={room}
        currentSocketId={socket?.id ?? ""}
        onAddComputer={addComputer}
        onRemoveComputer={removeComputer}
        onJoinSeat={joinSeat}
        onLeaveSeat={leaveSeat}
        onWatch={watchRoom}
        onStart={() => socket?.emit("oyun-baslat")}
        onBack={leaveRoom}
      />
    );
  }
  return (
    <main
      className={`game-shell game-theme-${gameTheme} ${isSpectator ? "spectator-mode" : ""} ${game.elSonucu ? "round-complete" : ""}`}
    >
      <div className="game-top-actions">
        {!isSpectator && (onlineGame || gamePrepared) && (
          <button className="game-leave-button" onClick={leaveGame}>
            Oyundan ayrıl
          </button>
        )}
        <button
          type="button"
          className="game-theme-button"
          aria-label={`Tema: ${gameThemeNames[gameTheme]}`}
          title={`${gameThemeNames[gameTheme]} tema`}
          onClick={() =>
            setGameTheme((current) => {
              const index = gameThemes.indexOf(current);
              return gameThemes[(index + 1) % gameThemes.length];
            })
          }
        >
          <i aria-hidden="true" />
          Tema
        </button>
        {onlineGame && game.toplamEl > 0 && (
          <span className="game-top-round">
            <b>{Math.min(game.tamamlananEl + 1, game.toplamEl)}. el</b>
          </span>
        )}
      </div>
      {isSpectator && (
        <div className="spectator-badge" role="status">
          İzleyici modu
        </div>
      )}
      {game.elSonucu && !onlineGame && (
        <section className="round-result" role="dialog" aria-modal="true">
          <div className="round-result-content">
            <small>
              {game.elSonucu.macBitti
                ? `${game.toplamEl} el tamamlandı`
                : `${game.elSonucu.elNo}. el tamamlandı`}
            </small>
            <h2>
              {game.elSonucu.macBitti
                ? `Oyunun kazananı: ${game.macKazananlari.map((item: any) => item.isim).join(" & ")}`
                : game.elSonucu.berabere
                  ? "El berabere tamamlandı"
                  : `Elin kazananı: ${game.elSonucu.kazananIsim}`}
            </h2>
            <div className="round-score-list">
              {[...(game.elSonucu.puanlar || [])]
                .sort((a: any, b: any) => a.toplam - b.toplam)
                .map((item: any, index: number) => (
                  <div
                    className={index === 0 ? "leader" : ""}
                    key={item.koltukNo}
                  >
                    <span>{item.isim}</span>
                    <small>{item.fark > 0 ? `+${item.fark}` : item.fark}</small>
                    <b>{item.toplam}</b>
                  </div>
                ))}
            </div>
            {!game.elSonucu.macBitti &&
              game.roomOwnerSocketId === socket?.id && (
                <button
                  className="next-hand-button"
                  onClick={() => socket?.emit("sonraki-el")}
                >
                  {Number(game.elSonucu.elNo || game.tamamlananEl) + 1}. Eli Oyna
                </button>
              )}
            {!game.elSonucu.macBitti &&
              game.roomOwnerSocketId !== socket?.id && (
                <p>Oda kurucusu yeni eli başlatacak.</p>
              )}
          </div>
        </section>
      )}
      <section className="game-player-strip" aria-label="Oyuncular">
        {headerPlayers.map((player: any) => {
          const active = onlineGame && game.siradakiOyuncu === player.koltukNo;
          return (
            <div
              className={`game-player ${player.tablePosition ? `game-player-position-${player.tablePosition}` : ""} ${active ? "active" : ""}`}
              key={player.socketId}
            >
              <span className="game-player-order">{player.siraNo ?? "—"}</span>
              <span className="game-player-avatar">
                {player.avatar || (player.bot ? "🤖" : "🙂")}
              </span>
              <div className="game-player-name">
                <b>{player.isim}</b>
                <small>{Number(player.puan || 0)} puan</small>
                {Number(player.cezaPuani || 0) > 0 && (
                  <span className="player-penalty">
                    {Number(player.cezaPuani)} ceza yedi
                  </span>
                )}
                {player.acilisTipi && (
                  <span
                    className={`player-opening player-opening-${player.acilisTipi}`}
                  >
                    {player.acilisTipi === "pairs"
                      ? "Çift açtı"
                      : "Seri açtı"}
                  </span>
                )}
              </div>
              <span className="game-player-status">
                {active ? "Sıra onda" : "Bekliyor"}
              </span>
            </div>
          );
        })}
      </section>
      <section
        className="opponent-discard-corners"
        aria-label="Rakiplerin attığı taşlar"
      >
        {Array.from({ length: 2 }, (_, index) => {
          const player: any = cornerDiscardPlayers[index] ?? null;
          const takenFromThisPlayer = Boolean(
            player && takenProfileDiscard?.seat === player.koltukNo,
          );
          const lastTile = player
            ? ((takenFromThisPlayer ? takenProfileDiscard?.tile : null) ??
              playerDiscards[String(player.koltukNo)] ??
              playerDiscards[player.socketId] ??
              playerDiscards[player.isim])
            : null;
          const history: Tile[] = player
            ? (playerDiscardHistories[String(player.koltukNo)] ??
              playerDiscardHistories[player.socketId] ??
              playerDiscardHistories[player.isim] ??
              (lastTile ? [lastTile] : []))
            : [];
          const visibleHistory = history.slice(-3);
          return (
            <div
              className={`opponent-discard-corner opponent-discard-corner-${index === 0 ? "left" : "right"} ${takenFromThisPlayer ? "discard-taken" : ""}`}
              key={`discard-${player?.socketId ?? `empty-${index}`}`}
            >
              <div className="rack-discard opponent-rack-discard">
                <div className="incoming-discard-stack">
                  {visibleHistory.map((tile, tileIndex) => (
                  <div
                    className={`incoming-pointer-tile ${tileIndex === visibleHistory.length - 1 ? "top" : ""} ${rackPointerDrag?.source === "inspect" && rackPointerDrag.tile.id === tile.id ? "drag-source" : ""}`}
                    key={tile.id}
                    style={{ zIndex: tileIndex + 1 }}
                    onPointerDown={(event) =>
                      startRackPointerDrag(event, "inspect", -1, tile)
                    }
                    onPointerMove={moveRackPointerDrag}
                    onPointerUp={finishRackPointerDrag}
                    onPointerCancel={() => setRackPointerDrag(null)}
                  >
                    <TileView tile={tile} compact />
                  </div>
                  ))}
                </div>
                {visibleHistory.length === 0 && <span>+</span>}
              </div>
            </div>
          );
        })}
      </section>
      <section className="game-center-info">
        {gamePrepared ? (
          <button
            className="deal-button"
            disabled={!canDistribute}
            onClick={() => socket?.emit("taslari-dagit")}
          >
            Taşları Diz
          </button>
        ) : (
          onlineGame && (
            <>
              <div className="indicator-tile">
                <small>Gösterge</small>
                <TileView tile={game.gostergeTas} />
              </div>
              <div className="deck-info">
                {game.kalanTasSayisi > 0 ? (
                  <>
                    <div
                      className="center-deck-stack"
                      onDoubleClick={() => drawTile("deck")}
                      onPointerDown={(e) =>
                        startRackPointerDrag(e, "deck", -1, {
                          id: "deck-hidden",
                          value: "?",
                          color: "black",
                        })
                      }
                      onPointerMove={moveRackPointerDrag}
                      onPointerUp={finishDeckPointerDrag}
                      onPointerCancel={() => setRackPointerDrag(null)}
                    >
                      <i />
                      <i />
                      <div className="center-deck-tile">
                        {game.kalanTasSayisi}
                      </div>
                      {drawAnimation?.source === "deste" && (
                        <div
                          className="draw-fly draw-from-deste"
                          aria-hidden="true"
                        >
                          {drawAnimation.tile ? (
                            <TileView tile={drawAnimation.tile} compact />
                          ) : (
                            <span>?</span>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  game.eliBitirecekKoltukNo === mySeat && !isSpectator ? (
                    <button
                      className="finish-empty-hand"
                      onClick={() => socket?.emit("eli-bitir")}
                    >
                      Eli Bitir
                    </button>
                  ) : (
                    <span className="finish-empty-wait">
                      El otomatik bitecek
                    </span>
                  )
                )}
              </div>
              <div
                className="table-controls"
                aria-label="Masaya açma kontrolleri"
              >
                <div className="table-mode-buttons">
                  <button
                    type="button"
                    className={openingMode === "series" ? "active" : ""}
                    aria-pressed={openingMode === "series"}
                    onClick={() => {
                      setOpeningMode("series");
                      setNotice("Seri alanı seçildi");
                    }}
                    disabled={isSpectator}
                  >
                    Seri Aç
                  </button>
                  <button
                    type="button"
                    className={openingMode === "pairs" ? "active" : ""}
                    aria-pressed={openingMode === "pairs"}
                    onClick={() => {
                      setOpeningMode("pairs");
                      setNotice("Çift alanı seçildi");
                    }}
                    disabled={isSpectator}
                  >
                    Çift Aç
                  </button>
                </div>
                <div className="table-action-buttons">
                  <button
                    className="process-table"
                    disabled={!buttonActivity.canTasIsle}
                    onClick={commitTable}
                  >
                    Taşları İşle
                  </button>
                  <button
                    disabled={!buttonActivity.canGeriTopla}
                    onClick={collect}
                  >
                    Geri Topla
                  </button>
                </div>
                <output
                  className={`opening-counter ${openingPreview.valid || hasOpened ? "complete" : ""}`}
                >
                  {hasOpened
                    ? `${pending.length} taş hazır`
                    : openingMode === "series"
                      ? `${openingPreview.score} / ${game.mevcutBaraj}`
                      : `${openingPreview.pairCount} / 5 çift`}
                </output>
              </div>
            </>
          )
        )}
      </section>
      <section className="game-area">
        <div className="board-stage">
          <div className="table-head">
            <div>
              <span>Seri</span>
            </div>
            <div>
              <span>Çift</span>
            </div>
          </div>
          <div className="table-matrix">
            <Grid
              cells={table.series}
              indicator={game.gostergeTas}
              zone="series"
              active={openingMode === "series"}
              interactionKey={gridInteractionKey}
              gridRef={seriesGridRef}
              onDrop={dropTable}
              onPointerStart={(e, index, tile) =>
                startRackPointerDrag(e, "table", index, tile, "series")
              }
              onPointerMove={moveRackPointerDrag}
              onPointerEnd={finishRackPointerDrag}
              dragState={rackPointerDrag}
            />
            <Grid
              cells={table.pairs}
              indicator={game.gostergeTas}
              zone="pairs"
              active={openingMode === "pairs"}
              interactionKey={gridInteractionKey}
              gridRef={pairsGridRef}
              onDrop={dropTable}
              onPointerStart={(e, index, tile) =>
                startRackPointerDrag(e, "table", index, tile, "pairs")
              }
              onPointerMove={moveRackPointerDrag}
              onPointerEnd={finishRackPointerDrag}
              dragState={rackPointerDrag}
            />
          </div>
        </div>
      </section>
      <aside className="sidebar">
        <div className="rules">
          <span>Eşli</span>
          <span>Yardımlı</span>
          <span>Katlamalı</span>
        </div>
        <div className="side-content">
          <div className="deck-column">
            <label>Okey</label>
            <TileView tile={game.gostergeTas} />
            <label>Deste</label>
            <div
              className="deck"
              draggable
              onDragStart={(e) => beginDrag(e, "deck", 0)}
              onDoubleClick={() => drawTile("deck")}
            >
              <strong>{game.kalanTasSayisi}</strong>
            </div>
            <output>{String(game.tur).padStart(3, "0")}</output>
            <small>
              Baraj <b>{game.mevcutBaraj}</b>
            </small>
          </div>
          <div
            className="discard-column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={discardTile}
          >
            <label>Atılan</label>
            <div className="discard-stack">
              {discard.slice(-5).map((t, i) => (
                <div key={t.id} style={{ top: i * 18, zIndex: i }}>
                  <TileView
                    tile={t}
                    compact
                    draggable={i === Math.min(4, discard.length - 1)}
                    onDragStart={(e) =>
                      beginDrag(e, "discard", discard.length - 1)
                    }
                    onDoubleClick={
                      i === Math.min(4, discard.length - 1)
                        ? () => drawTile("discard")
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="actions">
            <button
              disabled={!buttonActivity.canSeriAc}
              onClick={() => setOpeningMode("series")}
            >
              <b>Seri</b>
              <span>{score || "—"}</span>
            </button>
            <button
              disabled={!buttonActivity.canCiftAc}
              onClick={() => setOpeningMode("pairs")}
            >
              <b>Çift</b>
              <span>{table.pairs.filter(Boolean).length}/5</span>
            </button>
            <button
              aria-label="Geri topla"
              disabled={!buttonActivity.canGeriTopla}
              onClick={collect}
            >
              <b>↶</b>
            </button>
            <button disabled={!buttonActivity.canTasIsle} onClick={commitTable}>
              <b>İşle</b>
            </button>
          </div>
        </div>
      </aside>
      <section className="rack-area">
        <div className="rack-actions">
          <button onClick={() => drawTile("deck")}>Ortadan taş çek</button>
          <button disabled={isSpectator} onClick={() => sortRack("pairs")}>
            Çift diz
          </button>
          <button disabled={isSpectator} onClick={() => sortRack("series")}>
            Seri diz
          </button>
        </div>
        <div className="turn-timer-slot">
          {onlineGame && game.hamleSonZaman ? (
            <TurnTimer
              limit={game.hamleSuresi ?? turnLimit}
              deadline={game.hamleSonZaman}
              phase={turnPhase}
              running
              resetKey={`${game.elNo}:${game.siradakiOyuncu}:${turnPhase}:${game.hamleSonZaman}`}
            />
          ) : null}
        </div>
        <div className="rack-board">
          <div className="rack-discard rack-discard-left">
            <small>Yandan taş çek</small>
            <div className="incoming-discard-stack">
              {incomingDiscards.slice(-3).map((tile, i) => {
                const top = i === incomingDiscards.slice(-3).length - 1;
                const isDraggedHistoryTile =
                  rackPointerDrag?.tile.id === tile.id &&
                  (rackPointerDrag.source === "discard" ||
                    rackPointerDrag.source === "inspect");
                return (
                  <div
                    key={tile.id}
                    className={`incoming-pointer-tile ${top ? "top" : ""} ${isDraggedHistoryTile ? "drag-source" : ""}`}
                    onPointerDown={(e) =>
                      startRackPointerDrag(
                        e,
                        top ? "discard" : "inspect",
                        -1,
                        tile,
                      )
                    }
                    onPointerMove={moveRackPointerDrag}
                    onPointerUp={finishRackPointerDrag}
                    onPointerCancel={() => setRackPointerDrag(null)}
                  >
                    <TileView tile={tile} compact />
                  </div>
                );
              })}
            </div>
            {incomingDiscards.length === 0 && <span>+</span>}
          </div>
          <div
            key={`rack-deal-${dealAnimationKey}`}
            ref={rackGridRef}
            className={`rack-grid ${dealAnimating ? "deal-animating" : ""}`}
          >
            {rack.slice(0, 32).map((tile, i) => (
              <div
                className={`rack-cell ${selectedRackIndex === i ? "selected" : ""}`}
                key={i}
                style={{ "--rack-index": i } as React.CSSProperties}
              >
                {tile && (
                  <div
                    className={`rack-pointer-tile ${rackPointerDrag?.source === "rack" && rackPointerDrag.index === i ? "drag-source" : ""}`}
                    onPointerDown={(e) =>
                      startRackPointerDrag(e, "rack", i, tile)
                    }
                    onPointerMove={moveRackPointerDrag}
                    onPointerUp={finishRackPointerDrag}
                    onPointerCancel={() => setRackPointerDrag(null)}
                  >
                    <TileView tile={tile} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div
            ref={rackThrowRef}
            className="rack-discard rack-discard-right"
            onClick={discardSelected}
          >
            <small>Taş at</small>
            <div className="my-discard-stack">
              {myDiscards.slice(-3).map((tile) => (
                <div
                  key={tile.id}
                  className={`incoming-pointer-tile ${rackPointerDrag?.source === "inspect" && rackPointerDrag.tile.id === tile.id ? "drag-source" : ""}`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) =>
                    startRackPointerDrag(e, "inspect", -1, tile)
                  }
                  onPointerMove={moveRackPointerDrag}
                  onPointerUp={finishRackPointerDrag}
                  onPointerCancel={() => setRackPointerDrag(null)}
                >
                  <TileView tile={tile} compact />
                </div>
              ))}
            </div>
            {myDiscards.length === 0 && <span>+</span>}
          </div>
        </div>
        {rackPointerDrag &&
          createPortal(
            <div
              className="rack-drag-ghost"
              style={{
                left: rackPointerDrag.x + rackPointerDrag.centerOffsetX,
                top: rackPointerDrag.y + rackPointerDrag.centerOffsetY,
              }}
            >
              <TileView tile={rackPointerDrag.tile} />
            </div>,
            document.body,
          )}
        <p className={`rack-status ${penaltyAlert ? "penalty" : ""}`}>
          <span className={isMyTurn ? "pulse" : ""} />
          {penaltyAlert || notice}
        </p>
      </section>
    </main>
  );
}

function GridView({
  cells,
  indicator,
  zone,
  onDrop,
  active,
  interactionKey: _interactionKey,
  gridRef,
  onPointerStart,
  onPointerMove,
  onPointerEnd,
  dragState,
}: {
  cells: (TableTile | null)[];
  indicator: Tile;
  zone: Zone;
  onDrop: (e: React.DragEvent, z: Zone, i: number) => void;
  active: boolean;
  interactionKey: string;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onPointerStart: (
    e: React.PointerEvent<HTMLDivElement>,
    index: number,
    tile: TableTile,
  ) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
  dragState: {
    source: "rack" | "discard" | "deck" | "table" | "inspect";
    index: number;
    zone?: Zone;
  } | null;
}) {
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".table-pointer-tile")
    )
      return;
    const element = gridRef.current;
    if (!element) return;
    element.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    setIsPanning(true);
    event.preventDefault();
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const element = gridRef.current;
    if (!pan || !element || pan.pointerId !== event.pointerId) return;
    element.scrollLeft = pan.left - (event.clientX - pan.x);
    element.scrollTop = pan.top - (event.clientY - pan.y);
    event.preventDefault();
  };
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    const element = gridRef.current;
    if (element?.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setIsPanning(false);
  };
  return (
    <div
      ref={gridRef}
      className={`grid ${zone} ${active ? "active-zone" : ""} ${isPanning ? "is-panning" : ""}`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {cells.map((tile, i) => (
        <div
          className="grid-cell"
          key={i}
          data-table-cell={i}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, zone, i)}
        >
          {tile &&
            (tile.committed ? (
              <div className="table-committed-tile">
                <TileView
                  tile={{ ...tile, isOkey: isOkeyTile(tile, indicator) }}
                  compact
                />
              </div>
            ) : (
              <div
                className={`table-pointer-tile ${dragState?.source === "table" && dragState.zone === zone && dragState.index === i ? "drag-source" : ""}`}
                onPointerDown={(e) => onPointerStart(e, i, tile)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
              >
                <TileView
                  tile={{ ...tile, isOkey: isOkeyTile(tile, indicator) }}
                  compact
                />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
const Grid = memo(
  GridView,
  (previous, next) =>
    previous.cells === next.cells &&
    previous.indicator.color === next.indicator.color &&
    previous.indicator.value === next.indicator.value &&
    previous.zone === next.zone &&
    previous.active === next.active &&
    previous.interactionKey === next.interactionKey &&
    previous.dragState?.source === next.dragState?.source &&
    previous.dragState?.index === next.dragState?.index &&
    previous.dragState?.zone === next.dragState?.zone,
);

function TurnTimer({
  limit,
  deadline,
  phase,
  running,
  resetKey,
}: {
  limit: number;
  deadline?: number | null;
  phase: "draw" | "discard";
  running: boolean;
  resetKey: string;
}) {
  const remainingSeconds = () =>
    deadline
      ? Math.max(0, Math.ceil((Number(deadline) - Date.now()) / 1000))
      : limit;
  const [seconds, setSeconds] = useState(remainingSeconds);
  useEffect(() => {
    setSeconds(remainingSeconds());
    if (!running) return;
    const timer = window.setInterval(
      () =>
        setSeconds((current) =>
          deadline ? remainingSeconds() : Math.max(0, current - 1),
        ),
      deadline ? 500 : 1000,
    );
    return () => window.clearInterval(timer);
  }, [deadline, limit, resetKey, running]);
  const color = `hsl(${Math.round((seconds / limit) * 120)} 72% 42%)`;
  return (
    <div className="turn-timer">
      <div className="turn-timer-track">
        <span
          style={{
            width: `${(seconds / limit) * 100}%`,
            background: color,
          }}
        />
      </div>
      <small>
        {phase === "draw" ? "Taş çek" : "Taş at"} · {seconds}s
      </small>
    </div>
  );
}

function Opponent({
  p,
  active,
  className,
}: {
  p: { name: string; count: number };
  active: boolean;
  className: string;
}) {
  if (!p?.name) return null;
  return (
    <div className={`${className} ${active ? "active" : ""}`}>
      <span />
      <b>{p.name}</b>
      <small>{p.count} TAŞ</small>
    </div>
  );
}

function StartMenu({
  onStart,
  onSettings,
  onInstall,
  showInstall,
  installHint,
}: {
  onStart: () => void;
  onSettings: () => void;
  onInstall: () => void;
  showInstall: boolean;
  installHint: string;
  notice: string;
}) {
  return (
    <main className="start-screen">
      <div className="start-menu-content">
        <div className="start-mark">
          <div className="start-number" aria-hidden="true">
            101
          </div>
          <span className="start-plus" aria-hidden="true">
            +
          </span>
        </div>
        <nav className="menu-actions" aria-label="Ana menü">
          <button className="primary-action" onClick={onStart}>
            Başla
          </button>
          <button className="ghost-action" onClick={onSettings}>
            Ayarlar
          </button>
          {showInstall && (
            <button className="pwa-install-action" onClick={onInstall}>
              Uygulamayı yükle
            </button>
          )}
        </nav>
        {installHint && <p className="pwa-install-hint">{installHint}</p>}
      </div>
    </main>
  );
}

function SettingsView({
  name,
  emoji,
  soundOn,
  onNameChange,
  onEmojiChange,
  onSoundChange,
  onBack,
}: {
  name: string;
  emoji: string;
  soundOn: boolean;
  onNameChange: (value: string) => void;
  onEmojiChange: (value: string) => void;
  onSoundChange: (value: boolean) => void;
  onBack: () => void;
}) {
  const emojis = [
    "🧒",
    "👧",
    "🧑",
    "👩",
    "👨",
    "🧕",
    "👵",
    "🧓",
    "😎",
    "🤠",
    "🤖",
    "🦊",
    "🐼",
    "🐱",
    "🌻",
    "🎮",
    "🎨",
    "👾",
  ];
  return (
    <main className="settings-screen">
      <section className="settings-content">
        <div className="settings-avatar">{emoji}</div>
        <label className="settings-name">
          <span>İsmi düzenle</span>
          <input
            value={name}
            maxLength={20}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <div className="emoji-picker" aria-label="Profil resmi seç">
          <span>Emoji seç</span>
          <div>
            {emojis.map((item) => (
              <button
                key={item}
                className={item === emoji ? "selected" : ""}
                onClick={() => onEmojiChange(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <label className="sound-toggle">
          <span>Sesleri aç</span>
          <button
            aria-pressed={soundOn}
            onClick={() => onSoundChange(!soundOn)}
          >
            {soundOn ? "Açık" : "Kapalı"}
          </button>
        </label>
      </section>
      <button
        className="back-link room-back settings-back"
        onClick={onBack}
        aria-label="Geri"
      >
        <span className="back-arrow">‹</span> Geri
      </button>
    </main>
  );
}

function Lobby({
  rooms,
  joinedRoomId,
  roomName,
  setRoomName,
  roomSize,
  setRoomSize,
  roomRule,
  setRoomRule,
  roomHands,
  setRoomHands,
  onCreate,
  onDelete,
  onJoin,
  onBack,
}: {
  rooms: {
    id: number | string;
    name: string;
    owner: string;
    players: number;
    max: number;
    status: string;
    rule?: RoomRule;
    hands?: MatchHands;
    started?: boolean;
  }[];
  joinedRoomId: number | string | null;
  roomName: string;
  setRoomName: (v: string) => void;
  roomSize: 2 | 3 | 4;
  setRoomSize: (v: 2 | 3 | 4) => void;
  roomRule: RoomRule;
  setRoomRule: (v: RoomRule) => void;
  roomHands: MatchHands;
  setRoomHands: (v: MatchHands) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
  onJoin: (id: number | string) => void;
  onBack: () => void;
}) {
  return (
    <main className="lobby-screen">
      <button
        className="back-link lobby-back"
        onClick={onBack}
        aria-label="Geri"
      >
        <span className="back-arrow">‹</span> Geri
      </button>
      <section className="lobby-content">
        <div className="create-panel">
          <h1>Oyun oluştur</h1>
          <span className="create-field-label">Oda adı</span>
          <input
            aria-label="Oda adı"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
          />
          <span className="create-field-label">Oyuncu sayısı</span>
          <div className="tile-picker" aria-label="Oyuncu sayısı">
            {[2, 3, 4].map((value) => (
              <button
                key={value}
                className={`player-tile tile-choice-${value} ${roomSize === value ? "selected" : ""}`}
                onClick={() => setRoomSize(value as 2 | 3 | 4)}
              >
                <span className="tile-pips">
                  {Array.from({ length: value }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <b>{value}</b>
              </button>
            ))}
          </div>
          <span className="create-field-label">Oyun türü</span>
          <div className="room-rule-picker" aria-label="Oyun kuralı">
            <button
              className={roomRule === "sabit" ? "selected" : ""}
              onClick={() => setRoomRule("sabit")}
            >
              Sabit 101
            </button>
            <button
              className={roomRule === "katlamali" ? "selected" : ""}
              onClick={() => setRoomRule("katlamali")}
            >
              Katlamalı
            </button>
          </div>
          <span className="create-field-label">El sayısı</span>
          <div className="room-hands-picker" aria-label="El sayısı">
            {[5, 10, 20].map((value) => (
              <button
                key={value}
                className={roomHands === value ? "selected" : ""}
                onClick={() => setRoomHands(value as MatchHands)}
              >
                {value} el
              </button>
            ))}
          </div>
          <button className="create-button" onClick={onCreate}>
            Oluştur
          </button>
        </div>
        <div className="lobby-divider" />
        <div className="rooms-panel">
          <h1>Odalar</h1>
          <div className="room-list">
            {rooms.length === 0 ? (
              <p className="rooms-footnote">Henüz oda yok.</p>
            ) : (
              rooms.map((room) => {
                const joined = room.id === joinedRoomId;
                return (
                  <div
                    className="room-row room-row-open"
                    key={room.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${room.name} odasını aç`}
                    onClick={() => onJoin(room.id as number)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onJoin(room.id as number);
                      }
                    }}
                  >
                    <div className="room-join room-summary">
                      <span className="room-main">
                        <span className="room-title-line">
                          <b>{room.name}</b>
                          <small className="room-hands">
                            {room.started
                              ? `${Math.min(room.currentHand || 1, room.hands || 5)}/${room.hands || 5} el`
                              : `${room.hands || 5} el`}
                          </small>
                          <small className="room-rule">
                            {room.rule === "katlamali"
                              ? "Katlamalı"
                              : "Sabit"}
                          </small>
                          {joined && (
                            <small className="joined-label">Katılındı</small>
                          )}
                        </span>
                      </span>
                    </div>
                    <span className="room-count">
                      {room.players}/{room.max}
                    </span>
                    {room.owner === "Siz" && (
                      <button
                        className="room-delete"
                        aria-label={`${room.name} odasını sil`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(room.id as number);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v5M14 11v5" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function RoomView({
  room,
  currentSocketId,
  onAddComputer,
  onRemoveComputer,
  onJoinSeat,
  onLeaveSeat,
  onWatch,
  onStart,
  onBack,
}: {
  room: any;
  currentSocketId: string;
  onAddComputer: (seat: number) => void;
  onRemoveComputer: (seat: number) => void;
  onJoinSeat: (seat: number) => void;
  onLeaveSeat: () => void;
  onWatch: () => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const max = room?.maksimum ?? room?.max ?? 4,
    players = room?.oyuncular ?? [],
    total = players.length,
    mine = players.find((p: any) => p.socketId === currentSocketId),
    isSpectator = !mine,
    gameInProgress = Boolean(room?.macAktif || room?.oyunBasladi),
    firstEmptySeat = Array.from({ length: max }, (_, i) => i).find(
      (seat) => !players.some((player: any) => player.koltukNo === seat),
    ),
    canAddRobot =
      Boolean(mine) &&
      players.some((p: any) => !p.bot) &&
      players.filter((p: any) => p.bot).length < max - 1,
    canStart =
      Boolean(mine) &&
      room?.kurucuSocketId === currentSocketId &&
      total === max;
  return (
    <main className="room-screen">
      <section className="room-content">
        <div className={`room-profile-grid count-${max}`}>
          {Array.from({ length: max }, (_, i) => {
            const player = players.find((p: any) => p.koltukNo === i);
            return (
              <div className="room-profile" key={i}>
                <div
                  className={`profile-box ${player?.bot ? "bot" : ""} ${player?.socketId === currentSocketId ? "player" : ""} ${!player ? "empty-profile" : ""}`}
                >
                  {player?.bot ? (
                    <>
                      <span className="avatar avatar-bot" aria-hidden="true">
                        🤖
                      </span>
                      <b>Robot</b>
                      <small>{Number(player.puan || 0)} puan</small>
                    </>
                  ) : player ? (
                    <>
                      <span className="avatar avatar-player" aria-hidden="true">
                        {player.avatar || "🙂"}
                      </span>
                      <b>{player.isim}</b>
                      <small>{Number(player.puan || 0)} puan</small>
                    </>
                  ) : (
                    <>
                      <span className="avatar avatar-empty" aria-hidden="true">
                        +
                      </span>
                      <span>Boş profil</span>
                      {Number(room?.koltukPuanlari?.[i] || 0) !== 0 && (
                        <small>{Number(room.koltukPuanlari[i])} puan</small>
                      )}
                    </>
                  )}
                </div>
                {player?.bot ? (
                  <button
                    className="robot-add"
                    onClick={() => onRemoveComputer(i)}
                    disabled={isSpectator}
                  >
                    Robot sil
                  </button>
                ) : player?.socketId === currentSocketId ? (
                  <button
                    className="robot-add room-leave-seat"
                    onClick={onLeaveSeat}
                  >
                    Ayrıl
                  </button>
                ) : (
                  !player && (
                    <>
                      <button
                        className="robot-add room-join-seat"
                        onClick={() => onJoinSeat(i)}
                        disabled={Boolean(mine)}
                      >
                        Katıl
                      </button>
                      <button
                        className="robot-add"
                        onClick={() => onAddComputer(i)}
                        disabled={!canAddRobot}
                      >
                        Robot ekle
                      </button>
                    </>
                  )
                )}
              </div>
            );
          })}
        </div>
        <div className="room-actions">
          <span>
            {total}/{max}
          </span>
          {gameInProgress && mine ? (
            <button className="start-game" onClick={onWatch}>
              Oyuna dön
            </button>
          ) : gameInProgress && firstEmptySeat !== undefined ? (
            <button
              className="start-game"
              onClick={() => onJoinSeat(firstEmptySeat)}
            >
              Oyuna katıl
            </button>
          ) : isSpectator && total >= max ? (
            <button className="start-game room-watch" onClick={onWatch}>
              İzle
            </button>
          ) : (
            <button className="start-game" onClick={onStart} disabled={!canStart}>
              Başlat
            </button>
          )}
        </div>
      </section>
      <button
        className="back-link room-back"
        onClick={onBack}
        aria-label="Geri"
      >
        <span className="back-arrow">‹</span> Geri
      </button>
    </main>
  );
}
