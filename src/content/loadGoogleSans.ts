import woffCyrillicExt from '@fontsource/google-sans/files/google-sans-cyrillic-ext-400-normal.woff2?url'
import woffCyrillic from '@fontsource/google-sans/files/google-sans-cyrillic-400-normal.woff2?url'
import woffLatin from '@fontsource/google-sans/files/google-sans-latin-400-normal.woff2?url'

function fontHref(viteAssetPath: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    const path = viteAssetPath.replace(/^\.\//, '').replace(/^\//, '')
    return chrome.runtime.getURL(path)
  }
  return viteAssetPath
}

const faces: { file: string; unicodeRange: string }[] = [
  {
    file: woffCyrillicExt,
    unicodeRange:
      'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  },
  {
    file: woffCyrillic,
    unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  },
  {
    file: woffLatin,
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
]

let loadPromise: Promise<void> | null = null

/**
 * Регистрирует Google Sans в document.fonts из пакета расширения.
 * Обходит CSP страницы (в отличие от @font-face внутри инлайн-стиля в shadow).
 */
export function ensureGoogleSans(): Promise<void> {
  if (loadPromise) return loadPromise
  if (typeof FontFace === 'undefined') {
    loadPromise = Promise.resolve()
    return loadPromise
  }

  loadPromise = (async () => {
    for (const { file, unicodeRange } of faces) {
      const src = fontHref(file)
      try {
        const face = new FontFace('Google Sans', `url(${src})`, {
          weight: '400',
          style: 'normal',
          unicodeRange,
        })
        await face.load()
        document.fonts.add(face)
      } catch {
        try {
          const face = new FontFace('Google Sans', `url(${src})`, {
            weight: '400',
            style: 'normal',
          })
          await face.load()
          document.fonts.add(face)
        } catch {
          /* остаётся system-ui из стека */
        }
      }
    }
  })()

  return loadPromise
}
