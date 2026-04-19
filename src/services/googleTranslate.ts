/**
 * Прямой запрос к публичному endpoint Google (client=gtx), как в лёгких клиентах перевода.
 * Без своего сервера и API-ключа. Формат может измениться — это неофициальный способ.
 */

export type TranslateResult = {
  translatedText: string
  detectedSourceLanguage?: string
}

type GtxObjectResponse = {
  sentences?: Array<{ trans?: string }>
  src?: string
  ld_result?: {
    srclangs?: string[]
  }
}

const targetParam: Record<string, string> = {
  zh: 'zh-CN',
}

function mapTarget(code: string): string {
  return targetParam[code] ?? code
}

function normalizeLangCode(code: string): string {
  const lower = code.toLowerCase()
  if (lower.startsWith('zh')) return 'zh'
  return lower.split('-')[0] ?? lower
}

function inferSourceLanguageFromText(text: string): string | undefined {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko'
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/u.test(text)) return 'zh'
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar'
  if (/[\u0370-\u03ff]/u.test(text)) return 'el'
  if (/[\u0900-\u097f]/u.test(text)) return 'hi'
  return undefined
}

function resolveDetectedSource(text: string, detected?: string): string | undefined {
  const inferred = inferSourceLanguageFromText(text)
  if (!detected) return inferred
  if (!inferred) return detected

  const normalizedDetected = normalizeLangCode(detected)
  const normalizedInferred = normalizeLangCode(inferred)
  if (normalizedDetected === normalizedInferred) return detected

  // Google gtx иногда ошибочно отдаёт `en` даже для иероглифов.
  if (normalizedDetected === 'en') return inferred

  return detected
}

function parseDetectedSource(root: unknown[]): string | undefined {
  if (typeof root[2] === 'string' && root[2].length > 0) {
    return root[2]
  }
  const tail = root[8]
  if (Array.isArray(tail) && Array.isArray(tail[0]) && typeof tail[0][0] === 'string') {
    return tail[0][0]
  }
  return undefined
}

function parseObjectDetectedSource(data: GtxObjectResponse): string | undefined {
  if (typeof data.src === 'string' && data.src.length > 0) {
    return data.src
  }
  if (Array.isArray(data.ld_result?.srclangs) && typeof data.ld_result.srclangs[0] === 'string') {
    return data.ld_result.srclangs[0]
  }
  return undefined
}

function parseObjectGtxResponse(data: GtxObjectResponse): TranslateResult {
  const chunks =
    Array.isArray(data.sentences)
      ? data.sentences
          .map((sentence) => (typeof sentence?.trans === 'string' ? sentence.trans : ''))
          .filter(Boolean)
      : []

  return {
    translatedText: chunks.join(''),
    detectedSourceLanguage: parseObjectDetectedSource(data),
  }
}

function parseArrayGtxResponse(data: unknown): TranslateResult {
  const root = data as unknown[]
  const detected = parseDetectedSource(root)

  const chunks: string[] = []
  const segments = root[0]
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      if (Array.isArray(seg) && typeof seg[0] === 'string') {
        chunks.push(seg[0])
      }
    }
  }

  return {
    translatedText: chunks.join(''),
    detectedSourceLanguage: detected,
  }
}

function parseGtxResponse(data: unknown): TranslateResult {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return parseObjectGtxResponse(data as GtxObjectResponse)
  }
  return parseArrayGtxResponse(data)
}

export async function translateFree(
  text: string,
  targetLang: string
): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('Пустой текст')
  }

  const tl = mapTarget(targetLang)
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl,
    dj: '1',
    dt: 't',
    q: trimmed,
  })

  const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) {
    throw new Error(`Перевод: HTTP ${res.status}`)
  }

  const data: unknown = await res.json()
  const out = parseGtxResponse(data)
  out.detectedSourceLanguage = resolveDetectedSource(trimmed, out.detectedSourceLanguage)
  if (!out.translatedText) {
    throw new Error('Пустой ответ перевода')
  }
  return out
}
