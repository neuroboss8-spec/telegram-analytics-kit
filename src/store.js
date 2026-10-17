import { createClient } from "redis";
export class Store {
  constructor(url) {
    this.client = createClient({ url });
    this.client.on("error", () => {});
  }
  async connect() {
    await this.client.connect();
  }
  async close() {
    if (this.client.isOpen) await this.client.close();
  }
  get(key) {
    return this.client.get(key);
  }
  set(key, value, ttl) {
    return this.client.set(key, value, { EX: ttl });
  }
  async acquireLock(key, token, ttl) {
    return (await this.client.set(key, token, { NX: true, EX: ttl })) === "OK";
  }
  async renewLock(key, token, ttl) {
    return (
      Number(
        await this.client.eval(
          "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) end return 0",
          { keys: [key], arguments: [token, String(ttl)] },
        ),
      ) === 1
    );
  }
  async setIfLockOwned(lock, token, key, value, ttl) {
    return (
      Number(
        await this.client.eval(
          "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]); return 1",
          { keys: [lock, key], arguments: [token, value, String(ttl)] },
        ),
      ) === 1
    );
  }
  releaseLock(key, token) {
    return this.client.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
      { keys: [key], arguments: [token] },
    );
  }
}
