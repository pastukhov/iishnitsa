import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  pickImageFromLibrary,
  pickImageFromCamera,
  imageToBase64,
  getImageDataUrl,
  deleteImage,
} from "../image-utils";

describe("image-utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default granted permissions
    (
      ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
    ).mockResolvedValue({
      status: "granted",
    });
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "granted",
    });
  });

  describe("pickImageFromLibrary", () => {
    it("should return null when user cancels", async () => {
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: true,
        assets: [],
      });

      const result = await pickImageFromLibrary();

      expect(result).toBeNull();
      expect(
        ImagePicker.requestMediaLibraryPermissionsAsync,
      ).toHaveBeenCalled();
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    });

    it("should return attachment when image is selected", async () => {
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: "file:///test/image.jpg",
            mimeType: "image/jpeg",
            width: 800,
            height: 600,
          },
        ],
      });
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
      });

      const result = await pickImageFromLibrary();

      expect(result).not.toBeNull();
      expect(result?.type).toBe("image");
      expect(result?.mimeType).toBe("image/jpeg");
      expect(result?.width).toBe(800);
      expect(result?.height).toBe(600);
      expect(FileSystem.copyAsync).toHaveBeenCalled();
    });

    it("should throw error when permission denied", async () => {
      (
        ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
      ).mockResolvedValue({
        status: "denied",
      });

      await expect(pickImageFromLibrary()).rejects.toThrow(
        "Permission to access media library was denied",
      );
    });

    it("should create directory if it does not exist", async () => {
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: "file:///test/image.jpg",
            mimeType: "image/jpeg",
            width: 800,
            height: 600,
          },
        ],
      });
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: false,
      });

      await pickImageFromLibrary();

      expect(FileSystem.makeDirectoryAsync).toHaveBeenCalled();
    });

    it("should use default mime type when not provided", async () => {
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: "file:///test/image.jpg",
            width: 800,
            height: 600,
          },
        ],
      });
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
      });

      const result = await pickImageFromLibrary();

      expect(result?.mimeType).toBe("image/jpeg");
    });
  });

  describe("pickImageFromCamera", () => {
    it("should return null when user cancels", async () => {
      (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
        canceled: true,
        assets: [],
      });

      const result = await pickImageFromCamera();

      expect(result).toBeNull();
      expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
    });

    it("should return attachment when photo is taken", async () => {
      (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: "file:///test/photo.jpg",
            mimeType: "image/jpeg",
            width: 1920,
            height: 1080,
          },
        ],
      });
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
      });

      const result = await pickImageFromCamera();

      expect(result).not.toBeNull();
      expect(result?.type).toBe("image");
    });

    it("should throw error when camera permission denied", async () => {
      (
        ImagePicker.requestCameraPermissionsAsync as jest.Mock
      ).mockResolvedValue({
        status: "denied",
      });

      await expect(pickImageFromCamera()).rejects.toThrow(
        "Permission to access camera was denied",
      );
    });
  });

  describe("imageToBase64", () => {
    it("should read file as base64 string", async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(
        "base64EncodedData",
      );

      const result = await imageToBase64("file:///test/image.jpg");

      expect(result).toBe("base64EncodedData");
      expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(
        "file:///test/image.jpg",
        { encoding: "base64" },
      );
    });
  });

  describe("getImageDataUrl", () => {
    it("should return data URL with correct format", async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("abc123");

      const result = await getImageDataUrl({
        id: "1",
        type: "image",
        uri: "file:///test/image.png",
        mimeType: "image/png",
      });

      expect(result).toBe("data:image/png;base64,abc123");
    });
  });

  describe("deleteImage", () => {
    it("should delete existing file", async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
      });

      await deleteImage("file:///test/image.jpg");

      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
        "file:///test/image.jpg",
      );
    });

    it("should not delete non-existing file", async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: false,
      });

      await deleteImage("file:///test/nonexistent.jpg");

      expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    });

    it("should handle delete errors gracefully", async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockRejectedValue(
        new Error("Access denied"),
      );
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      await deleteImage("file:///test/image.jpg");

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
