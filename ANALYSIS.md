# План доработок Easy Translator — оставшиеся пункты

> Всё, что можно было сделать без риска для поведения, уже сделано в v0.0.113
> (WeakMap, единый `sanitizeProvider`, типизация `MainPopupProps`, guard в
> google-парсере, discriminated union на стрим-порту, чистка мёртвых
> экспортов, `observer.disconnect()` на `pagehide`, убран `winAny`-каст,
> типизированы `pick(opt)` и `removeDocClick`).
>
> Ниже — только **нереализованные** задачи, сгруппированы по приоритету с
> оценкой импакта и рисков. Приоритет задаётся по формуле
> **реальный эффект × видимость для пользователя**, а не по «красоте кода».

---

## 🔴 Высокий приоритет — ощутимое ускорение / тихие баги

### H1. Кэш сессии в горячем пути «выделение → попап»

**Где:** `src/content/index.ts:664–684` и `804–830` (`loadInitialMainAuthState` / `mountEditablePopup`).

**Что сейчас:** На **каждое** выделение текста (каждый `mouseup` после выделения) мы асинхронно дергаем `loadStoredSession` + `loadMainProvider` / `loadInlineProvider` + `loadResultSize` через `chrome.storage.local`. В сумме — 2–4 storage-операции в критическом пути «пользователь выделил → попап появился».

**Импакт (скорость):**
- `chrome.storage.local.get` — ~0.5–5 мс в MV3 service worker roundtrip. На медленных машинах / при разбуженном SW первая операция может быть 20–50 мс.
- Пользователь видит это как **задержку появления попапа** при первом выделении после простоя. Это именно тот лаг «кликнул — не сразу появилось».

**Что сделать:**
1. Модульные переменные `cachedSession` / `cachedMainProvider` / `cachedInlineProvider` / `cachedResultSize` в content script.
2. Первая инициализация — один `chrome.storage.local.get({ ... })` с **всеми** ключами сразу (один roundtrip вместо нескольких).
3. Подписка на `chrome.storage.onChanged` — инвалидация/обновление кэша, когда background меняет сессию (логин, логаут, refresh токена).
4. Дополнительно: событие `pageshow` (bfcache) — форс-синк (bfcache мог пропустить storage-update).

**Риски:**
- Средние. Инвалидация через `onChanged` работает надёжно внутри одного extension-id, но легко пропустить edge case: логин в одной вкладке → соседняя вкладка с открытым попапом должна перерисовать UI с новым `aiState`.
- Если промахнуться с реактивностью Vue — кэш обновится, а `aiState` в App.vue нет.
- На iframe-бридже `chrome.storage.onChanged` работает только из contexts, которым открыт доступ (у нас открыт `TRUSTED_AND_UNTRUSTED_CONTEXTS` для `session`, но не для `local`) — нужно проверить, что `onChanged` для `chrome.storage.local` приходит в дочерние iframe-content-скрипты.

**Что тестировать:** логин в одной вкладке → попап в соседней вкладке; логаут во время открытого попапа; первая загрузка страницы после смены размера окна; восстановление pinned bubble из bfcache.

---

### H2. Разделение `content.js` на ленивые куски (~226 KB → ядро + UI по требованию)

**Где:** `vite.extension.config.js:35–50` (`inlineDynamicImports: true`), весь `src/content/*` и через него `App.vue` + `EditableTranslateBubble.vue`.

**Что сейчас:** В `content.js` инжектится ~226 KB (gzip ~70 KB) **на каждую страницу**, которую открывает пользователь. Туда вложены Vue 3, весь `App.vue` (~1600 строк UI), SCSS темы через `?inline`, `powerToggle`, мост в background. UI-часть нужна только когда реально появляется попап (большинство страниц просмотра её не используют).

**Импакт (скорость):**
- Парсинг ~226 KB JS на каждой вкладке: 10–40 мс на desktop, больше на слабых ноутбуках / Chromebook.
- Память: ~2–4 МБ на вкладку только от расширения.
- На сайтах с десятками iframe (форумы, reddit) — умножается.
- В Lighthouse-метриках не попадает (content script не блокирует `DOMContentLoaded`), но **time-to-interactive** длиннее.

**Что сделать:**
1. Добавить `rollup-plugin-visualizer` на `EXT_BUILD_TARGET=content` — получить карту.
2. Минимальное content-ядро: только `powerToggle` + детектор выделения + IPC-мост. Vue + App.vue + SCSS — в отдельном **offscreen-документе** или в `chrome-extension://…/popup-host.html`, инжектируемом в shadow-host через `<iframe src=chrome-extension://…>`.
3. Либо проще: оставить Vue в content, но лениво грузить `EditableTranslateBubble` и redkie панели (history, reports).

**Риски:**
- **Высокие.** MV3 в content script запрещает `import()` без предварительной регистрации чанков в манифесте. `inlineDynamicImports: true` стоит именно из-за этого.
- Перенос UI в iframe (`chrome-extension://`) рушит shadow DOM-интеграцию, стили темы хостового сайта, обработку кликов вне попапа; нужен другой механизм `pointer-events`.
- Любой фрагмент, зависящий от `document` хостовой страницы (позиция селектора, anchor-rect), придётся гонять через `postMessage` между content и iframe — много инженерии.

**Что тестировать:** вся сборка работает на 10+ типовых сайтах (youtube, reddit, vk, твиттер, cke-форумы, SPA с shadow DOM, iframe-редакторы), bfcache цикл, pinned bubble.

**Оценка усилий:** 3–5 дней с тестированием; реальное ускорение ощутимо только если перенести UI из content. Иначе выигрыш ~20–30 KB max — не стоит MV3-геморроя.

---

### H3. Схлопывание двух `watch` по `targetLang` / `provider` в `App.vue`

**Где:** `src/App.vue:1577–1610` — два `watch(…, { immediate: true })`, один по `targetLang`, другой по `provider`, оба дёргают `runTranslate` с guard'ами.

**Что сейчас:** Логика «первый watch инициализирует `targetLang` через `suggestTargetLangFromText`, второй не должен стрельнуть при `prev === undefined`, иначе — двойной `runTranslate`». Это balanced-on-the-edge state machine без явного флага «первая загрузка».

**Импакт (баги):**
- При любом рефакторе инициализации (смена порядка импортов, `suggestTargetLangFromText` стал асинхронным, добавили третью реактивную зависимость) легко получить:
  - **Двойной** сетевой запрос перевода при открытии попапа → двойной расход токенов, двойной спин loader.
  - **Пропущенный** первый перевод → пользователь видит пустое поле, думает что сломалось.
- Сейчас работает, но это tripwire под следующим апдейтом.

**Что сделать:**
1. Явный флаг `didBootstrap = ref(false)` или `hasInitialTranslation` — один проход в `onMounted`, потом обычный `watch([targetLang, provider])` с `flush: 'post'`.
2. Либо `watchEffect(() => runTranslate({ reason: 'reactive' }))` + дебаунс — `runTranslate` сам решает, стоит ли дергаться, по хэшу `{text, targetLang, provider}`.

**Риски:**
- Низкие, если приделать ручной тест-чеклист перед релизом: (а) открыть попап на свежей странице; (б) поменять язык в попапе; (в) переключить провайдера в попапе; (г) повторно выделить другой текст; (д) pinned bubble при перезагрузке. Для каждого — ровно один запрос.
- Средние, если релизнуть вслепую: регрессия тихая, пользователь жалуется «токены кончились за 2 дня».

**Оценка усилий:** 2–4 часа на рефактор + час ручного прогона.

---

## 🟡 Средний приоритет — качество кода / устойчивость

### M1. Единый хелпер `viewportRectFrom(iframe, localRect)`

**Где:** `src/content/index.ts:326–347` (`translateRectThroughFrame`) и `src/content/index.ts:1089–1094` (ручное `iframeRect.left + localRect.left ...`).

**Что сейчас:** Два разных способа превратить координаты выделения внутри iframe в координаты viewport верхнего фрейма.

**Импакт:** Визуальный баг **только** на вложенных iframe (iframe внутри iframe) или при нестандартных `transform: scale`. Обычные CKE-редакторы (один iframe) работают — дублирование не проявлялось.

**Риски рефакторинга:**
- **Средние.** Позиционирование попапа в CKE-редакторах — то, что пользователь чинил долго (см. историю v0.0.11x). Любая ошибка в новом хелпере мгновенно ломает попап на форумах с CKE.
- Нужен минимум 2 живых тест-стенда: CKE 4 (как на `forum2.live-show.com`) и TinyMCE.

**Оценка усилий:** 1 день; выигрыш — чище код, не более.

### M2. Общий слой `chromeStorage.ts`

**Где:** `src/services/reportBuffer.ts:30–68`, `src/services/sessionStore.ts:59–175`, `src/content/powerToggle.ts:22–51`.

**Что сейчас:** Три независимые реализации: (а) sessionStore для `storage.local` c child-frame fallback через `chrome.runtime.sendMessage`; (б) reportBuffer поверх `storage.session`; (в) powerToggle — опять поверх `storage.local`. У каждого свой `hasSessionStorage`/`tryGet`.

**Импакт:** Баг, найденный в одной копии, не попадает в другие. Конкретно: child-frame fallback (когда контент-скрипт выполняется в `about:blank` iframe без доступа к `chrome.storage`) сделан только в `sessionStore.ts`. Если завтра `reportBuffer` понадобится работать из iframe — он молча сломается.

**Риски рефакторинга:**
- **Средние.** `storage.session` и `storage.local` — два разных API с разной политикой trusted/untrusted contexts. Единый `storageGet<T>(area, key)` легко сделать, а вот унификация child-frame fallback (там асинхронный round-trip через `chrome.runtime`) — аккуратно.
- Регрессии могут быть незаметны: например, настройки размера шрифта сохраняются, а восстанавливаются из устаревшего кэша.

**Оценка усилий:** 1–2 дня + прогон всех persist-кейсов (pinned bubble, font size, result size, inline provider, main provider, report buffer).

### M3. Валидация `initialAuthState` / `parseJsonSafe` (Zod или ручной guard)

**Где:** `src/App.vue:423–426` (`initialAuthState: { type: Object, default: undefined }`), `src/services/backendApi.ts:75–83` (`JSON.parse(text) as T`).

**Что сейчас:** Полное доверие форме входного объекта. При расхождении — `Cannot read property 'isAuthenticated' of undefined` где-то глубоко в UI через 10 стек-кадров.

**Импакт:**
- Типичный кейс: поменяли форму `AuthState` в backend, выкатили новый backend раньше расширения — у всех текущих пользователей в `chrome.storage.local` лежит **старая** форма → `aiState` получит `undefined` поле → UI либо сломается, либо тихо покажет гостя вместо залогиненного.
- Сейчас — не наблюдается, потому что `AuthState` стабилен давно.

**Риски рефакторинга:**
- Низкие. Добавить функцию `isValidAuthState(x): x is AuthState` в `translatorProtocol.ts`, использовать в `loadStoredSession` и `App.vue` props-default.
- Zod раздует бандл на ~8–12 KB gzip — не нужен; хватит ручного guard'а.

**Оценка усилий:** 2–3 часа.

---

## 🟢 Низкий приоритет — архитектурные вопросы / приёмлемые компромиссы

### L1. Клиентский HMAC-секрет (`requestSigning.ts`)

**Модель угроз:** Это не секрет, а обфускация «чтобы curl'ом без расширения не стучали». Любой злоумышленник вытащит ключ из публичной сборки за 5 минут. Бэкенд и так должен полагаться на JWT + rate-limit, а не на HMAC-подпись клиента.

**Что делать:** Ничего, пока нет инцидента. Документировать как «obfuscation layer», на бэкенде — ротация `CLIENT_HMAC_PREVIOUS_SECRET`, мониторинг аномальных частот неподписанных запросов.

**Риск изменения:** Вынос в env.variable при сборке не поможет (она всё равно публичная); честное решение — подписывать с сервера per-session — это отдельный protocol-redesign.

### L2. Access token в `chrome.storage.session` с `TRUSTED_AND_UNTRUSTED_CONTEXTS`

**Модель угроз:** Open access level — сознательное решение, чтобы content script и popup могли работать от имени пользователя. Реальный риск — другой content script того же расширения или вредоносный сайт, на котором исполняется **наш** content (не сторонний). Chrome изолирует миры (isolated world), утечка через `window.*` исключена.

**Что делать:** Держать TTL у access token короткий (refresh через 5–10 мин) — уже сделано. Больше по-хорошему не улучшишь без отказа от session storage.

### L3. `innerHTML = GROK_SVG` в `powerToggle.ts:186`

**Риск:** Нулевой. `GROK_SVG` — константа из того же модуля, без подстановок. XSS не представим.

**Что делать:** Оставить. `createElementNS` даст ту же картинку за 30 строк кода вместо одной.

### L4. Подделка `Origin`/`Referer` в `yandexTranslate.ts`

**Что сейчас:** Запросы к Yandex Translate с заголовками, маскирующимися под `youtube.com`. Публичный API Yandex режет запросы без этих хедеров.

**Импакт:** Хрупкость интеграции (Yandex может ужесточить политику в любой момент). Не уязвимость.

**Что делать:** Мониторить 403/пустые ответы, graceful fallback на Google уже есть. Отдельный публичный Yandex API без HMAC-плясок не существует.

### L5. `chrome.runtime.onMessage` без `sender.origin`-чека

**Модель угроз:** Нет `externally_connectable` в манифесте → сторонние сайты не могут слать сообщения. Остаётся только другой компонент **нашего** расширения. В `switch (message.type)` уже есть exhaustive-проверка.

**Что делать:** Ничего. При любой попытке добавить `externally_connectable` — сразу allowlist и валидация.

### L6. `window.addEventListener('resize', …)` в `powerToggle.ts:266` без снятия

**Что сейчас:** Listener живёт всё время жизни страницы. У power toggle нет метода `destroy()` — он инициализируется один раз на сессию.

**Импакт:** Формально утечка, практически — нет (страница уходит → GC всё зачистит).

**Что делать:** Добавить снятие только если когда-нибудь появится явный `destroyPowerToggle()` (например, для внутренних тестов HMR). До тех пор — пустая работа.

### L7. Замена ручных `addEventListener` на `@vueuse/core`

**Что даст:** Единообразное автоснятие обработчиков (`useEventListener`, `onClickOutside`).

**Что стоит:** +15–30 KB gzip к `content.js`, который и так проблемный (см. H2).

**Что делать:** Не подключать, пока не решена стратегия уменьшения `content.js`. Ручные add/remove сейчас типизированы и симметричны.

### L8. `mitt` / `nanoid` / `uuid`

**Не нужны.** Нет централизованного event bus (связь через `chrome.runtime` и props), id генерируются через `crypto.randomUUID()` / timestamp+counter.

---

## Итог приоритизации

| № | Задача | Эффект | Риск | Усилия |
|---|--------|--------|------|--------|
| H1 | Кэш сессии в content hot-path | Заметное ускорение открытия попапа | Средний (инвалидация между вкладками) | 1–2 дня |
| H2 | Разделение `content.js` | 40–100 KB на вкладку, TTI | Высокий (MV3 + shadow DOM) | 3–5 дней |
| H3 | Единый watch в App.vue | Защита от будущих регрессий | Низкий при тестах | 0.5 дня |
| M1 | `viewportRectFrom` | Чище код, редкие позиционные баги | Средний (CKE/TinyMCE тесты) | 1 день |
| M2 | Общий `chromeStorage.ts` | Единый child-frame fallback | Средний (много persist-точек) | 1–2 дня |
| M3 | Guard для `initialAuthState` / API | Защита от рассинхрона с backend | Низкий | 2–3 часа |
| L1–L8 | Архитектура/стиль | Нулевой или отрицательный | — | — |

**Рекомендация:** брать по одному пункту H-блока за релиз (H3 → H1 → H2), не смешивая. M-блок — когда будет окно без бизнес-задач. L-блок — не трогать без повода.
