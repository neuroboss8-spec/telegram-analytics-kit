export const periods = { today: "Сегодня", yesterday: "Вчера", week: "7 дней" };
export const views = {
  summary: "Сводка",
  funnel: "Воронка",
  billing: "Оплаты",
  jobs: "Задания",
};
const integer = (n) => new Intl.NumberFormat("ru-RU").format(n);
export const percent = (n, base) =>
  base > 0
    ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format((100 * n) / base)}%`
    : "—";
export const money = (n, currency) =>
  `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: currency === "credits" ? 0 : 2, maximumFractionDigits: 2 }).format(n)} ${currency === "credits" ? "кредитов" : currency === "USD" ? "USD" : currency === "RUB" ? "₽" : currency}`;
export function selection(value, config) {
  const [prefix, period, platform, view, extra] = value.split(":");
  return prefix === "stats" &&
    !extra &&
    Object.hasOwn(periods, period) &&
    Object.hasOwn(views, view) &&
    config.platforms.some((p) => p.id === platform)
    ? { period, platform, view }
    : null;
}
export function keyboard(s, c) {
  const callback = (text, next) => ({
    text,
    callback_data: `stats:${next.period}:${next.platform}:${next.view}`,
  });
  return {
    inline_keyboard: [
      [
        callback("Обновить", s),
        {
          text: `${periods[s.period]} · ${c.platforms.find((p) => p.id === s.platform).label}`,
          callback_data: `filters:${s.period}:${s.platform}:${s.view}`,
        },
      ],
      [
        {
          text: "Разделы",
          callback_data: `sections:${s.period}:${s.platform}:${s.view}`,
        },
        { text: "Уведомления", callback_data: "settings" },
      ],
      [{ text: "Открыть дашборд ↗", url: c.dashboard }],
    ],
  };
}
export function report(data, s, c) {
  const base = data.registrationsAll,
    t = data.totals;
  const ratio = (label, n) =>
    `${label}: ${integer(n)} (${percent(n, base)} от рег. Все)`;
  const date = (s) => s.split("-").reverse().join(".");
  let rows = [
    `${views[s.view]} · ${c.title}`,
    `${date(data.period.start)}${data.period.start === data.period.end ? "" : ` — ${date(data.period.end)}`} · UTC · ${c.platforms.find((p) => p.id === s.platform).label}`,
    `Обновлено: ${new Intl.DateTimeFormat("ru-RU", { timeZone: c.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt))} · ${c.timezone}`,
  ];
  if (data.demo) rows.push("ДЕМО · все значения вымышлены");
  rows.push("");
  if (s.view === "summary" || s.view === "funnel") {
    rows.push(
      `Регистрации всего: ${integer(base)}`,
      ...data.registrationsByPlatform.map(
        (p) => `${p.label}: ${integer(p.count)} (${percent(p.count, base)})`,
      ),
      "",
      ...data.funnel.map((p) => ratio(p.label, p.count)),
    );
  }
  if (s.view === "summary" || s.view === "jobs")
    rows.push(
      "",
      `Готовые задания: ${integer(t.jobsCompleted)}`,
      `Ошибки: ${integer(t.jobsFailed)}`,
    );
  if (s.view === "summary" || s.view === "billing")
    rows.push(
      "",
      ratio("Создали счёт", t.invoices),
      ratio("Покупатели", t.payers),
    );
  if (s.view === "summary" && data.providers.length) {
    rows.push("", "Остатки сейчас · все платформы");
    for (const p of data.providers) {
      let line = `${p.name}: ${p.balance === null ? "недоступно" : money(p.balance.amount, p.balance.currency)}`;
      if (p.balance?.currency === "USD")
        line += ` ≈ ${money(p.balance.amount * c.exchangeRate, "RUB")}`;
      if (typeof p.estimatedDays === "number")
        line += ` · ≈ ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(p.estimatedDays)} дн.`;
      rows.push(line);
    }
    if (data.providers.some((p) => p.balance?.currency === "USD"))
      rows.push(`Рубли приблизительно по ${c.exchangeRate} ₽/USD.`);
  }
  if (s.view !== "funnel" && s.view !== "jobs")
    rows.push("", `Выручка: ${money(t.revenue, t.currency)}`);
  const text = rows.join("\n");
  if (text.length > 4000) throw Error("Report too long");
  return { text, reply_markup: keyboard(s, c) };
}
