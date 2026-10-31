import { createInstance } from "i18next";
import en from "./locales/en/developer.json";
import zh from "./locales/zh/developer.json";

const requestedLanguage = new URLSearchParams(window.location.search).get(
  "lang",
);

// This package must not reinitialize the host application's i18next singleton.
const i18n = createInstance();
void i18n.init({
  resources: { en: { developer: en }, zh: { developer: zh } },
  lng: requestedLanguage === "en" ? "en" : "zh",
  fallbackLng: "en",
  supportedLngs: ["en", "zh"],
  defaultNS: "developer",
  interpolation: { escapeValue: false },
});

export default i18n;
