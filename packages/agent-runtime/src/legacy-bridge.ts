import { randomUUID } from "node:crypto";
import type { AgentEventDraft } from "@srgical/studio-shared";

export type LegacyTextInvocation = (options: { onOutputChunk(chunk: string): void }) => Promise<string>;

export async function runLegacyTextTurn(options: {
  invoke: LegacyTextInvocation;
  emit(event: AgentEventDraft): Promise<void>;
  createMessageId?: () => string;
}): Promise<string> {
  const messageId = (options.createMessageId ?? randomUUID)();
  await options.emit({ kind: "session.status", payload: { status: "running", detail: "thinking" } });
  await options.emit({ kind: "message.started", payload: { messageId, role: "assistant" } });
  let streamed = "";
  try {
    const result = await options.invoke({
      onOutputChunk(chunk) {
        if (!chunk) {
          return;
        }
        streamed += chunk;
        void options.emit({ kind: "message.delta", payload: { messageId, text: chunk } });
      }
    });
    const finalText = result.trim();
    await options.emit({ kind: "message.completed", payload: { messageId, text: finalText || streamed.trim() } });
    await options.emit({ kind: "session.status", payload: { status: "idle" } });
    return finalText;
  } catch (error) {
    await options.emit({
      kind: "session.failed",
      payload: { message: error instanceof Error ? error.message : String(error) }
    });
    throw error;
  }
}

