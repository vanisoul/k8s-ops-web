export type MessageQueue = { entries: string[]; dropped: number };

export function enqueue(queue: MessageQueue, message: string, limit: number): void {
  if (queue.entries.length >= limit) queue.dropped++;
  else queue.entries.push(message);
}

export function flush(from: MessageQueue, to: MessageQueue, limit: number): void {
  for (const entry of from.entries) enqueue(to, entry, limit);
  to.dropped += from.dropped;
  from.entries.length = 0;
  from.dropped = 0;
}
