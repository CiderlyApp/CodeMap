/**
 * @fileoverview Контроллер дерева файлов проекта и управления фокусом графа.
 * Отвечает за рендеринг структуры каталогов, фильтрацию сирот, выбор файлов
 * и добавление файлов в контекст ИИ прямо из дерева.
 *
 * @module treeController
 */

import { state } from './state.js';
import { renderGraph, centerNode } from './canvas-controller.js';
import { openInspector, ensureDrawerOpen, toggleCustomContextFile } from './inspector-controller.js';

/**
 * Отрисовывает интерактивное дерево файлов со сворачиваемыми директориями
 * и кнопками быстрого добавления в бандл.
 *
 * @returns {void}
 */
export function initTree() {
    const container = document.getElementById('project-tree-view');
    if (!container) return;
    container.innerHTML = '';

    const connectedNodeIds = new Set();
    state.projectFiles.forEach(f => {
        (f.dependencies || []).forEach(dep => {
            connectedNodeIds.add(f.id);
            connectedNodeIds.add(dep.target);
        });
    });

    const folders = new Map();
    state.projectFiles.forEach(f => {
        const isOrphan = !connectedNodeIds.has(f.id);
        if (state.orphanFilter === 'no-orphans' && isOrphan) return;
        if (state.orphanFilter === 'only-orphans' && !isOrphan) return;

        const folder = f.folder || 'root';
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder).push({ ...f, isOrphan });
    });

    folders.forEach((files, folderName) => {
        const folderEl = document.createElement('div');
        const isCollapsed = state.collapsedFolders.has(folderName);
        folderEl.className = `tree-folder ${isCollapsed ? 'collapsed' : ''}`;
        folderEl.innerHTML = `
            <span class="arrow-toggle">▾</span>
            <span>📂</span>
            <span style="font-weight:600;">${folderName}</span>
            <span style="font-size:10px; color:#64748b; margin-left:auto;">${files.length}</span>
        `;

        const group = document.createElement('div');
        group.className = `tree-children ${isCollapsed ? 'collapsed' : ''}`;

        folderEl.onclick = (e) => {
            e.stopPropagation();
            if (state.collapsedFolders.has(folderName)) {
                state.collapsedFolders.delete(folderName);
                folderEl.classList.remove('collapsed');
                group.classList.remove('collapsed');
            } else {
                state.collapsedFolders.add(folderName);
                folderEl.classList.add('collapsed');
                group.classList.add('collapsed');
            }
        };

        files.forEach(file => {
            const item = document.createElement('div');
            const isPinned = state.customContextFiles.has(file.id);
            item.className = `tree-file ${isPinned ? 'pinned-to-context' : ''}`;
            item.dataset.fileId = file.id;

            if (file.lines >= state.thresholds.large) item.classList.add('candidate-warn');
            if (file.id === state.selectedFileId) item.classList.add('selected');
            if (file.isOrphan) item.classList.add('orphan-file');

            item.innerHTML = `
                <span class="tree-icon">📄</span>
                <span class="tree-label">${file.name}</span>
                <button class="btn-tree-pin" title="Добавить / убрать файл из контекста ИИ">${isPinned ? '✓' : '📌'}</button>
            `;

            // Клик по кнопке пина в дереве
            const pinBtn = item.querySelector('.btn-tree-pin');
            if (pinBtn) {
                pinBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    toggleCustomContextFile(file.id);
                };
            }

            // Клик на файл: фокусировка
            item.onclick = (e) => {
                e.stopPropagation();
                selectFile(file.id, true);
            };
            group.appendChild(item);
        });

        container.appendChild(folderEl);
        container.appendChild(group);
    });
}

/**
 * Переводит приложение в режим фокусировки на конкретном файле и его связях.
 *
 * @param {string} fileId - Идентификатор файла.
 * @param {boolean} [shouldCenter=false] - Центрировать ли холст на карточке файла.
 * @returns {void}
 */
export function selectFile(fileId, shouldCenter = false) {
    state.selectedFileId = fileId;
    state.isOverviewMode = false;
    state.focusFiles = new Set([fileId]);
    state.excludedContextFiles.clear();

    ensureDrawerOpen();
    openInspector(fileId);

    document.querySelectorAll('.tree-file').forEach(el => {
        el.classList.toggle('selected', el.dataset.fileId === fileId);
    });

    renderGraph(selectFile);
    updateContextPill();
    if (shouldCenter) centerNode(fileId);
}

/**
 * Инициализирует выпадающий селектор фильтрации файлов-сирот.
 *
 * @returns {void}
 */
export function initOrphanFilter() {
    const select = document.getElementById('orphan-filter-select');
    if (!select) return;

    select.value = state.orphanFilter;
    select.onchange = (e) => {
        state.orphanFilter = e.target.value;
        initTree();
        renderGraph(selectFile);
    };
}

/**
 * Обновляет плашку-индикатор активного фокуса на холсте.
 *
 * @returns {void}
 */
export function updateContextPill() {
    const pill = document.getElementById('focus-context-pill');
    const text = document.getElementById('focus-context-text');
    if (!pill || !text) return;

    if (state.isOverviewMode || !state.selectedFileId) {
        pill.style.display = 'none';
    } else {
        const file = state.projectFiles.find(f => f.id === state.selectedFileId);
        pill.style.display = 'flex';
        text.innerText = `Фокус: ${file ? file.name : state.selectedFileId} (только его связи)`;
    }
}