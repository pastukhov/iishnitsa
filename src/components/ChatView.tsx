import React, { useState, useRef, useEffect } from "react";
import { useStore, Message, ToolCall } from "../lib/store";
import { sendChatMessage, OpenAIMessage, MCPTool } from "../lib/api";
import { initializeMCPServer, callMCPTool, getMCPTools, clearMCPSession } from "../lib/mcp-client";
import "../styles/ChatView.css";

export default function ChatView() {
  const { getCurrentChat, addMessage, updateMessage, settings } = useStore();
  const chat = getCurrentChat();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages, streamingContent]);

  useEffect(() => {
    if (!settings.mcpEnabled || settings.mcpServers.length === 0) {
      setMcpTools([]);
      setMcpError(null);
      return;
    }

    const enabledServers = settings.mcpServers.filter((s) => s.enabled);
    if (enabledServers.length === 0) {
      setMcpTools([]);
      return;
    }

    const initServers = async () => {
      const allTools: MCPTool[] = [];
      setMcpError(null);

      for (const server of enabledServers) {
        try {
          const tools = await initializeMCPServer(server.url);
          allTools.push(...tools);
        } catch (error: any) {
          console.error(`Failed to init MCP server ${server.name}:`, error);
          setMcpError(`Failed to connect to ${server.name}: ${error.message}`);
        }
      }

      setMcpTools(allTools);
    };

    initServers();

    return () => {
      for (const server of enabledServers) {
        clearMCPSession(server.url);
      }
    };
  }, [settings.mcpEnabled, settings.mcpServers]);

  const findServerForTool = (toolName: string): string | null => {
    for (const server of settings.mcpServers.filter((s) => s.enabled)) {
      const tools = getMCPTools(server.url);
      if (tools.some((t) => t.name === toolName)) {
        return server.url;
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !chat || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    addMessage(chat.id, { role: "user", content: userMessage });

    const messages: OpenAIMessage[] = [];
    if (settings.systemPrompt) {
      messages.push({ role: "system", content: settings.systemPrompt });
    }
    for (const msg of chat.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: "user", content: userMessage });

    try {
      let response = await sendChatMessage(
        settings.baseUrl,
        settings.apiKey,
        settings.model,
        messages,
        settings.mcpEnabled && mcpTools.length > 0 ? mcpTools : undefined,
        (chunk) => setStreamingContent((prev) => prev + chunk)
      );

      while (response.toolCalls && response.toolCalls.length > 0) {
        setStreamingContent("");

        for (const tc of response.toolCalls) {
          const serverUrl = findServerForTool(tc.name);
          if (!serverUrl) {
            tc.result = { error: `Tool ${tc.name} not found` };
            continue;
          }

          try {
            tc.result = await callMCPTool(serverUrl, tc.name, tc.arguments);
          } catch (error: any) {
            tc.result = { error: error.message };
          }
        }

        const toolResultsContent = response.toolCalls
          .map((tc) => `Tool: ${tc.name}\nResult: ${JSON.stringify(tc.result, null, 2)}`)
          .join("\n\n");

        messages.push({
          role: "assistant",
          content: response.content || "",
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        for (const tc of response.toolCalls) {
          messages.push({
            role: "user",
            content: `Tool result for ${tc.name}: ${JSON.stringify(tc.result)}`,
          } as any);
        }

        response = await sendChatMessage(
          settings.baseUrl,
          settings.apiKey,
          settings.model,
          messages,
          settings.mcpEnabled && mcpTools.length > 0 ? mcpTools : undefined,
          (chunk) => setStreamingContent((prev) => prev + chunk)
        );
      }

      addMessage(chat.id, { role: "assistant", content: response.content });
    } catch (error: any) {
      console.error("Chat error:", error);
      addMessage(chat.id, {
        role: "assistant",
        content: `Error: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!chat) {
    return (
      <div className="chat-empty">
        <p>No chat selected</p>
      </div>
    );
  }

  return (
    <div className="chat-container">
      {mcpError && <div className="mcp-error">{mcpError}</div>}
      {settings.mcpEnabled && mcpTools.length > 0 && (
        <div className="mcp-tools-badge">
          {mcpTools.length} MCP tool{mcpTools.length !== 1 ? "s" : ""} available
        </div>
      )}

      <div className="messages-container">
        {chat.messages.length === 0 && !streamingContent && (
          <div className="chat-welcome">
            <h2>Start a conversation</h2>
            <p>Type a message below to begin</p>
          </div>
        )}

        {chat.messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-content">
              {msg.content.split("\n").map((line, i) => (
                <p key={i}>{line || "\u00A0"}</p>
              ))}
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="message assistant">
            <div className="message-content">
              {streamingContent.split("\n").map((line, i) => (
                <p key={i}>{line || "\u00A0"}</p>
              ))}
              <span className="cursor" />
            </div>
          </div>
        )}

        {isLoading && !streamingContent && (
          <div className="message assistant">
            <div className="message-content loading">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="input-container" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isLoading}
          rows={1}
        />
        <button type="submit" disabled={!input.trim() || isLoading}>
          Send
        </button>
      </form>
    </div>
  );
}
