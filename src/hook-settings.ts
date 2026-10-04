import { existsSync, readFileSync } from "node:fs";

export type HookType = "available" | "unavailable" | "logRegex";
export type Provider = { name: string; type: "discord"; url: string; queueLimit: number; intervalSeconds: number };
export type Hook = { name: string; type: HookType; message: string; providers: string[]; regex?: RegExp; bufferLimit: number };
export type HookSettings = { providers: Provider[]; hooks: Hook[] };

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

function positive(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export function interval(name: string, fallback = 10): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new Error(`${name} must be a positive integer`);
  return seconds;
}

function json(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadHookSettings(): HookSettings | null {
  const providersPath = process.env.PROVIDERS_CONFIG_PATH || "config/providers.json";
  const hooksPath = process.env.HOOKS_CONFIG_PATH || "config/hooks.json";
  if (!process.env.PROVIDERS_CONFIG_PATH && !process.env.HOOKS_CONFIG_PATH &&
      !existsSync(providersPath) && !existsSync(hooksPath)) return null;

  const providersFile = object(json(providersPath), providersPath);
  const hooksFile = object(json(hooksPath), hooksPath);
  if (!Array.isArray(providersFile.providers)) throw new Error(`${providersPath}.providers must be an array`);
  if (!Array.isArray(hooksFile.hooks)) throw new Error(`${hooksPath}.hooks must be an array`);

  const providerNames = new Set<string>();
  const providers: Provider[] = providersFile.providers.map((entry, i) => {
    const label = `providers[${i}]`;
    const item = object(entry, label);
    const name = text(item.name, `${label}.name`);
    if (providerNames.has(name)) throw new Error(`Duplicate provider: ${name}`);
    providerNames.add(name);
    if (item.type !== "discord") throw new Error(`${label}.type must be discord`);
    const env = item.urlEnv === undefined ? undefined : text(item.urlEnv, `${label}.urlEnv`);
    const url = item.url === undefined ? (env ? process.env[env] : undefined) : text(item.url, `${label}.url`);
    if (!url) throw new Error(`${label}: missing url or value of urlEnv ${env ?? ""}`);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "discord.com" && parsed.hostname !== "discordapp.com" ||
          !/^\/api\/webhooks\/\d+\/[^/]+$/.test(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw new Error("invalid webhook URL");
      }
    } catch {
      throw new Error(`${label}: invalid Discord webhook URL`);
    }
    return {
      name, type: "discord", url,
      queueLimit: positive(item.queueLimit, 20, `${label}.queueLimit`),
      intervalSeconds: positive(item.intervalSeconds, 1, `${label}.intervalSeconds`),
    };
  });

  const hookNames = new Set<string>();
  const hooks: Hook[] = hooksFile.hooks.map((entry, i) => {
    const label = `hooks[${i}]`;
    const item = object(entry, label);
    const name = text(item.name, `${label}.name`);
    if (hookNames.has(name)) throw new Error(`Duplicate hook: ${name}`);
    hookNames.add(name);
    if (item.type !== "available" && item.type !== "unavailable" && item.type !== "logRegex") {
      throw new Error(`${label}.type is invalid`);
    }
    const message = text(item.message, `${label}.message`);
    if (!Array.isArray(item.providers) || !item.providers.length) throw new Error(`${label}.providers must be a nonempty array`);
    const destinations = item.providers.map((value, j) => text(value, `${label}.providers[${j}]`));
    if (new Set(destinations).size !== destinations.length) throw new Error(`${label}.providers contains duplicates`);
    for (const destination of destinations) {
      if (!providerNames.has(destination)) throw new Error(`${label}: unknown provider ${destination}`);
    }
    let regex: RegExp | undefined;
    if (item.type === "logRegex") {
      try { regex = new RegExp(text(item.regex, `${label}.regex`)); }
      catch (error) { throw new Error(`${label}.regex: ${error instanceof Error ? error.message : String(error)}`); }
      const groups = new Set([...regex.source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((match) => match[1]));
      for (const [, group] of message.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
        if (!groups.has(group)) {
          throw new Error(`${label}.message: unknown capture group ${group}`);
        }
      }
    } else if (message.includes("{{")) {
      throw new Error(`${label}.message: capture groups require logRegex`);
    }
    return { name, type: item.type, message, providers: destinations, regex,
      bufferLimit: positive(item.bufferLimit, 20, `${label}.bufferLimit`) };
  });
  return { providers, hooks };
}
