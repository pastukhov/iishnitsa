const loadTranslations = (locale: string) => {
  jest.resetModules();
  jest.doMock("expo-localization", () => ({
    __esModule: true,
    getLocales: () => [{ languageTag: locale }],
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getTranslations, TRANSLATIONS } = require("@/lib/translations");
  return { getTranslations, TRANSLATIONS };
};

describe("translations", () => {
  afterEach(() => {
    jest.dontMock("expo-localization");
    jest.resetModules();
  });

  describe("TRANSLATIONS", () => {
    it("has consistent keys across all locales", () => {
      const { TRANSLATIONS } = loadTranslations("en");
      const enKeys = Object.keys(TRANSLATIONS.en).sort();
      const ruKeys = Object.keys(TRANSLATIONS.ru).sort();

      expect(enKeys).toEqual(ruKeys);
    });

    it("has all required translation keys", () => {
      const { TRANSLATIONS } = loadTranslations("en");
      const requiredKeys = [
        "appName",
        "appSubtitle",
        "newChat",
        "recentChats",
        "noChatsYet",
        "about",
        "settings",
        "deleteChat",
        "delete",
        "cancel",
        "yesterday",
        "releaseNotes",
      ];

      requiredKeys.forEach((key) => {
        expect(TRANSLATIONS.en).toHaveProperty(key);
        expect(TRANSLATIONS.ru).toHaveProperty(key);
      });
    });

    it("has correct Russian translations", () => {
      const { TRANSLATIONS } = loadTranslations("ru");

      expect(TRANSLATIONS.ru.appName).toBe("Иишница");
      expect(TRANSLATIONS.ru.appSubtitle).toBe("Чат с ИИ");
      expect(TRANSLATIONS.ru.newChat).toBe("Новый чат");
      expect(TRANSLATIONS.ru.settings).toBe("Настройки");
    });

    it("has correct English translations", () => {
      const { TRANSLATIONS } = loadTranslations("en");

      expect(TRANSLATIONS.en.appName).toBe("Iishnitsa");
      expect(TRANSLATIONS.en.appSubtitle).toBe("Chat with AI");
      expect(TRANSLATIONS.en.newChat).toBe("New Chat");
      expect(TRANSLATIONS.en.settings).toBe("Settings");
    });
  });

  describe("getTranslations", () => {
    it("returns Russian translations for ru locale", () => {
      const { getTranslations } = loadTranslations("ru-RU");
      const t = getTranslations("ru");

      expect(t.appName).toBe("Иишница");
      expect(t.appSubtitle).toBe("Чат с ИИ");
    });

    it("returns English translations for en locale", () => {
      const { getTranslations } = loadTranslations("en-US");
      const t = getTranslations("en");

      expect(t.appName).toBe("Iishnitsa");
      expect(t.appSubtitle).toBe("Chat with AI");
    });

    it("falls back to English for unsupported locale", () => {
      const { getTranslations } = loadTranslations("fr-FR");
      const t = getTranslations("fr");

      expect(t.appName).toBe("Iishnitsa");
      expect(t.appSubtitle).toBe("Chat with AI");
    });

    it("uses device locale when no locale provided", () => {
      const { getTranslations } = loadTranslations("ru-RU");
      const t = getTranslations();

      expect(t.appName).toBe("Иишница");
    });

    it("normalizes locale codes", () => {
      const { getTranslations } = loadTranslations("en-US");

      const t1 = getTranslations("RU-RU");
      expect(t1.appName).toBe("Иишница");

      const t2 = getTranslations("ru");
      expect(t2.appName).toBe("Иишница");
    });
  });
});
