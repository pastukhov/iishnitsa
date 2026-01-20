const loadLanguageCode = (localizationMock: any) => {
  jest.resetModules();
  jest.doMock("expo-localization", () => ({
    __esModule: true,
    ...localizationMock,
  }));
  return require("@/lib/locale").getDeviceLanguageCode();
};

describe("locale", () => {
  afterEach(() => {
    jest.dontMock("expo-localization");
  });

  it("uses languageTag when available", () => {
    const code = loadLanguageCode({
      getLocales: () => [{ languageTag: "ru-RU" }],
    });

    expect(code).toBe("ru");
  });

  it("falls back to languageCode", () => {
    const code = loadLanguageCode({
      getLocales: () => [{ languageCode: "es" }],
    });

    expect(code).toBe("es");
  });

  it("uses locale fallback", () => {
    const code = loadLanguageCode({
      getLocales: () => [],
      locale: "pt-BR",
    });

    expect(code).toBe("pt");
  });

  it("defaults to en", () => {
    const code = loadLanguageCode({
      getLocales: () => [],
    });

    expect(code).toBe("en");
  });
});
