export function discordContent(entries: string[], dropped: number): string {
  const raw = entries.join("\n");
  const suffix = dropped ? `\n已丟棄 ${dropped} 筆訊息；若短時間需保留更多推送，請縮短 Provider 發送秒數或增加佇列上限。` : "";
  const characters = Array.from(raw);
  const clipped = characters.length > 1800;
  let notice = (clipped ? "\n……字數過長無法顯示" : "") + suffix;
  if (characters.length > 2000 - Array.from(notice).length && !clipped) notice = "\n……字數過長無法顯示" + suffix;
  // Discord limits content to 2000 Unicode characters, rather than UTF-16 code units.
  return characters.slice(0, Math.min(1800, 2000 - Array.from(notice).length)).join("") + notice;
}
