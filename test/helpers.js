import { config } from "../src/config.js";
export const settings = () =>
  config({
    BOT_TOKEN: "1000:synthetic",
    OWNER_IDS: "10001",
    DASHBOARD_URL: "https://dashboard.example.com",
  });
export class MemoryStore {
  constructor() {
    this.data = new Map();
  }
  async get(key) {
    const d = this.data.get(key);
    return d && d.until > Date.now() ? d.value : null;
  }
  async set(key, value, ttl) {
    this.data.set(key, { value, until: Date.now() + ttl * 1000 });
  }
  async acquireLock(key, token, ttl) {
    const d = this.data.get(key);
    if (d && d.until > Date.now()) return false;
    this.data.set(key, { value: token, until: Date.now() + ttl * 1000 });
    return true;
  }
  async renewLock(key, token, ttl) {
    if ((await this.get(key)) !== token) return false;
    await this.set(key, token, ttl);
    return true;
  }
  async setIfLockOwned(lock, token, key, value, ttl) {
    if ((await this.get(lock)) !== token) return false;
    await this.set(key, value, ttl);
    return true;
  }
  async releaseLock(key, token) {
    if ((await this.get(key)) === token) this.data.delete(key);
  }
}
export class FakeTelegram {
  constructor() {
    this.sent = [];
    this.callbacks = [];
    this.failure = null;
  }
  async screen(id, screen, messageId) {
    if (this.failure) throw this.failure;
    this.sent.push({ id, ...screen, messageId });
  }
  async call(method, body) {
    this.callbacks.push({ method, body });
    return {};
  }
}
export const message = (id, text) => ({
  update_id: 1,
  message: {
    message_id: 10,
    from: { id: Number(id), first_name: "Demo User" },
    chat: { id: Number(id), type: "private" },
    text,
  },
});
export const callback = (id, data) => ({
  update_id: 2,
  callback_query: {
    id: "synthetic",
    from: { id: Number(id) },
    data,
    message: { message_id: 10, chat: { id: Number(id), type: "private" } },
  },
});
