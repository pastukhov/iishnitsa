import { EndpointConfig, Message } from "@/lib/store";
import {
  AgentDecision,
  ModelCapabilities,
  ModelCatalogEntry,
  ModelTier,
  OpenAIFunction,
} from "@/lib/agent/types";
import {
  getModelCandidates,
  getProviderDefaultCapabilities,
  getProviderDefaultModel,
  getModelTier,
} from "@/lib/agent/model-registry";

type ComplexityLevel = "simple" | "moderate" | "complex";

interface ComplexityAnalysis {
  level: ComplexityLevel;
  requiredTier: ModelTier;
  reasons: string[];
}

const COMPLEXITY_PATTERNS = {
  complex: [
    /\b(analyze|анализ|разбор|explain in detail|объясни подробно)\b/i,
    /\b(code|код|program|программ|debug|отладк|refactor|рефакторинг)\b/i,
    /\b(compare|сравни|evaluate|оцени|critique|критик)\b/i,
    /\b(plan|план|strategy|стратеги|architecture|архитектур)\b/i,
    /\b(research|исследова|investigate|расслед)\b/i,
    /\b(summarize a (long|больш)|резюмируй длинн)\b/i,
    /\b(write (an?|a long)|напиши (длинн|больш))\b/i,
    /\b(multiple|несколько|various|различн).{0,30}(step|шаг|task|задач)\b/i,
  ],
  moderate: [
    /\b(explain|объясни|describe|опиши|how does|как работает)\b/i,
    /\b(create|создай|generate|сгенерируй|write|напиши)\b/i,
    /\b(fix|исправь|improve|улучши|modify|измени)\b/i,
    /\b(translate|переведи|convert|преобразуй)\b/i,
    /\b(list|перечисли|enumerate|перечень)\b/i,
  ],
};

function analyzeMessageComplexity(content: string): ComplexityAnalysis {
  const reasons: string[] = [];

  // Check message length
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount > 200) {
    reasons.push("long_message");
  }

  // Check for code blocks
  if (/```[\s\S]*```/.test(content)) {
    reasons.push("contains_code");
  }

  // Check for complex patterns
  let complexPatternMatches = 0;
  for (const pattern of COMPLEXITY_PATTERNS.complex) {
    if (pattern.test(content)) {
      complexPatternMatches++;
      reasons.push("complex_task_pattern");
    }
  }

  // Check for moderate patterns
  let moderatePatternMatches = 0;
  for (const pattern of COMPLEXITY_PATTERNS.moderate) {
    if (pattern.test(content)) {
      moderatePatternMatches++;
    }
  }

  // Check for multiple questions
  const questionMarks = (content.match(/\?/g) || []).length;
  if (questionMarks > 2) {
    reasons.push("multiple_questions");
  }

  // Determine complexity level
  let level: ComplexityLevel = "simple";
  let requiredTier: ModelTier = "cheap";

  if (
    complexPatternMatches >= 2 ||
    (complexPatternMatches >= 1 && wordCount > 100) ||
    reasons.includes("contains_code") ||
    questionMarks > 3
  ) {
    level = "complex";
    requiredTier = "premium";
  } else if (
    complexPatternMatches >= 1 ||
    moderatePatternMatches >= 2 ||
    wordCount > 100 ||
    questionMarks > 1
  ) {
    level = "moderate";
    requiredTier = "standard";
  }

  return { level, requiredTier, reasons };
}

function getLatestUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content) {
      return messages[i].content;
    }
  }
  return "";
}

function analyzeQueryComplexity(messages: Message[]): ComplexityAnalysis {
  const latestMessage = getLatestUserMessage(messages);
  if (!latestMessage) {
    return { level: "simple", requiredTier: "cheap", reasons: [] };
  }

  return analyzeMessageComplexity(latestMessage);
}

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

function buildEndpointCandidate(
  endpoint: EndpointConfig,
  model?: string,
): ModelCatalogEntry {
  const modelName = model || endpoint.model;
  const tier = getModelTier(endpoint.providerId, modelName);
  const baseCapabilities = getProviderDefaultCapabilities(endpoint.providerId);
  return {
    model: modelName,
    providerId: endpoint.providerId,
    capabilities: { ...baseCapabilities, tier },
    priority: -1,
  };
}

const TIER_PRIORITY: Record<ModelTier, number> = {
  cheap: 0,
  standard: 1,
  premium: 2,
};

function tierMatchesRequirement(
  candidateTier: ModelTier | undefined,
  requiredTier: ModelTier,
): boolean {
  const candidatePriority = TIER_PRIORITY[candidateTier || "standard"];
  const requiredPriority = TIER_PRIORITY[requiredTier];
  return candidatePriority >= requiredPriority;
}

function selectModelByComplexity(
  candidates: ModelCatalogEntry[],
  requiredTier: ModelTier,
  requirements: {
    needsVision: boolean;
    needsTools: boolean;
    needsStreaming: boolean;
  },
): ModelCatalogEntry | null {
  // Sort candidates by tier (cheapest first that meets requirement)
  const sortedCandidates = [...candidates].sort((a, b) => {
    const aTier = TIER_PRIORITY[a.capabilities.tier || "standard"];
    const bTier = TIER_PRIORITY[b.capabilities.tier || "standard"];
    return aTier - bTier;
  });

  // Find the cheapest model that meets both tier and capability requirements
  for (const candidate of sortedCandidates) {
    if (
      matchesRequirements(candidate.capabilities, requirements) &&
      tierMatchesRequirement(candidate.capabilities.tier, requiredTier)
    ) {
      return candidate;
    }
  }

  return null;
}

export function decideAgentAction({
  endpoint,
  messages,
  tools,
  mcpEnabled,
}: DecisionInput): AgentDecision {
  const needsVision = hasImageAttachments(messages);
  const needsTools = tools.length > 0;
  const needsStreaming = true;
  const isAutoMode = !endpoint.model || endpoint.model.trim() === "";

  const requirements = { needsVision, needsTools, needsStreaming };
  const candidates = getModelCandidates(endpoint);

  let selectedCandidate: ModelCatalogEntry;
  let reason: string | undefined;

  if (isAutoMode) {
    // Auto mode: select model based on query complexity
    const complexity = analyzeQueryComplexity(messages);

    // Try to find a model that matches complexity requirements
    const autoSelected = selectModelByComplexity(
      candidates,
      complexity.requiredTier,
      requirements,
    );

    if (autoSelected) {
      selectedCandidate = autoSelected;
      reason = `auto_selected_${complexity.level}`;
    } else if (candidates.length > 0) {
      // Fallback to first available candidate
      selectedCandidate = candidates[0];
      reason = "auto_fallback";
    } else {
      // No candidates in registry, use provider's default model
      const defaultModel = getProviderDefaultModel(
        endpoint.providerId,
        endpoint.folderId,
      );
      if (defaultModel) {
        selectedCandidate = buildEndpointCandidate(endpoint, defaultModel);
        reason = "auto_default_model";
      } else {
        // No default model for this provider
        const defaultCapabilities = getProviderDefaultCapabilities(
          endpoint.providerId,
        );
        return {
          model: "",
          toolChoice: "none",
          mode: "chat",
          capabilities: defaultCapabilities,
          reason: "no_models_available",
        };
      }
    }
  } else {
    // Manual mode: use the specified model
    const endpointCandidateFromRegistry = candidates.find(
      (candidate) => candidate.model === endpoint.model,
    );
    const endpointCandidate =
      endpointCandidateFromRegistry || buildEndpointCandidate(endpoint);

    const orderedCandidates = [
      endpointCandidate,
      ...candidates.filter((candidate) => candidate !== endpointCandidate),
    ];

    selectedCandidate =
      orderedCandidates.find((candidate) =>
        matchesRequirements(candidate.capabilities, requirements),
      ) || endpointCandidate;

    reason =
      selectedCandidate !== endpointCandidate
        ? "fallback_model_selected"
        : undefined;
  }

  const canUseTools =
    needsTools && selectedCandidate.capabilities.supportsTools;
  const toolChoice = canUseTools ? "auto" : "none";
  const mode = toolChoice === "auto" ? "tool" : "chat";

  return {
    model: selectedCandidate.model,
    toolChoice,
    mode,
    capabilities: selectedCandidate.capabilities,
    reason,
  };
}
