import { range } from "../src/config.js";
import { demoMetrics } from "../src/metrics.js";
import { report } from "../src/report.js";
const c = {
  title: "Аналитика",
  timezone: "Europe/Moscow",
  platforms: [{ id: "all", label: "Все" }],
  dashboard: "https://dashboard.example.com",
  exchangeRate: 85,
};
const s = { period: "yesterday", platform: "all", view: "summary" };
const data = demoMetrics({ ...range(s.period), platform: s.platform });
console.log(report(data, s, c).text);
console.log(
  "\nКнопки:",
  report(data, s, c)
    .reply_markup.inline_keyboard.map((row) =>
      row.map((b) => b.text).join(" | "),
    )
    .join("\n"),
);
