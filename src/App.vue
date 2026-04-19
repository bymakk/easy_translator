<template>
  <div v-if="popupVisible" class="translator-popup-body">
    <div class="translator-popup-header">
      <a
        class="translator-popup-github"
        href="https://github.com/bymakk/easy_translator"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Репозиторий расширения на GitHub"
        @mousedown.stop
      >
        <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <g fill="currentColor" fill-rule="evenodd">
            <g transform="translate(-140 -7559)">
              <g transform="translate(56 160)">
                <path
                  d="M94 7399c5.523 0 10 4.59 10 10.253 0 4.529-2.862 8.371-6.833 9.728-.507.101-.687-.219-.687-.492 0-.338.012-1.442.012-2.814 0-.956-.32-1.58-.679-1.898 2.227-.254 4.567-1.121 4.567-5.059 0-1.12-.388-2.034-1.03-2.752.104-.259.447-1.302-.098-2.714 0 0-.838-.275-2.747 1.051A9.506 9.506 0 0 0 94 7403.958a9.506 9.506 0 0 0-2.503.345c-1.911-1.326-2.751-1.051-2.751-1.051-.543 1.412-.2 2.455-.097 2.714-.639.718-1.03 1.632-1.03 2.752 0 3.928 2.335 4.808 4.556 5.067-.286.256-.545.708-.635 1.371-.57.262-2.018.715-2.91-.852 0 0-.529-.985-1.533-1.057 0 0-.975-.013-.068.623 0 0 .655.315 1.11 1.5 0 0 .587 1.83 3.369 1.21.005.857.014 1.665.014 1.909 0 .271-.184.588-.683.493C86.865 7417.627 84 7413.783 84 7409.253c0-5.663 4.478-10.253 10-10.253"
                />
              </g>
            </g>
          </g>
        </svg>
      </a>
      <div
        class="translator-source-lang"
        role="status"
        aria-live="polite"
        aria-label="Язык выделенного текста"
      >
        <span class="translator-source-lang__label">{{ sourceLangLabel }}</span>
      </div>
      <span class="translator-header-arrow" aria-hidden="true"></span>
      <div
        ref="selectWrapRef"
        class="translator-select-wrap"
        :class="{ 'translator-select-wrap--open': open }"
      >
        <button
          type="button"
          class="translator-select-trigger"
          :aria-expanded="open"
          aria-haspopup="listbox"
          aria-label="Язык перевода"
          @click="open = !open"
        >
          <span class="translator-select-trigger__label">{{ currentLabel }}</span>
        </button>
        <div v-show="open" class="translator-select-dropdown">
          <input
            ref="searchInputRef"
            v-model="langSearchQuery"
            type="search"
            class="translator-select-search"
            placeholder="Поиск…"
            aria-label="Поиск языка"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            @keydown.escape.prevent="open = false"
          />
          <ul
            v-if="filteredOptions.length > 0"
            class="translator-select-list"
            role="listbox"
          >
            <li
              v-for="opt in filteredOptions"
              :key="opt.value"
              class="translator-select-list__item"
              role="presentation"
            >
              <button
                type="button"
                class="translator-select-option"
                role="option"
                :aria-selected="opt.value === targetLang"
                @mousedown.prevent
                @click="pick(opt)"
              >
                {{ opt.label }}
              </button>
            </li>
          </ul>
          <p
            v-else-if="langSearchQuery.trim()"
            class="translator-select-empty"
          >
            Нет совпадений
          </p>
        </div>
      </div>
      <button
        type="button"
        class="translator-popup-close"
        aria-label="Закрыть"
        @click="closePopup"
      ></button>
    </div>
    <div class="translator-popup-content">
      <div
        class="translator-result"
        :class="{ 'translator-result--loading': embedded && translating }"
        aria-live="polite"
        aria-label="Перевод"
      >
        <div class="translator-result__body">
          <div class="translator-result__text">{{ resultBody }}</div>
        </div>
        <button
          type="button"
          class="translator-result__copy"
          :class="{ 'translator-result__copy--success': copySuccess }"
          aria-label="Копировать перевод"
          :disabled="!canCopy"
          @click="copyTranslation"
        >
          <span class="translator-result__copy-icon" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { detectedLanguageLabels, languageOptions, normalizeLangCode } from './languages'
import { translateFree } from './services/googleTranslate'

const props = defineProps({
  embedded: { type: Boolean, default: false },
  selectedText: { type: String, default: '' },
  onVanish: { type: Function, default: undefined },
})

const sourceLangCode = ref(props.embedded ? '' : 'en')

const popupVisible = ref(true)

const targetLang = ref('ru')
const open = ref(false)
const selectWrapRef = ref(null)
const searchInputRef = ref(null)
const langSearchQuery = ref('')
const copySuccess = ref(false)

const translatedText = ref('')
const translateError = ref('')
const translating = ref(false)

/** Старый ответ fetch не должен перезаписывать текст и язык после нового запроса */
let translateRequestSeq = 0

let removeDocClick = null
let copySuccessTimer = null

onUnmounted(() => {
  removeDocClick?.()
  if (copySuccessTimer) clearTimeout(copySuccessTimer)
})

const sourceLangLabel = computed(() => {
  const code = sourceLangCode.value
  if (!code) return 'Авто'
  const short = normalizeLangCode(code)
  const detectedLabel = detectedLanguageLabels[short]
  if (detectedLabel) return detectedLabel
  const hit = languageOptions.find((o) => o.value === code || o.value === short)
  if (hit) return hit.label
  return short.toUpperCase()
})

const filteredOptions = computed(() => {
  const q = langSearchQuery.value.trim().toLocaleLowerCase('ru-RU')
  if (!q) return languageOptions
  return languageOptions.filter((opt) => {
    const label = opt.label.toLocaleLowerCase('ru-RU')
    const value = opt.value.toLocaleLowerCase('en-US')
    return label.includes(q) || value.includes(q)
  })
})

watch(open, (isOpen) => {
  removeDocClick?.()
  removeDocClick = null
  if (!isOpen) {
    langSearchQuery.value = ''
    return
  }
  nextTick(() => {
    searchInputRef.value?.focus()
    searchInputRef.value?.select()
    const onDoc = (e) => {
      const root = selectWrapRef.value
      const path = e.composedPath()
      if (root && path.includes(root)) return
      open.value = false
    }
    document.addEventListener('click', onDoc, true)
    removeDocClick = () => document.removeEventListener('click', onDoc, true)
  })
})

function pick(opt) {
  targetLang.value = opt.value
  open.value = false
}

function closePopup() {
  open.value = false
  popupVisible.value = false
  props.onVanish?.()
}

const currentLabel = computed(
  () => languageOptions.find((o) => o.value === targetLang.value)?.label ?? targetLang.value
)

const sampleText = computed(() => {
  const body = `Перевод появляется здесь после того, как вы выделите фрагмент на странице. Такой блок удобно проверять на длинных ответах: текст переносится по строкам, а если сообщение не помещается по высоте, внутри области включается прокрутка. Ниже — ещё немного текста, чтобы было видно, как ведёт себя поле при нескольких абзацах.

В реальном сценарии сюда подставит расширение или скрипт результат запроса к API переводчика. Пока что это просто тестовый набор предложений для вёрстки: межстрочный интервал, отступы, цвет фона и рамка должны оставаться аккуратными и при пустом состоянии, и при длинном переводе.

Если нужно скопировать результат, его можно выделить мышью — для этого у блока включено обычное выделение текста.`

  return `${body}\n\n(Демо: выбран код языка «${targetLang.value}».)`
})

const resultBody = computed(() => {
  if (!props.embedded) return sampleText.value
  if (translating.value) return ''
  if (translateError.value) return translateError.value
  return translatedText.value
})

const canCopy = computed(
  () =>
    props.embedded
      ? Boolean(translatedText.value.trim()) && !translating.value && !translateError.value
      : true
)

async function runTranslate() {
  if (!props.embedded) return
  const raw = props.selectedText?.trim() ?? ''
  if (!raw) {
    translating.value = false
    translateError.value = 'Нет текста для перевода'
    translatedText.value = ''
    sourceLangCode.value = ''
    return
  }
  const seq = ++translateRequestSeq
  sourceLangCode.value = ''
  translating.value = true
  translateError.value = ''
  translatedText.value = ''
  try {
    const r = await translateFree(raw, targetLang.value)
    if (seq !== translateRequestSeq) return
    translatedText.value = r.translatedText
    if (r.detectedSourceLanguage) {
      sourceLangCode.value = r.detectedSourceLanguage
    }
  } catch (e) {
    if (seq !== translateRequestSeq) return
    translateError.value = e instanceof Error ? e.message : 'Ошибка перевода'
  } finally {
    if (seq === translateRequestSeq) translating.value = false
  }
}

watch(
  () => [props.embedded, props.selectedText],
  () => {
    if (props.embedded) void runTranslate()
  },
  { immediate: true },
)

watch(targetLang, () => {
  if (props.embedded && props.selectedText?.trim()) void runTranslate()
})

async function copyTranslation() {
  const payload = props.embedded ? translatedText.value : sampleText.value
  if (!payload.trim()) return
  try {
    await navigator.clipboard.writeText(payload)
    copySuccess.value = true
    if (copySuccessTimer) clearTimeout(copySuccessTimer)
    copySuccessTimer = setTimeout(() => {
      copySuccess.value = false
      copySuccessTimer = null
    }, 1600)
  } catch {
    copySuccess.value = false
  }
}
</script>
