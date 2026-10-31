import { createInstance } from 'i18next'
const i18n = createInstance()
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import { defaultLanguage, resources, supportedLanguages } from './resources'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    defaultNS: 'common',
    fallbackLng: defaultLanguage,
    interpolation: {
      escapeValue: false,
    },
    ns: Object.keys(resources[defaultLanguage]),
    resources,
    returnNull: false,
    supportedLngs: supportedLanguages,
  })

export default i18n
