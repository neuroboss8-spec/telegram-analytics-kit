import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/store.js";
import { AccessRegistry } from "../src/access.js";
const store = new Store(process.env.REDIS_URL || "redis://localhost:6379");
const prefix = `test:analytics-kit:${randomUUID()}`;
const keys = new Set();
const key = (s) => {
  const k = `${prefix}:${s}`;
  keys.add(k);
  return k;
};
try {
  await store.connect();
  const lock = key("lock"),
    target = key("target");
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.acquireLock(lock, String(i), 30),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  const owner = String(results.indexOf(true));
  assert.equal(
    await store.setIfLockOwned(lock, "other", target, "bad", 30),
    false,
  );
  assert.equal(
    await store.setIfLockOwned(lock, owner, target, "good", 30),
    true,
  );
  assert.equal(await store.get(target), "good");
  await store.releaseLock(lock, "other");
  assert.equal(await store.get(lock), owner);
  await store.releaseLock(lock, owner);
  assert.equal(await store.get(lock), null);
  const access = new AccessRegistry(store),
    ns = key("access-ns");
  keys.add(`${ns}:access`);
  keys.add(`${ns}:access:lock`);
  const request = await access.request(ns, {
    id: "10002",
    name: "Synthetic User",
  });
  assert.equal(request.status, "created");
  assert.equal(
    (
      await access.decide(
        ns,
        ["10001"],
        "10002",
        "10002",
        request.request.nonce,
        true,
      )
    ).status,
    "forbidden",
  );
  assert.equal(
    (
      await access.decide(
        ns,
        ["10001"],
        "10001",
        "10002",
        request.request.nonce,
        true,
      )
    ).status,
    "approved",
  );
  assert.equal(
    await new AccessRegistry(store).canRead(ns, ["10001"], "10002"),
    true,
  );
  await access.revoke(ns, ["10001"], "10001", "10002", request.request.nonce);
  assert.equal(await access.canRead(ns, ["10001"], "10002"), false);
  console.log(
    "Real Redis integration passed: race, fencing, persistence, owner approval and revocation.",
  );
} finally {
  if (store.client.isOpen) {
    for (const k of keys) await store.client.del(k);
    await store.close();
  }
}
