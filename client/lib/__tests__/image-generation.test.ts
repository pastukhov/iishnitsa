import * as FileSystem from "expo-file-system/legacy";
import {
  isImageGenerationModel,
  saveGeneratedImage,
  generateImage,
} from "../image-generation";
import type { EndpointConfig } from "../store";

const mockFetch = global.fetch as jest.Mock;

describe("image-generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isImageGenerationModel", () => {
    it("returns true for dall-e models", () => {
      expect(isImageGenerationModel("dall-e-2")).toBe(true);
      expect(isImageGenerationModel("dall-e-3")).toBe(true);
      expect(isImageGenerationModel("DALL-E-3")).toBe(true);
    });

    it("returns true for gpt-image models", () => {
      expect(isImageGenerationModel("gpt-image-1")).toBe(true);
      expect(isImageGenerationModel("GPT-IMAGE-2")).toBe(true);
    });

    it("returns true for stable-diffusion models", () => {
      expect(isImageGenerationModel("stable-diffusion-xl")).toBe(true);
      expect(isImageGenerationModel("stabilityai/stable-diffusion-2")).toBe(
        true,
      );
    });

    it("returns true for sdxl models", () => {
      expect(isImageGenerationModel("sdxl-turbo")).toBe(true);
      expect(isImageGenerationModel("SDXL-1.0")).toBe(true);
    });

    it("returns true for flux models", () => {
      expect(isImageGenerationModel("flux-schnell")).toBe(true);
      expect(isImageGenerationModel("black-forest-labs/flux")).toBe(true);
    });

    it("returns false for non-image models", () => {
      expect(isImageGenerationModel("gpt-4")).toBe(false);
      expect(isImageGenerationModel("claude-3-opus")).toBe(false);
      expect(isImageGenerationModel("llama-2-70b")).toBe(false);
    });
  });

  describe("saveGeneratedImage", () => {
    it("saves base64 image and returns attachment", async () => {
      const result = await saveGeneratedImage("base64data", "image/png");

      expect(FileSystem.getInfoAsync).toHaveBeenCalled();
      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringContaining("chat_images/"),
        "base64data",
        { encoding: "base64" },
      );
      expect(result).toMatchObject({
        type: "image",
        mimeType: "image/png",
        width: 1024,
        height: 1024,
      });
      expect(result.id).toBeDefined();
      expect(result.uri).toContain("chat_images/");
    });

    it("creates directory if not exists", async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({
        exists: false,
      });

      await saveGeneratedImage("base64data");

      expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
        expect.stringContaining("chat_images/"),
        { intermediates: true },
      );
    });

    it("uses correct extension from mimeType", async () => {
      await saveGeneratedImage("base64data", "image/jpeg");

      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringMatching(/\.jpeg$/),
        "base64data",
        { encoding: "base64" },
      );
    });

    it("defaults to png extension", async () => {
      await saveGeneratedImage("base64data");

      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringMatching(/\.png$/),
        "base64data",
        { encoding: "base64" },
      );
    });
  });

  describe("generateImage", () => {
    const mockEndpoint: EndpointConfig = {
      providerId: "openai",
      apiKey: "test-api-key",
      model: "dall-e-3",
    };

    it("generates image with b64_json response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                b64_json: "mockBase64Image",
                revised_prompt: "A beautiful landscape",
              },
            ],
          }),
      });

      const result = await generateImage(mockEndpoint, "draw a landscape");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/images/generations",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody).toMatchObject({
        model: "dall-e-3",
        prompt: "draw a landscape",
        n: 1,
        response_format: "b64_json",
        size: "1024x1024",
        quality: "auto",
      });

      expect(result.attachment).toMatchObject({
        type: "image",
        mimeType: "image/png",
      });
      expect(result.revisedPrompt).toBe("A beautiful landscape");
    });

    it("generates image with url response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                url: "https://example.com/image.png",
                revised_prompt: "A cat",
              },
            ],
          }),
      });

      const result = await generateImage(mockEndpoint, "draw a cat");

      expect(FileSystem.downloadAsync).toHaveBeenCalledWith(
        "https://example.com/image.png",
        expect.stringContaining("chat_images/"),
      );
      expect(result.attachment.uri).toBe(
        "file:///mock/documents/downloaded.png",
      );
      expect(result.revisedPrompt).toBe("A cat");
    });

    it("uses dall-e-2 specific settings", async () => {
      const dalle2Endpoint: EndpointConfig = {
        ...mockEndpoint,
        model: "dall-e-2",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ b64_json: "mockBase64" }],
          }),
      });

      await generateImage(dalle2Endpoint, "test prompt");

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.model).toBe("dall-e-2");
      expect(requestBody.size).toBe("1024x1024");
      expect(requestBody.quality).toBeUndefined();
    });

    it("uses default model when not specified", async () => {
      const noModelEndpoint: EndpointConfig = {
        providerId: "openai",
        apiKey: "test-key",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ b64_json: "mockBase64" }],
          }),
      });

      await generateImage(noModelEndpoint, "test");

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.model).toBe("dall-e-3");
    });

    it("throws error on API failure with JSON error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { message: "Invalid prompt" } }),
          ),
      });

      await expect(generateImage(mockEndpoint, "bad prompt")).rejects.toThrow(
        "Invalid prompt",
      );
    });

    it("throws error on API failure with text error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal server error"),
      });

      await expect(generateImage(mockEndpoint, "test")).rejects.toThrow(
        "Internal server error",
      );
    });

    it("throws error on API failure with empty response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve(""),
      });

      await expect(generateImage(mockEndpoint, "test")).rejects.toThrow(
        "Image generation failed: 503",
      );
    });

    it("throws error when no image data in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      await expect(generateImage(mockEndpoint, "test")).rejects.toThrow(
        "No image data in response",
      );
    });

    it("throws error when response has neither b64_json nor url", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ some_other_field: "value" }],
          }),
      });

      await expect(generateImage(mockEndpoint, "test")).rejects.toThrow(
        "Response contains neither b64_json nor url",
      );
    });

    it("ensures directory exists before downloading", async () => {
      const callOrder: string[] = [];
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({
        exists: false,
      });
      (FileSystem.makeDirectoryAsync as jest.Mock).mockImplementationOnce(
        () => {
          callOrder.push("makeDirectoryAsync");
          return Promise.resolve();
        },
      );
      (FileSystem.downloadAsync as jest.Mock).mockImplementationOnce(() => {
        callOrder.push("downloadAsync");
        return Promise.resolve({ uri: "file:///mock/downloaded.png" });
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ url: "https://example.com/image.png" }],
          }),
      });

      await generateImage(mockEndpoint, "test");

      expect(callOrder).toEqual(["makeDirectoryAsync", "downloadAsync"]);
    });
  });
});
