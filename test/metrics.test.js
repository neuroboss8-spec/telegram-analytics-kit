import { test } from "node:test";
import assert from "node:assert/strict";
import { config, range, clock } from "../src/config.js";
import {
  demoMetrics,
  validateMetrics,
  MetricsSource,
  boundedJson,
} from "../src/metrics.js";
import { report, selection } from "../src/report.js";
import { settings } from "./helpers.js";
const request = { start: "2026-01-01", end: "2026-01-01", platform: "all" };
test("configuration fails closed on missing owners, unsafe dashboard and remote HTTP", () => {
  assert.throws(() => config({ BOT_TOKEN: "1000:synthetic" }));
  for (const url of [
    "http://example.com",
    "https://example.com?token=synthetic",
    "https://user:pass@example.com",
  ])
    assert.throws(() =>
      config({
        BOT_TOKEN: "1000:synthetic",
        OWNER_IDS: "10001",
        DASHBOARD_URL: url,
      }),
    );
  assert.throws(() =>
    config({
      BOT_TOKEN: "1000:synthetic",
      OWNER_IDS: "10001",
      METRICS_MODE: "http",
      METRICS_URL: "http://example.com",
    }),
  );
});
test("UTC ranges and configurable local delivery clock remain separate", () => {
  assert.deepEqual(range("yesterday", new Date("2026-01-01T00:30:00Z")), {
    start: "2025-12-31",
    end: "2025-12-31",
  });
  assert.deepEqual(range("week", new Date("2026-01-01T00:30:00Z")), {
    start: "2025-12-26",
    end: "2026-01-01",
  });
  assert.deepEqual(clock("Europe/Moscow", new Date("2026-01-01T22:30:00Z")), {
    date: "2026-01-02",
    hour: 1,
  });
});
test("schema rejects stale, missing, nonfinite or mismatched data rather than showing zero", () => {
  for (const mutate of [
    (d) => {
      d.updatedAt = "2020-01-01T00:00:00Z";
    },
    (d) => {
      d.totals.revenue = NaN;
    },
    (d) => {
      d.totals.jobsFailed = null;
    },
    (d) => {
      d.platform = "web";
    },
    (d) => {
      d.period.timezone = "local";
    },
    (d) => {
      d.providers[0].estimatedDays = -1;
    },
  ]) {
    const d = demoMetrics(request);
    mutate(d);
    assert.throws(() => validateMetrics(d, request));
  }
});
test("unknown provider balance stays unavailable, zero/debt stay real, extra fields are discarded", () => {
  const d = demoMetrics(request);
  d.providers[0].balance = null;
  d.providers[1].balance.amount = -10;
  d.secret = "must-not-flow";
  const safe = validateMetrics(d, request);
  assert.equal(safe.providers[0].balance, null);
  assert.equal(safe.providers[1].balance.amount, -10);
  assert.equal(safe.secret, undefined);
  const screen = report(
    safe,
    { period: "today", platform: "all", view: "summary" },
    settings(),
  );
  assert.match(screen.text, /Вычисления: недоступно/);
  assert.match(screen.text, /-10,00 ₽/);
  assert.doesNotMatch(screen.text, /must-not-flow/);
});
test("HTTP adapter uses only the configured endpoint, bounded response, bearer header and no redirects", async () => {
  const c = {
    ...settings(),
    mode: "http",
    metricsUrl: "https://metrics.example.com/report",
    metricsToken: "synthetic-read-only",
  };
  const source = new MetricsSource(c, async (url, options) => {
    assert.equal(url.origin, "https://metrics.example.com");
    assert.equal(url.searchParams.get("platform"), "all");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer synthetic-read-only");
    return Response.json(demoMetrics(request));
  });
  assert.equal((await source.get(request)).registrationsAll, 100);
  await assert.rejects(() => boundedJson(new Response("x".repeat(40)), 20));
});
test("all views and platforms use the same all-registration denominator and readable currency", () => {
  const c = settings();
  for (const platform of ["all", "web", "app"])
    for (const view of ["summary", "funnel", "billing", "jobs"]) {
      const d = demoMetrics({ ...request, platform });
      const s = report(d, { period: "today", platform, view }, c);
      assert.ok(s.text.length < 4000);
      assert.match(s.text, /ДЕМО/);
      if (view === "summary") {
        assert.match(s.text, /18,02 USD/);
        assert.match(s.text, /85 ₽\/USD/);
        assert.match(s.text, /Выручка:/);
      }
      if (view === "billing" && platform === "web")
        assert.match(s.text, /7% от рег\. Все/);
    }
  assert.equal(selection("stats:today:unknown:summary", c), null);
  assert.equal(selection("stats:today:all:summary:extra", c), null);
});
