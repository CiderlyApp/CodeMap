/**
 * @fileoverview Контроллер управления сессиями проектов и списком кандидатов рефакторинга.
 *
 * @module projectController
 */

import { state } from './state.js';
import {
    pickProjectDirectoryReadOnly,
    scanLocalDirectory,
    buildGraphFromScannedFiles
} from './project-scanner.js';
import {
    saveProjectToCache,
    removeProjectFromCache,
    saveActiveProjectName
} from './storage-cache.js';
import { renderGraph } from './canvas-controller.js';
import { openInspector } from './inspector-controller.js';
import { initTree, selectFile } from './tree-controller.js';

/**
 * Инициализирует менеджер проектов: выбор локальной папки и выпадающий список проектов.
 *
 * @returns {void}
 */
export function initProjectManager() {
    const btnAddProject = document.getElementById('btn-add-project');
    const dropdownTrigger = document.getElementById('project-dropdown-trigger');
    const dropdownMenu = document.getElementById('project-dropdown-menu');
    const fallbackInput = document.getElementById('fallback-folder-input');

    if (dropdownTrigger && dropdownMenu) {
        dropdownTrigger.onclick = (e) => {
            e.stopPropagation();
            const isHidden = dropdownMenu.style.display === 'none' || !dropdownMenu.style.display;
            dropdownMenu.style.display = isHidden ? 'block' : 'none';
            renderProjectDropdownList();
        };

        document.addEventListener('click', () => {
            dropdownMenu.style.display = 'none';
        });
    }

    if (btnAddProject) {
        btnAddProject.onclick = async (e) => {
            e.stopPropagation();
            if ('showDirectoryPicker' in window) {
                try {
                    const dirHandle = await pickProjectDirectoryReadOnly();
                    if (!dirHandle) return;

                    const projectName = dirHandle.name;
                    // Передаем актуальные настройки игнорирования из state
                    const scanned = await scanLocalDirectory(dirHandle, '', state.ignoreSettings);
                    if (scanned.length === 0) {
                        alert('В выбранной папке не найдено исходных файлов с учётом правил игнорирования.');
                        return;
                    }

                    const parsed = buildGraphFromScannedFiles(scanned);
                    state.projects.set(projectName, parsed);
                    await saveProjectToCache(projectName, parsed);
                    await switchActiveProject(projectName);
                } catch (err) {
                    if (err.name !== 'AbortError') alert('Ошибка: ' + err.message);
                }
            } else if (fallbackInput) {
                fallbackInput.click();
            }
        };
    }

    if (fallbackInput) {
        fallbackInput.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            const rawList = [];
            for (const f of files) {
                const ext = f.name.substring(f.name.lastIndexOf('.'));
                if (['.py', '.js', '.jsx', '.ts', '.tsx', '.dart'].includes(ext)) {
                    const content = await f.text();
                    rawList.push({
                        id: f.webkitRelativePath || f.name,
                        name: f.name,
                        path: f.webkitRelativePath || f.name,
                        content,
                        lines: content.split('\n').length,
                        ext
                    });
                }
            }

            if (rawList.length > 0) {
                const rootName = rawList[0].id.split('/')[0] || 'Local-Project';
                const parsed = buildGraphFromScannedFiles(rawList);
                state.projects.set(rootName, parsed);
                await saveProjectToCache(rootName, parsed);
                await switchActiveProject(rootName);
            }
        };
    }
}

/**
 * Отрисовывает пункты меню выпадающего списка проектов.
 *
 * @returns {void}
 */
export function renderProjectDropdownList() {
    const list = document.getElementById('project-items-list');
    if (!list) return;
    list.innerHTML = '';

    state.projects.forEach((files, name) => {
        const item = document.createElement('div');
        item.className = `project-menu-item ${name === state.activeProjectName ? 'active' : ''}`;
        item.innerHTML = `
            <span class="project-item-name">📁 ${name} (${files.length} f)</span>
            ${state.projects.size > 1 ? '<button class="btn-remove-project" title="Удалить">✕</button>' : ''}
        `;

        item.querySelector('.project-item-name').onclick = async () => {
            await switchActiveProject(name);
            const menu = document.getElementById('project-dropdown-menu');
            if (menu) menu.style.display = 'none';
        };

        const removeBtn = item.querySelector('.btn-remove-project');
        if (removeBtn) {
            removeBtn.onclick = async (e) => {
                e.stopPropagation();
                state.projects.delete(name);
                await removeProjectFromCache(name);
                if (state.activeProjectName === name) {
                    await switchActiveProject(state.projects.keys().next().value);
                } else {
                    renderProjectDropdownList();
                }
            };
        }

        list.appendChild(item);
    });
}

/**
 * Переключает активный проект, обновляя граф, инспектор и дерево файлов.
 *
 * @async
 * @param {string} projectName - Имя проекта.
 * @returns {Promise<void>}
 */
export async function switchActiveProject(projectName) {
    if (!state.projects.has(projectName)) return;

    state.activeProjectName = projectName;
    state.projectFiles = state.projects.get(projectName);
    await saveActiveProjectName(projectName);

    state.selectedFileId = state.projectFiles[0]?.id || null;
    state.isOverviewMode = true;
    state.focusFiles.clear();

    const label = document.getElementById('current-project-label');
    const stats = document.getElementById('project-stats-label');
    if (label) label.innerText = projectName;
    if (stats) stats.innerText = `${projectName} • ${state.projectFiles.length} files`;

    initTree();
    updateCandidates();
    renderGraph(selectFile);

    if (state.selectedFileId) {
        openInspector(state.selectedFileId);
    }
}

/**
 * Пересчитывает и обновляет список кандидатов на рефакторинг в боковой панели.
 *
 * @returns {void}
 */
export function updateCandidates() {
    const list = document.getElementById('candidates-list');
    const badge = document.getElementById('candidates-count-badge');
    if (!list || !badge) return;
    list.innerHTML = '';

    const candidates = state.projectFiles
        .filter(f => f.lines >= state.thresholds.large)
        .sort((a, b) => b.lines - a.lines);

    badge.innerText = candidates.length.toString();

    candidates.forEach(f => {
        const item = document.createElement('div');
        const isCritical = f.lines >= state.thresholds.critical;
        item.className = `candidate-card-item ${isCritical ? 'severity-critical' : ''}`;
        item.innerHTML = `
            <div class="candidate-name">⚠️ ${f.name}</div>
            <div class="candidate-lines">${f.lines.toLocaleString()} lines</div>
        `;
        item.onclick = (e) => {
            e.stopPropagation();
            selectFile(f.id, true);
        };
        list.appendChild(item);
    });
}