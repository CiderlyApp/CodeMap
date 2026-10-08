/**
 * @fileoverview Алгоритмический движок графа: расчет топологии, транзитивного замыкания
 * зависимостей и роутинг кривых Безье в обход карточек файлов.
 *
 * @module graphEngine
 */

const CARD_W = 180;
const CARD_H = 68;

/**
 * Вычисляет точку пересечения луча (из центра карточки к цели) с её границей.
 * Предотвращает заезд стрелок внутрь тела карточки.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect - Координаты и размеры карточки.
 * @param {number} targetX - Координата X целевой точки.
 * @param {number} targetY - Координата Y целевой точки.
 * @returns {{x: number, y: number}} Координаты точки на границе.
 */
function getRectIntersection(rect, targetX, targetY) {
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

    return {
        x: cx + dx * scale,
        y: cy + dy * scale
    };
}

/**
 * Генерирует сглаженную кубическую кривую Безье, выходящую из внешней границы
 * карточки-источника и входящую во внешнюю границу карточки-цели.
 *
 * @param {{x: number, y: number, width: number, height: number}} srcRect - Прямоугольник истока.
 * @param {{x: number, y: number, width: number, height: number}} tgtRect - Прямоугольник цели.
 * @returns {string} SVG Path команды (d-атрибут).
 */
export function generateCurvedEdgePath(srcRect, tgtRect) {
    const srcCenter = { x: srcRect.x + srcRect.width / 2, y: srcRect.y + srcRect.height / 2 };
    const tgtCenter = { x: tgtRect.x + tgtRect.width / 2, y: tgtRect.y + tgtRect.height / 2 };

    const start = getRectIntersection(srcRect, tgtCenter.x, tgtCenter.y);
    const end = getRectIntersection(tgtRect, srcCenter.x, srcCenter.y);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);

    const nx = -dy / (dist || 1);
    const ny = dx / (dist || 1);

    const isVerticalColumn = Math.abs(dx) < 60;
    const sideShift = isVerticalColumn ? Math.sign(dx || 1) * 70 : 0;
    const curvature = Math.min(Math.max(dist * 0.22, 35), 110);

    const cp1x = start.x + dx * 0.28 + nx * curvature * 0.3 + sideShift;
    const cp1y = start.y + dy * 0.28 + ny * curvature * 0.3;
    const cp2x = start.x + dx * 0.72 + nx * curvature * 0.3 + sideShift;
    const cp2y = start.y + dy * 0.72 + ny * curvature * 0.3;

    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/**
 * Рассчитывает полный подграф бандла: включает все узлы из списка и ВСЕ рёбра
 * между ними (включая перекрёстные связи между зависимостями).
 *
 * @param {Array<import('./data.js').CodeFileNode>} allFiles - Реестр файлов проекта.
 * @param {Set<string>|string[]} bundleFileIds - Множество ID файлов, входящих в бандл.
 * @returns {{ visibleNodes: Set<string>, visibleEdges: Array<{from: string, to: string, type: string}> }}
 */
export function computeBundleSubgraph(allFiles, bundleFileIds) {
    const visibleNodes = new Set(bundleFileIds);
    const visibleEdges = [];
    const fileMap = new Map(allFiles.map(f => [f.id, f]));

    visibleNodes.forEach(nodeId => {
        const file = fileMap.get(nodeId);
        if (!file) return;

        (file.dependencies || []).forEach(dep => {
            if (visibleNodes.has(dep.target)) {
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

/**
 * Раскладка карточек по директориям без взаимных перекрытий (Non-overlapping Grid).
 *
 * @param {Array<import('./data.js').CodeFileNode>} files - Все файлы.
 * @param {Set<string>} visibleNodeIds - Идентификаторы видимых узлов.
 * @returns {{ clusters: Array<Object>, nodePositions: Map<string, {x: number, y: number, width: number, height: number}> }}
 */
export function computeGraphLayout(files, visibleNodeIds) {
    const activeFiles = files.filter(f => visibleNodeIds.has(f.id));
    const foldersMap = new Map();

    activeFiles.forEach(file => {
        const folder = file.folder || 'root';
        if (!foldersMap.has(folder)) foldersMap.set(folder, []);
        foldersMap.get(folder).push(file);
    });

    const nodePositions = new Map();
    const clusters = [];
    const GAP_X = 28;
    const GAP_Y = 24;
    const PADDING_BOX = 20;
    const TOP_HEADER_OFFSET = 38;
    const CLUSTER_MARGIN = 75;

    const clusterBoxes = [];
    foldersMap.forEach((folderFiles, folderName) => {
        let cols = 1;
        if (folderFiles.length >= 8) cols = 3;
        else if (folderFiles.length >= 3) cols = 2;

        const rows = Math.ceil(folderFiles.length / cols);
        const width = (cols * CARD_W) + ((cols - 1) * GAP_X) + (PADDING_BOX * 2);
        const height = (rows * CARD_H) + ((rows - 1) * GAP_Y) + (PADDING_BOX * 2) + TOP_HEADER_OFFSET;

        clusterBoxes.push({ folderName, folderFiles, cols, width, height });
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

        box.folderFiles.forEach((file, index) => {
            const c = index % box.cols;
            const r = Math.floor(index / box.cols);

            const nx = box.x + PADDING_BOX + (c * (CARD_W + GAP_X));
            const ny = box.y + PADDING_BOX + TOP_HEADER_OFFSET + (r * (CARD_H + GAP_Y));

            nodePositions.set(file.id, { x: nx, y: ny, width: CARD_W, height: CARD_H });
        });

        clusters.push({
            folder: box.folderName,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            fileIds: box.folderFiles.map(f => f.id)
        });
    });

    return { clusters, nodePositions };
}