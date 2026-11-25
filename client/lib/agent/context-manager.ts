import { EndpointConfig, Message, MessageAttachment } from "@/lib/store";
import { ChatCompletionMessage, ContentPart } from "@/lib/agent/types";
import { MemoryEntry, MemoryStore, type MemoryScope } from "@/lib/agent/memory";

interface ContextBuildInput {
  messages: Message[];
  endpoint: EndpointConfig;
  untrustedSkillContext?: string;
  systemPrompt?: string;
  chatPrompt?: string;
  memoryStore?: MemoryStore;
  memoryScope?: MemoryScope;
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
      const { getImageDataUrl } =
        // Attachment-only native loading must work in Metro, Node, and Jest.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("@/lib/image-utils") as typeof import("@/lib/image-utils");
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
  return JSON.stringify({
    type: "untrusted_memory_reference",
    memories: entries.map(({ type, content, provenance }) => ({
      type,
      content,
      provenance,
    })),
  });
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
  untrustedSkillContext,
  memoryStore,
  memoryScope,
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

  if (memoryStore && memoryScope) {
    const memories = await memoryStore.getRelevantMemories({
      scope: memoryScope,
      limit: memoryLimit ?? 8,
      minImportance: memoryMinImportance ?? 0.5,
    });
    if (memories.length > 0) {
      chatMessages.push({
        role: "user",
        content: formatMemory(memories),
      });
    }
  }

  if (untrustedSkillContext !== undefined) {
    chatMessages.push({ role: "user", content: untrustedSkillContext });
  }
  const conversationMessages = await buildConversationMessages(messages);
  chatMessages.push(...conversationMessages);

  return chatMessages;
}

export { buildConversationMessages };
