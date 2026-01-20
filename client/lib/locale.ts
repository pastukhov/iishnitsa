import * as Localization from "expo-localization";

export function getDeviceLanguageCode(): string {
  const locales = Localization.getLocales?.() || [];
  const primary = locales[0];
  const languageTag =
    primary?.languageTag ||
    primary?.languageCode ||
    (Localization as { locale?: string }).locale ||
    "en";
  return languageTag.split("-")[0].toLowerCase();
}
