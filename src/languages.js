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
  ru: 'Русский',
  en: 'English',
  zh: 'Chinese',
  uk: 'Украинский',
  bg: 'Болгарский',
  kk: 'Казахский',
  udm: 'Удмуртский',
  be: 'Белорусский',
  mk: 'Македонский',
  sr: 'Сербский',
  ky: 'Киргизский',
  mn: 'Монгольский',
}

const intlLanguageNames =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['ru'], { type: 'language' })
    : null

export function normalizeLangCode(code) {
  const lower = String(code ?? '').toLowerCase()
  if (lower.startsWith('zh')) return 'zh'
  return lower.split('-')[0] ?? lower
}

function capitalizeLabel(label) {
  return label ? label[0].toUpperCase() + label.slice(1) : ''
}

export function getDetectedLanguageLabel(code) {
  if (!code) return 'Авто'

  const normalized = normalizeLangCode(code)
  const explicitLabel = detectedLanguageLabels[normalized]
  if (explicitLabel) return explicitLabel

  const label = intlLanguageNames?.of(normalized) ?? intlLanguageNames?.of(String(code))
  if (label) return capitalizeLabel(label)

  const hit = languageOptions.find((option) => option.value === normalized)
  if (hit) return hit.label

  return 'Авто'
}

export function inferLikelySourceLang(text) {
  const t = String(text ?? '').trim()
  if (!t) return undefined

  let cyrillic = 0
  let latin = 0
  const hasUkrainianLetters = /[іїєґІЇЄҐ]/u.test(t)

  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x0400 && cp <= 0x04ff) cyrillic++
    else if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) latin++
  }

  if (cyrillic > 0 && latin === 0) return hasUkrainianLetters ? 'uk' : 'ru'
  if (latin > 0 && cyrillic === 0) return 'en'
  if (cyrillic > latin) return hasUkrainianLetters ? 'uk' : 'ru'
  if (latin > cyrillic) return 'en'
  return undefined
}

export function suggestTargetLangFromText(text) {
  const source = inferLikelySourceLang(text)
  if (source === 'ru' || source === 'uk') return 'en'
  if (source === 'en') return 'ru'
  return 'ru'
}
