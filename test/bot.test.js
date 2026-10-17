import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalyticsBot, domainStage } from "../src/bot.js";
import { demoMetrics } from "../src/metrics.js";
import { TelegramError } from "../src/telegram.js";
import {
  settings,
  MemoryStore,
  FakeTelegram,
  message,
  callback,
} from "./helpers.js";
function fixture() {
  const c = settings(),
    store = new MemoryStore(),
    tg = new FakeTelegram();
  const source = { get: async (request) => demoMetrics(request) };
  const create = () => new AnalyticsBot(c, store, source, tg);
  return { c, store, tg, source, create, bot: create() };
}
test("unknown /start creates one owner approval request and grants no statistics automatically", async () => {
  const h = fixture();
  await h.bot.handle(message("10002", "/start"));
  await h.bot.handle(message("10002", "/start"));
  assert.equal(await h.bot.allowed("10002"), false);
  assert.equal(h.tg.sent.filter((m) => m.id === "10001").length, 1);
  assert.ok(
    h.tg.sent.every(
      (m) => m.id !== "10002" || !m.text.includes("Регистрации всего"),
    ),
  );
  const state = await h.bot.access.state(h.c.namespace);
  assert.equal(state.requests.length, 1);
  await h.bot.handle(
    callback("10002", `access:approve:10002:${state.requests[0].nonce}`),
  );
  assert.equal(await h.bot.allowed("10002"), false);
  await h.bot.handle(
    callback("10001", `access:approve:10002:${state.requests[0].nonce}`),
  );
  assert.equal(await h.bot.allowed("10002"), true);
  await h.bot.handle(message("10002", "/today"));
  assert.match(h.tg.sent.at(-1).text, /Регистрации всего/);
});
test("stale approval cannot regrant revoked access; revoked viewer cannot refresh or get daily reports", async () => {
  const h = fixture();
  await h.bot.handle(message("10002", "/start"));
  const p = (await h.bot.access.state(h.c.namespace)).requests[0];
  await h.bot.handle(callback("10001", `access:approve:10002:${p.nonce}`));
  await h.bot.handle(message("10002", "/start"));
  await h.bot.handle(callback("10001", `access:revoke:10002:${p.nonce}`));
  await h.bot.handle(callback("10001", `access:approve:10002:${p.nonce}`));
  const count = h.tg.sent.length;
  await h.bot.handle(callback("10002", "stats:today:all:summary"));
  assert.equal(h.tg.sent.length, count);
  assert.equal(await h.bot.allowed("10002"), false);
});
test("private chat binding blocks forged callbacks and group messages", async () => {
  const h = fixture(),
    u = message("10001", "/today");
  u.message.chat.type = "group";
  await h.bot.handle(u);
  const forged = callback("10001", "stats:today:all:summary");
  forged.callback_query.message.chat.id = 10002;
  await h.bot.handle(forged);
  assert.equal(h.tg.sent.length, 0);
});
test("daily reports persist, catch up once, and recheck access immediately before sending", async () => {
  const h = fixture(),
    id = "10001",
    date = new Date("2026-02-02T12:00:00Z");
  await h.store.set(
    h.bot.key(`prefs:${id}`),
    JSON.stringify({ subscribed: true, hour: 9 }),
    1000,
  );
  await h.bot.daily(date);
  await h.create().daily(date);
  assert.equal(h.tg.sent.length, 1);
  assert.match(h.tg.sent[0].text, /01\.02\.2026/);
  await h.bot.handle(message(id, "/stop"));
  await h.bot.daily(new Date("2026-02-03T12:00:00Z"));
  assert.equal(h.tg.sent.length, 2);
});
test("manual refresh changes one card; filter and section menu preserve the choice", async () => {
  const h = fixture();
  await h.bot.handle(callback("10001", "stats:week:web:billing"));
  assert.equal(h.tg.sent[0].messageId, 10);
  assert.match(h.tg.sent[0].text, /Оплаты/);
  await h.bot.handle(callback("10001", "filters:week:web:billing"));
  assert.equal(
    h.tg.sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data,
    "stats:today:web:billing",
  );
});
test("finance is owners-only, independent of daily preferences; five days triggers and renewal stops", async () => {
  const h = fixture();
  h.c.financeEnabled = true;
  let days = 5,
    paidTill = "2026-02-05T12:00:00Z";
  h.source.get = async (request) => ({
    ...demoMetrics(request),
    demo: false,
    providers: [
      {
        id: "hosting",
        name: "Hosting",
        balance: { amount: 740, currency: "RUB" },
        estimatedDays: days,
      },
    ],
    domains: [{ name: "example.com", paidTill }],
  });
  const now = new Date("2026-02-02T12:00:00Z");
  await h.bot.finance(now);
  await h.create().finance(now);
  assert.equal(h.tg.sent.length, 2);
  assert.ok(h.tg.sent.every((m) => m.id === "10001"));
  days = 6;
  paidTill = "2027-02-05T12:00:00Z";
  await h.bot.finance(now);
  assert.equal(h.tg.sent.length, 2);
});
test("uncertain delivery keeps claim; definite retry-after is fenced and can retry", async () => {
  const h = fixture();
  let calls = 0;
  await h.bot.claimed("unknown", 86400, async () => {
    calls++;
    throw Error("transport");
  });
  await h.bot.claimed("unknown", 86400, async () => {
    calls++;
  });
  assert.equal(calls, 1);
  await h.bot.claimed("limited", 86400, async () => {
    throw new TelegramError(429, 30);
  });
  assert.equal(await h.store.get("limited"), "rejected");
});
test("domain stages handle timezones, catch-up and unknown dates", () => {
  const now = new Date("2026-02-02T22:00:00Z");
  assert.deepEqual(domainStage("2026-02-05T12:00:00Z", "Europe/Moscow", now), {
    days: 2,
    stage: 3,
  });
  assert.equal(domainStage(null, "UTC", now), null);
  assert.equal(domainStage("2027-02-05T12:00:00Z", "UTC", now), null);
});
test("revocation during a slow metrics fetch prevents disclosure", async () => {
  const h = fixture();
  await h.bot.handle(message("10002", "/start"));
  const p = (await h.bot.access.state(h.c.namespace)).requests[0];
  await h.bot.access.decide(
    h.c.namespace,
    h.c.owners,
    "10001",
    "10002",
    p.nonce,
    true,
  );
  h.source.get = async (request) => {
    await h.bot.access.revoke(
      h.c.namespace,
      h.c.owners,
      "10001",
      "10002",
      p.nonce,
    );
    return demoMetrics(request);
  };
  const count = h.tg.sent.length;
  await h.bot.stats("10002");
  assert.equal(h.tg.sent.length, count);
});
test("source failure produces an unavailable card, not fabricated zero statistics", async () => {
  const h = fixture();
  h.source.get = async () => {
    throw Error("offline");
  };
  await h.bot.handle(message("10001", "/today"));
  assert.match(h.tg.sent[0].text, /недоступны/);
  assert.doesNotMatch(h.tg.sent[0].text, /Выручка: 0/);
});
test("a delivery-day claim survives restart and suppresses concurrent send attempts", async () => {
  const h = fixture();
  let sent = 0;
  await Promise.all(
    Array.from({ length: 10 }, () =>
      h.create().claimed("delivery-day", 86400, async () => {
        sent++;
      }),
    ),
  );
  assert.equal(sent, 1);
});
test("corrupt access state fails closed without sending report data", async () => {
  const h = fixture();
  await h.store.set(
    h.bot.key("access"),
    JSON.stringify({ version: 1, grants: [{ id: "10002" }], requests: [] }),
    1000,
  );
  await assert.rejects(() => h.bot.allowed("10002"));
  assert.equal(h.tg.sent.length, 0);
});
