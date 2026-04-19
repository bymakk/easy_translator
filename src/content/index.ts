import { createApp } from 'vue'
import App from '../App.vue'
import EditableTranslateBubble from '../EditableTranslateBubble.vue'
import { translateFree } from '../services/googleTranslate'
import { ensureGoogleSans } from './loadGoogleSans'
import shadowCss from '../styles/main-extension.scss?inline'

/** Vite кладёт woff2 в /assets/…; в инлайн-стиле на странице это ушло бы на origin сайта — чиним на URL расширения. */
function extensionScopedCss(css: string): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return css
  return css.replace(/url\(\/(assets\/[^)]+)\)/g, (_, path: string) => {
    return `url(${chrome.runtime.getURL(path)})`
  })
}

const POPUP_WIDTH = 450
const POPUP_HEIGHT = 200
const INLINE_POPUP_WIDTH = 210
const INLINE_POPUP_HEIGHT = 40
const MAX_CHARS = 4500

type TextControl = HTMLInputElement | HTMLTextAreaElement
type EditableSnapshot =
  | {
      kind: 'text-control'
      element: TextControl
      start: number
      end: number
    }
  | {
      kind: 'contenteditable'
      element: HTMLElement
      range: Range
    }

type EditableSelectionData = {
  text: string
  anchorLeft: number
  anchorBottom: number
  snapshot: EditableSnapshot
}

type PopupAnchor =
  | {
      kind: 'page-selection'
      range: Range
    }
  | {
      kind: 'editable-range'
      range: Range
    }
  | {
      kind: 'editable-control'
      element: TextControl
    }

let hostEl: HTMLDivElement | null = null
let popupWrap: HTMLDivElement | null = null
let app: ReturnType<typeof createApp> | null = null
let removeDocDown: (() => void) | null = null
let removeEscape: (() => void) | null = null
let removeReposition: (() => void) | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeAnchor: PopupAnchor | null = null

function tearDown() {
  removeDocDown?.()
  removeDocDown = null
  removeEscape?.()
  removeEscape = null
  removeReposition?.()
  removeReposition = null
  app?.unmount()
  app = null
  hostEl?.remove()
  hostEl = null
  popupWrap = null
  activeAnchor = null
}

function isTextControl(el: Element | null): el is TextControl {
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  return new Set(['text', 'search', 'url', 'tel', 'password', 'email']).has(el.type)
}

function getContentEditableRoot(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!el) return null
  const editable = el.closest('[contenteditable]:not([contenteditable="false"])')
  return editable instanceof HTMLElement ? editable : null
}

function placePopup(x: number, y: number) {
  const pad = 8
  const w = Math.min(POPUP_WIDTH, window.innerWidth - pad * 2)
  const h = Math.min(POPUP_HEIGHT, window.innerHeight - pad * 2)
  let left = Math.max(pad, Math.min(x, window.innerWidth - w - pad))
  let top = Math.max(pad, Math.min(y, window.innerHeight - h - pad))
  return { left, top, width: w }
}

function placeInlinePopup(x: number, y: number) {
  const pad = 8
  const w = Math.min(INLINE_POPUP_WIDTH, window.innerWidth - pad * 2)
  const h = Math.min(INLINE_POPUP_HEIGHT, window.innerHeight - pad * 2)
  const left = Math.max(pad, Math.min(x - w / 2, window.innerWidth - w - pad))
  const top = Math.max(pad, Math.min(y, window.innerHeight - h - pad))
  return { left, top, width: w }
}

function getRangeAnchorRect(range: Range): DOMRect | null {
  const root = range.commonAncestorContainer
  if (!root.isConnected) return null

  const rects = Array.from(range.getClientRects())
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
  if (!rect) return null
  return rect
}

function getPopupAnchorRect(anchor: PopupAnchor): DOMRect | null {
  try {
    if (anchor.kind === 'editable-control') {
      if (!anchor.element.isConnected) return null
      return anchor.element.getBoundingClientRect()
    }
    return getRangeAnchorRect(anchor.range)
  } catch {
    return null
  }
}

function updatePopupPosition() {
  if (!popupWrap || !activeAnchor) return

  const rect = getPopupAnchorRect(activeAnchor)
  if (!rect) return

  let nextPosition
  if (activeAnchor.kind === 'page-selection') {
    nextPosition = placePopup(rect.left, rect.bottom + 8)
  } else {
    nextPosition = placeInlinePopup(rect.left + rect.width / 2, rect.bottom + 8)
  }

  popupWrap.style.left = `${nextPosition.left}px`
  popupWrap.style.top = `${nextPosition.top}px`
  popupWrap.style.width = `${nextPosition.width}px`
  popupWrap.style.maxWidth = 'calc(100vw - 16px)'
}

function attachRepositionListeners() {
  const onReposition = () => updatePopupPosition()
  document.addEventListener('scroll', onReposition, true)
  window.addEventListener('resize', onReposition)

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onReposition)
    window.visualViewport.addEventListener('scroll', onReposition)
  }

  removeReposition = () => {
    document.removeEventListener('scroll', onReposition, true)
    window.removeEventListener('resize', onReposition)

    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onReposition)
      window.visualViewport.removeEventListener('scroll', onReposition)
    }
  }
}

function mountHostShell(left: number, top: number, width: number) {
  hostEl = document.createElement('div')
  hostEl.id = 'translator-theme-host'
  hostEl.setAttribute('data-translator-theme', '1')
  Object.assign(hostEl.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100%',
    height: '0',
    margin: '0',
    padding: '0',
    border: 'none',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '2147483646',
  })

  const shadow = hostEl.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = extensionScopedCss(shadowCss)
  shadow.appendChild(styleEl)

  const wrap = document.createElement('div')
  Object.assign(wrap.style, {
    pointerEvents: 'auto',
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxWidth: 'calc(100vw - 16px)',
  })

  const mount = document.createElement('div')
  shadow.appendChild(wrap)
  wrap.appendChild(mount)
  document.documentElement.appendChild(hostEl)
  popupWrap = wrap
  return mount
}

function attachDismissListeners() {
  const onDocMouseDown = (e: MouseEvent) => {
    if (!hostEl) return
    const path = e.composedPath()
    if (path.includes(hostEl)) return
    tearDown()
  }
  document.addEventListener('mousedown', onDocMouseDown, true)
  removeDocDown = () => document.removeEventListener('mousedown', onDocMouseDown, true)

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') tearDown()
  }
  document.addEventListener('keydown', onKey, true)
  removeEscape = () => document.removeEventListener('keydown', onKey, true)
}

async function mountComponent(
  component: object,
  props: Record<string, unknown>,
  anchor: PopupAnchor,
  left: number,
  top: number,
  width: number
) {
  tearDown()

  try {
    await ensureGoogleSans()
  } catch {
    /* system-ui fallback */
  }

  const mount = mountHostShell(left, top, width)
  app = createApp(component, props)
  app.mount(mount)
  activeAnchor = anchor
  attachDismissListeners()
  attachRepositionListeners()
  updatePopupPosition()
}

async function mountPopup(selectedText: string, range: Range) {
  const rect = getRangeAnchorRect(range)
  if (!rect) return

  const anchor: PopupAnchor = {
    kind: 'page-selection',
    range,
  }
  const { left, top, width } = placePopup(rect.left, rect.bottom + 8)
  await mountComponent(
    App,
    {
      embedded: true,
      selectedText,
      onVanish: tearDown,
    },
    anchor,
    left,
    top,
    width
  )
}

function dispatchEditableInput(target: HTMLElement | TextControl, data: string) {
  try {
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data,
        inputType: 'insertText',
      })
    )
  } catch {
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  }
}

function focusEditable(target: HTMLElement | TextControl) {
  try {
    target.focus({ preventScroll: true })
  } catch {
    target.focus()
  }
}

function replaceEditableSelection(snapshot: EditableSnapshot, translatedText: string) {
  if (!translatedText) return

  if (snapshot.kind === 'text-control') {
    const { element, start, end } = snapshot
    if (!element.isConnected) return
    focusEditable(element)
    element.setSelectionRange(start, end)
    element.setRangeText(translatedText, start, end, 'end')
    dispatchEditableInput(element, translatedText)
    return
  }

  const { element, range } = snapshot
  if (!element.isConnected) return

  focusEditable(element)
  const selection = window.getSelection()
  if (!selection) return

  const nextRange = range.cloneRange()
  selection.removeAllRanges()
  selection.addRange(nextRange)
  nextRange.deleteContents()

  const textNode = document.createTextNode(translatedText)
  nextRange.insertNode(textNode)
  nextRange.setStartAfter(textNode)
  nextRange.collapse(true)

  selection.removeAllRanges()
  selection.addRange(nextRange)
  dispatchEditableInput(element, translatedText)
}

async function mountEditablePopup(data: EditableSelectionData) {
  let anchor: PopupAnchor
  let anchorLeft = data.anchorLeft
  let anchorBottom = data.anchorBottom

  if (data.snapshot.kind === 'text-control') {
    anchor = {
      kind: 'editable-control',
      element: data.snapshot.element,
    }
  } else {
    anchor = {
      kind: 'editable-range',
      range: data.snapshot.range,
    }

    const rect = getRangeAnchorRect(data.snapshot.range)
    if (rect) {
      anchorLeft = rect.left + rect.width / 2
      anchorBottom = rect.bottom
    }
  }

  const { left, top, width } = placeInlinePopup(anchorLeft, anchorBottom + 8)
  await mountComponent(
    EditableTranslateBubble,
    {
      selectedText: data.text,
      onApply: async (targetLang: string) => {
        const result = await translateFree(data.text, targetLang)
        replaceEditableSelection(data.snapshot, result.translatedText)
        tearDown()
      },
    },
    anchor,
    left,
    top,
    width
  )
}

function getTextControlSelection(target: EventTarget | null): EditableSelectionData | null {
  const el =
    target instanceof Element && isTextControl(target)
      ? target
      : isTextControl(document.activeElement)
        ? document.activeElement
        : null
  if (!el) return null

  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  if (end <= start) return null

  const text = el.value.slice(start, end)
  if (!text.trim() || text.length > MAX_CHARS) return null

  const rect = el.getBoundingClientRect()
  return {
    text,
    anchorLeft: rect.left + rect.width / 2,
    anchorBottom: rect.bottom,
    snapshot: {
      kind: 'text-control',
      element: el,
      start,
      end,
    },
  }
}

function getContentEditableSelection(sel: Selection): EditableSelectionData | null {
  if (sel.rangeCount === 0) return null

  const root = getContentEditableRoot(sel.anchorNode)
  const focusRoot = getContentEditableRoot(sel.focusNode)
  if (!root || root !== focusRoot) return null

  const text = sel.toString()
  if (!text.trim() || text.length > MAX_CHARS) return null

  const range = sel.getRangeAt(0)
  const rects = Array.from(range.getClientRects())
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  return {
    text,
    anchorLeft: rect.left + rect.width / 2,
    anchorBottom: rect.bottom,
    snapshot: {
      kind: 'contenteditable',
      element: root,
      range: range.cloneRange(),
    },
  }
}

function handleSelection(e: MouseEvent) {
  if (hostEl && e.composedPath().includes(hostEl)) return

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null

    const textControlSelection = getTextControlSelection(e.target)
    if (textControlSelection) {
      void mountEditablePopup(textControlSelection)
      return
    }

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    const editableSelection = getContentEditableSelection(sel)
    if (editableSelection) {
      void mountEditablePopup(editableSelection)
      return
    }

    const text = sel.toString().trim()
    if (!text || text.length > MAX_CHARS) return

    const range = sel.getRangeAt(0)
    const rects = Array.from(range.getClientRects())
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return

    void mountPopup(text, range.cloneRange())
  }, 120)
}

window.addEventListener('mouseup', handleSelection)
