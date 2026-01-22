import { getDeviceLanguageCode } from "@/lib/locale";
import { useMemo } from "react";

/**
 * UI translations for the application.
 * Supports English (en) and Russian (ru).
 */
export const TRANSLATIONS = {
  en: {
    // App identity
    appName: "Iishnitsa",
    appSubtitle: "Chat with AI",

    // Drawer navigation
    newChat: "New Chat",
    recentChats: "Recent Chats",
    noChatsYet: "No chats yet",
    about: "About",
    settings: "Settings",

    // Actions and alerts
    deleteChat: "Delete Chat",
    delete: "Delete",
    cancel: "Cancel",

    // Date formatting
    yesterday: "Yesterday",

    // About screen
    releaseNotes: "Release Notes",

    // Prompt selector
    selectPrompt: "Select Prompt",
    searchPrompts: "Search prompts...",
    startWithoutPrompt: "Start without prompt",
    noPromptsFound: "No prompts found",
    favoritePrompts: "Favorites",
    recentPrompts: "Recent",
    allPrompts: "All Prompts",
    searchResults: "Search Results",
  },
  ru: {
    // App identity
    appName: "Иишница",
    appSubtitle: "Чат с ИИ",

    // Drawer navigation
    newChat: "Новый чат",
    recentChats: "Недавние чаты",
    noChatsYet: "Пока нет чатов",
    about: "О приложении",
    settings: "Настройки",

    // Actions and alerts
    deleteChat: "Удалить чат",
    delete: "Удалить",
    cancel: "Отмена",

    // Date formatting
    yesterday: "Вчера",

    // About screen
    releaseNotes: "История изменений",

    // Prompt selector
    selectPrompt: "Выбрать промпт",
    searchPrompts: "Поиск промптов...",
    startWithoutPrompt: "Начать без промпта",
    noPromptsFound: "Промпты не найдены",
    favoritePrompts: "Избранное",
    recentPrompts: "Недавние",
    allPrompts: "Все промпты",
    searchResults: "Результаты поиска",
  },
};

export type TranslationKey = keyof typeof TRANSLATIONS.en;
export type Translations = typeof TRANSLATIONS.en;
export type SupportedLocale = keyof typeof TRANSLATIONS;

/**
 * Get locale key from full locale string.
 * Normalizes and extracts language code (e.g., "ru-RU" → "ru").
 */
function getLocaleKey(locale?: string): string | null {
  if (!locale) return null;
  const normalized = locale.toLowerCase();
  return normalized.split("-")[0];
}

/**
 * Get translations for the specified locale.
 * Falls back to English if locale is not supported.
 *
 * @param locale - Optional locale code (e.g., 'ru', 'en'). Defaults to device locale.
 * @returns Translations object with all UI strings
 */
export function getTranslations(locale?: string): Translations {
  const deviceLocale = locale || getDeviceLanguageCode();
  const key = getLocaleKey(deviceLocale);

  if (key && key in TRANSLATIONS) {
    return TRANSLATIONS[key as SupportedLocale];
  }

  // Fallback to English
  if (__DEV__ && key && !(key in TRANSLATIONS)) {
    console.warn(
      `[translations] Unsupported locale "${key}", falling back to English`,
    );
  }

  return TRANSLATIONS.en;
}

/**
 * React hook to get localized translations.
 * Automatically detects device locale and provides appropriate translations.
 *
 * @returns Translations object with all UI strings
 */
export function useTranslations(): Translations {
  const deviceLocale = getDeviceLanguageCode();

  return useMemo(() => {
    return getTranslations(deviceLocale);
  }, [deviceLocale]);
}
