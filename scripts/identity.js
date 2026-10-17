import { Telegram } from "../src/telegram.js";
const token = process.env.BOT_TOKEN?.trim();
if (!token || !/^\d+:[\w-]+$/.test(token))
  throw Error("Set BOT_TOKEN in your local .env");
try {
  const telegram = new Telegram({
    token,
    ipv4: process.env.TELEGRAM_CONNECT_IPV4 || undefined,
  });
  const webhook = await telegram.call("getWebhookInfo");
  if (webhook.url) throw Error("Webhook active");
  const updates = await telegram.call("getUpdates", {
    timeout: 0,
    limit: 100,
    allowed_updates: ["message"],
  });
  const ids = [
    ...new Set(
      updates
        .filter(
          (u) =>
            u.message?.chat?.type === "private" &&
            /^\/(start|whoami)(?:\s|$)/.test(u.message.text || ""),
        )
        .map((u) => u.message.from?.id)
        .filter(Boolean),
    ),
  ];
  console.log(
    JSON.stringify({
      candidateIds: ids,
      note: "Choose your ID explicitly. Nothing is approved automatically.",
    }),
  );
} catch {
  console.error(
    "Identity discovery failed. Stop the running bot, check token and webhook. Credentials hidden.",
  );
  process.exitCode = 1;
}
