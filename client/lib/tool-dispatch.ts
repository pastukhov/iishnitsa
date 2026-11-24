import type { EndpointConfig } from "@/lib/store";
import { generateImage } from "@/lib/image-generation";
import {
  createToolExecutionPolicy,
  ToolPolicyDeniedError,
  type ToolPolicyOptions,
} from "@/lib/agent/tool-policy";

/** Direct UI image requests use the same confirmation boundary as agent tools. */
export async function requestImageGeneration(
  endpoint: EndpointConfig,
  prompt: string,
  toolPolicy?: ToolPolicyOptions,
) {
  const policy = createToolExecutionPolicy(toolPolicy);
  try {
    return await policy.execute(
      { kind: "builtin", name: "generate_image", endpoint },
      { prompt },
      async (target, args) => {
        if (target.kind !== "builtin" || typeof args.prompt !== "string") {
          throw new ToolPolicyDeniedError();
        }
        return generateImage(target.endpoint, args.prompt);
      },
    );
  } finally {
    policy.close();
  }
}
