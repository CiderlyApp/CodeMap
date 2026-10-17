/**
 * @fileoverview Отрисовка интерактивной физической карты зависимостей (Vis.js Network).
 * Обеспечивает строгую дедупликацию узлов и ребер для предотвращения коллизий id в Vis.js DataSet.
 * @module graphRenderer
 */

import { appState } from './state.js';
import { PROJECT_COLORS_POOL, getGlobalTypeColor } from './constants.js';
import { UI } from './ui.js';

/**
 * Загружает топологию зависимостей с бэкенда и инициализирует граф Vis.js.
 *
 * @async
 * @param {boolean} [refresh=false] - Флаг принудительной реиндексации проекта на сервере.
 * @returns {Promise<void>}
 */
export async function loadGraph(refresh = false) {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    
    loader.style.display = 'flex';
    loaderText.innerText = "Анализ репозиториев...";

    try {
        const response = await fetch(`/api/graph?refresh=${refresh}`);
        const data = await response.json();

        appState.allNodes = data.nodes || [];
        appState.allEdges = data.edges || [];

        if (!appState.allNodes || appState.allNodes.length === 0) {
            loader.style.display = 'none';
            document.getElementById('network').innerHTML = `
                <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#7f8c8d; font-size:15px; flex-direction:column; gap:10px; text-align:center; padding: 20px;">
                    <span style="font-size: 24px;">⚠️</span>
                    <strong>Подходящие файлы не найдены</strong>
                    <span style="font-size: 13px;">Проверьте выбор папок в меню «📁 Проекты и Настройки ⚙️»</span>
                </div>
            `;
            return;
        }

        const projects = [...new Set(appState.allNodes.map(node => node.id.split('/')[0]))];
        appState.activeProjects.clear();
        appState.projectColors = {};
        appState.projectDirections = {};

        projects.forEach((proj, idx) => {
            appState.activeProjects.add(proj);
            appState.projectColors[proj] = PROJECT_COLORS_POOL[idx % PROJECT_COLORS_POOL.length];
            const angle = (2 * Math.PI * idx) / projects.length;
            appState.projectDirections[proj] = { x: Math.cos(angle), y: Math.sin(angle) };
        });

        const activeUi = UI || window.UI;
        if (activeUi) {
            activeUi.buildProjectFilters(projects, appState.projectColors, (project, isChecked) => {
                if (isChecked) appState.activeProjects.add(project);
                else appState.activeProjects.delete(project);
                appState.nodesView.refresh();
                handleDeselect();
            });
            activeUi.initAutocomplete(appState.allNodes);
        }

        loaderText.innerText = "Распределение элементов...";

        const connectedNodes = new Set();
        appState.allEdges.forEach(e => {
            connectedNodes.add(e.from);
            connectedNodes.add(e.to);
        });

        const lonelyCounts = {};
        const seenNodeIds = new Set();
        const formattedNodes = [];

        // Дедупликация и форматирование узлов
        for (const node of appState.allNodes) {
            if (seenNodeIds.has(node.id)) {
                continue;
            }
            seenNodeIds.add(node.id);

            const project = node.id.split('/')[0];
            const isLonely = !connectedNodes.has(node.id);
            const direction = appState.projectDirections[project] || { x: 0, y: 0 };
            const centerX = direction.x * appState.currentProjDistance;
            const centerY = direction.y * appState.currentProjDistance;

            let posX, posY, isFixed = false, usePhysics = true;

            if (isLonely) {
                if (lonelyCounts[project] === undefined) lonelyCounts[project] = 0;
                const count = lonelyCounts[project]++;
                posX = centerX - 350 + ((count % 7) * 125);
                posY = centerY + 450 + (Math.floor(count / 7) * 45); 
                isFixed = true;
                usePhysics = false;
            } else {
                const angle = Math.random() * Math.PI * 2;
                const radius = 80 + Math.random() * 200;
                posX = centerX + Math.cos(angle) * radius;
                posY = centerY + Math.sin(angle) * radius;
            }

            const projBorderColor = appState.projectColors[project] || '#7f8c8d';
            const globalBgColor = getGlobalTypeColor(node.group);
            const finalFontSize = Math.round(10 + Math.min(Math.log(node.lines || 1) * 1.5, 8));

            formattedNodes.push({
                id: node.id,
                label: node.label,
                customGroup: node.group, 
                project,
                x: posX,
                y: posY,
                isLonely,
                fixed: isFixed,
                physics: usePhysics,
                color: {
                    border: isLonely ? '#bdc3c7' : projBorderColor,
                    background: globalBgColor,
                    highlight: { background: globalBgColor, border: projBorderColor },
                    hover: { background: globalBgColor, border: projBorderColor }
                },
                font: { size: finalFontSize, color: projBorderColor, face: 'monospace' },
                borderDashes: isLonely ? [4, 4] : false
            });
        }

        // Обновление петель
        appState.circularSet.clear();
        if (data.circular_edges) {
            data.circular_edges.forEach(edge => {
                appState.circularSet.add(`${edge.from}->${edge.to}`);
            });
        }

        renderWarningCycles(data.circular_edges);

        // Гарантированная дедупликация ребер по id
        const seenEdgeIds = new Set();
        const formattedEdges = [];

        for (const edge of appState.allEdges) {
            const edgeId = `${edge.from}->${edge.to}`;
            if (seenEdgeIds.has(edgeId) || edge.from === edge.to) {
                continue;
            }
            seenEdgeIds.add(edgeId);

            const isCircular = appState.circularSet.has(edgeId);
            formattedEdges.push({
                id: edgeId,
                from: edge.from,
                to: edge.to,
                arrows: 'to',
                color: { color: isCircular ? '#e74c3c' : '#bdc3c7', highlight: '#3498db' },
                width: isCircular ? 3.5 : 1.5,
                title: isCircular ? '⚠️ Архитектурная петля (циклическая зависимость)' : ''
            });
        }

        appState.nodesDataSet = new vis.DataSet(formattedNodes);
        appState.edgesDataSet = new vis.DataSet(formattedEdges);

        appState.nodesView = new vis.DataView(appState.nodesDataSet, {
            filter: (item) => {
                if (!appState.activeProjects.has(item.project)) return false;
                if (appState.orphanFilterMode === 'no-orphans') return !item.isLonely;
                if (appState.orphanFilterMode === 'only-orphans') return item.isLonely;
                return true;
            }
        });

        const container = document.getElementById('network');
        const options = {
            nodes: { shape: 'box', margin: 10, borderWidth: 2 },
            edges: { smooth: { type: 'cubicBezier', forceDirection: 'none', roundness: 0.6 } },
            physics: {
                enabled: true,
                solver: 'barnesHut',
                barnesHut: {
                    gravitationalConstant: -45000,
                    centralGravity: 0.1,
                    springLength: appState.currentElemDistance * 1.5,
                    springConstant: 0.04,
                    damping: 0.12,
                    avoidOverlap: 1
                },
                stabilization: { enabled: true, iterations: 250, updateInterval: 25 }
            },
            interaction: { hover: true, tooltipDelay: 150 }
        };

        appState.network = new vis.Network(container, { nodes: appState.nodesView, edges: appState.edgesDataSet }, options);

        appState.network.on("stabilizationProgress", (params) => {
            const progress = Math.round((params.iterations / params.total) * 100);
            loaderText.innerText = `Формирование орбит: ${progress}%`;
        });

        appState.network.on("stabilizationIterationsDone", () => {
            loader.style.display = 'none';
            appState.network.setOptions({ physics: { enabled: false } });
            appState.network.fit();
        });

        appState.network.on("selectNode", (params) => handleSelect(params.nodes[0]));
        appState.network.on("deselectNode", () => handleDeselect());

    } catch (err) {
        loaderText.innerHTML = `<span style="color: #c0392b;">Ошибка загрузки графа</span>`;
        console.error("Ошибка Vis.js:", err);
    }
}

/**
 * Отрисовывает информационный список выявленных циклических зависимостей.
 *
 * @param {Array<{from: string, to: string}>} cycles - Список ребер циклов.
 * @returns {void}
 */
export function renderWarningCycles(cycles) {
    const warningBox = document.getElementById('cycles-warning');
    const cyclesList = document.getElementById('cycles-list');
    if (!warningBox || !cyclesList) return;
    
    if (cycles && cycles.length > 0) {
        warningBox.style.display = 'block';
        cyclesList.innerHTML = '';
        cycles.forEach(edge => {
            const div = document.createElement('div');
            div.style.cssText = 'padding: 3px 0; border-bottom: 1px dashed #f8b4b4; cursor: pointer; font-size: 12px;';
            div.innerText = `🔄 ${edge.from.split('/').pop()} ⇄ ${edge.to.split('/').pop()}`;
            div.onclick = () => selectAndFocus(edge.from);
            cyclesList.appendChild(div);
        });
    } else {
        warningBox.style.display = 'none';
    }
}

/**
 * Сбрасывает визуальную подсветку активных путей и останавливает таймер анимации.
 * @returns {void}
 */
export function resetHighlighting() {
    if (appState.dashAnimationInterval) {
        clearInterval(appState.dashAnimationInterval);
        appState.dashAnimationInterval = null;
    }

    if (appState.highlightedNodes.length > 0) {
        appState.nodesDataSet.update(appState.allNodes.map(n => ({ id: n.id, opacity: 1.0, borderWidth: 2 })));
        appState.highlightedNodes = [];
    }

    if (appState.highlightedEdges.length > 0) {
        appState.edgesDataSet.update(appState.highlightedEdges.map(edgeId => ({
            id: edgeId,
            color: { color: appState.circularSet.has(edgeId) ? '#e74c3c' : '#bdc3c7' },
            width: appState.circularSet.has(edgeId) ? 3.5 : 1.5,
            dashes: false
        })));
        appState.highlightedEdges = [];
    }
}

/**
 * Выделяет узел, выполняет обход связанных зависимостей и запускает анимацию потока связей.
 *
 * @param {string} nodeId - Уникальный идентификатор узла.
 * @returns {void}
 */
export function handleSelect(nodeId) {
    appState.selectedNodeId = nodeId; 
    const activeUi = UI || window.UI;
    if (activeUi) activeUi.updateSelectedInfo(nodeId);
    
    const upstream = new Set();
    const downstream = new Set();

    const findUpstream = (node) => {
        appState.allEdges.forEach(e => {
            if (e.from === node && !upstream.has(e.to)) {
                upstream.add(e.to); findUpstream(e.to);
            }
        });
    };

    const findDownstream = (node) => {
        appState.allEdges.forEach(e => {
            if (e.to === node && !downstream.has(e.from)) {
                downstream.add(e.from); findDownstream(e.from);
            }
        });
    };

    findUpstream(nodeId);
    findDownstream(nodeId);

    resetHighlighting();

    const nodeUpdates = appState.allNodes.map(node => {
        let opacity = 0.15;
        let borderWidth = 2;

        if (node.id === nodeId || upstream.has(node.id) || downstream.has(node.id)) {
            opacity = 1.0;
            appState.highlightedNodes.push(node.id);
        }
        if (node.id === nodeId) borderWidth = 4;

        return { id: node.id, opacity, borderWidth };
    });
    appState.nodesDataSet.update(nodeUpdates);

    const edgeUpdates = [];
    const animateEdges = [];

    appState.allEdges.forEach(edge => {
        const edgeId = `${edge.from}->${edge.to}`;
        let color = null;

        if (edge.from === nodeId || (upstream.has(edge.from) && upstream.has(edge.to))) {
            color = '#e67e22';
        } else if (edge.to === nodeId || (downstream.has(edge.from) && downstream.has(edge.to))) {
            color = '#2980b9';
        }

        if (color) {
            edgeUpdates.push({ id: edgeId, color: { color }, width: 2.5, dashes: [5, 5] });
            appState.highlightedEdges.push(edgeId);
            animateEdges.push({ id: edgeId });
        }
    });
    appState.edgesDataSet.update(edgeUpdates);

    if (animateEdges.length > 0) {
        let dashOffset = 0;
        appState.dashAnimationInterval = setInterval(() => {
            dashOffset = (dashOffset + 2) % 16;
            appState.edgesDataSet.update(animateEdges.map(edge => ({
                id: edge.id,
                dashes: [Math.max(0.1, dashOffset), 8, Math.max(0.1, 16 - dashOffset), 8]
            })));
        }, 80);
    }

    if (activeUi) activeUi.renderDependencyLists(upstream, downstream, selectAndFocus);
}

/**
 * Снимает активный выбор с текущего элемента и очищает стили графа.
 * @returns {void}
 */
export function handleDeselect() {
    appState.selectedNodeId = null; 
    const activeUi = UI || window.UI;
    if (activeUi) activeUi.updateSelectedInfo(null);
    resetHighlighting();
}

/**
 * Программно центрирует камеру полотна на целевом узле с зумированием.
 *
 * @param {string} nodeId - Идентификатор узла для фокусировки.
 * @returns {void}
 */
export function selectAndFocus(nodeId) {
    if (appState.nodesDataSet && appState.nodesDataSet.get(nodeId)) {
        appState.network.selectNodes([nodeId]);
        handleSelect(nodeId);
        appState.network.focus(nodeId, {
            scale: 1.1,
            animation: { duration: 500, easingFunction: 'easeInOutQuad' }
        });
    }
}

/**
 * Изменяет базовую дистанцию пружин физической модели графа.
 *
 * @param {number|string} newDistance - Новое расстояние в пикселях.
 * @returns {void}
 */
export function changeElementDistance(newDistance) {
    appState.currentElemDistance = parseInt(newDistance, 10);
    document.getElementById('val-elem-dist').innerText = `${appState.currentElemDistance}px`;
    
    if (!appState.network) return;

    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = "Пересчет геометрии...";

    appState.network.setOptions({
        physics: {
            enabled: true,
            barnesHut: {
                springLength: appState.currentElemDistance * 1.5,
                gravitationalConstant: -250 * appState.currentElemDistance
            }
        }
    });
    appState.network.stabilize(180);
}

/**
 * Масштабирует относительное позиционирование кластеров проектов.
 *
 * @param {number|string} newDistance - Новая дистанция орбиты проектов.
 * @returns {void}
 */
export function changeProjectDistance(newDistance) {
    const nextD = parseInt(newDistance, 10);
    document.getElementById('val-proj-dist').innerText = `${nextD}px`;

    if (!appState.nodesDataSet) return;
    const scaleFactor = nextD / appState.currentProjDistance;

    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = "Перемещение проектов...";

    const updates = appState.nodesDataSet.get().map(node => ({
        id: node.id,
        x: node.x * scaleFactor,
        y: node.y * scaleFactor
    }));

    appState.nodesDataSet.update(updates);
    appState.currentProjDistance = nextD;

    appState.network.setOptions({ physics: { enabled: true } });
    appState.network.stabilize(100);
}