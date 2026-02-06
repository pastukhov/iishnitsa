import * as FileSystem from "expo-file-system/legacy";
import { EndpointConfig, MessageAttachment } from "@/lib/store";
import { buildAuthHeaders, resolveBaseUrl } from "@/lib/providers";
import type { ProviderId } from "@/lib/providers";

const IMAGE_GEN_MODEL_PATTERNS = [
  /^dall-e-/i,
  /^gpt-image-/i,
  /stable-diffusion/i,
  /sdxl/i,
  /flux/i,
];

export function isImageGenerationModel(model: string): boolean {
  return IMAGE_GEN_MODEL_PATTERNS.some((pattern) => pattern.test(model));
}

const IMAGE_INTENT_PATTERNS = [
  // English (\b works with ASCII)
  /\b(generate|create|make|draw|paint|design|render)\b.{0,30}\b(image|picture|photo|illustration|icon|logo|art|artwork|portrait|sketch|diagram)\b/i,
  /\b(image|picture|photo|illustration|icon|logo|art|artwork|portrait|sketch)\b.{0,20}\b(of|with|showing|depicting|featuring)\b/i,
  /\bdraw\s+(me\s+)?/i,
  /\bgenerate\s+(an?\s+)?image\b/i,
  // Russian — \b не работает с кириллицей, используем (^|\s)
  /(^|\s)(нарисуй|нарисовать|сгенерируй|сгенерировать|создай|создать)\S*.{0,30}(картинк|изображени|фото|иллюстраци|иконк|логотип|портрет|арт)/i,
  /(^|\s)(нарисуй|нарисовать|нарисуйте)/i,
  /(^|\s)(сгенерируй|сгенерировать|сгенерируйте)\S*.{0,10}(картинк|изображени|фото)/i,
];

export function detectImageGenerationIntent(text: string): boolean {
  return IMAGE_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

const PROVIDER_DEFAULT_IMAGE_MODELS: Partial<Record<ProviderId, string>> = {
  openai: "dall-e-3",
  custom: "dall-e-3",
};

export function getDefaultImageModel(providerId: ProviderId): string | null {
  return PROVIDER_DEFAULT_IMAGE_MODELS[providerId] || null;
}

const IMAGES_DIR = `${FileSystem.documentDirectory || ""}chat_images/`;

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

async function ensureImagesDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(IMAGES_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(IMAGES_DIR, { intermediates: true });
  }
}

export async function saveGeneratedImage(
  base64Data: string,
  mimeType: string = "image/png",
): Promise<MessageAttachment> {
  await ensureImagesDir();
  const extension = mimeType.split("/")[1] || "png";
  const filename = `${generateId()}.${extension}`;
  const destPath = `${IMAGES_DIR}${filename}`;

  await FileSystem.writeAsStringAsync(destPath, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    id: generateId(),
    type: "image",
    uri: destPath,
    mimeType,
    width: 1024,
    height: 1024,
  };
}

interface ImageGenerationResult {
  attachment: MessageAttachment;
  revisedPrompt?: string;
}

export async function generateImage(
  endpoint: EndpointConfig,
  prompt: string,
): Promise<ImageGenerationResult> {
  const baseUrl = resolveBaseUrl(endpoint.providerId, endpoint.baseUrl);
  const url = `${baseUrl}/images/generations`;

  const model = endpoint.model || "dall-e-3";
  const isDalle2 = /dall-e-2/i.test(model);

  const requestBody: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    response_format: "b64_json",
  };

  if (!isDalle2) {
    requestBody.size = "1024x1024";
    requestBody.quality = "auto";
  } else {
    requestBody.size = "1024x1024";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(endpoint.providerId, endpoint.apiKey),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Image generation failed: ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const imageData = data.data?.[0];

  if (!imageData) {
    throw new Error("No image data in response");
  }

  if (imageData.b64_json) {
    const attachment = await saveGeneratedImage(
      imageData.b64_json,
      "image/png",
    );
    return {
      attachment,
      revisedPrompt: imageData.revised_prompt,
    };
  }

  if (imageData.url) {
    await ensureImagesDir();
    const downloadResult = await FileSystem.downloadAsync(
      imageData.url,
      `${IMAGES_DIR}${generateId()}.png`,
    );

    return {
      attachment: {
        id: generateId(),
        type: "image",
        uri: downloadResult.uri,
        mimeType: "image/png",
        width: 1024,
        height: 1024,
      },
      revisedPrompt: imageData.revised_prompt,
    };
  }

  throw new Error("Response contains neither b64_json nor url");
}
