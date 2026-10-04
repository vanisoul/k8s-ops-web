import { followLogs, getAvailability, getLogSources, type LogSource } from "./kubectl";
import { interval, loadHookSettings, type Hook, type Provider } from "./hook-settings";
import { discordContent } from "./discord";

type Pending = { entries: string[]; dropped: number };
type Sender = Pending & { provider: Provider; busy: boolean; retryAt: number };

function report(source: string, count: number, reason: string) {
  if (count) console.error(`${source}: ${count} messages dropped (${reason})`);
}

function enqueue(sender: Sender, message: string) {
  if (sender.entries.length >= sender.provider.queueLimit) {
    sender.dropped++;
  } else sender.entries.push(message);
}

async function send(sender: Sender) {
  if (sender.busy || Date.now() < sender.retryAt || !sender.entries.length && !sender.dropped) return;
  sender.busy = true;
  const count = sender.entries.length;
  const dropped = sender.dropped;
  try {
    report(sender.provider.name, dropped, "hook buffer or provider queue full");
    const response = await fetch(sender.provider.url + "?wait=true", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: discordContent(sender.entries.slice(0, count), dropped), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        const seconds = retry ? Number(retry) : Number((await response.clone().json().catch(() => ({})) as { retry_after?: number }).retry_after);
        if (Number.isFinite(seconds) && seconds > 0) sender.retryAt = Date.now() + seconds * 1000;
      }
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    sender.entries.splice(0, count);
    sender.dropped -= dropped;
  } catch (error) {
    console.error(`Provider ${sender.provider.name} send failed: ${error}`);
  } finally {
    sender.busy = false;
  }
}

function dispatch(hook: Hook, message: string, senders: Map<string, Sender>) {
  for (const name of hook.providers) enqueue(senders.get(name)!, message);
}

function bufferLog(hook: Hook, line: string, pending: Pending) {
  const match = hook.regex!.exec(line);
  if (!match) return;
  const message = hook.message.replace(/{{\s*([^{}]+?)\s*}}/g, (_, name: string) => match.groups?.[name] ?? "");
  if (pending.entries.length >= hook.bufferLimit) {
    pending.dropped++;
  } else pending.entries.push(message);
}

function flushLog(hook: Hook, pending: Pending, senders: Map<string, Sender>) {
  report(hook.name, pending.dropped, "hook buffer full");
  for (const name of hook.providers) {
    const sender = senders.get(name)!;
    for (const entry of pending.entries) enqueue(sender, entry);
    sender.dropped += pending.dropped;
  }
  pending.entries.length = 0;
  pending.dropped = 0;
}

type Stream = { process: ReturnType<typeof Bun.spawn>; source: LogSource };

export function startHooks(): void {
  const settings = loadHookSettings();
  if (!settings) return;
  const availableInterval = interval("AVAILABLE_INTERVAL_SECONDS");
  const unavailableInterval = interval("UNAVAILABLE_INTERVAL_SECONDS");
  const logInterval = interval("LOG_REGEX_INTERVAL_SECONDS");
  const senders = new Map(settings.providers.map((provider) => [provider.name,
    { provider, entries: [], dropped: 0, busy: false, retryAt: 0 } as Sender]));
  const logHooks = settings.hooks.filter((hook) => hook.type === "logRegex");
  const pending = new Map(logHooks.map((hook) => [hook.name, { entries: [], dropped: 0 } as Pending]));
  const started = new Date(Date.now() - 1);
  const streams = new Map<string, Stream>();
  const missing = new Map<string, number>();
  const cursors = new Map<string, string>();
  let lastStatus: boolean | undefined;

  async function checkStatus() {
    const status = await getAvailability();
    if (status !== null && status !== lastStatus) {
      lastStatus = status;
      for (const hook of settings.hooks) {
        if (hook.type === (status ? "available" : "unavailable")) dispatch(hook, hook.message, senders);
      }
    }
    setTimeout(checkStatus, (lastStatus === undefined ? Math.min(availableInterval, unavailableInterval) :
      lastStatus ? unavailableInterval : availableInterval) * 1000);
  }

  async function stream(source: LogSource, process: ReturnType<typeof Bun.spawn>, resume?: { timestamp: string; count: number }) {
    let incomplete = "";
    let skipping = false;
    let skipped = 0;
    let lastTimestamp = "";
    let lastCount = 0;
    const resumed = resume ? { ...resume } : undefined;
    const decoder = new TextDecoder();
    const stderr = new Response(process.stderr).text();
    try {
      for await (const chunk of process.stdout as ReadableStream<Uint8Array>) {
        const decoded = decoder.decode(chunk, { stream: true });
        if (skipping) {
          const end = decoded.indexOf("\n");
          if (end === -1) continue;
          incomplete = decoded.slice(end + 1);
          skipping = false;
        } else incomplete += decoded;
        let index: number;
        while ((index = incomplete.indexOf("\n")) !== -1) {
          const row = incomplete.slice(0, index).replace(/\r$/, "");
          incomplete = incomplete.slice(index + 1);
          if (row.length > 65536) {
            console.error(`Log line too long for ${source.id}; skipping line`);
            continue;
          }
          const match = row.match(/^(\S+)\s(.*)$/);
          if (!match || !Number.isFinite(Date.parse(match[1]))) {
            console.error(`Invalid timestamped log line from ${source.id}`);
            continue;
          }
          const time = new Date(match[1]);
          if (time < started) continue;
          if (resume && match[1] < resume.timestamp) continue;
          if (resume && match[1] === resume.timestamp) {
            skipped++;
            if (skipped <= resume.count) continue;
          }
          if (match[1] !== lastTimestamp) { lastTimestamp = match[1]; lastCount = 0; }
          lastCount++;
          const count = lastCount + (resumed && match[1] === resumed.timestamp ? resumed.count : 0);
          if (resume && match[1] > resume.timestamp) resume = undefined;
          const cursor = cursors.get(source.id);
          if (!cursor || match[1] > cursor.timestamp || match[1] === cursor.timestamp && count > cursor.count) {
            cursors.set(source.id, { timestamp: match[1], count });
          }
          for (const hook of logHooks) bufferLog(hook, match[2], pending.get(hook.name)!);
        }
        if (incomplete.length > 65536 && !skipping) {
          console.error(`Log line too long for ${source.id}; skipping partial line`);
          skipping = true;
        }
        if (skipping) {
          incomplete = "";
        }
      }
      const code = await process.exited;
      const error = await stderr;
      console.error(`Log stream ended for ${source.id}: exit ${code} ${error.trim()}`);
    } catch (error) {
      console.error(`Log stream failed for ${source.id}: ${error}`);
    } finally {
      if (!process.killed) process.kill();
      if (streams.get(source.id)?.process === process) streams.delete(source.id);
    }
  }

  async function checkStreams() {
    const sources = await getLogSources();
    if (sources) {
      const active = new Set(sources.map((source) => source.id));
      for (const id of cursors.keys()) {
        if (active.has(id)) missing.delete(id);
        else if ((missing.get(id) ?? 0) >= 6) { cursors.delete(id); missing.delete(id); }
        else missing.set(id, (missing.get(id) ?? 0) + 1);
      }
      for (const [id, value] of streams) {
        if (!active.has(id)) { value.process.kill(); streams.delete(id); }
      }
      for (const source of sources) {
        if (streams.has(source.id)) continue;
        try {
          const cursor = cursors.get(source.id);
          const process = followLogs(source, cursor ? new Date(Date.parse(cursor.timestamp) - 1) : started);
          streams.set(source.id, { process, source });
          void stream(source, process, cursor ? { ...cursor } : undefined);
        } catch (error) { console.error(`Cannot follow logs for ${source.id}: ${error}`); }
      }
    }
    setTimeout(checkStreams, 10000);
  }

  void checkStatus();
  if (logHooks.length) {
    void checkStreams();
    setInterval(() => {
      for (const hook of logHooks) flushLog(hook, pending.get(hook.name)!, senders);
    }, logInterval * 1000);
  }
  for (const sender of senders.values()) setInterval(() => void send(sender), sender.provider.intervalSeconds * 1000);
  process.on("SIGTERM", () => {
    for (const sender of senders.values()) console.error(`Stopping provider ${sender.provider.name}: ${sender.entries.length} unsent, ${sender.dropped} dropped`);
    for (const hook of logHooks) console.error(`Stopping hook ${hook.name}: ${pending.get(hook.name)!.entries.length} buffered`);
    for (const value of streams.values()) value.process.kill();
    process.exit(0);
  });
}
