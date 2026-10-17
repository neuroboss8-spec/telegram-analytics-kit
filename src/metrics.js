import { clean } from "./config.js";

export async function boundedJson(response, limit = 1_048_576) {
  if (Number(response.headers.get("content-length")) > limit)
    throw Error("Response too large");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty response");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) throw Error("Response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const moneyCurrency = (value) =>
  typeof value === "string" &&
  (/^[A-Z]{3}$/.test(value) || value === "credits");
export function validateMetrics(
  data,
  requested,
  maxAge = 900,
  now = Date.now(),
) {
  const number = (n, count = false) =>
    typeof n === "number" &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= 1e12 &&
    (!count || Number.isSafeInteger(n));
  const label = (s) =>
    typeof s === "string" && s.length > 0 && s.length <= 60 && s === clean(s);
  const iso = (s) => {
    if (
      typeof s !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) ||
      !Number.isFinite(Date.parse(s))
    )
      return false;
    return (
      new Date(s).toISOString() ===
      s.replace(/(\d{2}:\d{2}:\d{2})Z$/, "$1.000Z")
    );
  };
  if (
    !data ||
    data.schemaVersion !== 1 ||
    data.period?.start !== requested.start ||
    data.period?.end !== requested.end ||
    data.period?.timezone !== "UTC" ||
    data.platform !== requested.platform ||
    !iso(data.updatedAt) ||
    now - Date.parse(data.updatedAt) > maxAge * 1000 ||
    Date.parse(data.updatedAt) - now > 60000
  )
    throw Error("Metrics missing, stale or do not match the requested range");
  const t = data.totals;
  if (
    !t ||
    !number(data.registrationsAll, true) ||
    ![
      "registrations",
      "invoices",
      "payers",
      "jobsCompleted",
      "jobsFailed",
    ].every((k) => number(t[k], true)) ||
    t.registrations > data.registrationsAll ||
    !number(t.revenue) ||
    !moneyCurrency(t.currency) ||
    t.currency === "credits"
  )
    throw Error("Invalid totals");
  if (
    !Array.isArray(data.registrationsByPlatform) ||
    data.registrationsByPlatform.length > 6 ||
    !data.registrationsByPlatform.every(
      (p) => label(p.label) && number(p.count, true),
    )
  )
    throw Error("Invalid platform counts");
  if (
    !Array.isArray(data.funnel) ||
    data.funnel.length > 12 ||
    !data.funnel.every((row) => label(row.label) && number(row.count, true))
  )
    throw Error("Invalid funnel");
  const provider = (p) => {
    const balance = p?.balance;
    return (
      p &&
      label(p.id) &&
      /^[a-z][a-z0-9_-]{0,30}$/.test(p.id) &&
      label(p.name) &&
      (balance === null ||
        (balance &&
          typeof balance.amount === "number" &&
          Number.isFinite(balance.amount) &&
          Math.abs(balance.amount) <= 1e12 &&
          moneyCurrency(balance.currency))) &&
      (p.estimatedDays === null ||
        p.estimatedDays === undefined ||
        number(p.estimatedDays))
    );
  };
  if (
    !Array.isArray(data.providers) ||
    data.providers.length > 8 ||
    !data.providers.every(provider)
  )
    throw Error("Invalid providers");
  if (new Set(data.providers.map((p) => p.id)).size !== data.providers.length)
    throw Error("Duplicate providers");
  if (
    !Array.isArray(data.domains) ||
    data.domains.length > 10 ||
    !data.domains.every(
      (d) =>
        typeof d.name === "string" &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
          d.name,
        ) &&
        (d.paidTill === null || iso(d.paidTill)),
    )
  )
    throw Error("Invalid domains");
  // Whitelist the public contract: extra adapter fields never flow into a Telegram message.
  return {
    schemaVersion: 1,
    period: { ...requested, timezone: "UTC" },
    platform: requested.platform,
    updatedAt: data.updatedAt,
    registrationsAll: data.registrationsAll,
    totals: Object.fromEntries(
      [
        "registrations",
        "invoices",
        "payers",
        "jobsCompleted",
        "jobsFailed",
        "revenue",
        "currency",
      ].map((k) => [k, t[k]]),
    ),
    registrationsByPlatform: data.registrationsByPlatform.map((p) => ({
      label: p.label,
      count: p.count,
    })),
    funnel: data.funnel.map((p) => ({ label: p.label, count: p.count })),
    providers: data.providers.map((p) => ({
      id: p.id,
      name: p.name,
      balance:
        p.balance === null
          ? null
          : { amount: p.balance.amount, currency: p.balance.currency },
      estimatedDays: p.estimatedDays ?? null,
    })),
    domains: data.domains.map((d) => ({ name: d.name, paidTill: d.paidTill })),
    demo: data.demo === true,
  };
}
export function demoMetrics(requested, now = new Date()) {
  const share =
    requested.platform === "all" ? 1 : requested.platform === "web" ? 0.6 : 0.4;
  const scale = (n) => Math.round(n * share);
  return {
    schemaVersion: 1,
    period: { start: requested.start, end: requested.end, timezone: "UTC" },
    platform: requested.platform,
    updatedAt: now.toISOString(),
    demo: true,
    registrationsAll: 100,
    registrationsByPlatform: [
      { label: "Web", count: 60 },
      { label: "Приложение", count: 40 },
    ],
    totals: {
      registrations: scale(100),
      invoices: scale(18),
      payers: scale(12),
      jobsCompleted: scale(72),
      jobsFailed: scale(2),
      revenue: scale(3600),
      currency: "RUB",
    },
    funnel: [
      { label: "Начали работу", count: scale(86) },
      { label: "Получили результат", count: scale(72) },
      { label: "Открыли результат", count: scale(58) },
    ],
    providers: [
      {
        id: "compute",
        name: "Вычисления",
        balance: { amount: 18.02, currency: "USD" },
        estimatedDays: 9,
      },
      {
        id: "hosting",
        name: "Хостинг",
        balance: { amount: 740, currency: "RUB" },
        estimatedDays: 4,
      },
      {
        id: "tasks",
        name: "Задания",
        balance: { amount: 1200, currency: "credits" },
        estimatedDays: null,
      },
    ],
    domains: [
      {
        name: "example.com",
        paidTill: new Date(now.getTime() + 10 * 86400000).toISOString(),
      },
    ],
  };
}
export class MetricsSource {
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }
  async get(requested) {
    if (this.config.mode === "demo")
      return validateMetrics(
        demoMetrics(requested),
        requested,
        this.config.maxAge,
      );
    const url = new URL(this.config.metricsUrl);
    for (const [k, v] of Object.entries(requested)) url.searchParams.set(k, v);
    const response = await this.fetcher(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(this.config.metricsToken
          ? { Authorization: `Bearer ${this.config.metricsToken}` }
          : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("Metrics endpoint unavailable");
    return validateMetrics(
      await boundedJson(response),
      requested,
      this.config.maxAge,
    );
  }
}
