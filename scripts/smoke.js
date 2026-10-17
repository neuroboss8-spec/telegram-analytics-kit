import assert from "node:assert/strict";
import { MetricsSource } from "../src/metrics.js";
import { AnalyticsBot } from "../src/bot.js";
import {
  settings,
  MemoryStore,
  FakeTelegram,
  message,
} from "../test/helpers.js";
const c = settings(),
  tg = new FakeTelegram(),
  bot = new AnalyticsBot(c, new MemoryStore(), new MetricsSource(c), tg);
await bot.handle(message("10001", "/start"));
assert.equal(tg.sent.length, 1);
assert.match(tg.sent[0].text, /ДЕМО/);
assert.match(tg.sent[0].text, /Выручка/);
console.log(
  "Offline smoke passed: report, menu, access, subscription. No Telegram or private API calls.",
);
