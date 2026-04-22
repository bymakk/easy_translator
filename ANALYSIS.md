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

### ~~H3. Схлопывание двух `watch` по `targetLang` / `provider` в `App.vue`~~ ✅ *Сделано в ветке `refactor/h3-single-watch`*

**Где было:** `src/App.vue:1550–1583` — два `watch(…, { immediate: true })`.

**Как решено:** Заменено на одного watcher по `[embedded, internalSelectedText, targetLang]` с явным флагом `hasBootstrapped` и отдельный notifier-watcher `watch(targetLang, onTargetLangChange, immediate: true)`. Первый tick гарантированно делает ровно один `runTranslate`; последующие изменения текста или языка перезаходят в тот же watcher через реактивное присваивание `targetLang.value = suggested` и собирают ровно один `runTranslate` на tick.

**Мысленный прогон 6 сценариев — каждый ровно 1 `runTranslate`:**
1. Mount с текстом (suggested == initial) — bootstrap.
2. Mount с restored pinned lang (`initialTargetLang` задан) — bootstrap уважает, не пересчитывает.
3. Пользователь меняет язык через dropdown — lang-ветка watcher-а.
4. Пользователь переключает провайдер — обрабатывается отдельным handler'ом (не watch'ем), рефактор не трогает.
5. Повторное выделение нового текста — текст-ветка watcher-а, возможно 1 реассайн `targetLang` → re-entry → 1 translate.
6. Mount non-embedded (playground) — early-return, внешние handler'ы сами дергают runTranslate.

**Сборка:** `content.js` 226.52 → 226.55 KB (+30 B за явную машину состояний, приемлемо).

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

### ✅ M3. Валидация `initialAuthState` / session payload (ручной guard) — ВЫПОЛНЕНО

**Было:** `initialAuthState` и `session.authState` из `chrome.storage.local` шли в UI через наивный spread-merge — битый тип поля (`aiAvailability: "bogus"`) протекал в `aiState`.

**Сделано:**
- В `src/services/translatorProtocol.ts` добавлены guard'ы `isAiAvailability`, `isTranslationMode` и sanitizer'ы `sanitizeQuota`, `sanitizeReports`, `sanitizeAuthState` (per-field fallback к guest default, никогда не бросают).
- `sessionStore.loadStoredSession` теперь пропускает хранимый `authState` через sanitizer вместо spread-merge.
- `App.vue`: `sanitizeAuthState` применяется к `props.initialAuthState` при монтировании и к `nextState` внутри `applyAuthState` (тот принимает `unknown`, потому что приходит из IPC-границы с `any`).
- `backendApi.ts`: `assertSessionPayload` на `/v1/auth/login`, `/register/verify`, `/refresh` — если сервер вернёт payload без `accessToken`/`refreshToken`/`accessTokenExpiresAt` → `BackendApiError('…', 'MALFORMED_RESPONSE', 200)` вместо тихой порчи auth state.
- `errorCodes.ts`: новый код `MALFORMED_RESPONSE` (502) — тост показывает понятное сообщение вместо fallthrough в generic 500.

**Zod решили не подключать** — раздул бы бандл на ~8–12 KB gzip; ручной guard покрыл все известные формы.

**Бэкап:** тег `backup/post-m3`.

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
| ~~H3~~ | ~~Единый watch в App.vue~~ | ✅ Сделано | — | — |
| M1 | `viewportRectFrom` | Чище код, редкие позиционные баги | Средний (CKE/TinyMCE тесты) | 1 день |
| M2 | Общий `chromeStorage.ts` | Единый child-frame fallback | Средний (много persist-точек) | 1–2 дня |
| ~~M3~~ | ~~Guard для `initialAuthState` / API~~ | ✅ Сделано | — | — |
| L1–L8 | Архитектура/стиль | Нулевой или отрицательный | — | — |

**Рекомендация:** брать по одному пункту H-блока за релиз (~~H3~~ → ~~M3~~ → H1 → H2), не смешивая. M-блок — когда будет окно без бизнес-задач. L-блок — не трогать без повода.


Релиз 1 — H3: схлопывание двух watch в App.vue (первым)
Почему первым:

Самый дешёвый (~0.5 дня) и самый изолированный — меняется один файл, одна функция.
Устраняет tripwire, который иначе взорвётся при любом M-рефакторе в App.vue (тот же M3 ниже ходит по аналогичной реактивности).
Риск низкий: проверяется ручным чек-листом за 15 минут (см. H3 в ANALYSIS.md).
Даёт уверенность в процессе «бэкап → рефактор → тест → релиз» перед более крупными изменениями.
Критерий релиза: ровно один runTranslate на открытие попапа, смену языка, смену провайдера, повторное выделение, pinned-restore. Откатиться на backup-тег при любой регрессии.

Релиз 2 — M3: guard для initialAuthState + parseJsonSafe
Почему вторым:

Тоже ~3 часа, но защищает H1 от взрыва. Если дальше начну кэшировать сессию (H1), любая ошибка формы попадёт в кэш и застрянет. Сначала — guard, потом — кэш.
Чисто аддитивная проверка: isValidAuthState(x): x is AuthState в translatorProtocol.ts, точка применения — loadStoredSession и props-default в App.vue. Если guard отверг форму — fallback на createGuestAuthState().
Риск низкий; пользователи даже не заметят.
Релиз 3 — H1: кэш сессии в content hot-path
Почему третьим (а не первым, хотя самый ощутимый ускоритель):

Требует фундамента из релизов 1–2: предсказуемый watch в App.vue + валидация формы. Без них любой cross-tab рассинхрон будет выглядеть как «то работает, то нет».
Самостоятельно видимый выигрыш для пользователя — лаг при открытии попапа пропадает.
План исполнения внутри релиза:
Модульные cachedSession/cachedMainProvider/cachedInlineProvider/cachedResultSize в src/content/index.ts.
Один chrome.storage.local.get({...}) на всю пачку ключей при installContentScript().
Слушатель chrome.storage.onChanged → обновление кэша, пуш обновления в смонтированный App.vue через prop / reactive ref на хосте.
На pageshow (bfcache restore) — форс-синк.
Риск средний; выкатывается с флагом ENABLE_HOT_PATH_CACHE = true в одном месте — если что-то не так, откат — одна строка.
Релиз 4 — M1: единый viewportRectFrom(iframe, localRect)
Почему четвёртым:

Чисто визуальный рефактор, не ускоряет и не чинит явных багов. Но выравнивает код перед H2, где вся математика координат будет заново пересекаться с iframe-изоляцией.
Риск средний-высокий, несмотря на малый scope: попап в CKE/TinyMCE — самое хрупкое место. Обязателен ручной тест на forum2.live-show.com + на одном TinyMCE-стенде перед релизом.
Релиз 5 — M2: общий chromeStorage.ts
Почему пятым:

После H1 уже есть понимание, как именно content script обращается к storage (один batch-get + onChanged). Единый слой делается по этому паттерну, а не догадками.
Рефактор затрагивает sessionStore, reportBuffer, powerToggle — три независимых persist-пути. Каждый имеет свой ручной тест: pinned bubble, font size, result size, inline provider, main provider, отчёты в reportBuffer.
Риск средний; релизить отдельно от H1, чтобы регрессию можно было однозначно атрибутировать.
Релиз 6 — H2: разделение content.js (самым последним и только если окупится)
Почему последним:

Самая дорогая задача (3–5 дней) и единственная с высоким риском. MV3 + shadow DOM + iframe-изоляция всё вместе.
Перед тем как трогать, обязательно:
Прогнать rollup-plugin-visualizer, понять реальное распределение веса.
Оценить — сколько реально спасём. Если <20 KB gzip — не делать, не стоит инженерии.
Если выигрыш большой — выбрать одну из двух стратегий (offscreen-host или lazy EditableTranslateBubble) и сделать proof-of-concept за день; релизить только если PoC работает на 10 типовых сайтах.
Возможен исход «PoC показал непропорциональную сложность → закрыли тикет wontfix». Это нормальный результат.