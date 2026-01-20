export type AgentState =
  | "IDLE"
  | "RECEIVE_INPUT"
  | "BUILD_CONTEXT"
  | "THINK"
  | "DECIDE"
  | "ACT"
  | "OBSERVE"
  | "UPDATE_STATE";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface OpenAIFunction {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface AgentDecision {
  model: string;
  toolChoice?: "auto" | "none";
}
