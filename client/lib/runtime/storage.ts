/** Minimal per-instance persistence port; importing it never initializes native code. */
export interface RuntimeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function loadNativeStorage(): RuntimeStorage {
  // Native storage loads only on use; local require works in Metro, Node, and Jest.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require("@react-native-async-storage/async-storage") as
    | { default: RuntimeStorage }
    | RuntimeStorage;
  return "default" in loaded ? loaded.default : loaded;
}

export const nativeStorage: RuntimeStorage = Object.freeze({
  async getItem(key: string) {
    return loadNativeStorage().getItem(key);
  },
  async setItem(key: string, value: string) {
    await loadNativeStorage().setItem(key, value);
  },
});
