import { randomUUID } from "node:crypto";
import {
  AccessRegistry,
  applicantProfile,
  accessListScreen,
  accessPersonScreen,
} from "./access.js";
import { range, clock } from "./config.js";
import { report, selection, periods, views, keyboard } from "./report.js";
import { TelegramError } from "./telegram.js";

const DEFAULT = { period: "today", platform: "all", view: "summary" };
const STATE_TTL = 10 * 365 * 86400;
const dateAtZone = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
export function domainStage(paidTill, tz, now = new Date()) {
  if (!paidTill || !Number.isFinite(Date.parse(paidTill))) return null;
  const days =
    dateAtZone(clock(tz, new Date(paidTill)).date) -
    dateAtZone(clock(tz, now).date);
  return days > 30
    ? null
    : {
        days,
        stage:
          days <= 0 ? 0 : days <= 1 ? 1 : days <= 3 ? 3 : days <= 7 ? 7 : 30,
      };
}
export class AnalyticsBot {
  constructor(config, store, source, telegram) {
    this.config = config;
    this.store = store;
    this.source = source;
    this.telegram = telegram;
    this.access = new AccessRegistry(store);
  }
  key(suffix) {
    return `${this.config.namespace}:${suffix}`;
  }
  async allowed(id) {
    return this.access.canRead(this.config.namespace, this.config.owners, id);
  }
  async preferences(id) {
    const raw = await this.store.get(this.key(`prefs:${id}`));
    if (!raw) return { subscribed: false, hour: 9 };
    const value = JSON.parse(raw);
    if (
      typeof value.subscribed !== "boolean" ||
      ![9, 12, 18].includes(value.hour)
    )
      throw Error("Invalid saved preferences");
    return value;
  }
  async screen(id, screen, messageId) {
    return this.telegram.screen(id, screen, messageId);
  }
  async stats(id, s = DEFAULT, messageId) {
    if (!(await this.allowed(id))) return;
    let data;
    try {
      data = await this.source.get({
        ...range(s.period),
        platform: s.platform,
      });
    } catch {
      if (await this.allowed(id))
        return this.screen(
          id,
          {
            text: "Данные временно недоступны или устарели. Повторите обновление позже.",
            reply_markup: keyboard(s, this.config),
          },
          messageId,
        );
      return;
    }
    if (!(await this.allowed(id))) return;
    return this.screen(id, report(data, s, this.config), messageId);
  }
  async settings(id, messageId) {
    if (!(await this.allowed(id))) return;
    const prefs = await this.preferences(id);
    return this.screen(
      id,
      {
        text: `Ежедневная сводка за вчера (UTC)\nДоставка: ${this.config.timezone}\n${prefs.subscribed ? "Включена" : "Выключена"} · ${prefs.hour}:00`,
        reply_markup: {
          inline_keyboard: [
            [9, 12, 18].map((hour) => ({
              text: `${prefs.subscribed && prefs.hour === hour ? "✓ " : ""}${hour}:00`,
              callback_data: `notify:${hour}`,
            })),
            [{ text: "Отключить сводку", callback_data: "notify:off" }],
            ...(this.config.owners.includes(id)
              ? [
                  [
                    {
                      text: "Управление доступом",
                      callback_data: "access:home:0",
                    },
                  ],
                ]
              : []),
            [{ text: "← К сводке", callback_data: "stats:today:all:summary" }],
          ],
        },
      },
      messageId,
    );
  }
  async handle(update) {
    const cb = update.callback_query,
      msg = cb?.message || update.message,
      user = cb?.from || msg?.from;
    if (
      !msg ||
      !user ||
      user.is_bot ||
      msg.chat?.type !== "private" ||
      String(msg.chat.id) !== String(user.id)
    )
      return;
    const id = String(user.id),
      command = msg.text?.split(/\s/)[0]?.split("@")[0];
    if (cb)
      await this.telegram
        .call("answerCallbackQuery", { callback_query_id: cb.id })
        .catch(() => {});
    if (!cb && command === "/whoami")
      return this.screen(id, { text: `Ваш Telegram ID: ${id}` });
    if (!(await this.allowed(id))) {
      if (!cb && command === "/start") {
        const result = await this.access.request(
          this.config.namespace,
          applicantProfile(id, user),
        );
        if (result.status === "created")
          for (const owner of this.config.owners)
            await this.screen(
              owner,
              accessPersonScreen(result.request, true),
            ).catch(() => {});
        return this.screen(id, {
          text: "Запрос на доступ отправлен владельцу. После одобрения нажмите /start ещё раз.",
        });
      }
      if (!cb)
        return this.screen(id, {
          text: "Для доступа отправьте /start. Владелец должен одобрить запрос.",
        });
      return;
    }
    if (cb) {
      const value = cb.data || "";
      const selected = selection(value, this.config);
      if (selected) return this.stats(id, selected, msg.message_id);
      if (value === "settings") return this.settings(id, msg.message_id);
      if (/^notify:(off|9|12|18)$/.test(value)) {
        const pref = await this.preferences(id);
        const chosen = value.split(":")[1];
        await this.store.set(
          this.key(`prefs:${id}`),
          JSON.stringify({
            subscribed: chosen !== "off",
            hour: chosen === "off" ? pref.hour : Number(chosen),
          }),
          STATE_TTL,
        );
        // Enabling after a prior report still uses the same delivery-day marker.
        await this.store.set(
          this.key(`daily-start:${id}`),
          clock(this.config.timezone).date,
          STATE_TTL,
        );
        return this.settings(id, msg.message_id);
      }
      if (value.startsWith("access:"))
        return this.handleAccess(id, value, msg.message_id);
      if (value.startsWith("filters:") || value.startsWith("sections:")) {
        const s = selection(
          value.replace(/^(filters|sections):/, "stats:"),
          this.config,
        );
        if (!s) return;
        const button = (text, next) => ({
          text,
          callback_data: `stats:${next.period}:${next.platform}:${next.view}`,
        });
        return this.screen(
          id,
          {
            text: value.startsWith("filters:")
              ? "Период и платформа"
              : "Раздел отчёта",
            reply_markup: {
              inline_keyboard: value.startsWith("filters:")
                ? [
                    Object.entries(periods).map(([period, label]) =>
                      button(label, { ...s, period }),
                    ),
                    this.config.platforms.map((p) =>
                      button(p.label, { ...s, platform: p.id }),
                    ),
                  ]
                : Object.entries(views).map(([view, label]) => [
                    button(label, { ...s, view }),
                  ]),
            },
          },
          msg.message_id,
        );
      }
      return;
    }
    if (command === "/stop") {
      const prefs = await this.preferences(id);
      await this.store.set(
        this.key(`prefs:${id}`),
        JSON.stringify({ ...prefs, subscribed: false }),
        STATE_TTL,
      );
      return this.screen(id, {
        text: "Ежедневная сводка отключена. Служебные напоминания владельцу настраиваются отдельно.",
      });
    }
    if (command === "/access") return this.handleAccess(id, "access:home:0");
    if (command === "/settings") return this.settings(id);
    if (
      command === "/start" &&
      !(await this.store.get(this.key(`prefs:${id}`)))
    ) {
      await this.store.set(
        this.key(`prefs:${id}`),
        JSON.stringify({ subscribed: true, hour: 9 }),
        STATE_TTL,
      );
      await this.store.set(
        this.key(`daily-start:${id}`),
        clock(this.config.timezone).date,
        STATE_TTL,
      );
    }
    const commands = {
      "/today": "today",
      "/yesterday": "yesterday",
      "/week": "week",
      "/start": "today",
    };
    if (commands[command])
      return this.stats(id, { ...DEFAULT, period: commands[command] });
    return this.screen(id, {
      text: "Команды: /today /yesterday /week /settings /access /stop /whoami",
    });
  }
  async handleAccess(id, value, messageId) {
    if (!this.config.owners.includes(id)) return;
    const [, action, personId, nonce, extra] = value.split(":");
    if (extra) return;
    const ns = this.config.namespace,
      owners = this.config.owners;
    if (["approve", "deny", "revoke"].includes(action)) {
      if (
        !/^[1-9]\d{0,15}$/.test(personId) ||
        !/^[a-f0-9]{16}$/.test(nonce || "")
      )
        return;
      const result =
        action === "revoke"
          ? await this.access.revoke(ns, owners, id, personId, nonce)
          : await this.access.decide(
              ns,
              owners,
              id,
              personId,
              nonce,
              action === "approve",
            );
      if (result.status === "approved")
        await this.screen(personId, {
          text: "Доступ открыт. Нажмите /start.",
        }).catch(() => {});
      if (result.status === "revoked")
        await this.store.set(
          this.key(`prefs:${personId}`),
          JSON.stringify({ subscribed: false, hour: 9 }),
          STATE_TTL,
        );
      return this.screen(
        id,
        {
          text: result.status,
          reply_markup: {
            inline_keyboard: [
              [{ text: "← Доступ", callback_data: "access:home:0" }],
            ],
          },
        },
        messageId,
      );
    }
    const state = await this.access.state(ns);
    if (action === "home" && /^\d{1,3}$/.test(personId || ""))
      return this.screen(
        id,
        accessListScreen(state, Number(personId)),
        messageId,
      );
    const person =
      action === "request"
        ? state.requests.find(
            (p) =>
              p.id === personId &&
              p.nonce === nonce &&
              p.status === "pending" &&
              p.expiresAt > Date.now(),
          )
        : action === "person"
          ? state.grants.find((p) => p.id === personId && p.nonce === nonce)
          : null;
    if (person)
      return this.screen(
        id,
        accessPersonScreen(person, action === "request"),
        messageId,
      );
  }
  async claimed(key, ttl, send) {
    const lease = randomUUID();
    if (!(await this.store.acquireLock(key, lease, ttl))) return;
    try {
      await send();
    } catch (error) {
      // Network timeout may mean delivered: keep the claim. A definite rejection may retry.
      if (error instanceof TelegramError)
        await this.store.setIfLockOwned(
          key,
          lease,
          key,
          "rejected",
          error.code === 429
            ? error.retryAfter
            : [400, 401, 403].includes(error.code)
              ? 86400
              : 60,
        );
      console.warn("notification.delivery_failed");
    }
  }
  async daily(now = new Date()) {
    const current = clock(this.config.timezone, now),
      state = await this.access.state(this.config.namespace);
    let data;
    for (const id of [
      ...new Set([...this.config.owners, ...state.grants.map((p) => p.id)]),
    ]) {
      const prefs = await this.preferences(id);
      if (
        !prefs.subscribed ||
        current.hour < prefs.hour ||
        (await this.store.get(this.key(`daily-start:${id}`))) ===
          current.date ||
        !(await this.allowed(id))
      )
        continue;
      data ??= await this.source.get({
        ...range("yesterday", now),
        platform: "all",
      });
      if (!(await this.allowed(id))) continue;
      await this.claimed(
        this.key(`daily:${id}:${current.date}`),
        3 * 86400,
        async () => {
          if (await this.allowed(id))
            await this.screen(
              id,
              report(data, { ...DEFAULT, period: "yesterday" }, this.config),
            );
        },
      );
    }
  }
  async finance(now = new Date()) {
    if (!this.config.financeEnabled) return;
    const current = clock(this.config.timezone, now);
    if (current.hour < 9 || current.hour > 20) return;
    const data = await this.source.get({
      ...range("today", now),
      platform: "all",
    });
    if (data.demo) return;
    for (const owner of this.config.owners) {
      for (const p of data.providers)
        if (
          p.balance !== null &&
          typeof p.estimatedDays === "number" &&
          p.estimatedDays <= this.config.lowBalanceDays
        ) {
          const text = `⚠️ Проверьте баланс\n${p.name}\nОстаток: ${p.balance.amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${p.balance.currency}\nПрогноз: ≈ ${p.estimatedDays.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} дн.\nНапоминаем раз в сутки, пока осталось ${this.config.lowBalanceDays} дней или меньше.\n${this.config.dashboard}`;
          await this.claimed(this.key(`balance:${p.id}:${owner}`), 86400, () =>
            this.screen(owner, { text }),
          );
        }
      for (const d of data.domains) {
        const due = domainStage(d.paidTill, this.config.timezone, now);
        if (!due) continue;
        const text = `🌐 Проверьте продление домена\n${d.name}\nОплачен до: ${new Intl.DateTimeFormat("ru-RU", { timeZone: this.config.timezone }).format(new Date(d.paidTill))}\n${due.days > 0 ? `Осталось: ${due.days} дн.` : due.days === 0 ? "Срок заканчивается сегодня." : "Оплаченный срок истёк."}\nИсточник: ваш адаптер данных.\n${this.config.dashboard}`;
        await this.claimed(
          this.key(`domain:${d.name}:${d.paidTill}:${due.stage}:${owner}`),
          400 * 86400,
          () => this.screen(owner, { text }),
        );
      }
    }
  }
}
