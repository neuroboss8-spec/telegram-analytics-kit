import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { demoMetrics } from "../src/metrics.js";
export function demoServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const requested = Object.fromEntries(
      ["start", "end", "platform"].map((k) => [k, url.searchParams.get(k)]),
    );
    const validDate = (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (
      req.method !== "GET" ||
      url.pathname !== "/metrics" ||
      !validDate(requested.start) ||
      !validDate(requested.end) ||
      requested.start > requested.end ||
      !["all", "web", "app"].includes(requested.platform)
    ) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({
            error:
              "Use GET /metrics?start=YYYY-MM-DD&end=YYYY-MM-DD&platform=all|web|app",
          }),
        );
      return;
    }
    res
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify(demoMetrics(requested)));
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  demoServer().listen(8080, "0.0.0.0", () =>
    console.log(
      "Synthetic demo adapter listening on port 8080. No real accounts or credentials.",
    ),
  );
}
