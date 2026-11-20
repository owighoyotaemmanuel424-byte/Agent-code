import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  agentMessageSchema,
  newId,
  nowIso,
  projectIdSchema,
  sessionIdSchema,
  timestampSchema,
} from "@freebuff/shared";
import type { AgentMessage, ProjectId, SessionId } from "@freebuff/shared";
import { z } from "zod";
import { readTextFile, writeFileAtomic } from "./fs-utils";

export const chatSessionMetaSchema = z.object({
  id: sessionIdSchema,
  projectId: projectIdSchema,
  title: z.string().min(1).max(200),
  modelId: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ChatSessionMeta = z.infer<typeof chatSessionMetaSchema>;

const chatSessionFileSchema = z.object({
  version: z.literal(1),
  meta: chatSessionMetaSchema,
  messages: z.array(agentMessageSchema),
});

export interface ChatSession {
  readonly meta: ChatSessionMeta;
  readonly messages: readonly AgentMessage[];
}

/**
 * One JSON document per session, written atomically. History is the portable
 * context: resuming a session replays exactly the messages the model saw.
 */
export class ChatHistoryStore {
  private readonly directory: string;
  private readonly maxMessages: number;

  constructor(directory: string, maxMessages = 2000) {
    this.directory = directory;
    this.maxMessages = maxMessages;
  }

  private fileFor(id: SessionId): string {
    return join(this.directory, `${String(id)}.json`);
  }

  async create(input: {
    readonly projectId: ProjectId;
    readonly title: string;
    readonly modelId: string;
  }): Promise<ChatSession> {
    const at = nowIso();
    const session: ChatSession = {
      meta: {
        id: sessionIdSchema.parse(newId()),
        projectId: input.projectId,
        title: input.title.slice(0, 200),
        modelId: input.modelId,
        createdAt: at,
        updatedAt: at,
      },
      messages: [],
    };
    await this.write(session);
    return session;
  }

  async load(id: SessionId): Promise<ChatSession | undefined> {
    const text = await readTextFile(this.fileFor(id));
    if (text === undefined) {
      return undefined;
    }
    const parsed = chatSessionFileSchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { meta: parsed.data.meta, messages: parsed.data.messages }
      : undefined;
  }

  async append(
    id: SessionId,
    messages: readonly AgentMessage[],
  ): Promise<ChatSession> {
    const existing = await this.load(id);
    if (existing === undefined) {
      throw new Error(`Unknown session: ${String(id)}`);
    }
    const merged = [...existing.messages, ...messages].slice(-this.maxMessages);
    const session: ChatSession = {
      meta: { ...existing.meta, updatedAt: nowIso() },
      messages: merged,
    };
    await this.write(session);
    return session;
  }

  async list(): Promise<ChatSessionMeta[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    const sessions: ChatSessionMeta[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const text = await readTextFile(join(this.directory, entry));
      if (text === undefined) {
        continue;
      }
      try {
        const parsed = chatSessionFileSchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          sessions.push(parsed.data.meta);
        }
      } catch {
        continue;
      }
    }
    return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async latest(projectId?: ProjectId): Promise<ChatSessionMeta | undefined> {
    const sessions = await this.list();
    return projectId === undefined
      ? sessions[0]
      : sessions.find(
          (session) => String(session.projectId) === String(projectId),
        );
  }

  private async write(session: ChatSession): Promise<void> {
    const payload = {
      version: 1 as const,
      meta: session.meta,
      messages: session.messages,
    };
    await writeFileAtomic(
      this.fileFor(session.meta.id),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  }
}

export const parseProjectId = (value: string): ProjectId =>
  projectIdSchema.parse(value);
