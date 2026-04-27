import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TranscriptEventSchema, type TranscriptEvent } from "./session-transcript-schema.js";

const SESSIONS_DIR = ".inkos/sessions";
const appendQueues = new Map<string, Promise<void>>();

export function sessionsDir(projectRoot: string): string {
  return join(projectRoot, SESSIONS_DIR);
}

export function transcriptPath(projectRoot: string, sessionId: string): string {
  return join(sessionsDir(projectRoot), `${sessionId}.jsonl`);
}

export function legacyBookSessionPath(projectRoot: string, sessionId: string): string {
  return join(sessionsDir(projectRoot), `${sessionId}.json`);
}

export async function readTranscriptEvents(
  projectRoot: string,
  sessionId: string,
): Promise<TranscriptEvent[]> {
  let raw: string;
  try {
    raw = await readFile(transcriptPath(projectRoot, sessionId), "utf-8");
  } catch {
    return [];
  }

  const events: TranscriptEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = TranscriptEventSchema.safeParse(JSON.parse(line));
      if (parsed.success) events.push(parsed.data);
    } catch {
      continue;
    }
  }

  return events.sort((a, b) => a.seq - b.seq);
}

export async function nextTranscriptSeq(projectRoot: string, sessionId: string): Promise<number> {
  const events = await readTranscriptEvents(projectRoot, sessionId);
  return events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
}

export async function appendTranscriptEvent(
  projectRoot: string,
  event: TranscriptEvent,
): Promise<void> {
  const key = `${projectRoot}:${event.sessionId}`;
  const previous = appendQueues.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(sessionsDir(projectRoot), { recursive: true });
    await appendFile(
      transcriptPath(projectRoot, event.sessionId),
      `${JSON.stringify(event)}\n`,
      "utf-8",
    );
  });
  appendQueues.set(key, next.catch(() => undefined));
  await next;
}
