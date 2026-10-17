import { test } from "node:test";
import assert from "node:assert/strict";
import { demoServer } from "../scripts/demo-source.js";
import { MetricsSource } from "../src/metrics.js";
import { settings } from "./helpers.js";
test("standalone HTTP example serves the real adapter contract with current synthetic data", async () => {
  const server = demoServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const source = new MetricsSource({
      ...settings(),
      mode: "http",
      metricsUrl: `http://127.0.0.1:${port}/metrics`,
    });
    const data = await source.get({
      start: "2026-01-01",
      end: "2026-01-01",
      platform: "web",
    });
    assert.equal(data.demo, true);
    assert.equal(data.totals.registrations, 60);
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/metrics?start=bad`)).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
