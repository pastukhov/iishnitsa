import { EndpointConfig, Message, MessageAttachment } from "@/lib/store";
import { getImageDataUrl } from "@/lib/image-utils";
import { ChatCompletionMessage, ContentPart } from "@/lib/agent/types";
import { MemoryEntry, MemoryStore } from "@/lib/agent/memory";

interface ContextBuildInput {
  messages: Message[];
  endpoint: EndpointConfig;
  systemPrompt?: string;
  chatPrompt?: string;
  memoryStore?: MemoryStore;
  memoryLimit?: number;
  memoryMinImportance?: number;
}

async function buildMultimodalContent(
  text: string,
  attachments?: MessageAttachment[],
): Promise<string | ContentPart[]> {
  if (!attachments || attachments.length === 0) {
    return text;
  }

  const parts: ContentPart[] = [];

  if (text) {
    parts.push({ type: "text", text });
  }

  for (const attachment of attachments) {
    if (attachment.type === "image") {
      const dataUrl = await getImageDataUrl(attachment);
      parts.push({
        type: "image_url",
        image_url: { url: dataUrl },
      });
    }
  }

  return parts;
}

function formatMemory(entries: MemoryEntry[]): string {
  const lines = entries.map((entry) => `- (${entry.type}) ${entry.content}`);
  return `Relevant memory:\n${lines.join("\n")}`;
}

async function buildConversationMessages(
  messages: Message[],
): Promise<ChatCompletionMessage[]> {
  const chatMessages: ChatCompletionMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;
    const hasContent = msg.content && msg.content.trim().length > 0;
    const hasAttachments = msg.attachments && msg.attachments.length > 0;

    if (!hasContent && !hasAttachments) continue;

    if (msg.role === "user" && hasAttachments) {
      const content = await buildMultimodalContent(
        msg.content || "",
        msg.attachments,
      );
      chatMessages.push({ role: msg.role, content });
    } else {
      chatMessages.push({ role: msg.role, content: msg.content });
    }
  }

  return chatMessages;
}

export async function buildAgentContext({
  messages,
  endpoint,
  systemPrompt,
  chatPrompt,
  memoryStore,
  memoryLimit,
  memoryMinImportance,
}: ContextBuildInput): Promise<ChatCompletionMessage[]> {
  const chatMessages: ChatCompletionMessage[] = [];

  // Use provided systemPrompt, fallback to endpoint.systemPrompt for backwards compatibility
  const effectiveSystemPrompt = systemPrompt ?? endpoint.systemPrompt;
  const promptParts = [
    effectiveSystemPrompt?.trim(),
    chatPrompt?.trim(),
  ].filter(Boolean);

  if (promptParts.length > 0) {
    chatMessages.push({
      role: "system",
      content: promptParts.join("\n\n"),
    });
  }

  if (memoryStore) {
    const memories = await memoryStore.getRelevantMemories({
      limit: memoryLimit ?? 8,
      minImportance: memoryMinImportance ?? 0.5,
    });
    if (memories.length > 0) {
      chatMessages.push({
        role: "system",
        content: formatMemory(memories),
      });
    }
  }

  const conversationMessages = await buildConversationMessages(messages);
  chatMessages.push(...conversationMessages);

  return chatMessages;
}

export { buildConversationMessages };
