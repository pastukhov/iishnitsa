import { EndpointConfig, Message } from "@/lib/store";
import {
  AgentDecision,
  ModelCapabilities,
  ModelCatalogEntry,
  OpenAIFunction,
} from "@/lib/agent/types";
import {
  getModelCandidates,
  getProviderDefaultCapabilities,
} from "@/lib/agent/model-registry";

interface DecisionInput {
  endpoint: EndpointConfig;
  messages: Message[];
  tools: OpenAIFunction[];
  mcpEnabled: boolean;
}

function hasImageAttachments(messages: Message[]): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      message.attachments?.some((attachment) => attachment.type === "image"),
  );
}

function matchesRequirements(
  capabilities: ModelCapabilities,
  requirements: {
    needsVision: boolean;
    needsTools: boolean;
    needsStreaming: boolean;
  },
): boolean {
  if (requirements.needsVision && !capabilities.supportsVision) {
    return false;
  }
  if (requirements.needsTools && !capabilities.supportsTools) {
    return false;
  }
  if (requirements.needsStreaming && !capabilities.supportsStreaming) {
    return false;
  }
  return true;
}

function buildEndpointCandidate(endpoint: EndpointConfig): ModelCatalogEntry {
  return {
    model: endpoint.model,
    providerId: endpoint.providerId,
    capabilities: getProviderDefaultCapabilities(endpoint.providerId),
    priority: -1,
  };
}

export function decideAgentAction({
  endpoint,
  messages,
  tools,
  mcpEnabled,
}: DecisionInput): AgentDecision {
  const needsVision = hasImageAttachments(messages);
  const needsTools = mcpEnabled && tools.length > 0;
  const needsStreaming = true;

  const requirements = { needsVision, needsTools, needsStreaming };
  const candidates = getModelCandidates(endpoint);
  const endpointCandidateFromRegistry = candidates.find(
    (candidate) => candidate.model === endpoint.model,
  );
  const endpointCandidate =
    endpointCandidateFromRegistry || buildEndpointCandidate(endpoint);

  const orderedCandidates = [
    endpointCandidate,
    ...candidates.filter((candidate) => candidate !== endpointCandidate),
  ];

  const selectedCandidate =
    orderedCandidates.find((candidate) =>
      matchesRequirements(candidate.capabilities, requirements),
    ) || endpointCandidate;

  const canUseTools =
    needsTools && selectedCandidate.capabilities.supportsTools;
  const toolChoice = canUseTools ? "auto" : "none";
  const mode = toolChoice === "auto" ? "tool" : "chat";

  const reason =
    selectedCandidate !== endpointCandidate
      ? "fallback_model_selected"
      : undefined;

  return {
    model: selectedCandidate.model,
    toolChoice,
    mode,
    capabilities: selectedCandidate.capabilities,
    reason,
  };
}
