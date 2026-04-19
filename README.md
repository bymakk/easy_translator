# easy_translator

Chrome-расширение: перевод выделенного текста на странице (и замена выделения в полях ввода). Исходники и сборка лежат в этом репозитории; **готовый к установке артефакт** — каталог [`chrome-extension/build`](./chrome-extension/build) (его нужно коммитить после каждой релизной сборки).

- Репозиторий на GitHub: [bymakk/easy_translator](https://github.com/bymakk/easy_translator)
- Текущая версия расширения задаётся в [`chrome-extension/manifest.json`](./chrome-extension/manifest.json) (поле `version`) и должна совпадать с копией в `chrome-extension/build/manifest.json` после сборки.

## Установка из собранной папки

1. Откройте `chrome://extensions`.
2. Включите «Режим разработчика».
3. «Загрузить распакованное расширение» → выберите папку **`chrome-extension/build`** из клона репозитория.

## Сборка без смены версии

Чтобы пересобрать `chrome-extension/build`, **не** увеличивая номер версии:

```bash
npm ci
npm run build:extension:pack
```

Для локальной разработки с автоматическим bump версии используйте `npm run build:extension` или `npm run release` (см. `package.json`).

## После пуша на GitHub

Убедитесь, что в коммите есть актуальное содержимое **`chrome-extension/build`** и что в `chrome-extension/build/manifest.json` указана нужная версия — это и есть то, что пользователи загружают как распакованное расширение.
