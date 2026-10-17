/**
 * @fileoverview Контроллер холста графа: поддержка четырёх режимов визуализации,
 * маршрутизация рёбер без пересечения карточек, панорамирование и Drag & Drop узлов.
 *
 * @module canvasController
 */

import { state } from './state.js';
import {
    computeBundleSubgraph,
    computeGraphLayout,
    computeLayeredGraphLayout,
    simulateForceLayout,
    routeEdgeAvoidCards
} from './graph-engine.js';
import { getDeduplicatedBundleFileIds } from './inspector-controller.js';
import { renderDependencyMatrix } from './matrix-controller.js';

let activeDragNode = null;
let nodeDragOffset = { x: 0, y: 0 };

export function renderGraph(onFileSelect) {
    const nodesLayer = document.getElementById('graph-nodes-container');
    const edgesSvg = document.getElementById('graph-edges-svg');
    const matrixContainer = document.getElementById('matrix-viewport-container');
    const graphWorld = document.getElementById('graph-world');
    const depthControls = document.getElementById('layered-depth-controls');
    const freeControls = document.getElementById('free-layout-controls');

    if (!nodesLayer || !edgesSvg) return;

    if (state.currentViewMode === 'matrix') {
        if (graphWorld) graphWorld.style.display = 'none';
        if (matrixContainer) {
            matrixContainer.style.display = 'flex';
            renderDependencyMatrix(onFileSelect);
        }
        if (depthControls) depthControls.style.display = 'none';
        if (freeControls) freeControls.style.display = 'none';
        return;
    }

    if (matrixContainer) matrixContainer.style.display = 'none';
    if (graphWorld) graphWorld.style.display = 'block';

    if (depthControls) {
        depthControls.style.display = state.currentViewMode === 'layered' ? 'flex' : 'none';
    }
    if (freeControls) {
        freeControls.style.display = state.currentViewMode === 'free' ? 'flex' : 'none';
    }

    if (state.currentViewMode === 'layered') {
        renderLayeredMode(nodesLayer, edgesSvg, onFileSelect);
    } else if (state.currentViewMode === 'free') {
        renderFreeMode(nodesLayer, edgesSvg, onFileSelect);
    } else {
        renderMapMode(nodesLayer, edgesSvg, onFileSelect);
    }

    updateTransform();
}

function renderMapMode(nodesLayer, edgesSvg, onFileSelect) {
    let visibleNodes = new Set();
    let visibleEdges = [];

    if (state.isOverviewMode || !state.selectedFileId) {
        visibleNodes = new Set(state.projectFiles.map(f => f.id));
        state.projectFiles.forEach(src => {
            (src.dependencies || []).forEach(dep => {
                if (state.activeEdgeTypes.has(dep.type || 'import') && visibleNodes.has(dep.target) && dep.target !== src.id) {
                    visibleEdges.push({ from: src.id, to: dep.target, type: dep.type || 'import' });
                }
            });
        });
    } else {
        const bundleFileIds = getDeduplicatedBundleFileIds(state.selectedFileId, false);
        const sub = computeBundleSubgraph(state.projectFiles, bundleFileIds, state.activeEdgeTypes);
        visibleNodes = sub.visibleNodes;
        visibleEdges = sub.visibleEdges;
    }

    if (state.isOverviewMode && state.orphanFilter !== 'all') {
        const connectedNodeIds = new Set();
        state.projectFiles.forEach(f => {
            (f.dependencies || []).forEach(dep => {
                if (state.activeEdgeTypes.has(dep.type || 'import')) {
                    connectedNodeIds.add(f.id);
                    connectedNodeIds.add(dep.target);
                }
            });
        });

        if (state.orphanFilter === 'no-orphans') {
            visibleNodes = new Set([...visibleNodes].filter(id => connectedNodeIds.has(id)));
        } else if (state.orphanFilter === 'only-orphans') {
            visibleNodes = new Set([...visibleNodes].filter(id => !connectedNodeIds.has(id)));
        }
    }

    const { clusters, nodePositions } = computeGraphLayout(state.projectFiles, visibleNodes, state.collapsedFolders);

    nodesLayer.innerHTML = '';
    edgesSvg.innerHTML = createSvgMarkerDefs();

    clusters.forEach(c => {
        const el = document.createElement('div');
        el.className = `folder-cluster-container ${c.isCollapsed ? 'folder-cluster-collapsed' : ''}`;
        el.style.left = `${c.x}px`;
        el.style.top = `${c.y}px`;
        el.style.width = `${c.width}px`;
        el.style.height = `${c.height}px`;

        el.innerHTML = `
            <div class="folder-cluster-header">
                <span class="folder-toggle-btn" title="Свернуть/развернуть папку">${c.isCollapsed ? '▶' : '▼'}</span>
                <span>📁</span> ${c.folder}/ (${c.fileCount})
            </div>
            ${c.isCollapsed ? `<div class="collapsed-folder-subtext">Папка свернута. Нажмите для раскрытия.</div>` : ''}
        `;

        el.querySelector('.folder-toggle-btn').onclick = (e) => {
            e.stopPropagation();
            if (state.collapsedFolders.has(c.folder)) {
                state.collapsedFolders.delete(c.folder);
            } else {
                state.collapsedFolders.add(c.folder);
            }
            renderGraph(onFileSelect);
        };

        nodesLayer.appendChild(el);
    });

    const allObstacleRects = Array.from(nodePositions.values());
    renderEdges(edgesSvg, visibleEdges, nodePositions, allObstacleRects);

    state.projectFiles.forEach(file => {
        if (!visibleNodes.has(file.id)) return;
        const pos = nodePositions.get(file.id);
        if (!pos || pos.isCollapsedFolder) return;

        createNodeCard(nodesLayer, file, pos, onFileSelect);
    });
}

function renderLayeredMode(nodesLayer, edgesSvg, onFileSelect) {
    nodesLayer.innerHTML = '';
    edgesSvg.innerHTML = createSvgMarkerDefs();

    if (!state.selectedFileId) {
        showEmptyPlaceholder(nodesLayer, 'Выберите файл в дереве или поиске для отображения слоевого графа');
        return;
    }

    const depth = state.layeredSettings.depth || 2;
    const { nodePositions, visibleEdges, visibleNodeIds } = computeLayeredGraphLayout(
        state.selectedFileId,
        state.projectFiles,
        depth,
        state.activeEdgeTypes
    );

    const allObstacleRects = Array.from(nodePositions.values());
    renderEdges(edgesSvg, visibleEdges, nodePositions, allObstacleRects);

    state.projectFiles.forEach(file => {
        if (!visibleNodeIds.has(file.id)) return;
        const pos = nodePositions.get(file.id);
        if (!pos) return;
        createNodeCard(nodesLayer, file, pos, onFileSelect);
    });
}

function renderFreeMode(nodesLayer, edgesSvg, onFileSelect) {
    nodesLayer.innerHTML = '';
    edgesSvg.innerHTML = createSvgMarkerDefs();

    const activeFiles = state.projectFiles.filter(f => {
        if (state.orphanFilter === 'no-orphans') {
            return (f.dependencies || []).length > 0 || state.projectFiles.some(o => (o.dependencies||[]).some(d => d.target === f.id));
        }
        return true;
    });

    const activeIds = new Set(activeFiles.map(f => f.id));
    const edges = [];
    activeFiles.forEach(f => {
        (f.dependencies || []).forEach(dep => {
            if (state.activeEdgeTypes.has(dep.type || 'import') && activeIds.has(dep.target) && dep.target !== f.id) {
                edges.push({ from: f.id, to: dep.target, type: dep.type || 'import' });
            }
        });
    });

    const nodesForSim = activeFiles.map(f => {
        const saved = state.freeLayoutPositions.get(f.id);
        return {
            id: f.id,
            x: saved ? saved.x : Math.random() * 800 + 100,
            y: saved ? saved.y : Math.random() * 600 + 100
        };
    });

    if (state.freeLayoutPositions.size === 0) {
        const computed = simulateForceLayout(nodesForSim, edges, 45);
        computed.forEach((val, key) => state.freeLayoutPositions.set(key, val));
    }

    const nodePositions = new Map();
    activeFiles.forEach(f => {
        const pos = state.freeLayoutPositions.get(f.id) || { x: 200, y: 200, width: 180, height: 68 };
        nodePositions.set(f.id, { ...pos, width: 180, height: 68 });
    });

    const allObstacleRects = Array.from(nodePositions.values());
    renderEdges(edgesSvg, edges, nodePositions, allObstacleRects);

    activeFiles.forEach(file => {
        const pos = nodePositions.get(file.id);
        if (!pos) return;
        const card = createNodeCard(nodesLayer, file, pos, onFileSelect);
        makeCardDraggable(card, file.id, onFileSelect);
    });
}

function renderEdges(edgesSvg, edges, nodePositions, allObstacleRects) {
    const pairCounts = new Map();

    edges.forEach(e => {
        const src = nodePositions.get(e.from);
        const tgt = nodePositions.get(e.to);
        if (!src || !tgt) return;

        const pairKey = [e.from, e.to].sort().join('--');
        const parallelIdx = pairCounts.get(pairKey) || 0;
        pairCounts.set(pairKey, parallelIdx + 1);

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const normType = (e.type || 'import').replace('_', '-');
        const dAttr = routeEdgeAvoidCards(src, tgt, allObstacleRects, parallelIdx);

        pathEl.setAttribute('d', dAttr);
        pathEl.setAttribute('class', `dependency-edge-path edge-${normType}`);
        pathEl.setAttribute('marker-end', `url(#arrow-${normType})`);

        if (state.selectedFileId === e.from || state.selectedFileId === e.to) {
            pathEl.classList.add('highlighted');
        }

        edgesSvg.appendChild(pathEl);
    });
}

function createNodeCard(nodesLayer, file, pos, onFileSelect) {
    const card = document.createElement('div');
    card.className = 'file-node-card';
    card.id = `node-${file.id.replace(/[/.]/g, '-')}`;
    card.dataset.fileId = file.id;
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
        <div class="node-subtext" title="${file.id}">${file.folder}/</div>
        <div class="node-footer-row">
            <span>${file.lines.toLocaleString()} loc</span>
            ${state.customContextFiles.has(file.id) ? '<span class="node-pinned-tag">📌 Bundle</span>' : ''}
            ${file.lines >= state.thresholds.large ? '<span class="node-refactor-tag">Refactor</span>' : ''}
        </div>
    `;

    card.onclick = (ev) => {
        ev.stopPropagation();
        if (onFileSelect) onFileSelect(file.id, false);
    };

    nodesLayer.appendChild(card);
    return card;
}

function makeCardDraggable(card, fileId, onFileSelect) {
    card.style.cursor = 'grab';
    card.onmousedown = (e) => {
        e.stopPropagation();
        activeDragNode = fileId;
        const currentPos = state.freeLayoutPositions.get(fileId) || { x: parseFloat(card.style.left), y: parseFloat(card.style.top) };
        nodeDragOffset = {
            x: (e.clientX / state.viewTransform.scale) - currentPos.x,
            y: (e.clientY / state.viewTransform.scale) - currentPos.y
        };
        card.style.cursor = 'grabbing';
    };
}

window.addEventListener('mousemove', (e) => {
    if (!activeDragNode || state.currentViewMode !== 'free') return;
    const nx = Math.round((e.clientX / state.viewTransform.scale) - nodeDragOffset.x);
    const ny = Math.round((e.clientY / state.viewTransform.scale) - nodeDragOffset.y);

    state.freeLayoutPositions.set(activeDragNode, { x: nx, y: ny });
    const card = document.getElementById(`node-${activeDragNode.replace(/[/.]/g, '-')}`);
    if (card) {
        card.style.left = `${nx}px`;
        card.style.top = `${ny}px`;
    }
});

window.addEventListener('mouseup', () => {
    if (activeDragNode) {
        activeDragNode = null;
        if (state.currentViewMode === 'free') {
            renderGraph();
        }
    }
});

function showEmptyPlaceholder(container, message) {
    const box = document.createElement('div');
    box.className = 'canvas-placeholder-box';
    box.innerHTML = `<h3>🔍 ${message}</h3>`;
    container.appendChild(box);
}

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
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#94a3b8"/>
            </marker>
            <marker id="arrow-dynamic" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#a78bfa"/>
            </marker>
        </defs>
    `;
}

export function updateTransform() {
    const world = document.getElementById('graph-world');
    if (world && state.currentViewMode !== 'matrix') {
        world.style.transform = `translate(${state.viewTransform.x}px, ${state.viewTransform.y}px) scale(${state.viewTransform.scale})`;
    }
}

export function centerNode(fileId) {
    const card = document.getElementById(`node-${fileId.replace(/[/.]/g, '-')}`);
    const viewport = document.getElementById('canvas-viewport');
    if (!card || !viewport || state.currentViewMode === 'matrix') return;

    const rect = viewport.getBoundingClientRect();
    const nx = parseFloat(card.style.left);
    const ny = parseFloat(card.style.top);

    state.viewTransform.x = (rect.width / 2) - (nx * state.viewTransform.scale) - 90;
    state.viewTransform.y = (rect.height / 2) - (ny * state.viewTransform.scale) - 34;
    updateTransform();
}

export function initCanvasNavigation() {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;

    vp.addEventListener('mousedown', (e) => {
        if (
            e.target.closest('.file-node-card') ||
            e.target.closest('.canvas-bottom-dock') ||
            e.target.closest('.drawer-toggle-handle') ||
            e.target.closest('.floating-context-pill') ||
            e.target.closest('.dsm-wrapper') ||
            e.target.closest('button') ||
            e.target.closest('select') ||
            e.target.closest('input')
        ) {
            return;
        }
        state.isDragging = true;
        state.dragStart = { x: e.clientX - state.viewTransform.x, y: e.clientY - state.viewTransform.y };
    });

    window.addEventListener('mousemove', (e) => {
        if (!state.isDragging || state.currentViewMode === 'matrix') return;
        state.viewTransform.x = e.clientX - state.dragStart.x;
        state.viewTransform.y = e.clientY - state.dragStart.y;
        updateTransform();
    });

    window.addEventListener('mouseup', () => { state.isDragging = false; });

    vp.addEventListener('wheel', (e) => {
        if (state.currentViewMode === 'matrix') return;
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
    const btnRerunFree = document.getElementById('btn-rerun-free-layout');

    if (btnZoomIn) btnZoomIn.onclick = () => { state.viewTransform.scale = Math.min(state.viewTransform.scale * 1.2, 2.5); updateTransform(); };
    if (btnZoomOut) btnZoomOut.onclick = () => { state.viewTransform.scale = Math.max(state.viewTransform.scale * 0.8, 0.2); updateTransform(); };
    if (btnFitGraph) btnFitGraph.onclick = () => { state.viewTransform = { x: 50, y: 10, scale: 0.75 }; updateTransform(); };
    if (btnFitScreen) btnFitScreen.onclick = () => { state.viewTransform = { x: 50, y: 10, scale: 0.75 }; updateTransform(); };
    if (btnCenterSelection) btnCenterSelection.onclick = () => { if (state.selectedFileId) centerNode(state.selectedFileId); };
    if (btnRerunFree) {
        btnRerunFree.onclick = () => {
            state.freeLayoutPositions.clear();
            renderGraph();
        };
    }
}