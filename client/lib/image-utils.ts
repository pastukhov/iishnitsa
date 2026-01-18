import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { MessageAttachment } from "@/lib/store";

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

async function saveImageToDocuments(
  uri: string,
  mimeType: string,
): Promise<string> {
  await ensureImagesDir();
  const extension = mimeType.split("/")[1] || "jpg";
  const filename = `${generateId()}.${extension}`;
  const destPath = `${IMAGES_DIR}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destPath });
  return destPath;
}

export async function pickImageFromLibrary(): Promise<MessageAttachment | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permission to access media library was denied");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.8,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const mimeType = asset.mimeType || "image/jpeg";
  const savedUri = await saveImageToDocuments(asset.uri, mimeType);

  return {
    id: generateId(),
    type: "image",
    uri: savedUri,
    mimeType,
    width: asset.width,
    height: asset.height,
  };
}

export async function pickImageFromCamera(): Promise<MessageAttachment | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permission to access camera was denied");
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.8,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const mimeType = asset.mimeType || "image/jpeg";
  const savedUri = await saveImageToDocuments(asset.uri, mimeType);

  return {
    id: generateId(),
    type: "image",
    uri: savedUri,
    mimeType,
    width: asset.width,
    height: asset.height,
  };
}

export async function imageToBase64(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64;
}

export async function getImageDataUrl(
  attachment: MessageAttachment,
): Promise<string> {
  const base64 = await imageToBase64(attachment.uri);
  return `data:${attachment.mimeType};base64,${base64}`;
}

export async function deleteImage(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri);
    }
  } catch (error) {
    console.warn("Failed to delete image:", error);
  }
}
