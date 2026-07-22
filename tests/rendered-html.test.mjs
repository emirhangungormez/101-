import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the 101 Okey start screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>101 Okey/);
  assert.match(html, />101</);
  assert.match(html, />Başla</);
  assert.match(html, />Ayarlar</);
  assert.doesNotMatch(html, /Codex is working|Your site is taking shape/);
});

test("keeps the multiplayer match controls in the application source", async () => {
  const [page, server, game] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/index.js", import.meta.url), "utf8"),
    readFile(new URL("../server/game.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\[5, 10, 20\]/);
  assert.match(page, /Eli Oyna/);
  assert.match(page, /Yeni Oyuna Başla/);
  assert.match(page, /const prepareGame[\s\S]*?applyGame\(room\)/);
  assert.match(page, /dealAnimationKey/);
  assert.match(page, /round-complete/);
  assert.match(page, /round-result/);
  assert.match(page, /focusedOpeningZonesRef/);
  assert.match(page, /serverTableHandRef/);
  assert.doesNotMatch(page, /openedPlayerModesRef/);
  assert.match(page, /game-theme-/);
  assert.match(page, /okey-game-theme/);
  assert.match(server, /socket\.on\("sonraki-el"/);
  assert.match(game, /eliTamamla/);
  assert.match(game, /macKazananlari/);
});
