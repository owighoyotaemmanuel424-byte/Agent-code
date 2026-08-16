import { formatRetrievedContext, type RetrievalMatch } from "./retrieve";

const MAX_CONTEXT_CHARS = 24000;

export function buildGroundedSystemPrompt(basePrompt: string | undefined, matches: RetrievalMatch[]) {
  const context = formatRetrievedContext(matches).slice(0, MAX_CONTEXT_CHARS);
  const grounding = context
    ? `\n\nUse the following workspace knowledge as evidence when answering. Do not invent facts that are not supported by the conversation or this context. If the context is insufficient, say so.\n\n<knowledge>\n${context}\n</knowledge>`
    : "\n\nNo relevant workspace knowledge was retrieved. Do not claim that you searched the knowledge base.";

  return `${basePrompt?.trim() || "You are a helpful AI assistant."}${grounding}`;
}
