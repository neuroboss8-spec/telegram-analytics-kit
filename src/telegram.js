import { telegramRequest } from "./transport.js";
import { boundedJson } from "./metrics.js";
export class TelegramError extends Error {
  constructor(code, retryAfter = 60, unchanged = false) {
    super("Telegram request rejected");
    this.code = code;
    this.retryAfter = retryAfter;
    this.unchanged = unchanged;
  }
}
export class Telegram {
  constructor(config, transport = telegramRequest) {
    this.config = config;
    this.transport = transport;
  }
  async call(method, body = {}, signal) {
    const response = await this.transport(
      this.config.token,
      method,
      body,
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
        : AbortSignal.timeout(35000),
      this.config.ipv4,
    );
    const payload = await boundedJson(response);
    if (!response.ok || payload.ok !== true)
      throw new TelegramError(
        payload.error_code || response.status,
        Math.max(
          15,
          Math.min(3600, Number(payload.parameters?.retry_after) || 60),
        ),
        typeof payload.description === "string" &&
          payload.description.startsWith(
            "Bad Request: message is not modified",
          ),
      );
    return payload.result;
  }
  async screen(id, screen, messageId) {
    try {
      return await this.call(messageId ? "editMessageText" : "sendMessage", {
        chat_id: id,
        ...(messageId ? { message_id: messageId } : {}),
        ...screen,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      if (error instanceof TelegramError && error.unchanged) return;
      throw error;
    }
  }
}
