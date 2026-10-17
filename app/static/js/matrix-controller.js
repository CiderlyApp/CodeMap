/**
 * @fileoverview Контроллер режима «Матрица зависимостей» (Dependency Structure Matrix - DSM).
 * Обеспечивает отображение матрицы на уровне файлов и модулей, сортировку, фильтрацию
 * и выявление межпапочной архитектурной связности.
 *
 * @module matrixController
 */

import { state } from './state.js';
import { computeGraphMetrics } from './graph-engine.js';
import { toggleCustomContextFile } from './inspector-controller.js';

/**
 * Инициализирует и отрисовывает Матрицу зависимостей в рабочей области.
 *
 * @param {function(string, boolean=): void} onFileSelect - Callback выбора файла.
 * @returns {void}
 */
export function renderDependencyMatrix(onFileSelect) {
    const container = document.getElementById('matrix-viewport-container');
    if (!container) return;

    container.innerHTML = '';
    const level = state.matrixSettings.level;

    if (level === 'modules') {
        renderModuleMatrix(container, onFileSelect);
    } else {
        renderFileMatrix(container, onFileSelect);
    }
}

/**
 * Отрисовывает файловую матрицу зависимостей (Files DSM).
 *
 * @param {HTMLElement} container - DOM-контейнер.
 * @param {function(string): void} onFileSelect - Callback выбора.
 */
function renderFileMatrix(container, onFileSelect) {
    const files = getFilteredAndSortedFiles();
    const metrics = computeGraphMetrics(state.projectFiles, state.activeEdgeTypes);
    const fileIdList = files.map(f => f.id);
    const fileMap = new Map(files.map(f => [f.id, f]));

    // Построение карты связей: Map<sourceId, Map<targetId, Edge[]>>
    const matrixData = new Map();
    fileIdList.forEach(src => matrixData.set(src, new Map()));

    files.forEach(src => {
        (src.dependencies || []).forEach(dep => {
            if (state.activeEdgeTypes && !state.activeEdgeTypes.has(dep.type || 'import')) return;
            if (matrixData.has(dep.target) && dep.target !== src.id) {
                if (!matrixData.get(src.id).has(dep.target)) {
                    matrixData.get(src.id).set(dep.target, []);
                }
                matrixData.get(src.id).get(dep.target).push(dep);
            }
        });
    });

    const wrap = document.createElement('div');
    wrap.className = 'dsm-wrapper';

    // Панель управления матрицей
    wrap.innerHTML = `
        <div class="dsm-toolbar">
            <div class="dsm-toolbar-left">
                <span class="dsm-title">Файловая матрица зависимостей (${files.length} × ${files.length})</span>
                <span class="dsm-legend-hint">Строка ➔ импортирует ➔ Столбец</span>
            </div>
            <div class="dsm-toolbar-right">
                <input type="text" id="dsm-search-input" class="dsm-search" placeholder="Фильтр файлов..." value="${state.matrixSettings.searchQuery}">
                <select id="dsm-sort-select" class="dropdown-select btn-sm">
                    <option value="name" ${state.matrixSettings.sortBy === 'name' ? 'selected' : ''}>По имени</option>
                    <option value="in-degree" ${state.matrixSettings.sortBy === 'in-degree' ? 'selected' : ''}>По In-degree (исп-ся в)</option>
                    <option value="out-degree" ${state.matrixSettings.sortBy === 'out-degree' ? 'selected' : ''}>По Out-degree (импорты)</option>
                    <option value="lines" ${state.matrixSettings.sortBy === 'lines' ? 'selected' : ''}>По строкам (LOC)</option>
                </select>
                <button class="btn btn-secondary btn-sm" id="btn-toggle-dsm-level">🏢 Показать модули</button>
            </div>
        </div>
        <div class="dsm-table-scroll-box" id="dsm-table-scroll-box">
            <table class="dsm-table" id="dsm-table">
                <thead>
                    <tr id="dsm-header-row">
                        <th class="dsm-corner-cell">SOURCE \\ TARGET</th>
                        ${files.map((f, idx) => `
                            <th class="dsm-col-header" data-col-id="${f.id}" title="${f.id} (${f.folder})">
                                <div class="dsm-col-label">${idx + 1}. ${f.name}</div>
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody id="dsm-body">
                    ${files.map((src, rIdx) => `
                        <tr class="dsm-row" data-row-id="${src.id}">
                            <td class="dsm-row-header ${src.id === state.selectedFileId ? 'active-file' : ''}" data-row-id="${src.id}" title="${src.id}">
                                <div class="dsm-row-label">
                                    <span class="dsm-idx">${rIdx + 1}</span>
                                    <span class="dsm-fname">${src.name}</span>
                                    <span class="dsm-in-out-badge">in:${metrics.inDegreeMap.get(src.id) || 0} / out:${metrics.outDegreeMap.get(src.id) || 0}</span>
                                </div>
                            </td>
                            ${files.map(tgt => {
                                const isDiagonal = src.id === tgt.id;
                                const deps = matrixData.get(src.id).get(tgt.id) || [];
                                const hasDep = deps.length > 0;
                                const cellClasses = [
                                    'dsm-cell',
                                    isDiagonal ? 'dsm-diagonal' : '',
                                    hasDep ? 'dsm-has-edge' : '',
                                    hasDep && deps[0].type ? `dsm-type-${deps[0].type.replace('_', '-')}` : ''
                                ].filter(Boolean).join(' ');

                                const badgeText = hasDep ? (deps.length > 1 ? deps.length : '●') : '';
                                return `
                                    <td class="${cellClasses}" data-source="${src.id}" data-target="${tgt.id}" title="${isDiagonal ? 'Самоссылка (диагональ)' : (hasDep ? `${src.name} ➔ ${tgt.name} (${deps.map(d=>d.type).join(', ')})` : '')}">
                                        ${badgeText}
                                    </td>
                                `;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div id="dsm-cell-details-popup" class="dsm-details-popup" style="display: none;"></div>
    `;

    container.appendChild(wrap);
    bindMatrixEvents(wrap, onFileSelect);
}

/**
 * Отрисовывает агрегированную матрицу модулей/папок (Modules DSM).
 * Различает уникальные пары файлов и суммарное количество связей.
 *
 * @param {HTMLElement} container - DOM-контейнер.
 * @param {function(string): void} onFileSelect - Callback выбора.
 */
function renderModuleMatrix(container, onFileSelect) {
    const foldersSet = new Set(state.projectFiles.map(f => f.folder || 'root'));
    const folders = Array.from(foldersSet).sort();
    const fileMap = new Map(state.projectFiles.map(f => [f.id, f]));

    // Агрегация: Map<srcFolder, Map<tgtFolder, { uniquePairs: Set<string>, totalImports: number, statements: Array }>>
    const moduleMatrix = new Map();
    folders.forEach(f1 => {
        moduleMatrix.set(f1, new Map());
        folders.forEach(f2 => {
            moduleMatrix.get(f1).set(f2, { uniquePairs: new Set(), totalImports: 0, links: [] });
        });
    });

    state.projectFiles.forEach(src => {
        const srcFolder = src.folder || 'root';
        (src.dependencies || []).forEach(dep => {
            if (state.activeEdgeTypes && !state.activeEdgeTypes.has(dep.type || 'import')) return;
            const tgt = fileMap.get(dep.target);
            if (!tgt) return;
            const tgtFolder = tgt.folder || 'root';

            const bucket = moduleMatrix.get(srcFolder).get(tgtFolder);
            bucket.uniquePairs.add(`${src.id}➔${tgt.id}`);
            bucket.totalImports++;
            bucket.links.push({ from: src.id, to: tgt.id, type: dep.type || 'import' });
        });
    });

    const wrap = document.createElement('div');
    wrap.className = 'dsm-wrapper';

    wrap.innerHTML = `
        <div class="dsm-toolbar">
            <div class="dsm-toolbar-left">
                <span class="dsm-title">Модульная матрица зависимостей (${folders.length} × ${folders.length})</span>
                <span class="dsm-legend-hint">Значение ячейки: уникальные пары файлов / (всего импортов)</span>
            </div>
            <div class="dsm-toolbar-right">
                <button class="btn btn-secondary btn-sm" id="btn-toggle-dsm-level">📄 Показать файлы</button>
            </div>
        </div>
        <div class="dsm-table-scroll-box">
            <table class="dsm-table dsm-module-table">
                <thead>
                    <tr>
                        <th class="dsm-corner-cell">MODULE SOURCE \\ TARGET</th>
                        ${folders.map(f => `<th class="dsm-col-header"><div class="dsm-col-label">📁 ${f}/</div></th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${folders.map(srcFolder => `
                        <tr class="dsm-row">
                            <td class="dsm-row-header"><span class="dsm-fname">📁 ${srcFolder}/</span></td>
                            ${folders.map(tgtFolder => {
                                const isDiag = srcFolder === tgtFolder;
                                const cellData = moduleMatrix.get(srcFolder).get(tgtFolder);
                                const pairsCount = cellData.uniquePairs.size;
                                const totalCount = cellData.totalImports;
                                const hasLinks = pairsCount > 0;

                                return `
                                    <td class="dsm-cell dsm-module-cell ${isDiag ? 'dsm-diagonal' : ''} ${hasLinks ? 'dsm-has-edge' : ''}"
                                        data-src-folder="${srcFolder}" data-tgt-folder="${tgtFolder}"
                                        title="${srcFolder} ➔ ${tgtFolder}: ${pairsCount} пар, ${totalCount} импортов">
                                        ${hasLinks ? `<span class="pair-cnt">${pairsCount}</span><span class="total-cnt">(${totalCount})</span>` : ''}
                                    </td>
                                `;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div id="dsm-cell-details-popup" class="dsm-details-popup" style="display: none;"></div>
    `;

    container.appendChild(wrap);

    const toggleBtn = wrap.querySelector('#btn-toggle-dsm-level');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            state.matrixSettings.level = 'files';
            renderDependencyMatrix(onFileSelect);
        };
    }

    // Клик по модульной ячейке
    wrap.querySelectorAll('.dsm-module-cell').forEach(cell => {
        cell.onclick = (e) => {
            const srcFolder = cell.dataset.srcFolder;
            const tgtFolder = cell.dataset.tgtFolder;
            const data = moduleMatrix.get(srcFolder).get(tgtFolder);
            if (!data || data.uniquePairs.size === 0) return;

            showModuleCellPopup(e, srcFolder, tgtFolder, data, onFileSelect);
        };
    });
}

function bindMatrixEvents(wrap, onFileSelect) {
    const searchInput = wrap.querySelector('#dsm-search-input');
    const sortSelect = wrap.querySelector('#dsm-sort-select');
    const toggleBtn = wrap.querySelector('#btn-toggle-dsm-level');

    if (searchInput) {
        searchInput.oninput = (e) => {
            state.matrixSettings.searchQuery = e.target.value.toLowerCase();
            renderDependencyMatrix(onFileSelect);
        };
    }

    if (sortSelect) {
        sortSelect.onchange = (e) => {
            state.matrixSettings.sortBy = e.target.value;
            renderDependencyMatrix(onFileSelect);
        };
    }

    if (toggleBtn) {
        toggleBtn.onclick = () => {
            state.matrixSettings.level = state.matrixSettings.level === 'files' ? 'modules' : 'files';
            renderDependencyMatrix(onFileSelect);
        };
    }

    // Подсветка строки и столбца при наведении
    wrap.querySelectorAll('.dsm-cell').forEach(cell => {
        cell.onmouseenter = () => {
            const srcId = cell.dataset.source;
            const tgtId = cell.dataset.target;
            wrap.querySelectorAll('.dsm-cell').forEach(c => c.classList.remove('highlight-row', 'highlight-col'));
            wrap.querySelectorAll(`[data-source="${srcId}"]`).forEach(c => c.classList.add('highlight-row'));
            wrap.querySelectorAll(`[data-target="${tgtId}"]`).forEach(c => c.classList.add('highlight-col'));
        };
    });

    wrap.onmouseleave = () => {
        wrap.querySelectorAll('.dsm-cell').forEach(c => c.classList.remove('highlight-row', 'highlight-col'));
    };

    // Клик по ячейке связи
    wrap.querySelectorAll('.dsm-cell.dsm-has-edge').forEach(cell => {
        cell.onclick = (e) => {
            const srcId = cell.dataset.source;
            const tgtId = cell.dataset.target;
            showFileCellPopup(e, srcId, tgtId, onFileSelect);
        };
    });

    // Клик по заголовку строки файла -> выбор файла
    wrap.querySelectorAll('.dsm-row-header').forEach(header => {
        header.onclick = (e) => {
            e.stopPropagation();
            const fId = header.dataset.rowId;
            if (onFileSelect) onFileSelect(fId, true);
        };
    });
}

function showFileCellPopup(event, srcId, tgtId, onFileSelect) {
    const popup = document.getElementById('dsm-cell-details-popup');
    if (!popup) return;

    const srcFile = state.projectFiles.find(f => f.id === srcId);
    const deps = (srcFile?.dependencies || []).filter(d => d.target === tgtId);

    popup.style.display = 'block';
    popup.style.left = `${Math.min(event.clientX + 10, window.innerWidth - 380)}px`;
    popup.style.top = `${Math.min(event.clientY + 10, window.innerHeight - 250)}px`;

    popup.innerHTML = `
        <div class="popup-header">
            <strong>Связь зависимостей</strong>
            <button class="popup-close-btn" onclick="this.parentElement.parentElement.style.display='none'">✕</button>
        </div>
        <div class="popup-body">
            <div class="popup-link-row"><strong>Source:</strong> <code>${srcId}</code></div>
            <div class="popup-link-row"><strong>Target:</strong> <code>${tgtId}</code></div>
            <div class="popup-link-row"><strong>Обнаруженные импорты:</strong></div>
            <ul class="popup-dep-list">
                ${deps.map(d => `<li><code>${d.type}</code>: ${d.statement || tgtId}</li>`).join('')}
            </ul>
        </div>
        <div class="popup-footer">
            <button class="btn btn-secondary btn-sm" id="btn-popup-goto-src">Перейти к ${srcFile?.name || 'источнику'}</button>
            <button class="btn btn-primary btn-sm" id="btn-popup-pin-target">Добавить в Bundle</button>
        </div>
    `;

    popup.querySelector('#btn-popup-goto-src').onclick = () => {
        popup.style.display = 'none';
        if (onFileSelect) onFileSelect(srcId, true);
    };

    popup.querySelector('#btn-popup-pin-target').onclick = () => {
        toggleCustomContextFile(tgtId);
        popup.style.display = 'none';
    };
}

function showModuleCellPopup(event, srcFolder, tgtFolder, data, onFileSelect) {
    const popup = document.getElementById('dsm-cell-details-popup');
    if (!popup) return;

    popup.style.display = 'block';
    popup.style.left = `${Math.min(event.clientX + 10, window.innerWidth - 420)}px`;
    popup.style.top = `${Math.min(event.clientY + 10, window.innerHeight - 300)}px`;

    popup.innerHTML = `
        <div class="popup-header">
            <strong>Межмодульная связь: ${srcFolder} ➔ ${tgtFolder}</strong>
            <button class="popup-close-btn" onclick="this.parentElement.parentElement.style.display='none'">✕</button>
        </div>
        <div class="popup-body">
            <div class="popup-link-row">Уникальных пар файлов: <strong>${data.uniquePairs.size}</strong></div>
            <div class="popup-link-row">Суммарно импортов: <strong>${data.totalImports}</strong></div>
            <div class="popup-link-row" style="margin-top:6px;"><strong>Конкретные связи файлов:</strong></div>
            <div class="popup-scroll-links">
                ${data.links.map(l => `
                    <div class="popup-file-pair-item" data-src="${l.from}">
                        <span>${l.from.split('/').pop()}</span> ➔ <span>${l.to.split('/').pop()}</span>
                        <span class="meta-tag">${l.type}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    popup.querySelectorAll('.popup-file-pair-item').forEach(el => {
        el.onclick = () => {
            popup.style.display = 'none';
            if (onFileSelect) onFileSelect(el.dataset.src, true);
        };
    });
}

function getFilteredAndSortedFiles() {
    let files = [...state.projectFiles];
    const q = state.matrixSettings.searchQuery;
    if (q) {
        files = files.filter(f => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
    }

    const metrics = computeGraphMetrics(state.projectFiles, state.activeEdgeTypes);
    const sortBy = state.matrixSettings.sortBy;

    files.sort((a, b) => {
        if (sortBy === 'in-degree') {
            return (metrics.inDegreeMap.get(b.id) || 0) - (metrics.inDegreeMap.get(a.id) || 0);
        }
        if (sortBy === 'out-degree') {
            return (metrics.outDegreeMap.get(b.id) || 0) - (metrics.outDegreeMap.get(a.id) || 0);
        }
        if (sortBy === 'lines') {
            return b.lines - a.lines;
        }
        return a.name.localeCompare(b.name);
    });

    return files;
}