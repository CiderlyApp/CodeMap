/**
 * @fileoverview Главный контроллер и точка входа приложения CodeMap.
 * Выполняет инициализацию подсистем, синхронизацию с IndexedDB и координацию событий.
 *
 * @module app
 */

import { PROJECT_DATA as DEMO_DATA } from './data.js';
import { state } from './state.js';
import {
    saveProjectToCache,
    loadAllCachedProjects,
    saveActiveProjectName,
    loadActiveProjectName,
    loadSettingsFromCache
} from './storage-cache.js';
import { renderGraph, initCanvasNavigation } from './canvas-controller.js';
import {
    openInspector,
    initDrawer,
    initCodeViewerTabs,
    initAICopyButtons
} from './inspector-controller.js';
import {
    initTree,
    initOrphanFilter,
    selectFile,
    updateContextPill
} from './tree-controller.js';
import {
    initProjectManager,
    switchActiveProject,
    updateCandidates
} from './project-controller.js';
import { initSettingsModal } from './settings-controller.js';
import { initSearch } from './search-controller.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await restoreFromLocalCache();
        initUI();
        updateCandidates();
        renderGraph(selectFile);

        if (state.selectedFileId) {
            openInspector(state.selectedFileId);
        }

        tryLoadServerGraph().catch((err) => {
            console.info('Серверный граф недоступен, работаем с локальным кэшем:', err);
        });
    } catch (err) {
        console.error('Ошибка инициализации CodeMap:', err);
    }
});

/**
 * Загружает граф с бэкенда, если он запущен.
 *
 * @async
 * @returns {Promise<void>}
 */
async function tryLoadServerGraph() {
    const resp = await fetch('/api/graph');
    if (!resp.ok) return;

    const data = await resp.json();
    if (data.nodes && data.nodes.length > 0) {
        const mappedFiles = data.nodes.map(n => ({
            id: n.id,
            name: n.label,
            folder: n.parent && n.parent !== 'root' ? n.parent.split('/').pop() : 'root',
            role: n.id.includes('test') ? 'test suite' : 'module',
            lines: n.lines || 1,
            language: n.ext === '.py' ? 'Python' : n.ext === '.dart' ? 'Dart' : 'TypeScript/JS',
            tags: [n.ext ? n.ext.replace('.', '').toUpperCase() : 'CODE'],
            exports: n.exports || [],
            content: n.content || '',
            dependencies: (data.edges || [])
                .filter(e => e.from === n.id)
                .map(e => ({
                    target: e.to,
                    type: e.type || 'import',
                    statement: e.to
                }))
        }));

        const serverProjectName = mappedFiles[0].id.split('/')[0] || 'server-repo';
        state.projects.set(serverProjectName, mappedFiles);
        await saveProjectToCache(serverProjectName, mappedFiles);
        await switchActiveProject(serverProjectName);
    }
}

/**
 * Восстанавливает сохраненные данные проектов и настройки из IndexedDB.
 *
 * @async
 * @returns {Promise<void>}
 */
async function restoreFromLocalCache() {
    try {
        const cachedProjects = await loadAllCachedProjects();
        if (cachedProjects && cachedProjects.size > 0) {
            state.projects = cachedProjects;
            const lastActive = await loadActiveProjectName();
            state.activeProjectName = (lastActive && state.projects.has(lastActive))
                ? lastActive
                : state.projects.keys().next().value;

            state.projectFiles = state.projects.get(state.activeProjectName) || [];
            if (state.projectFiles.length > 0) {
                state.selectedFileId = state.projectFiles[0].id;
            }
        } else {
            await saveProjectToCache('ciderly-demo', DEMO_DATA);
            await saveActiveProjectName('ciderly-demo');
        }

        const cachedSettings = await loadSettingsFromCache();
        if (cachedSettings) {
            if (cachedSettings.thresholds) {
                state.thresholds = cachedSettings.thresholds;
            }
            if (cachedSettings.ignoreSettings) {
                state.ignoreSettings = cachedSettings.ignoreSettings;
            }
        }
    } catch (e) {
        console.warn('Ошибка загрузки локального кэша:', e);
    }
}

/**
 * Инициализирует элементы интерфейса и обработчики сквозных событий.
 *
 * @returns {void}
 */
function initUI() {
    initTree();
    initDrawer();
    initProjectManager();
    initAICopyButtons();
    initCanvasNavigation();
    initSearch();
    initSettingsModal();
    initOrphanFilter();
    initCodeViewerTabs();

    // Сброс фокуса и показ всего проекта по клику на заголовок дерева
    const explorerTitle = document.getElementById('btn-explorer-title');
    if (explorerTitle) {
        explorerTitle.onclick = () => {
            state.isOverviewMode = true;
            state.focusFiles.clear();
            state.selectedFileId = null;
            document.querySelectorAll('.tree-file').forEach(el => el.classList.remove('selected'));
            renderGraph(selectFile);
            updateContextPill();
        };
    }

    const btnOverview = document.getElementById('btn-project-overview');
    if (btnOverview) {
        btnOverview.onclick = () => {
            state.isOverviewMode = true;
            state.focusFiles.clear();
            renderGraph(selectFile);
            updateContextPill();
        };
    }

    const pillClose = document.getElementById('btn-exit-focus-pill');
    if (pillClose) {
        pillClose.onclick = () => {
            state.isOverviewMode = true;
            state.focusFiles.clear();
            renderGraph(selectFile);
            updateContextPill();
        };
    }

    const label = document.getElementById('current-project-label');
    if (label) label.innerText = state.activeProjectName;
}