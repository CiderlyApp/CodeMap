/**
 * @fileoverview Контроллер холста графа: отображение всех файлов и рёбер бандла,
 * панорамирование и масштабирование.
 *
 * @module canvasController
 */

import { state } from './state.js';
import { computeBundleSubgraph, computeGraphLayout, generateCurvedEdgePath } from './graph-engine.js';
import { getDeduplicatedBundleFileIds } from './inspector-controller.js';

/**
 * Отрисовывает граф на холсте. В режиме фокуса отображает все входящие и обратные
 * зависимости всех файлов бандла и все рёбра между ними.
 *
 * @param {function(string, boolean=): void} [onFileSelect] - Callback выбора файла.
 * @returns {void}
 */
export function renderGraph(onFileSelect) {
    const nodesLayer = document.getElementById('graph-nodes-container');
    const edgesSvg = document.getElementById('graph-edges-svg');
    if (!nodesLayer || !edgesSvg) return;

    let visibleNodes = new Set();
    let visibleEdges = [];

    if (state.isOverviewMode || !state.selectedFileId) {
        // Режим полного обзора: весь проект
        visibleNodes = new Set(state.projectFiles.map(f => f.id));
        state.projectFiles.forEach(src => {
            (src.dependencies || []).forEach(dep => {
                if (visibleNodes.has(dep.target)) {
                    visibleEdges.push({ from: src.id, to: dep.target, type: dep.type || 'import' });
                }
            });
        });
    } else {
        // Режим бандла: ВСЕ входящие и обратные зависимости ВСЕХ файлов бандла
        const bundleFileIds = getDeduplicatedBundleFileIds(state.selectedFileId, false);
        const subGraph = computeBundleSubgraph(state.projectFiles, bundleFileIds);
        visibleNodes = subGraph.visibleNodes;
        visibleEdges = subGraph.visibleEdges;
    }

    // Применение фильтра сирот в режиме обзора
    if (state.isOverviewMode) {
        const connectedNodeIds = new Set();
        state.projectFiles.forEach(f => {
            (f.dependencies || []).forEach(dep => {
                connectedNodeIds.add(f.id);
                connectedNodeIds.add(dep.target);
            });
        });

        if (state.orphanFilter === 'no-orphans') {
            visibleNodes = new Set([...visibleNodes].filter(id => connectedNodeIds.has(id)));
        } else if (state.orphanFilter === 'only-orphans') {
            visibleNodes = new Set([...visibleNodes].filter(id => !connectedNodeIds.has(id)));
        }
    }

    const { clusters, nodePositions } = computeGraphLayout(state.projectFiles, visibleNodes);

    nodesLayer.innerHTML = '';
    edgesSvg.innerHTML = createSvgMarkerDefs();

    // 1. Отрисовка кластеров папок
    clusters.forEach(c => {
        const el = document.createElement('div');
        el.className = 'folder-cluster-container';
        el.style.left = `${c.x}px`;
        el.style.top = `${c.y}px`;
        el.style.width = `${c.width}px`;
        el.style.height = `${c.height}px`;
        el.innerHTML = `<div class="folder-cluster-header"><span>📁</span> ${c.folder}/</div>`;
        nodesLayer.appendChild(el);
    });

    // 2. Отрисовка всех направленных связей между файлами бандла
    visibleEdges.forEach(e => {
        const src = nodePositions.get(e.from);
        const tgt = nodePositions.get(e.to);
        if (!src || !tgt) return;

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const normType = (e.type || 'import').replace('_', '-');
        const dAttr = generateCurvedEdgePath(src, tgt);

        pathEl.setAttribute('d', dAttr);
        pathEl.setAttribute('class', `dependency-edge-path edge-${normType}`);
        pathEl.setAttribute('marker-end', `url(#arrow-${normType})`);

        if (state.selectedFileId === e.from || state.selectedFileId === e.to) {
            pathEl.classList.add('highlighted');
        }
        edgesSvg.appendChild(pathEl);
    });

    // 3. Отрисовка карточек файлов
    state.projectFiles.forEach(file => {
        if (!visibleNodes.has(file.id)) return;
        const pos = nodePositions.get(file.id);
        if (!pos) return;

        const card = document.createElement('div');
        card.className = 'file-node-card';
        card.id = `node-${file.id.replace(/[/.]/g, '-')}`;
        card.style.left = `${pos.x}px`;
        card.style.top = `${pos.y}px`;

        if (file.id === state.selectedFileId) card.classList.add('selected');
        if (state.customContextFiles.has(file.id)) card.classList.add('pinned-node');
        if (file.lines >= state.thresholds.critical) card.classList.add('candidate-critical');
        else if (file.lines >= state.thresholds.large) card.classList.add('candidate-large');

        card.innerHTML = `
            <div class="node-header-row">
                <span class="node-file-name" title="${file.name}">📄 ${file.name}</span>
            </div>
            <div class="node-subtext" title="${file.role || ''}">${file.role || ''}</div>
            <div class="node-footer-row">
                <span>${file.lines.toLocaleString()} lines</span>
                ${state.customContextFiles.has(file.id) ? '<span class="node-pinned-tag">📌 бандл</span>' : ''}
                ${file.lines >= state.thresholds.large ? '<span class="node-refactor-tag">Refactor</span>' : ''}
            </div>
        `;

        card.onclick = (ev) => {
            ev.stopPropagation();
            if (onFileSelect) {
                onFileSelect(file.id, false);
            }
        };
        nodesLayer.appendChild(card);
    });

    updateTransform();
}

/**
 * Создает маркеры стрелок в SVG defs для каждого типа связи.
 *
 * @returns {string} Разметка блока defs.
 */
function createSvgMarkerDefs() {
    return `
        <defs>
            <marker id="arrow-import" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8"/>
            </marker>
            <marker id="arrow-from-import" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#4ade80"/>
            </marker>
            <marker id="arrow-export" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#fbbf24"/>
            </marker>
            <marker id="arrow-re-export" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#fbbf24"/>
            </marker>
            <marker id="arrow-test" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#64748b"/>
            </marker>
            <marker id="arrow-dynamic" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#64748b"/>
            </marker>
        </defs>
    `;
}

/**
 * Применяет текущую CSS-трансформацию масштаба и смещения к холсту.
 *
 * @returns {void}
 */
export function updateTransform() {
    const world = document.getElementById('graph-world');
    if (world) {
        world.style.transform = `translate(${state.viewTransform.x}px, ${state.viewTransform.y}px) scale(${state.viewTransform.scale})`;
    }
}

/**
 * Центрирует холст на карточке выбранного файла.
 *
 * @param {string} fileId - Идентификатор файла.
 * @returns {void}
 */
export function centerNode(fileId) {
    const card = document.getElementById(`node-${fileId.replace(/[/.]/g, '-')}`);
    const viewport = document.getElementById('canvas-viewport');
    if (!card || !viewport) return;

    const rect = viewport.getBoundingClientRect();
    const nx = parseFloat(card.style.left);
    const ny = parseFloat(card.style.top);

    state.viewTransform.x = (rect.width / 2) - (nx * state.viewTransform.scale) - 90;
    state.viewTransform.y = (rect.height / 2) - (ny * state.viewTransform.scale) - 34;
    updateTransform();
}

/**
 * Инициализирует интерактивную навигацию: панорамирование и масштабирование.
 *
 * @returns {void}
 */
export function initCanvasNavigation() {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;

    vp.addEventListener('mousedown', (e) => {
        if (
            e.target.closest('.file-node-card') ||
            e.target.closest('.canvas-bottom-dock') ||
            e.target.closest('.drawer-toggle-handle') ||
            e.target.closest('.floating-context-pill') ||
            e.target.closest('button')
        ) {
            return;
        }
        state.isDragging = true;
        state.dragStart = { x: e.clientX - state.viewTransform.x, y: e.clientY - state.viewTransform.y };
    });

    window.addEventListener('mousemove', (e) => {
        if (!state.isDragging) return;
        state.viewTransform.x = e.clientX - state.dragStart.x;
        state.viewTransform.y = e.clientY - state.dragStart.y;
        updateTransform();
    });

    window.addEventListener('mouseup', () => { state.isDragging = false; });

    vp.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        state.viewTransform.scale = Math.min(Math.max(state.viewTransform.scale * delta, 0.2), 2.5);
        updateTransform();
    }, { passive: false });

    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnFitGraph = document.getElementById('btn-fit-graph');
    const btnFitScreen = document.getElementById('btn-fit-screen');
    const btnCenterSelection = document.getElementById('btn-center-selection');

    if (btnZoomIn) btnZoomIn.onclick = () => { state.viewTransform.scale = Math.min(state.viewTransform.scale * 1.2, 2.5); updateTransform(); };
    if (btnZoomOut) btnZoomOut.onclick = () => { state.viewTransform.scale = Math.max(state.viewTransform.scale * 0.8, 0.2); updateTransform(); };
    if (btnFitGraph) btnFitGraph.onclick = () => { state.viewTransform = { x: 50, y: 10, scale: 0.75 }; updateTransform(); };
    if (btnFitScreen) btnFitScreen.onclick = () => { state.viewTransform = { x: 50, y: 10, scale: 0.75 }; updateTransform(); };
    if (btnCenterSelection) btnCenterSelection.onclick = () => { if (state.selectedFileId) centerNode(state.selectedFileId); };
}