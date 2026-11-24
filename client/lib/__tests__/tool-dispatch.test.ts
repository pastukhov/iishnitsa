import { requestImageGeneration } from "@/lib/tool-dispatch";
import { generateImage } from "@/lib/image-generation";
import { ToolPolicyDeniedError } from "@/lib/agent/tool-policy";
import type { EndpointConfig } from "@/lib/store";

jest.mock("@/lib/image-generation", () => ({ generateImage: jest.fn() }));
const generate = jest.mocked(generateImage);
const endpoint: EndpointConfig = {
  baseUrl: "https://images.invalid/v1",
  apiKey: "fake-key",
  model: "fake-image-model",
  providerId: "custom",
};

describe("requestImageGeneration", () => {
  beforeEach(() => jest.clearAllMocks());

  it("denies the direct image path without invoking the adapter", async () => {
    await expect(
      requestImageGeneration(endpoint, "a circle"),
    ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(generate).not.toHaveBeenCalled();
  });

  it("denies a registered mutation without a confirmation handler", async () => {
    await expect(
      requestImageGeneration(endpoint, "a circle", {
        registry: [
          {
            target: { kind: "builtin", name: "generate_image", endpoint },
            risk: "mutating",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(generate).not.toHaveBeenCalled();
  });

  it("denies changed endpoint identity while confirmation is pending", async () => {
    const currentEndpoint = { ...endpoint };
    await expect(
      requestImageGeneration(currentEndpoint, "a circle", {
        registry: [
          {
            target: {
              kind: "builtin",
              name: "generate_image",
              endpoint: currentEndpoint,
            },
            risk: "mutating",
          },
        ],
        requestApproval: (request) => {
          currentEndpoint.baseUrl = "https://different.invalid/v1";
          return { decision: "approve", request };
        },
      }),
    ).rejects.toBeInstanceOf(ToolPolicyDeniedError);
    expect(generate).not.toHaveBeenCalled();
  });

  it("executes exactly once after exact confirmation and returns the result", async () => {
    const result = {
      attachment: {
        type: "image" as const,
        uri: "file:///fake.png",
        id: "fake",
      },
    };
    generate.mockResolvedValue(result);
    const requestApproval = jest.fn((request) => ({
      decision: "approve" as const,
      request,
    }));
    await expect(
      requestImageGeneration(endpoint, "a circle", {
        registry: [
          {
            target: { kind: "builtin", name: "generate_image", endpoint },
            risk: "mutating",
          },
        ],
        requestApproval,
      }),
    ).resolves.toBe(result);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(endpoint, "a circle");
    expect(generate.mock.calls[0][0]).not.toBe(endpoint);
  });
});
