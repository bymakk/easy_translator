export const languageOptions = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'pl', label: 'Polski' },
  { value: 'uk', label: 'Українська' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ar', label: 'العربية' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'sv', label: 'Svenska' },
  { value: 'cs', label: 'Čeština' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'el', label: 'Ελληνικά' },
]

export const detectedLanguageLabels = {
  ru: 'Russian',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  uk: 'Ukrainian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  tr: 'Turkish',
  nl: 'Dutch',
  sv: 'Swedish',
  cs: 'Czech',
  hi: 'Hindi',
  vi: 'Vietnamese',
  el: 'Greek',
}

export function normalizeLangCode(code) {
  const lower = String(code ?? '').toLowerCase()
  if (lower.startsWith('zh')) return 'zh'
  return lower.split('-')[0] ?? lower
}

/** Для inline-popup: кириллица → перевод на en, латиница без кириллицы → ru */
export function suggestEditableTargetLang(text) {
  const t = String(text ?? '').trim()
  if (!t) return 'ru'

  let cyrillic = 0
  let latin = 0
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x0400 && cp <= 0x04ff) cyrillic++
    else if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) latin++
  }

  if (cyrillic > 0 && latin === 0) return 'en'
  if (latin > 0 && cyrillic === 0) return 'ru'
  if (cyrillic > latin) return 'en'
  if (latin > cyrillic) return 'ru'
  return 'ru'
}
