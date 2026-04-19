<template>
  <div class="translator-inline-popup" :class="{ 'translator-inline-popup--busy': submitting }">
    <span class="translator-inline-popup__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M14.6921 5H9.30807C8.15914 5.00635 7.0598 5.46885 6.25189 6.28576C5.44398 7.10268 4.99368 8.20708 5.00007 9.356V14.644C4.99368 15.7929 5.44398 16.8973 6.25189 17.7142C7.0598 18.5311 8.15914 18.9937 9.30807 19H14.6921C15.841 18.9937 16.9403 18.5311 17.7482 17.7142C18.5562 16.8973 19.0064 15.7929 19.0001 14.644V9.356C19.0064 8.20708 18.5562 7.10268 17.7482 6.28576C16.9403 5.46885 15.841 5.00635 14.6921 5Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M8.00012 10.5H12.0001V9H8.00012V10.5ZM12.7501 9.75V8H11.2501V9.75H12.7501ZM12.0001 10.5H15.5001V9H12.0001V10.5ZM15.5001 10.5H16.0001V9H15.5001V10.5ZM14.8864 9.31885C13.8552 10.7867 12.6412 12.1172 11.2737 13.2783L12.2445 14.4217C13.7091 13.1782 15.0093 11.7532 16.1138 10.1811L14.8864 9.31885ZM10.2005 16.0997C10.7113 15.7161 11.4531 15.1201 12.2569 14.407L11.2614 13.285C10.4871 13.9719 9.77692 14.5419 9.29973 14.9003L10.2005 16.0997ZM12.3491 13.3829C11.8824 12.7884 11.4917 12.1379 11.186 11.4467L9.8142 12.0533C10.1703 12.8586 10.6255 13.6164 11.1691 14.3091L12.3491 13.3829ZM11.1573 14.2976C11.8855 15.2767 12.8203 16.0835 13.8953 16.6608L14.605 15.3392C13.7239 14.8661 12.9578 14.2048 12.3609 13.4024L11.1573 14.2976Z"
          fill="currentColor"
        />
      </svg>
    </span>

    <div
      ref="selectWrapRef"
      class="translator-select-wrap translator-inline-popup__select"
      :class="{ 'translator-select-wrap--open': open }"
    >
      <button
        type="button"
        class="translator-select-trigger"
        :aria-expanded="open"
        aria-haspopup="listbox"
        aria-label="Язык перевода"
        :disabled="submitting"
        @mousedown.prevent
        @click="toggleOpen"
      >
        <span class="translator-select-trigger__label">{{ currentLabel }}</span>
      </button>

      <div v-show="open" class="translator-select-dropdown translator-inline-popup__dropdown">
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

        <ul v-if="filteredOptions.length > 0" class="translator-select-list" role="listbox">
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

        <p v-else-if="langSearchQuery.trim()" class="translator-select-empty">Нет совпадений</p>
      </div>
    </div>

    <button
      type="button"
      class="translator-inline-popup__apply"
      :disabled="!canApply"
      aria-label="Перевести выделенный текст"
      @mousedown.prevent
      @click="applyTranslation"
    >
      <span class="translator-inline-popup__apply-icon" aria-hidden="true"></span>
    </button>
  </div>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { languageOptions, suggestEditableTargetLang } from './languages'

const props = defineProps({
  selectedText: { type: String, default: '' },
  onApply: { type: Function, default: undefined },
})

const targetLang = ref(suggestEditableTargetLang(props.selectedText))
const open = ref(false)
const selectWrapRef = ref(null)
const searchInputRef = ref(null)
const langSearchQuery = ref('')
const submitting = ref(false)

let removeDocClick = null

onUnmounted(() => {
  removeDocClick?.()
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

const currentLabel = computed(
  () => languageOptions.find((opt) => opt.value === targetLang.value)?.label ?? targetLang.value
)

const canApply = computed(() => Boolean(props.selectedText?.trim()) && !submitting.value)

watch(
  () => props.selectedText,
  (t) => {
    targetLang.value = suggestEditableTargetLang(t ?? '')
  },
)

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
    const onDoc = (event) => {
      const root = selectWrapRef.value
      const path = event.composedPath()
      if (root && path.includes(root)) return
      open.value = false
    }
    document.addEventListener('click', onDoc, true)
    removeDocClick = () => document.removeEventListener('click', onDoc, true)
  })
})

function toggleOpen() {
  if (submitting.value) return
  open.value = !open.value
}

function pick(opt) {
  targetLang.value = opt.value
  open.value = false
}

async function applyTranslation() {
  if (!canApply.value) return
  open.value = false
  submitting.value = true

  try {
    await props.onApply?.(targetLang.value)
  } catch (error) {
    console.error('[translator-theme] inline translate failed', error)
  } finally {
    submitting.value = false
  }
}
</script>
