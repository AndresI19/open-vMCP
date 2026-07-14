import { db } from '../db/client.js';
import { toolCalls } from '../db/schema.js';
import { ensureUser } from '../db/users.js';
import { redactArgs } from './redact.js';

const REDACT = (process.env.REDACT_ARGS ?? 'true') !== 'false';

export interface ToolCallRecord {
  serverId: string;
  externalUserId: string | null;
  sessionId: string | null;
  toolName: string;
  args: unknown;
  status: 'ok' | 'error' | 'blocked';
  errorMessage?: string;
  latencyMs: number;
  requestedAt: Date;
  respondedAt: Date;
  resultPreview?: string;
}

/**
 * Persist one proxied tool call. Deliberately swallows its own errors: telemetry
 * must never break the actual proxied call for the end user.
 */
export async function recordToolCall(rec: ToolCallRecord): Promise<void> {
  try {
    let userUuid: string | null = null;
    if (rec.externalUserId) {
      const u = await ensureUser(rec.externalUserId);
      userUuid = u.id;
    }

    const { value, redacted } = REDACT ? redactArgs(rec.args) : { value: rec.args, redacted: false };

    await db.insert(toolCalls).values({
      serverId: rec.serverId,
      userId: userUuid,
      sessionId: rec.sessionId,
      toolName: rec.toolName,
      arguments: value as never,
      argsRedacted: redacted,
      status: rec.status,
      errorMessage: rec.errorMessage ?? null,
      latencyMs: rec.latencyMs,
      requestedAt: rec.requestedAt,
      respondedAt: rec.respondedAt,
      resultPreview: rec.resultPreview ?? null,
    });
  } catch (err) {
    console.error('[telemetry] failed to record tool call:', err);
  }
}
