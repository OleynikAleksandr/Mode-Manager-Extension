# План рефакторинга Mode-Manager-Extension

## 1. Цель рефакторинга

Основная цель - упростить пользовательский интерфейс и кодовую базу расширения, удалив вкладку "Roo Code Custom Modes" и связанную с ней функциональность. Вкладка "Stacks By Framework" должна стать основной и загружаться по умолчанию. Также необходимо подготовить место для будущей второй вкладки, которая пока останется пустой.

## 2. Ключевые изменения

*   Удаление вкладки "Roo Code Custom Modes" из основного UI.
*   Удаление логики загрузки, парсинга и отображения данных для "Roo Code Custom Modes".
*   Настройка вкладки "Stacks By Framework" как вкладки по умолчанию.
*   Обеспечение корректной загрузки данных для вкладки "Stacks By Framework" при инициализации панели.
*   Добавление заглушки для новой, пока пустой, второй вкладки.
*   Удаление неиспользуемых файлов и кода, связанных с функциональностью "Roo Code Custom Modes".

## 3. Детальный план по файлам и модулям

### 3.1. `src/ui/App.tsx`

*   **Управление состоянием вкладок:**
    *   Изменить начальное значение стейта `activeTab` с `0` на `0` (или `1`, если новая пустая вкладка будет сразу второй). Поскольку "Stacks By Framework" становится первой, ее индекс будет `0`. Новая пустая вкладка будет иметь индекс `1`. По умолчанию активной должна быть "Stacks By Framework".
        *   `const [activeTab, setActiveTab] = useState<number>(0);` // "Stacks By Framework" будет 0, новая пустая - 1.
*   **Отрисовка кнопок вкладок (JSX в районе строк 632-640 текущего файла):**
    *   Удалить кнопку для "Roo Code Custom Modes".
    *   Переименовать кнопку для "Stacks By Framework", если необходимо (например, если она была "Вкладка 2", а станет "Вкладка 1").
    *   Добавить новую кнопку для будущей пустой вкладки. Текст пока можно оставить как "Новая вкладка (пусто)" или аналогичный плейсхолдер.
*   **Отрисовка содержимого вкладок (условный рендеринг):**
    *   Удалить блок JSX, отвечающий за рендеринг содержимого для "Roo Code Custom Modes" (текущий `activeTab === 0`, строки ~680-706).
    *   Блок JSX для "Stacks By Framework" (текущий `activeTab === 1`, строки ~732-850) станет основным для `activeTab === 0`.
    *   Добавить простой JSX-блок (например, `<div>Содержимое новой вкладки появится здесь позже...</div>`) для `activeTab === 1` (новая пустая вкладка).
*   **Логика и состояния, связанные с "Roo Code Custom Modes":**
    *   Удалить стейт `modesData` и его сеттер `setModesData`.
    *   Удалить стейт `currentSelectedModeIds` и `setCurrentSelectedModeIds`.
    *   Удалить стейт `isLoading` и `error` (если они использовались только для "Roo Code Custom Modes", иначе пересмотреть).
    *   Удалить вызов `parseModes` и все его использования.
    *   В `useEffect` (строка 264, обработчик `handleMessage`):
        *   Удалить `case 'loadModes'` и `case 'loadModesError'`.
    *   В `useEffect` (строка 386, обновление унифицированного состояния):
        *   Удалить использование `modesData` и `allCustomModes`. Логика должна теперь работать только с `stacksData` (и `allStackModes`).
    *   Удалить функцию `handleSelectionChange` (строка 441), так как она работала с `modesData`.
*   **Логика и состояния, связанные с "Stacks By Framework":**
    *   Убедиться, что стейты `stacksData`, `selectedStackModeIds`, `isStacksLoading`, `stacksError` остаются и корректно используются.
    *   **Инициализация данных:**
        *   В `useEffect` (строка 260), после `vscode.postMessage({ command: 'webviewReady' });`, добавить:
            `vscode.postMessage({ command: 'requestStacksList', lang: currentLanguage });`
            Это обеспечит загрузку данных для "Stacks By Framework" при первой загрузке, а не только при смене языка.
*   **Общая/Унифицированная логика:**
    *   Стейт `selectedAndOrderedSlugs` и связанная с ним логика (`handleUnifiedModeSelection`, `handleUnifiedBatchModeSelection`, `useEffect` на строке 386) должны быть адаптированы для работы только с режимами из `stacksData`.
    *   Функция `getAllStackModes` остается актуальной.
    *   `handleStackModeSelection` и `handleSubgroupSelection` остаются актуальными.
    *   Логика кнопок "Apply", "Cancel" (`handleApply`, `handleCancel`) должна корректно работать с `selectedAndOrderedSlugs`, источником для которых теперь будет только "Stacks By Framework".
    *   `handleLanguageChange`: удалить строку `vscode.postMessage({ command: 'requestModeList', lang: lang });`.
*   **Удаление неиспользуемых типов:**
    *   Удалить интерфейс `Mode` (строки 20-28), если он больше нигде не используется после удаления `modesData` и `parseModes`.

### 3.2. `src/ui/webviewPanelManager.ts`

*   **Обработка сообщений от Webview:**
    *   В `currentWebviewPanel.webview.onDidReceiveMessage` (строка 117):
        *   Удалить `case 'requestModeList'`.
*   **Функция `loadAndSendData` (строка 235):**
    *   Эта функция в текущем виде загружает `roo_modes_list_*.md` и отправляет `loadModes`. Ее нужно будет либо полностью удалить, либо значительно переработать, если какая-то ее часть (например, чтение `.roomodes` для `initiallySelectedModesOrdered`) должна остаться для "Stacks By Framework".
    *   Учитывая, что `selectedModesOrdered` из `App.tsx` (строка 281) инициализируется на основе `message.selectedModesOrdered`, которое передается в `loadModes`, нужно будет обеспечить, чтобы эти начальные выбранные режимы (если они применимы к "Stacks By Framework") передавались при начальной загрузке `loadStacks`.
    *   **Предложение:** Перенести логику загрузки `stacks_by_framework_*.md` и отправки `loadStacks` из обработчика `requestStacksList` непосредственно в `loadAndSendData` (или в место первичной инициализации панели после `webviewReady`).
*   **Удаление импорта:** Удалить `generateRooModesListFile`, если он еще не удален.

### 3.3. `src/extension.ts`

*   **Логика копирования файлов при активации (строки 35-139):**
    *   Удалить код, связанный с `targetModesListEnPath`, `targetModesListUaPath`, `sourceModesListEnPath`, `sourceModesListUaPath`.
    *   Удалить проверки существования и копирование файлов `roo_modes_list_en.md` и `roo_modes_list_ua.md`.
    *   Удалить обновление `globalState` для `roo_modes_list_en_path` и `roo_modes_list_ua_path`.
*   **Импорты:** Удалить импорт `generateRooModesListFile` из `./core/modeListGenerator`.
*   **Вызовы `initializeModeManagerLogic`:** Проверить, не зависит ли эта функция косвенно от удаляемых файлов/логики (маловероятно, судя по коду `ModeManager.ts`).

### 3.4. Удаление файлов и кода

*   **Удалить файл:** `src/core/modeListGenerator.ts`.
*   **Удалить файлы данных:**
    *   `Mode-Manager-Extension/roo-commander/roo_modes_list_en.md`
    *   `Mode-Manager-Extension/roo-commander/roo_modes_list_ua.md`
*   **Проверить и удалить неиспользуемые функции/переменные** во всех затронутых файлах после основного рефакторинга.

### 3.5. Сохранение файлов

*   Файлы `Mode-Manager-Extension/roo-commander/stacks_by_framework_en.md` и `Mode-Manager-Extension/roo-commander/stacks_by_framework_ua.md` **остаются**, так как они являются источником данных для вкладки "Stacks By Framework".

### 3.6. `src/core/ModeManager.ts`

*   Текущий код `ModeManager.ts` не требует значительных изменений, так как он не содержит специфичной логики парсинга для удаляемой вкладки. Его метод `loadModes()` является заглушкой.
*   **Рекомендация на будущее (вне текущего рефакторинга):** Рассмотреть перенос логики парсинга данных (сейчас в `App.tsx` - `parseStacksData`) в `ModeManager.ts`, чтобы он стал единственным источником правды о режимах.

### 3.7. `src/ui/activityBarViewProvider.ts`

*   Изменения не требуются.

## 4. Тестирование

После рефакторинга необходимо тщательно протестировать:

1.  **Открытие расширения:**
    *   Корректное отображение UI в боковой панели.
    *   Корректное открытие основной webview-панели по кнопке.
2.  **Основная панель:**
    *   Отображается только одна активная вкладка "Stacks By Framework" и одна пустая вкладка (с плейсхолдером).
    *   "Stacks By Framework" является вкладкой по умолчанию.
    *   Данные для "Stacks By Framework" корректно загружаются и отображаются для языка по умолчанию (en) при первом открытии.
3.  **Функциональность "Stacks By Framework":**
    *   Выбор/снятие выбора режимов и подгрупп.
    *   Корректное отображение выбранных режимов в области "Selected: X Modes".
    *   Drag-and-drop для выбранных режимов (если эта функциональность должна сохраниться и она общая).
    *   Работа кнопок "Apply" и "Cancel".
    *   Смена языка (en, ua) и корректная перезагрузка/отображение данных для "Stacks By Framework".
4.  **Отсутствие ошибок:**
    *   Проверить консоль разработчика VS Code и консоль webview на наличие ошибок, связанных с удаленным кодом или измененной логикой.
5.  **Процесс активации расширения:**
    *   Убедиться, что удаление логики копирования `roo_modes_list_*.md` не вызывает ошибок при первой установке или обновлении расширения.

Этот план должен обеспечить компактное, но достаточное руководство для проведения рефакторинга.