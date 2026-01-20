const loadAppInfo = (constantsMock: any) => {
  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: constantsMock,
  }));
  jest.unmock("@/lib/app-info");
  return require("@/lib/app-info").appInfo;
};

describe("app-info", () => {
  afterEach(() => {
    jest.dontMock("expo-constants");
  });

  it("uses expoConfig when available", () => {
    const appInfo = loadAppInfo({
      expoConfig: {
        name: "Test App",
        version: "1.2.3",
        android: { versionCode: 42 },
      },
      manifest: null,
    });

    expect(appInfo).toEqual({
      name: "Test App",
      version: "1.2.3",
      androidVersionCode: 42,
    });
  });

  it("falls back to defaults", () => {
    const appInfo = loadAppInfo({
      expoConfig: undefined,
      manifest: {},
    });

    expect(appInfo).toEqual({
      name: "Iishnitsa",
      version: "0.0.0",
      androidVersionCode: undefined,
    });
  });
});
