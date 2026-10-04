import { afterEach, expect, test } from "bun:test";
import { discordContent } from "./discord";
import { loadHookSettings } from "./hook-settings";

const originalStatusUrl = process.env.DISCORD_STATUS_WEBHOOK_URL;
const originalPlayerUrl = process.env.DISCORD_PLAYER_WEBHOOK_URL;

afterEach(() => {
  if (originalStatusUrl === undefined) delete process.env.DISCORD_STATUS_WEBHOOK_URL;
  else process.env.DISCORD_STATUS_WEBHOOK_URL = originalStatusUrl;
  if (originalPlayerUrl === undefined) delete process.env.DISCORD_PLAYER_WEBHOOK_URL;
  else process.env.DISCORD_PLAYER_WEBHOOK_URL = originalPlayerUrl;
});

test("loads two independent Discord destinations and named log captures", () => {
  process.env.DISCORD_STATUS_WEBHOOK_URL = "https://discord.com/api/webhooks/123/example";
  process.env.DISCORD_PLAYER_WEBHOOK_URL = "https://discord.com/api/webhooks/456/example";
  const settings = loadHookSettings()!;
  expect(settings.providers.map((provider) => provider.name)).toEqual(["server-status", "player-join"]);
  const join = settings.hooks.find((hook) => hook.name === "player-joined")!;
  expect(join.regex!.exec("Player alice joined the server")?.groups?.id).toBe("alice");
  expect(join.providers).toEqual(["player-join"]);
});

test("fails startup when a referenced webhook URL is missing", () => {
  process.env.DISCORD_STATUS_WEBHOOK_URL = "https://discord.com/api/webhooks/123/example";
  delete process.env.DISCORD_PLAYER_WEBHOOK_URL;
  expect(() => loadHookSettings()).toThrow(/urlEnv/);
});

test("Discord clipping preserves both overflow and dropped-message notices", () => {
  const content = discordContent(["A".repeat(3000)], 25);
  expect(content.length).toBeLessThanOrEqual(2000);
  expect(content.startsWith("A".repeat(1800))).toBe(true);
  expect(content).toContain("字數過長無法顯示");
  expect(content).toContain("已丟棄 25 筆");
  expect(discordContent(["L1", "L2"], 0)).toBe("L1\nL2");
  const emoji = discordContent(["🎮".repeat(2050)], 2);
  expect(Array.from(emoji).length).toBeLessThanOrEqual(2000);
  expect(Array.from(emoji).slice(0, 1800).join("")).toBe("🎮".repeat(1800));
  expect(emoji).toContain("已丟棄 2 筆");
});
