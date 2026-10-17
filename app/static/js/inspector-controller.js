/**
 * @fileoverview Контроллер инспектора, вкладки архитектурных метрик и генератора Bundle для LLM.
 *
 * @module inspectorController
 */

import { state } from './state.js';
import { renderGraph } from './canvas-controller.js';
import { computeGraphMetrics } from './graph-engine.js';

export function getDeduplicatedBundleFileIds(rootFileId, onlySingle = false) {
    const fileMap = new Map(state.projectFiles.map(f => [f.id, f]));
    if (!fileMap.has(rootFileId)) return [];

    if (onlySingle) {
        return state.excludedContextFiles.has(rootFileId) ? [] : [rootFileId];
    }

    const reverseDepsMap = new Map();
    state.projectFiles.forEach(f => {
        (f.dependencies || []).forEach(dep => {
            if (!reverseDepsMap.has(dep.target)) {
                reverseDepsMap.set(dep.target, new Set());
            }
            reverseDepsMap.get(dep.target).add(f.id);
        });
    });

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

    while (queue.length > 0) {
        const currId = queue.shift();
        const currFile = fileMap.get(currId);
        if (!currFile) continue;

        (currFile.dependencies || []).forEach(dep => {
            const targetId = dep.target;
            if (fileMap.has(targetId) && !state.excludedContextFiles.has(targetId) && !visited.has(targetId)) {
                visited.add(targetId);
                queue.push(targetId);
            }
        });

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

    const result = Array.from(visited);
    const rootIndex = result.indexOf(rootFileId);
    if (rootIndex > 0) {
        result.splice(rootIndex, 1);
        result.unshift(rootFileId);
    }

    return result;
}

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

    // Рефакторинг
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

    // Входящие импорты
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

    // Обратные зависимости
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

    renderBundleCompositionList();
    renderCustomContextList();
    updateMetricsView(fileId);

    // Статистика
    const allBundleIds = getDeduplicatedBundleFileIds(fileId, false);
    safeSetText('active-deps-count', allBundleIds.length.toString());
    safeSetText('inspector-stat-direct', directDeps.length.toString());
    safeSetText('inspector-stat-reverse', importedBy.length.toString());
    safeSetText('inspector-stat-bundle', allBundleIds.length.toString());
    safeSetText('inspector-stat-lines', file.lines.toString());

    // Суммарные строки бандла
    const totalBundleLines = allBundleIds.reduce((sum, id) => {
        const f = state.projectFiles.find(p => p.id === id);
        return sum + (f ? f.lines : 0);
    }, 0);
    safeSetText('bundle-total-lines-label', totalBundleLines.toLocaleString());
}

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

export function renderCustomContextList() {
    const list = document.getElementById('inspector-custom-context-list');
    safeSetText('inspector-custom-context-count', state.customContextFiles.size.toString());

    const pinBtn = document.getElementById('btn-toggle-custom-context');
    if (pinBtn && state.selectedFileId) {
        const isPinned = state.customContextFiles.has(state.selectedFileId);
        pinBtn.classList.toggle('active', isPinned);
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
 * Обновляет панель архитектурных метрик (In-degree, Out-degree, SCC, плотность).
 */
export function updateMetricsView(fileId) {
    const container = document.getElementById('inspector-metrics-view');
    if (!container) return;

    const metrics = computeGraphMetrics(state.projectFiles, state.activeEdgeTypes);
    const inDeg = metrics.inDegreeMap.get(fileId) || 0;
    const outDeg = metrics.outDegreeMap.get(fileId) || 0;

    // Проверка на участие в цикле
    const cycleComp = metrics.cycles.find(comp => comp.includes(fileId));
    const isCyclic = Boolean(cycleComp);

    // Межмодульные связи данного файла
    const file = state.projectFiles.find(f => f.id === fileId);
    let crossModuleOutgoing = 0;
    if (file) {
        const fileMap = new Map(state.projectFiles.map(f => [f.id, f]));
        (file.dependencies || []).forEach(d => {
            const tgt = fileMap.get(d.target);
            if (tgt && tgt.folder !== file.folder) crossModuleOutgoing++;
        });
    }

    container.innerHTML = `
        <div class="metric-card-group">
            <div class="group-title">Метрики выбранного файла</div>
            <div class="stat-metric-row">
                <span>In-degree (используется в файлах)</span>
                <strong>${inDeg}</strong>
            </div>
            <div class="stat-metric-row">
                <span>Out-degree (зависит от файлов)</span>
                <strong>${outDeg}</strong>
            </div>
            <div class="stat-metric-row">
                <span>Межмодульных исходящих связей</span>
                <strong>${crossModuleOutgoing}</strong>
            </div>
            <div class="stat-metric-row">
                <span>Участие в циклических зависимостях</span>
                <strong style="color: ${isCyclic ? 'var(--warn-critical)' : '#10b981'};">
                    ${isCyclic ? `Да (${cycleComp.length} файлов в цикле)` : 'Нет'}
                </strong>
            </div>
            ${isCyclic ? `
                <div class="cycle-members-box">
                    <span class="field-hint">Файлы петли зависимостей:</span>
                    <ul class="cycle-file-list">
                        ${cycleComp.map(cId => `<li><code>${cId.split('/').pop()}</code></li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>

        <div class="metric-card-group" style="margin-top: 14px;">
            <div class="group-title">Общесистемные метрики проекта</div>
            <div class="stat-metric-row">
                <span>Всего файлов / связей</span>
                <strong>${metrics.totalFiles} / ${metrics.totalEdges}</strong>
            </div>
            <div class="stat-metric-row">
                <span>Плотность графа связей</span>
                <strong>${(metrics.density * 100).toFixed(2)}%</strong>
            </div>
            <div class="stat-metric-row">
                <span>Межмодульных связей</span>
                <strong>${metrics.crossModuleEdgesCount}</strong>
            </div>
            <div class="stat-metric-row">
                <span>Изолированных файлов (сирот)</span>
                <strong>${metrics.isolatedFiles.length}</strong>
            </div>
            <div class="stat-metric-row">
                <span>Всего архитектурных циклов (SCC)</span>
                <strong>${metrics.cycles.length}</strong>
            </div>
        </div>
    `;
}

export function toggleCustomContextFile(fileId) {
    if (!fileId) return;

    if (state.customContextFiles.has(fileId)) {
        state.customContextFiles.delete(fileId);
    } else {
        state.customContextFiles.add(fileId);
        state.excludedContextFiles.delete(fileId);
    }

    if (state.selectedFileId) openInspector(state.selectedFileId);
    renderGraph();
}

export function clearCustomContext() {
    state.customContextFiles.clear();
    if (state.selectedFileId) openInspector(state.selectedFileId);
    renderGraph();
}

export function toggleContextExclusion(fileId) {
    if (state.excludedContextFiles.has(fileId)) {
        state.excludedContextFiles.delete(fileId);
    } else {
        state.excludedContextFiles.add(fileId);
    }
    if (state.selectedFileId) openInspector(state.selectedFileId);
    renderGraph();
}

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
        console.warn('Серверный код недоступен:', e);
    }
    return `// Файл: ${file.name}\n// Путь: ${file.id}\n// Строк: ${file.lines}`;
}

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

export function initCodeViewerTabs() {
    const tabDeps = document.getElementById('tab-btn-deps');
    const tabMetrics = document.getElementById('tab-btn-metrics');
    const tabCode = document.getElementById('tab-btn-code');

    const viewDeps = document.getElementById('inspector-deps-view');
    const viewMetrics = document.getElementById('inspector-metrics-view');
    const viewCode = document.getElementById('inspector-code-view');

    const resetTabs = () => {
        [tabDeps, tabMetrics, tabCode].forEach(t => t && t.classList.remove('active'));
        if (viewDeps) viewDeps.style.display = 'none';
        if (viewMetrics) viewMetrics.style.display = 'none';
        if (viewCode) viewCode.style.display = 'none';
    };

    if (tabDeps) {
        tabDeps.onclick = () => {
            resetTabs();
            tabDeps.classList.add('active');
            if (viewDeps) viewDeps.style.display = 'flex';
        };
    }

    if (tabMetrics) {
        tabMetrics.onclick = () => {
            resetTabs();
            tabMetrics.classList.add('active');
            if (viewMetrics) viewMetrics.style.display = 'flex';
            if (state.selectedFileId) updateMetricsView(state.selectedFileId);
        };
    }

    if (tabCode) {
        tabCode.onclick = async () => {
            resetTabs();
            tabCode.classList.add('active');
            if (viewCode) viewCode.style.display = 'flex';
            const file = state.projectFiles.find(f => f.id === state.selectedFileId);
            const contentEl = document.getElementById('code-viewer-content');
            if (contentEl && file) {
                contentEl.innerText = await fetchFileContent(file);
            }
        };
    }
}

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
        btnClear.onclick = () => clearCustomContext();
    }
}

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

export function ensureDrawerOpen() {
    const drawer = document.getElementById('right-sidebar');
    if (drawer && !state.isDrawerOpen) {
        state.isDrawerOpen = true;
        drawer.classList.remove('collapsed');
    }
}

function safeSetText(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) el.innerText = text;
}