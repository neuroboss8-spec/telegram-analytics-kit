import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { Store } from "./store.js";
import { Telegram, TelegramError } from "./telegram.js";
import { MetricsSource } from "./metrics.js";
import { AnalyticsBot } from "./bot.js";

async function main() {
  const c = config(),
    store = new Store(c.redisUrl),
    telegram = new Telegram(c);
  await store.connect();
  const abort = new AbortController();
  let lastPoll = 0,
    stopped = false;
  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(lastPoll && Date.now() - lastPoll < 90000 ? 200 : 503, {
        "Content-Type": "application/json",
      })
      .end(
        JSON.stringify({
          status: lastPoll && Date.now() - lastPoll < 90000 ? "ok" : "starting",
        }),
      );
  }).listen(c.healthPort, "0.0.0.0");
  const stop = () => {
    stopped = true;
    abort.abort();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const key = `${c.namespace}:poll`,
    lease = randomUUID();
  let owns = false;
  const bot = new AnalyticsBot(c, store, new MetricsSource(c), telegram);
  const pause = (ms) =>
    new Promise((resolve) => {
      if (stopped) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", done);
        resolve();
      }
      abort.signal.addEventListener("abort", done, { once: true });
    });
  try {
    await telegram.call("getMe");
    const webhook = await telegram.call("getWebhookInfo");
    if (webhook.url) throw Error("Dedicated bot required: webhook is active");
    console.log("analytics-kit.ready");
    while (!stopped) {
      try {
        if (!owns) owns = await store.acquireLock(key, lease, 90);
        else owns = await store.renewLock(key, lease, 90);
        if (!owns) {
          await pause(5000);
          continue;
        }
        const offset = Number((await store.get(`${c.namespace}:offset`)) || 0);
        const updates = await telegram.call(
          "getUpdates",
          {
            offset,
            timeout: 20,
            limit: 20,
            allowed_updates: ["message", "callback_query"],
          },
          abort.signal,
        );
        lastPoll = Date.now();
        if (!(await store.renewLock(key, lease, 90)))
          throw Error("Polling lease lost");
        for (const update of updates) {
          if (stopped) break;
          // Telegram may repeat an update after a crash; durable checkpoint is written only after handling.
          try {
            await bot.handle(update);
          } catch {
            console.warn("update.failed");
          }
          if (
            !(await store.setIfLockOwned(
              key,
              lease,
              `${c.namespace}:offset`,
              String(update.update_id + 1),
              10 * 365 * 86400,
            ))
          )
            throw Error("Polling lease lost");
        }
        // Separate failures: an unavailable metrics endpoint must not stop access requests or polling.
        if (await store.renewLock(key, lease, 90)) {
          try {
            await bot.daily();
          } catch {
            console.warn("daily.source_unavailable");
          }
          const scanKey = `${c.namespace}:finance-scan`;
          if (await store.acquireLock(scanKey, randomUUID(), 300))
            try {
              await bot.finance();
            } catch {
              console.warn("finance.source_unavailable");
            }
        } else owns = false;
      } catch (error) {
        if (!stopped) console.warn("poll.retry");
        await pause(
          error instanceof TelegramError && error.code === 429
            ? error.retryAfter * 1000
            : 3000,
        );
      }
    }
  } finally {
    server.close();
    await store.releaseLock(key, lease).catch(() => {});
    await store.close();
  }
}
main().catch(() => {
  console.error(
    "Startup failed. Check configuration, Redis, bot permissions and webhook. Credentials are never logged.",
  );
  process.exitCode = 1;
});
