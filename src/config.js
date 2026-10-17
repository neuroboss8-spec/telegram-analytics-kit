import { createHash } from "node:crypto";
import { isIPv4 } from "node:net";

export const clean = (value, max = 60) =>
  String(value)
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .trim()
    .slice(0, max);
export function config(env = process.env) {
  const token = env.BOT_TOKEN?.trim();
  const owners = [
    ...new Set(
      (env.OWNER_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!token || !/^\d+:[\w-]+$/.test(token))
    throw Error("Set BOT_TOKEN in your local .env");
  if (
    !owners.length ||
    owners.length > 5 ||
    owners.some(
      (id) => !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)),
    )
  )
    throw Error("Set valid OWNER_IDS in your local .env");
  const dashboard = new URL(
    env.DASHBOARD_URL || "https://dashboard.example.com",
  );
  if (
    dashboard.protocol !== "https:" ||
    dashboard.username ||
    dashboard.password ||
    dashboard.search ||
    dashboard.hash
  )
    throw Error(
      "DASHBOARD_URL must be HTTPS without credentials/query/fragment",
    );
  const timezone = env.TIMEZONE || "Europe/Moscow";
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const mode = env.METRICS_MODE || "demo";
  if (!["demo", "http"].includes(mode))
    throw Error("METRICS_MODE must be demo or http");
  let metricsUrl;
  if (mode === "http") {
    metricsUrl = new URL(env.METRICS_URL || "");
    const local = ["localhost", "127.0.0.1", "[::1]", "demo-source"].includes(
      metricsUrl.hostname,
    );
    if (
      (metricsUrl.protocol !== "https:" &&
        !(local && metricsUrl.protocol === "http:")) ||
      metricsUrl.username ||
      metricsUrl.password ||
      metricsUrl.hash ||
      metricsUrl.search
    )
      throw Error(
        "METRICS_URL must be HTTPS (local HTTP is allowed), without credentials/query/fragment",
      );
  }
  const platforms = (env.PLATFORMS || "all:Все,web:Web,app:Приложение")
    .split(",")
    .map((pair) => {
      const split = pair.indexOf(":");
      return {
        id: pair.slice(0, split),
        label: clean(pair.slice(split + 1), 25),
      };
    });
  if (
    !platforms.length ||
    platforms.length > 6 ||
    platforms[0].id !== "all" ||
    platforms.some((p) => !/^[a-z][a-z0-9_]{0,15}$/.test(p.id) || !p.label) ||
    new Set(platforms.map((p) => p.id)).size !== platforms.length
  )
    throw Error("Invalid PLATFORMS");
  const integer = (value, fallback, min, max) => {
    const n = value === undefined || value === "" ? fallback : Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
      throw Error("Invalid numeric configuration");
    return n;
  };
  const ipv4 = env.TELEGRAM_CONNECT_IPV4?.trim() || undefined;
  if (ipv4 && !isIPv4(ipv4)) throw Error("Invalid TELEGRAM_CONNECT_IPV4");
  return {
    token,
    owners,
    dashboard: dashboard.href,
    timezone,
    mode,
    metricsUrl: metricsUrl?.href,
    metricsToken: env.METRICS_BEARER_TOKEN?.trim(),
    title: clean(env.REPORT_TITLE || "Аналитика"),
    platforms,
    ipv4,
    namespace: `analytics-kit:${createHash("sha256").update(token.split(":")[0]).digest("hex").slice(0, 16)}`,
    redisUrl: env.REDIS_URL || "redis://localhost:6379",
    maxAge: integer(env.METRICS_MAX_AGE_SECONDS, 900, 60, 86400),
    exchangeRate: integer(env.USD_RUB_RATE, 85, 1, 10000),
    financeEnabled:
      mode !== "demo" && env.FINANCE_REMINDERS_ENABLED !== "false",
    lowBalanceDays: integer(env.LOW_BALANCE_DAYS, 5, 1, 365),
    healthPort: integer(env.HEALTH_PORT, 3000, 1024, 65535),
  };
}

export function clock(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (key) => parts.find((p) => p.type === key).value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}
export function range(period, now = new Date()) {
  if (!["today", "yesterday", "week"].includes(period))
    throw Error("Unknown period");
  const end = new Date(now);
  if (period === "yesterday") end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
