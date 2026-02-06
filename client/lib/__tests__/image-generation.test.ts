import * as FileSystem from "expo-file-system/legacy";
import {
  isImageGenerationModel,
  detectImageGenerationIntent,
  getDefaultImageModel,
  saveGeneratedImage,
  generateImage,
} from "../image-generation";

describe("image-generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
  });

  describe("isImageGenerationModel", () => {
    it("should detect dall-e models", () => {
      expect(isImageGenerationModel("dall-e-3")).toBe(true);
      expect(isImageGenerationModel("dall-e-2")).toBe(true);
      expect(isImageGenerationModel("DALL-E-3")).toBe(true);
    });

    it("should detect gpt-image models", () => {
      expect(isImageGenerationModel("gpt-image-1")).toBe(true);
    });

    it("should detect stable-diffusion models", () => {
      expect(isImageGenerationModel("stable-diffusion-xl")).toBe(true);
      expect(isImageGenerationModel("stabilityai/stable-diffusion-3")).toBe(
        true,
      );
    });

    it("should detect sdxl and flux models", () => {
      expect(isImageGenerationModel("sdxl-turbo")).toBe(true);
      expect(isImageGenerationModel("flux-schnell")).toBe(true);
    });

    it("should return false for chat models", () => {
      expect(isImageGenerationModel("gpt-4o")).toBe(false);
      expect(isImageGenerationModel("gpt-4o-mini")).toBe(false);
      expect(isImageGenerationModel("claude-3-opus")).toBe(false);
    });
  });

  describe("detectImageGenerationIntent", () => {
    it("should detect English image generation requests", () => {
      expect(detectImageGenerationIntent("generate an image of a cat")).toBe(
        true,
      );
      expect(detectImageGenerationIntent("draw me a landscape")).toBe(true);
      expect(detectImageGenerationIntent("create a picture of sunset")).toBe(
        true,
      );
      expect(
        detectImageGenerationIntent("make an illustration of a robot"),
      ).toBe(true);
    });

    it("should detect Russian image generation requests", () => {
      expect(detectImageGenerationIntent("Нарисуй картинку с осминога")).toBe(
        true,
      );
      expect(detectImageGenerationIntent("нарисуй кота")).toBe(true);
      expect(detectImageGenerationIntent("сгенерируй изображение заката")).toBe(
        true,
      );
      expect(detectImageGenerationIntent("нарисуйте мне портрет")).toBe(true);
    });

    it("should not detect non-image requests", () => {
      expect(detectImageGenerationIntent("what is the weather today?")).toBe(
        false,
      );
      expect(detectImageGenerationIntent("расскажи мне о космосе")).toBe(false);
      expect(detectImageGenerationIntent("hello")).toBe(false);
    });
  });

  describe("getDefaultImageModel", () => {
    it("should return dall-e-3 for openai", () => {
      expect(getDefaultImageModel("openai")).toBe("dall-e-3");
    });

    it("should return dall-e-3 for custom provider", () => {
      expect(getDefaultImageModel("custom")).toBe("dall-e-3");
    });

    it("should return null for unsupported providers", () => {
      expect(getDefaultImageModel("anthropic")).toBeNull();
      expect(getDefaultImageModel("together")).toBeNull();
      expect(getDefaultImageModel("mistral")).toBeNull();
    });
  });

  describe("saveGeneratedImage", () => {
    it("should save base64 data to file and return attachment", async () => {
      const result = await saveGeneratedImage("base64data", "image/png");

      expect(result.type).toBe("image");
      expect(result.mimeType).toBe("image/png");
      expect(result.uri).toContain("chat_images/");
      expect(result.uri).toContain(".png");
      expect((FileSystem as any).writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringContaining(".png"),
        "base64data",
        { encoding: "base64" },
      );
    });

    it("should create directory if not exists", async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: false,
      });

      await saveGeneratedImage("data", "image/jpeg");

      expect(FileSystem.makeDirectoryAsync).toHaveBeenCalled();
    });
  });

  describe("generateImage", () => {
    const endpoint = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "dall-e-3",
      providerId: "openai" as const,
    };

    it("should call images/generations endpoint and return b64_json result", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                b64_json: "imageBase64Data",
                revised_prompt: "A cute cat sitting",
              },
            ],
          }),
      });

      const result = await generateImage(endpoint, "a cute cat");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/images/generations",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"model":"dall-e-3"'),
        }),
      );
      expect(result.attachment.type).toBe("image");
      expect(result.revisedPrompt).toBe("A cute cat sitting");
    });

    it("should handle url response format", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                url: "https://example.com/image.png",
                revised_prompt: "A dog",
              },
            ],
          }),
      });

      const result = await generateImage(endpoint, "a dog");

      expect((FileSystem as any).downloadAsync).toHaveBeenCalledWith(
        "https://example.com/image.png",
        expect.stringContaining("chat_images/"),
      );
      expect(result.attachment.type).toBe("image");
      expect(result.revisedPrompt).toBe("A dog");
    });

    it("should throw on API error", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: { message: "Invalid prompt" },
            }),
          ),
      });

      await expect(generateImage(endpoint, "bad prompt")).rejects.toThrow(
        "Invalid prompt",
      );
    });

    it("should throw when response has no image data", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      await expect(generateImage(endpoint, "test")).rejects.toThrow(
        "No image data in response",
      );
    });

    it("should throw when response has neither b64_json nor url", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{}] }),
      });

      await expect(generateImage(endpoint, "test")).rejects.toThrow(
        "Response contains neither b64_json nor url",
      );
    });

    it("should use dall-e-2 settings for dall-e-2 model", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ b64_json: "data" }],
          }),
      });

      const dalle2Endpoint = { ...endpoint, model: "dall-e-2" };
      await generateImage(dalle2Endpoint, "test");

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.model).toBe("dall-e-2");
      expect(body.quality).toBeUndefined();
    });

    it("should fallback to dall-e-3 when model is empty", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ b64_json: "data" }],
          }),
      });

      const noModelEndpoint = { ...endpoint, model: "" };
      await generateImage(noModelEndpoint, "test");

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.model).toBe("dall-e-3");
    });

    it("should handle non-JSON error response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(generateImage(endpoint, "test")).rejects.toThrow(
        "Internal Server Error",
      );
    });
  });
});
