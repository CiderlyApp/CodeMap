/**
 * @fileoverview Контроллер инспектора и генератор дедуплицированного контекста для LLM.
 * Реализует транзитивный двунаправленный сбор всех входящих и обратных зависимостей всех файлов.
 *
 * @module inspectorController
 */

import { state } from './state.js';
import { renderGraph } from './canvas-controller.js';

/**
 * Рекурсивно собирает транзитивное двунаправленное замыкание (все входящие импорты
 * и все обратные зависимости) для всех начальных файлов бандла с дедупликацией.
 *
 * @param {string} rootFileId - Основной выбранный файл.
 * @param {boolean} [onlySingle=false] - Возвращать исключительно одиночный файл.
 * @returns {string[]} Массив уникальных путей файлов без дубликатов.
 */
export function getDeduplicatedBundleFileIds(rootFileId, onlySingle = false) {
    const fileMap = new Map(state.projectFiles.map(f => [f.id, f]));
    if (!fileMap.has(rootFileId)) return [];

    if (onlySingle) {
        return state.excludedContextFiles.has(rootFileId) ? [] : [rootFileId];
    }

    // Построение карты обратных зависимостей для O(1) поиска
    const reverseDepsMap = new Map();
    state.projectFiles.forEach(f => {
        (f.dependencies || []).forEach(dep => {
            if (!reverseDepsMap.has(dep.target)) {
                reverseDepsMap.set(dep.target, new Set());
            }
            reverseDepsMap.get(dep.target).add(f.id);
        });
    });

    // Начальный фронт: выбранный файл + все добавленные пользователем файлы
    const visited = new Set();
    const queue = [];

    const addSeed = (id) => {
        if (fileMap.has(id) && !state.excludedContextFiles.has(id) && !visited.has(id)) {
            visited.add(id);
            queue.push(id);
        }
    };

    addSeed(rootFileId);
    (state.customContextFiles || new Set()).forEach(id => addSeed(id));

    // Транзитивный волновой обход (BFS) по входящим и обратным связям
    while (queue.length > 0) {
        const currId = queue.shift();
        const currFile = fileMap.get(currId);
        if (!currFile) continue;

        // 1. Входящие зависимости текущего файла (кого он импортирует: currId -> target)
        (currFile.dependencies || []).forEach(dep => {
            const targetId = dep.target;
            if (fileMap.has(targetId) && !state.excludedContextFiles.has(targetId) && !visited.has(targetId)) {
                visited.add(targetId);
                queue.push(targetId);
            }
        });

        // 2. Обратные зависимости текущего файла (кто его использует: source -> currId)
        const callers = reverseDepsMap.get(currId);
        if (callers) {
            callers.forEach(callerId => {
                if (fileMap.has(callerId) && !state.excludedContextFiles.has(callerId) && !visited.has(callerId)) {
                    visited.add(callerId);
                    queue.push(callerId);
                }
            });
        }
    }

    // Главный файл всегда идёт первым в списке
    const result = Array.from(visited);
    const rootIndex = result.indexOf(rootFileId);
    if (rootIndex > 0) {
        result.splice(rootIndex, 1);
        result.unshift(rootFileId);
    }

    return result;
}

/**
 * Открывает панель инспектора и заполняет её данными о выбранном файле и бандле.
 *
 * @param {string} fileId - Идентификатор файла.
 * @returns {void}
 */
export function openInspector(fileId) {
    const file = state.projectFiles.find(f => f.id === fileId);
    if (!file) return;

    safeSetText('inspector-file-name', file.name);
    safeSetText('inspector-file-path', file.id);
    safeSetText('inspector-full-path', file.id);

    const tagsEl = document.getElementById('inspector-tags');
    if (tagsEl) {
        tagsEl.innerHTML = (file.tags || []).map(t => `<span class="badge">${t}</span>`).join('');
    }

    // Баннер кандидатов рефакторинга
    const banner = document.getElementById('inspector-refactor-banner');
    const desc = document.getElementById('inspector-refactor-desc');
    if (banner && desc) {
        if (file.lines >= state.thresholds.large) {
            banner.style.display = 'flex';
            desc.innerText = `Файл содержит ${file.lines} строк кода (порог: ${state.thresholds.large}). Рекомендуется рефакторинг.`;
        } else {
            banner.style.display = 'none';
        }
    }

    // 1. Входящие зависимости (кого импортирует этот файл)
    const directDeps = file.dependencies || [];
    safeSetText('inspector-imports-count', directDeps.length.toString());
    const importsList = document.getElementById('inspector-imports-list');
    if (importsList) {
        importsList.innerHTML = directDeps.map(d => {
            const isExcluded = state.excludedContextFiles.has(d.target);
            return `
                <div class="dep-row-item ${isExcluded ? 'excluded-from-context' : ''}" data-target="${d.target}" title="Включить/исключить из бандла">
                    <span class="dep-status-icon">${isExcluded ? '❌' : '✅'}</span>
                    <span style="flex:1;">${d.target.split('/').pop()}</span>
                    <span style="font-size:10px; color:#64748b;">${d.type}</span>
                </div>
            `;
        }).join('') || '<div style="color:#64748b;font-size:11px;">Нет прямых импортов</div>';

        importsList.querySelectorAll('.dep-row-item').forEach(it => {
            it.onclick = (e) => {
                e.stopPropagation();
                toggleContextExclusion(it.dataset.target);
            };
        });
    }

    // 2. Обратные зависимости (кто использует этот файл)
    const importedBy = state.projectFiles.filter(o => (o.dependencies || []).some(d => d.target === file.id));
    safeSetText('inspector-imported-by-count', importedBy.length.toString());
    const importedByList = document.getElementById('inspector-imported-by-list');
    if (importedByList) {
        importedByList.innerHTML = importedBy.map(o => {
            const isExcluded = state.excludedContextFiles.has(o.id);
            return `
                <div class="dep-row-item ${isExcluded ? 'excluded-from-context' : ''}" data-target="${o.id}" title="Включить/исключить из бандла">
                    <span class="dep-status-icon">${isExcluded ? '❌' : '✅'}</span>
                    <span style="flex:1;">${o.name}</span>
                    <span style="font-size:10px; color:#64748b;">used-by</span>
                </div>
            `;
        }).join('') || '<div style="color:#64748b;font-size:11px;">Не используется другими файлами</div>';

        importedByList.querySelectorAll('.dep-row-item').forEach(it => {
            it.onclick = (e) => {
                e.stopPropagation();
                toggleContextExclusion(it.dataset.target);
            };
        });
    }

    // 3. Полный транзитивный состав бандла (все файлы)
    renderBundleCompositionList();

    // 4. Список файлов, добавленных вручную
    renderCustomContextList();

    // 5. Статистика
    const allBundleIds = getDeduplicatedBundleFileIds(fileId, false);
    safeSetText('active-deps-count', allBundleIds.length.toString());
    safeSetText('inspector-stat-direct', directDeps.length.toString());
    safeSetText('inspector-stat-reverse', importedBy.length.toString());
    safeSetText('inspector-stat-bundle', allBundleIds.length.toString());
    safeSetText('inspector-stat-lines', file.lines.toString());

    const codeView = document.getElementById('inspector-code-view');
    if (codeView && codeView.style.display !== 'none') {
        loadCodeToViewer();
    }
}

/**
 * Отрисовывает полный список файлов, вошедших в транзитивный бандл.
 *
 * @returns {void}
 */
export function renderBundleCompositionList() {
    const list = document.getElementById('inspector-bundle-list');
    if (!list || !state.selectedFileId) return;

    const bundleIds = getDeduplicatedBundleFileIds(state.selectedFileId, false);
    safeSetText('inspector-bundle-count', bundleIds.length.toString());

    const fileMap = new Map(state.projectFiles.map(f => [f.id, f]));

    list.innerHTML = bundleIds.map(fId => {
        const fileObj = fileMap.get(fId);
        const name = fileObj ? fileObj.name : fId.split('/').pop();
        const isRoot = fId === state.selectedFileId;
        const isCustom = state.customContextFiles.has(fId);

        let badge = 'dep';
        if (isRoot) badge = 'root';
        else if (isCustom) badge = 'pinned';

        return `
            <div class="dep-row-item" data-bundle-target="${fId}" title="Кликните для исключения/включения файла">
                <span class="dep-status-icon">✅</span>
                <span style="flex:1;" title="${fId}">${name}</span>
                <span class="bundle-role-tag role-${badge}">${badge}</span>
            </div>
        `;
    }).join('') || '<div style="color:#64748b;font-size:11px;">Бандл пуст</div>';

    list.querySelectorAll('.dep-row-item').forEach(it => {
        it.onclick = (e) => {
            e.stopPropagation();
            toggleContextExclusion(it.dataset.bundleTarget);
        };
    });
}

/**
 * Отрисовывает блок добавленных вручную файлов в инспекторе.
 *
 * @returns {void}
 */
export function renderCustomContextList() {
    const list = document.getElementById('inspector-custom-context-list');
    safeSetText('inspector-custom-context-count', state.customContextFiles.size.toString());

    const pinBtn = document.getElementById('btn-toggle-custom-context');
    if (pinBtn && state.selectedFileId) {
        const isPinned = state.customContextFiles.has(state.selectedFileId);
        pinBtn.classList.toggle('active', isPinned);
        pinBtn.title = isPinned ? 'Удалить текущий файл из бандла' : 'Добавить текущий файл в бандл';
    }

    if (!list) return;

    if (state.customContextFiles.size === 0) {
        list.innerHTML = '<div style="color:#64748b;font-size:11px;">Нет файлов, добавленных вручную</div>';
        return;
    }

    list.innerHTML = Array.from(state.customContextFiles).map(fId => {
        const file = state.projectFiles.find(f => f.id === fId);
        const name = file ? file.name : fId.split('/').pop();
        return `
            <div class="dep-row-item" data-id="${fId}">
                <span class="dep-status-icon">📌</span>
                <span style="flex:1;" title="${fId}">${name}</span>
                <button class="btn-remove-custom-file" data-remove="${fId}" title="Убрать из бандла">✕</button>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.btn-remove-custom-file').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleCustomContextFile(btn.dataset.remove);
        };
    });
}

/**
 * Добавляет или удаляет файл из списка закреплённых в контексте.
 *
 * @param {string} fileId - Идентификатор файла.
 * @returns {void}
 */
export function toggleCustomContextFile(fileId) {
    if (!fileId) return;

    if (state.customContextFiles.has(fileId)) {
        state.customContextFiles.delete(fileId);
    } else {
        state.customContextFiles.add(fileId);
        state.excludedContextFiles.delete(fileId);
    }

    if (state.selectedFileId) {
        openInspector(state.selectedFileId);
    }
    renderGraph();
}

/**
 * Очищает список вручную добавленных файлов.
 *
 * @returns {void}
 */
export function clearCustomContext() {
    state.customContextFiles.clear();
    document.querySelectorAll('.tree-file').forEach(el => {
        el.classList.remove('pinned-to-context');
        const pinIcon = el.querySelector('.btn-tree-pin');
        if (pinIcon) pinIcon.innerText = '📌';
    });
    if (state.selectedFileId) {
        openInspector(state.selectedFileId);
    }
    renderGraph();
}

/**
 * Переключает статус исключения файла из бандла.
 *
 * @param {string} fileId - Идентификатор файла.
 * @returns {void}
 */
export function toggleContextExclusion(fileId) {
    if (state.excludedContextFiles.has(fileId)) {
        state.excludedContextFiles.delete(fileId);
    } else {
        state.excludedContextFiles.add(fileId);
    }
    if (state.selectedFileId) {
        openInspector(state.selectedFileId);
    }
    renderGraph();
}

/**
 * Загружает исходный код файла.
 *
 * @async
 * @param {import('./data.js').CodeFileNode} file - Объект файла.
 * @returns {Promise<string>} Исходный код.
 */
export async function fetchFileContent(file) {
    if (file.content) return file.content;

    try {
        const resp = await fetch('/api/export_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [file.id] })
        });
        if (resp.ok) {
            const data = await resp.json();
            const raw = data.text || '';
            const match = raw.match(/<file[^>]*>([\s\S]*?)<\/file>/);
            return match ? match[1].trim() : raw;
        }
    } catch (e) {
        console.warn('Не удалось запросить код с сервера:', e);
    }
    return `// Файл: ${file.name}\n// Путь: ${file.id}\n// Строк: ${file.lines}`;
}

/**
 * Формирует чистый текстовый бандл для передачи в LLM без тегов <file> и ## path.
 *
 * @async
 * @param {string} rootFileId - Корневой файл.
 * @param {boolean} [onlySingle=false] - Копировать только одиночный файл.
 * @returns {Promise<string>} Чистый форматированный текст.
 */
export async function buildFormattedAIContext(rootFileId, onlySingle = false) {
    const fileMap = new Map(state.projectFiles.map(f => [f.id, f]));
    const targetIds = getDeduplicatedBundleFileIds(rootFileId, onlySingle);
    if (targetIds.length === 0) return '';

    const root = fileMap.get(rootFileId);
    const output = [];

    if (targetIds.length > 1 && root) {
        output.push(`// ========================================================`);
        output.push(`// CONTEXT BUNDLE FOR: ${root.name}`);
        output.push(`// TOTAL UNIQUE FILES (TRANSITIVE): ${targetIds.length}`);
        output.push(`// ========================================================\n`);
    }

    for (const fId of targetIds) {
        const fileObj = fileMap.get(fId);
        if (!fileObj) continue;

        const content = await fetchFileContent(fileObj);

        output.push(`// ========================================================`);
        output.push(`// FILE: ${fileObj.id}`);
        output.push(`// ========================================================`);
        output.push(content.trimEnd());
        output.push('\n');
    }

    return output.join('\n');
}

/**
 * Подгружает текст файла во вкладку Code Viewer.
 *
 * @async
 * @returns {Promise<void>}
 */
export async function loadCodeToViewer() {
    const file = state.projectFiles.find(f => f.id === state.selectedFileId);
    const contentEl = document.getElementById('code-viewer-content');
    const headerEl = document.getElementById('code-viewer-filename');
    if (!contentEl) return;

    if (!file) {
        contentEl.innerText = '// Файл не выбран';
        return;
    }

    if (headerEl) headerEl.innerText = file.name;
    contentEl.innerText = 'Загрузка содержимого...';
    const code = await fetchFileContent(file);
    contentEl.innerText = code || '// [Файл пуст или содержимое недоступно]';
}

/**
 * Инициализирует вкладки "Зависимости" и "Просмотр кода".
 *
 * @returns {void}
 */
export function initCodeViewerTabs() {
    const tabDeps = document.getElementById('tab-btn-deps');
    const tabCode = document.getElementById('tab-btn-code');
    const viewDeps = document.getElementById('inspector-deps-view');
    const viewCode = document.getElementById('inspector-code-view');
    const copyRawBtn = document.getElementById('btn-copy-raw-code');

    if (tabDeps && tabCode) {
        tabDeps.onclick = () => {
            tabDeps.classList.add('active');
            tabCode.classList.remove('active');
            if (viewDeps) viewDeps.style.display = 'flex';
            if (viewCode) viewCode.style.display = 'none';
        };

        tabCode.onclick = () => {
            tabCode.classList.add('active');
            tabDeps.classList.remove('active');
            if (viewDeps) viewDeps.style.display = 'none';
            if (viewCode) viewCode.style.display = 'flex';
            loadCodeToViewer();
        };
    }

    if (copyRawBtn) {
        copyRawBtn.onclick = async () => {
            const file = state.projectFiles.find(f => f.id === state.selectedFileId);
            if (!file) return;
            const content = await fetchFileContent(file);
            await navigator.clipboard.writeText(content);
            copyRawBtn.innerText = '✅ Скопировано!';
            setTimeout(() => { copyRawBtn.innerText = 'Скопировать весь код'; }, 2000);
        };
    }
}

/**
 * Инициализирует кнопки копирования бандла и управления контекстом.
 *
 * @returns {void}
 */
export function initAICopyButtons() {
    const btnOnly = document.getElementById('btn-copy-file-only');
    const btnBundle = document.getElementById('btn-copy-bundle');
    const btnPin = document.getElementById('btn-toggle-custom-context');
    const btnClear = document.getElementById('btn-clear-custom-context');

    if (btnOnly) {
        btnOnly.onclick = async () => {
            if (!state.selectedFileId) return;
            const text = await buildFormattedAIContext(state.selectedFileId, true);
            await navigator.clipboard.writeText(text);
            btnOnly.innerText = '✅ Скопировано!';
            setTimeout(() => { btnOnly.innerText = '📄 Только файл'; }, 2000);
        };
    }

    if (btnBundle) {
        btnBundle.onclick = async () => {
            if (!state.selectedFileId) return;
            const text = await buildFormattedAIContext(state.selectedFileId, false);
            await navigator.clipboard.writeText(text);
            btnBundle.innerText = '✅ Скопирован бандл!';
            setTimeout(() => {
                const countBadge = document.getElementById('active-deps-count');
                btnBundle.innerHTML = `<span>📦</span> Бандл (<span id="active-deps-count">${countBadge ? countBadge.innerText : '0'}</span>)`;
            }, 2000);
        };
    }

    if (btnPin) {
        btnPin.onclick = () => {
            if (!state.selectedFileId) return;
            toggleCustomContextFile(state.selectedFileId);
        };
    }

    if (btnClear) {
        btnClear.onclick = () => {
            clearCustomContext();
        };
    }
}

/**
 * Инициализирует боковую шторку инспектора.
 *
 * @returns {void}
 */
export function initDrawer() {
    const drawer = document.getElementById('right-sidebar');
    const toggleBtn = document.getElementById('btn-toggle-drawer');
    if (!drawer || !toggleBtn) return;

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        state.isDrawerOpen = !state.isDrawerOpen;
        drawer.classList.toggle('collapsed', !state.isDrawerOpen);
    };
}

/**
 * Гарантирует открытие боковой шторки.
 *
 * @returns {void}
 */
export function ensureDrawerOpen() {
    const drawer = document.getElementById('right-sidebar');
    if (drawer && !state.isDrawerOpen) {
        state.isDrawerOpen = true;
        drawer.classList.remove('collapsed');
    }
}

/**
 * Безопасная установка текста в элемент DOM.
 *
 * @param {string} elementId - ID элемента.
 * @param {string} text - Текст.
 */
function safeSetText(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) el.innerText = text;
}