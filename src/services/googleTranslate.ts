/**
 * Прямой запрос к публичному endpoint Google (client=gtx), как в лёгких клиентах перевода.
 * Без своего сервера и API-ключа. Формат может измениться — это неофициальный способ.
 */

export type TranslateResult = {
  translatedText: string
  detectedSourceLanguage?: string
}

export type DetectResult = {
  detectedSourceLanguage?: string
  confidence?: number
}

type GtxObjectResponse = {
  sentences?: Array<{ trans?: string }>
  src?: string
  confidence?: number
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

function parseObjectConfidence(data: GtxObjectResponse): number | undefined {
  return typeof data.confidence === 'number' ? data.confidence : undefined
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
  if (!out.translatedText) {
    throw new Error('Пустой ответ перевода')
  }
  return out
}

export async function detectSourceLanguageFree(text: string): Promise<DetectResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('Пустой текст')
  }

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'en',
    dj: '1',
    dt: 'ld',
    q: trimmed,
  })

  const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) {
    throw new Error(`Определение языка: HTTP ${res.status}`)
  }

  const data = (await res.json()) as GtxObjectResponse
  return {
    detectedSourceLanguage: parseObjectDetectedSource(data),
    confidence: parseObjectConfidence(data),
  }
}
