/**
 * @fileoverview Алгоритмический движок графа: расчет топологии, маршрутизация рёбер
 * с обходом препятствий (карточек файлов), раскладки режимов и архитектурные метрики.
 *
 * @module graphEngine
 */

export const CARD_W = 180;
export const CARD_H = 68;
const CARD_PADDING_SAFETY = 12;

// =============================================================================
// 1. АРХИТЕКТУРНЫЕ МЕТРИКИ И АНАЛИЗ ГРАФА
// =============================================================================

/**
 * Вычисляет архитектурные метрики графа зависимостей.
 *
 * @param {Array<import('./data.js').CodeFileNode>} files - Массив файлов проекта.
 * @param {Set<string>} [activeEdgeTypes] - Активные типы связей для фильтрации.
 * @returns {Object} Объект рассчитанных метрик проекта.
 */
export function computeGraphMetrics(files, activeEdgeTypes = null) {
    const fileMap = new Map(files.map(f => [f.id, f]));
    const inDegreeMap = new Map(files.map(f => [f.id, 0]));
    const outDegreeMap = new Map(files.map(f => [f.id, 0]));
    const folderOf = (id) => fileMap.get(id)?.folder || 'root';

    let totalConfirmedEdges = 0;
    let crossModuleEdgesCount = 0;
    const directAdjacency = new Map();

    files.forEach(f => {
        directAdjacency.set(f.id, new Set());
        (f.dependencies || []).forEach(dep => {
            if (activeEdgeTypes && !activeEdgeTypes.has(dep.type || 'import')) return;
            if (fileMap.has(dep.target) && dep.target !== f.id) {
                if (!directAdjacency.get(f.id).has(dep.target)) {
                    directAdjacency.get(f.id).add(dep.target);
                    totalConfirmedEdges++;

                    outDegreeMap.set(f.id, (outDegreeMap.get(f.id) || 0) + 1);
                    inDegreeMap.set(dep.target, (inDegreeMap.get(dep.target) || 0) + 1);

                    if (folderOf(f.id) !== folderOf(dep.target)) {
                        crossModuleEdgesCount++;
                    }
                }
            }
        });
    });

    // Поиск изолированных файлов (сирот)
    const isolatedFiles = files.filter(f => {
        return (inDegreeMap.get(f.id) === 0) && (outDegreeMap.get(f.id) === 0);
    }).map(f => f.id);

    // Расчет плотности направленного графа: |E| / (|V| * (|V| - 1))
    const n = files.length;
    const maxPossibleEdges = n > 1 ? n * (n - 1) : 1;
    const density = n > 1 ? (totalConfirmedEdges / maxPossibleEdges) : 0;

    // Поиск циклических компонент (Tarjan's SCC)
    const sccs = findStronglyConnectedComponents(files, activeEdgeTypes);
    const cycles = sccs.filter(comp => comp.length > 1);

    return {
        totalFiles: n,
        totalEdges: totalConfirmedEdges,
        crossModuleEdgesCount,
        density,
        isolatedFiles,
        inDegreeMap,
        outDegreeMap,
        cycles,
        sccs
    };
}

/**
 * Алгоритм Тарьяна для поиска сильно связных компонент (SCC) и обнаружения циклов.
 *
 * @param {Array<import('./data.js').CodeFileNode>} files - Узлы проекта.
 * @param {Set<string>} [activeEdgeTypes] - Фильтр типов связей.
 * @returns {string[][]} Список компонент связности.
 */
export function findStronglyConnectedComponents(files, activeEdgeTypes = null) {
    const fileMap = new Map(files.map(f => [f.id, f]));
    let index = 0;
    const indices = new Map();
    const lowlink = new Map();
    const onStack = new Map();
    const stack = [];
    const sccs = [];

    function strongConnect(v) {
        indices.set(v, index);
        lowlink.set(v, index);
        index++;
        stack.push(v);
        onStack.set(v, true);

        const node = fileMap.get(v);
        const targets = new Set();
        if (node && node.dependencies) {
            node.dependencies.forEach(dep => {
                if (activeEdgeTypes && !activeEdgeTypes.has(dep.type || 'import')) return;
                if (fileMap.has(dep.target) && dep.target !== v) {
                    targets.add(dep.target);
                }
            });
        }

        targets.forEach(w => {
            if (!indices.has(w)) {
                strongConnect(w);
                lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
            } else if (onStack.get(w)) {
                lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
            }
        });

        if (lowlink.get(v) === indices.get(v)) {
            const component = [];
            let w;
            do {
                w = stack.pop();
                onStack.set(w, false);
                component.push(w);
            } while (w !== v);
            sccs.push(component);
        }
    }

    files.forEach(f => {
        if (!indices.has(f.id)) {
            strongConnect(f.id);
        }
    });

    return sccs;
}

// =============================================================================
// 2. МАРШРУТИЗАЦИЯ РЁБЕР БЕЗ ПЕРЕСЕЧЕНИЯ КАРТОЧЕК
// =============================================================================

/**
 * Проверяет геометрическое пересечение отрезка (p1->p2) с прямоугольником (AABB).
 *
 * @param {{x: number, y: number}} p1 - Начало отрезка.
 * @param {{x: number, y: number}} p2 - Конец отрезка.
 * @param {{x: number, y: number, width: number, height: number}} rect - Прямоугольник.
 * @param {number} [pad=0] - Защитный отступ вокруг прямоугольника.
 * @returns {boolean} True, если отрезок пересекает прямоугольник.
 */
export function segmentIntersectsRect(p1, p2, rect, pad = 0) {
    const minX = rect.x - pad;
    const maxX = rect.x + rect.width + pad;
    const minY = rect.y - pad;
    const maxY = rect.y + rect.height + pad;

    // Быстрая отсечка по AABB отрезка
    if (Math.max(p1.x, p2.x) < minX || Math.min(p1.x, p2.x) > maxX) return false;
    if (Math.max(p1.y, p2.y) < minY || Math.min(p1.y, p2.y) > maxY) return false;

    // Внутренняя точка
    if (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) return true;
    if (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY) return true;

    // Проверка пересечения с четырьмя сторонами
    const leftIntersect = lineSegmentsIntersect(p1.x, p1.y, p2.x, p2.y, minX, minY, minX, maxY);
    if (leftIntersect) return true;
    const rightIntersect = lineSegmentsIntersect(p1.x, p1.y, p2.x, p2.y, maxX, minY, maxX, maxY);
    if (rightIntersect) return true;
    const topIntersect = lineSegmentsIntersect(p1.x, p1.y, p2.x, p2.y, minX, minY, maxX, minY);
    if (topIntersect) return true;
    const bottomIntersect = lineSegmentsIntersect(p1.x, p1.y, p2.x, p2.y, minX, maxY, maxX, maxY);
    if (bottomIntersect) return true;

    return false;
}

function lineSegmentsIntersect(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
    const s1x = p1x - p0x;
    const s1y = p1y - p0y;
    const s2x = p3x - p2x;
    const s2y = p3y - p2y;
    const s = (-s1y * (p0x - p2x) + s1x * (p0y - p2y)) / (-s2x * s1y + s1x * s2y);
    const t = (s2x * (p0y - p2y) - s2y * (p0x - p2x)) / (-s2x * s1y + s1x * s2y);
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

/**
 * Точка пересечения луча из центра прямоугольника с его границей.
 */
export function getRectIntersection(rect, targetX, targetY) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;

    if (dx === 0 && dy === 0) return { x: cx, y: cy };

    const hw = rect.width / 2;
    const hh = rect.height / 2;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    let scale;
    if (absDx * hh > absDy * hw) {
        scale = hw / absDx;
    } else {
        scale = hh / absDy;
    }

    return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Проверяет, пересекает ли полилиния пути хотя бы одну карточку препятствия.
 *
 * @param {Array<{x: number, y: number}>} points - Точки пути.
 * @param {Array<{x: number, y: number, width: number, height: number}>} obstacleRects - Карточки.
 * @returns {boolean} True, если зафиксировано пересечение с карточкой.
 */
export function checkPathIntersectsObstacles(points, obstacleRects) {
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        for (const obs of obstacleRects) {
            if (segmentIntersectsRect(p1, p2, obs, 4)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Маршрутизирует ребро с обходом прямоугольников карточек через выделенные каналы.
 *
 * @param {{x: number, y: number, width: number, height: number}} srcRect - Исходная карточка.
 * @param {{x: number, y: number, width: number, height: number}} tgtRect - Целевая карточка.
 * @param {Array<{x: number, y: number, width: number, height: number}>} allObstacleRects - Все карточки на холсте.
 * @param {number} [parallelIndex=0] - Смещение для параллельных рёбер.
 * @returns {string} SVG path data (d-атрибут).
 */
export function routeEdgeAvoidCards(srcRect, tgtRect, allObstacleRects, parallelIndex = 0) {
    const srcCenter = { x: srcRect.x + srcRect.width / 2, y: srcRect.y + srcRect.height / 2 };
    const tgtCenter = { x: tgtRect.x + tgtRect.width / 2, y: tgtRect.y + tgtRect.height / 2 };

    // Смещение параллельных рёбер на портах
    const portOffset = parallelIndex * 9;

    let start = getRectIntersection(srcRect, tgtCenter.x, tgtCenter.y + portOffset);
    let end = getRectIntersection(tgtRect, srcCenter.x, srcCenter.y + portOffset);

    // Препятствия — все карточки, кроме истока и цели
    const obstacles = allObstacleRects.filter(r => r !== srcRect && r !== tgtRect);

    // 1. Проверяем прямой отрезок
    const directIntersects = obstacles.some(obs => segmentIntersectsRect(start, end, obs, CARD_PADDING_SAFETY));

    if (!directIntersects) {
        // Прямой путь свободен — строим гладкую кубическую кривую
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dist = Math.hypot(dx, dy);
        const curvature = Math.min(Math.max(dist * 0.22, 25), 80);
        const nx = -dy / (dist || 1);
        const ny = dx / (dist || 1);

        const cp1x = start.x + dx * 0.28 + nx * curvature * 0.2 + (portOffset * 0.5);
        const cp1y = start.y + dy * 0.28 + ny * curvature * 0.2;
        const cp2x = start.x + dx * 0.72 + nx * curvature * 0.2 + (portOffset * 0.5);
        const cp2y = start.y + dy * 0.72 + ny * curvature * 0.2;

        return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    }

    // 2. Прямой путь пересекает карточки — генерируем ортогональный обход через каналы (Waypoints)
    const collidingObstacles = obstacles.filter(obs => segmentIntersectsRect(start, end, obs, CARD_PADDING_SAFETY));

    // Находим экстремумы карточек-препятствий
    let minObsY = Infinity;
    let maxObsY = -Infinity;
    collidingObstacles.forEach(obs => {
        minObsY = Math.min(minObsY, obs.y - CARD_PADDING_SAFETY);
        maxObsY = Math.max(maxObsY, obs.y + obs.height + CARD_PADDING_SAFETY);
    });

    // Определяем, куда выгоднее обойти: сверху или снизу
    const routeAboveY = minObsY - 20 - Math.abs(portOffset);
    const routeBelowY = maxObsY + 20 + Math.abs(portOffset);

    const costAbove = Math.abs(start.y - routeAboveY) + Math.abs(end.y - routeAboveY);
    const costBelow = Math.abs(start.y - routeBelowY) + Math.abs(end.y - routeBelowY);
    const bypassY = costAbove <= costBelow ? routeAboveY : routeBelowY;

    // Путевые точки ортогонального обхода с закруглением
    const midX1 = start.x + (end.x - start.x) * 0.2;
    const midX2 = start.x + (end.x - start.x) * 0.8;

    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${start.x.toFixed(1)} ${bypassY.toFixed(1)}, ${midX1.toFixed(1)} ${bypassY.toFixed(1)} T ${midX2.toFixed(1)} ${bypassY.toFixed(1)} T ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

// =============================================================================
// 3. РАСКЛАДКА РЕЖИМА 1 — «КАРТА ПРОЕКТА» (FOLDER CLUSTERS)
// =============================================================================

/**
 * Раскладка файлов по кластерам директорий с поддержкой сворачивания папок.
 *
 * @param {Array<import('./data.js').CodeFileNode>} files - Все файлы проекта.
 * @param {Set<string>} visibleNodeIds - Видимые файлы.
 * @param {Set<string>} collapsedFolders - Список свернутых папок.
 * @returns {Object} Кластеры и вычисленные позиции узлов.
 */
export function computeGraphLayout(files, visibleNodeIds, collapsedFolders = new Set()) {
    const activeFiles = files.filter(f => visibleNodeIds.has(f.id));
    const foldersMap = new Map();

    activeFiles.forEach(file => {
        const folder = file.folder || 'root';
        if (!foldersMap.has(folder)) foldersMap.set(folder, []);
        foldersMap.get(folder).push(file);
    });

    const nodePositions = new Map();
    const clusters = [];
    const GAP_X = 32;
    const GAP_Y = 28;
    const PADDING_BOX = 20;
    const TOP_HEADER_OFFSET = 42;
    const CLUSTER_MARGIN = 85;

    const clusterBoxes = [];
    foldersMap.forEach((folderFiles, folderName) => {
        const isCollapsed = collapsedFolders.has(folderName);
        if (isCollapsed) {
            // Свернутый кластер представлен компактным блоком
            clusterBoxes.push({
                folderName,
                folderFiles,
                isCollapsed: true,
                cols: 1,
                width: 220,
                height: 80
            });
        } else {
            let cols = 1;
            if (folderFiles.length >= 8) cols = 3;
            else if (folderFiles.length >= 3) cols = 2;

            const rows = Math.ceil(folderFiles.length / cols);
            const width = (cols * CARD_W) + ((cols - 1) * GAP_X) + (PADDING_BOX * 2);
            const height = (rows * CARD_H) + ((rows - 1) * GAP_Y) + (PADDING_BOX * 2) + TOP_HEADER_OFFSET;

            clusterBoxes.push({
                folderName,
                folderFiles,
                isCollapsed: false,
                cols,
                width,
                height
            });
        }
    });

    const maxColumns = clusterBoxes.length > 4 ? 3 : 2;
    const columnX = [0, 0, 0];
    const columnY = [0, 0, 0];

    clusterBoxes.forEach((box, i) => {
        const colIdx = i % maxColumns;
        const curX = colIdx === 0 ? 50 : (columnX[colIdx - 1] || 50) + CLUSTER_MARGIN;
        const curY = (columnY[colIdx] || 0) + 50;

        box.x = curX;
        box.y = curY;

        columnX[colIdx] = Math.max(columnX[colIdx] || 0, curX + box.width);
        columnY[colIdx] = curY + box.height + CLUSTER_MARGIN;

        if (box.isCollapsed) {
            // Для всех файлов свернутой папки позиция перенаправляется на сам свернутый кластер
            box.folderFiles.forEach(file => {
                nodePositions.set(file.id, {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                    isCollapsedFolder: true,
                    folder: box.folderName
                });
            });
        } else {
            box.folderFiles.forEach((file, index) => {
                const c = index % box.cols;
                const r = Math.floor(index / box.cols);

                const nx = box.x + PADDING_BOX + (c * (CARD_W + GAP_X));
                const ny = box.y + PADDING_BOX + TOP_HEADER_OFFSET + (r * (CARD_H + GAP_Y));

                nodePositions.set(file.id, {
                    x: nx,
                    y: ny,
                    width: CARD_W,
                    height: CARD_H,
                    isCollapsedFolder: false
                });
            });
        }

        clusters.push({
            folder: box.folderName,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            isCollapsed: box.isCollapsed,
            fileCount: box.folderFiles.length,
            fileIds: box.folderFiles.map(f => f.id)
        });
    });

    return { clusters, nodePositions };
}

// =============================================================================
// 4. РАСКЛАДКА РЕЖИМА 2 — «СЛОЕВОЙ ГРАФ» (LAYERED EGO-GRAPH)
// =============================================================================

/**
 * Рассчитывает слоевую раскладку для выбранного опорного узла:
 * Уровень 0: Выбранный узел (в центре).
 * Уровни -1, -2: Восходящие зависимости (Upstream / кто использует).
 * Уровни +1, +2: Нисходящие зависимости (Downstream / кого использует).
 *
 * Гарантия: каждый узел присутствует строго один раз независимо от количества связей.
 *
 * @param {string} rootId - Идентификатор центрального узла.
 * @param {Array<import('./data.js').CodeFileNode>} files - Все файлы проекта.
 * @param {number} [maxDepth=2] - Глубина поиска.
 * @param {Set<string>} [activeEdgeTypes] - Фильтр типов связей.
 * @returns {Object} Позиции узлов и список связей подграфа.
 */
export function computeLayeredGraphLayout(rootId, files, maxDepth = 2, activeEdgeTypes = null) {
    const fileMap = new Map(files.map(f => [f.id, f]));
    if (!fileMap.has(rootId)) {
        return { nodePositions: new Map(), visibleEdges: [], visibleNodeIds: new Set() };
    }

    const reverseAdjacency = new Map();
    const forwardAdjacency = new Map();

    files.forEach(f => {
        forwardAdjacency.set(f.id, []);
        reverseAdjacency.set(f.id, []);
    });

    files.forEach(f => {
        (f.dependencies || []).forEach(dep => {
            if (activeEdgeTypes && !activeEdgeTypes.has(dep.type || 'import')) return;
            if (fileMap.has(dep.target) && dep.target !== f.id) {
                forwardAdjacency.get(f.id).push({ target: dep.target, type: dep.type || 'import' });
                reverseAdjacency.get(dep.target).push({ source: f.id, type: dep.type || 'import' });
            }
        });
    });

    const nodeLayer = new Map();
    nodeLayer.set(rootId, 0);

    // BFS Upstream (Слева: отрицательные уровни -1, -2)
    let upQueue = [rootId];
    for (let d = 1; d <= maxDepth; d++) {
        const nextQueue = [];
        for (const curr of upQueue) {
            for (const { source } of reverseAdjacency.get(curr) || []) {
                if (!nodeLayer.has(source)) {
                    nodeLayer.set(source, -d);
                    nextQueue.push(source);
                }
            }
        }
        upQueue = nextQueue;
    }

    // BFS Downstream (Справа: положительные уровни +1, +2)
    let downQueue = [rootId];
    for (let d = 1; d <= maxDepth; d++) {
        const nextQueue = [];
        for (const curr of downQueue) {
            for (const { target } of forwardAdjacency.get(curr) || []) {
                if (!nodeLayer.has(target)) {
                    nodeLayer.set(target, d);
                    nextQueue.push(target);
                }
            }
        }
        downQueue = nextQueue;
    }

    const visibleNodeIds = new Set(nodeLayer.keys());
    const layersMap = new Map();

    visibleNodeIds.forEach(id => {
        const layer = nodeLayer.get(id);
        if (!layersMap.has(layer)) layersMap.set(layer, []);
        layersMap.get(layer).push(id);
    });

    // Сортировка слоев от отрицательных (слева) к положительным (справа)
    const sortedLayers = Array.from(layersMap.keys()).sort((a, b) => a - b);
    const nodePositions = new Map();

    const LAYER_SPACING_X = 290;
    const NODE_SPACING_Y = 100;
    const START_CENTER_X = 500;
    const START_CENTER_Y = 320;

    sortedLayers.forEach(layerIdx => {
        const layerNodes = layersMap.get(layerIdx);
        const colX = START_CENTER_X + (layerIdx * LAYER_SPACING_X);
        const totalHeight = (layerNodes.length - 1) * NODE_SPACING_Y;
        const startY = START_CENTER_Y - (totalHeight / 2);

        layerNodes.forEach((nodeId, rowIdx) => {
            const posY = startY + (rowIdx * NODE_SPACING_Y);
            nodePositions.set(nodeId, {
                x: colX,
                y: posY,
                width: CARD_W,
                height: CARD_H,
                layer: layerIdx,
                isRoot: nodeId === rootId
            });
        });
    });

    // Формирование связей только между отображаемыми узлами
    const visibleEdges = [];
    visibleNodeIds.forEach(srcId => {
        (forwardAdjacency.get(srcId) || []).forEach(({ target, type }) => {
            if (visibleNodeIds.has(target)) {
                visibleEdges.push({ from: srcId, to: target, type });
            }
        });
    });

    return { nodePositions, visibleEdges, visibleNodeIds };
}

// =============================================================================
// 5. РАСКЛАДКА РЕЖИМА 3 — «СВОБОДНЫЙ ГРАФ» (FORCE-DIRECTED)
// =============================================================================

/**
 * Выполняет физическую итерацию силовой симуляции графа (Force-Directed Step)
 * с учетом габаритов карточек (CARD_W, CARD_H) и предотвращением наложения.
 *
 * @param {Array<{id: string, x: number, y: number}>} nodes - Узлы с координатами.
 * @param {Array<{from: string, to: string}>} edges - Рёбра графа.
 * @param {number} [iterations=40] - Количество шагов симуляции.
 * @returns {Map<string, {x: number, y: number, width: number, height: number}>} Позиции узлов.
 */
export function simulateForceLayout(nodes, edges, iterations = 40) {
    const positions = new Map();
    nodes.forEach(n => {
        positions.set(n.id, { x: n.x || (Math.random() * 800), y: n.y || (Math.random() * 600) });
    });

    const k = 220; // Оптимальное расстояние между узлами

    for (let iter = 0; iter < iterations; iter++) {
        const forces = new Map();
        nodes.forEach(n => forces.set(n.id, { fx: 0, fy: 0 }));

        // 1. Силы взаимного отталкивания карточек (Кулоновское отталкивание + AABB коллизии)
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const u = nodes[i].id;
                const v = nodes[j].id;
                const p1 = positions.get(u);
                const p2 = positions.get(v);

                let dx = p1.x - p2.x;
                let dy = p1.y - p2.y;
                let dist = Math.hypot(dx, dy) || 1;

                // Усиленное отталкивание при наложении карточек
                const minDistanceX = CARD_W + 30;
                const minDistanceY = CARD_H + 30;
                let repFactor = (k * k) / dist;

                if (Math.abs(dx) < minDistanceX && Math.abs(dy) < minDistanceY) {
                    repFactor *= 3.5;
                }

                const fx = (dx / dist) * repFactor;
                const fy = (dy / dist) * repFactor;

                forces.get(u).fx += fx;
                forces.get(u).fy += fy;
                forces.get(v).fx -= fx;
                forces.get(v).fy -= fy;
            }
        }

        // 2. Силы притяжения вдоль рёбер (Закон Гука)
        edges.forEach(e => {
            const p1 = positions.get(e.from);
            const p2 = positions.get(e.to);
            if (!p1 || !p2) return;

            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.hypot(dx, dy) || 1;

            const attFactor = (dist * dist) / k;
            const fx = (dx / dist) * attFactor * 0.08;
            const fy = (dy / dist) * attFactor * 0.08;

            forces.get(e.from).fx -= fx;
            forces.get(e.from).fy -= fy;
            forces.get(e.to).fx += fx;
            forces.get(e.to).fy += fy;
        });

        // 3. Интегрирование смещений с затуханием (Damping)
        const temperature = Math.max(0.1, 1.0 - (iter / iterations));
        nodes.forEach(n => {
            const f = forces.get(n.id);
            const p = positions.get(n.id);
            p.x += Math.max(-50, Math.min(50, f.fx * 0.05 * temperature));
            p.y += Math.max(-50, Math.min(50, f.fy * 0.05 * temperature));
        });
    }

    const resultMap = new Map();
    positions.forEach((pos, id) => {
        resultMap.set(id, {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            width: CARD_W,
            height: CARD_H
        });
    });

    return resultMap;
}

// =============================================================================
// 6. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Вычисляет подграф бандла: все узлы и рёбра между ними с фильтрацией типов.
 */
export function computeBundleSubgraph(allFiles, bundleFileIds, activeEdgeTypes = null) {
    const visibleNodes = new Set(bundleFileIds);
    const visibleEdges = [];
    const fileMap = new Map(allFiles.map(f => [f.id, f]));

    visibleNodes.forEach(nodeId => {
        const file = fileMap.get(nodeId);
        if (!file) return;

        (file.dependencies || []).forEach(dep => {
            if (activeEdgeTypes && !activeEdgeTypes.has(dep.type || 'import')) return;
            if (visibleNodes.has(dep.target) && dep.target !== nodeId) {
                visibleEdges.push({
                    from: nodeId,
                    to: dep.target,
                    type: dep.type || 'import'
                });
            }
        });
    });

    return { visibleNodes, visibleEdges };
}