import { randomUUID, randomBytes } from "node:crypto";
const stateTtl = 10 * 365 * 86400;
const requestTtl = 7 * 86400000;
const rejectCooldown = 86400000;
export const accessLimits = {
  viewers: 50,
  requests: 100,
};
export const validTelegramId = (id) =>
  /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id));
export function applicantProfile(id, from) {
  const name =
    [from.first_name, from.last_name]
      .filter(Boolean)
      .join(" ")
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || `Пользователь ${id}`;
  const username =
    from.username && /^[A-Za-z0-9_]{5,32}$/.test(from.username)
      ? from.username
      : undefined;
  return {
    id,
    name,
    ...(username
      ? {
          username,
        }
      : {}),
  };
}
export class AccessRegistry {
  redis;
  constructor(redis) {
    this.redis = redis;
  }
  async state(namespace) {
    const stored = await this.redis.get(`${namespace}:access`);
    if (!stored)
      return {
        version: 1,
        requests: [],
        grants: [],
      };
    const state = JSON.parse(stored);
    const validPerson = (p) =>
      p &&
      validTelegramId(p.id) &&
      /^[a-f0-9]{16}$/.test(p.nonce) &&
      typeof p.name === "string" &&
      p.name.length <= 80 &&
      Number.isFinite(p.createdAt) &&
      (p.username === undefined || /^[A-Za-z0-9_]{5,32}$/.test(p.username));
    if (
      state.version !== 1 ||
      !Array.isArray(state.requests) ||
      !Array.isArray(state.grants) ||
      state.requests.length > accessLimits.requests ||
      state.grants.length > accessLimits.viewers ||
      !state.requests.every(
        (p) =>
          validPerson(p) &&
          ["pending", "denied"].includes(p.status) &&
          Number.isFinite(p.expiresAt),
      ) ||
      !state.grants.every(
        (p) => validPerson(p) && validTelegramId(p.grantedBy),
      ) ||
      new Set(state.requests.map((p) => p.id)).size !== state.requests.length ||
      new Set(state.grants.map((p) => p.id)).size !== state.grants.length
    )
      throw new Error("Invalid access state");
    return state;
  }
  async canRead(namespace, owners, id) {
    return (
      owners.includes(id) ||
      (await this.state(namespace)).grants.some((p) => p.id === id)
    );
  }
  async modify(namespace, fn) {
    const lock = `${namespace}:access:lock`,
      token = randomUUID();
    let locked = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      locked = await this.redis.acquireLock(lock, token, 10);
      if (locked) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (!locked) throw new Error("Access busy");
    try {
      const state = await this.state(namespace);
      state.requests = state.requests.filter((p) => p.expiresAt > Date.now());
      const result = fn(state);
      if (
        !(await this.redis.setIfLockOwned(
          lock,
          token,
          `${namespace}:access`,
          JSON.stringify(state),
          stateTtl,
        ))
      )
        throw new Error("Access lease lost");
      return result;
    } finally {
      await this.redis.releaseLock(lock, token);
    }
  }
  async request(namespace, profile) {
    if (!validTelegramId(profile.id)) throw new Error("Invalid applicant");
    return this.modify(namespace, (state) => {
      if (state.grants.some((p) => p.id === profile.id))
        return {
          status: "allowed",
        };
      const existing = state.requests.find((p) => p.id === profile.id);
      if (existing)
        return {
          status: existing.status,
          request: existing,
        };
      if (state.requests.length >= accessLimits.requests)
        return {
          status: "full",
        };
      const request = {
        ...profile,
        nonce: randomBytes(8).toString("hex"),
        createdAt: Date.now(),
        status: "pending",
        expiresAt: Date.now() + requestTtl,
      };
      state.requests.push(request);
      return {
        status: "created",
        request,
      };
    });
  }
  async decide(namespace, owners, actor, id, nonce, approve) {
    if (!owners.includes(actor) || owners.includes(id))
      return {
        status: "forbidden",
      };
    return this.modify(namespace, (state) => {
      const request = state.requests.find(
        (p) => p.id === id && p.nonce === nonce && p.status === "pending",
      );
      if (!request)
        return {
          status: "stale",
        };
      if (approve && state.grants.length >= accessLimits.viewers)
        return {
          status: "full",
        };
      if (approve) {
        const grant = {
          id: request.id,
          name: request.name,
          ...(request.username
            ? {
                username: request.username,
              }
            : {}),
          nonce: request.nonce,
          createdAt: Date.now(),
          grantedBy: actor,
        };
        state.grants.push(grant);
        state.requests = state.requests.filter((p) => p.id !== id);
        return {
          status: "approved",
          person: grant,
        };
      }
      request.status = "denied";
      request.expiresAt = Date.now() + rejectCooldown;
      return {
        status: "denied",
        person: request,
      };
    });
  }
  async revoke(namespace, owners, actor, id, nonce) {
    if (!owners.includes(actor) || owners.includes(id))
      return {
        status: "forbidden",
      };
    return this.modify(namespace, (state) => {
      const person = state.grants.find((p) => p.id === id && p.nonce === nonce);
      if (!person)
        return {
          status: "stale",
        };
      state.grants = state.grants.filter((p) => p.id !== id);
      return {
        status: "revoked",
        person,
      };
    });
  }
}
const back = [
  {
    text: "← Доступ",
    callback_data: "access:home:0",
  },
];
export function accessPersonScreen(person, pending) {
  return {
    text: `${pending ? "Заявка на доступ" : "Доступ открыт"}\n\n${person.name}${person.username ? ` · @${person.username}` : ""}\nTelegram ID: ${person.id}\n\nПросмотр всей статистики: выручка, воронка, задания и остатки провайдеров. Управлять доступом может только владелец. Вход в веб-дашборд выдаётся отдельно.`,
    reply_markup: {
      inline_keyboard: [
        pending
          ? [
              {
                text: "Выдать доступ",
                callback_data: `access:approve:${person.id}:${person.nonce}`,
              },
              {
                text: "Отклонить",
                callback_data: `access:deny:${person.id}:${person.nonce}`,
              },
            ]
          : [
              {
                text: "Отозвать доступ",
                callback_data: `access:revoke:${person.id}:${person.nonce}`,
              },
            ],
        back,
      ],
    },
  };
}
export function accessListScreen(state, page = 0) {
  const pending = state.requests.filter(
    (p) => p.status === "pending" && p.expiresAt > Date.now(),
  );
  const rows = [
    ...pending.map((p) => ({
      person: p,
      pending: true,
    })),
    ...state.grants.map((p) => ({
      person: p,
      pending: false,
    })),
  ];
  const current = Math.min(
    Math.max(0, page),
    Math.max(0, Math.ceil(rows.length / 6) - 1),
  );
  const buttons = rows
    .slice(current * 6, current * 6 + 6)
    .map(({ person, pending }) => [
      {
        text: `${pending ? "Заявка" : "Доступ"} · ${person.name.slice(0, 35)}`,
        callback_data: `access:${pending ? "request" : "person"}:${person.id}:${person.nonce}`,
      },
    ]);
  if (current > 0 || (current + 1) * 6 < rows.length)
    buttons.push([
      ...(current > 0
        ? [
            {
              text: "←",
              callback_data: `access:home:${current - 1}`,
            },
          ]
        : []),
      ...((current + 1) * 6 < rows.length
        ? [
            {
              text: "→",
              callback_data: `access:home:${current + 1}`,
            },
          ]
        : []),
    ]);
  buttons.push(
    [
      {
        text: "Обновить",
        callback_data: `access:home:${current}`,
      },
    ],
    [
      {
        text: "← К сводке",
        callback_data: "stats:today:all:summary",
      },
    ],
  );
  return {
    text: `Доступ к статистике\n\nОжидают одобрения: ${pending.length}\nДоступ открыт: ${state.grants.length}\n\n${rows.length ? "Выберите человека, чтобы проверить заявку или отозвать доступ." : "Новых заявок нет. Отправьте человеку ссылку на бота — после /start здесь появится заявка."}`,
    reply_markup: {
      inline_keyboard: buttons,
    },
  };
}
