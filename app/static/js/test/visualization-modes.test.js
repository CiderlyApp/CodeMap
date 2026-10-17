/**
 * @fileoverview Автоматизированные тесты для расширенных визуализаций CodeMap:
 * - Архитектурные метрики (In/Out-degree, SCC Tarjan, плотность)
 * - Геометрический обход карточек при маршрутизации рёбер
 * - Слоевой граф без дублирования узлов
 * - Файловая и модульная матрица зависимостей (DSM)
 * - Строгая дедупликация Bundle
 *
 * @module tests/visualizationModes
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    findStronglyConnectedComponents,
    computeGraphMetrics,
    segmentIntersectsRect,
    routeEdgeAvoidCards,
    computeLayeredGraphLayout,
    computeGraphLayout
} from '../graph-engine.js';
import { getDeduplicatedBundleFileIds } from '../inspector-controller.js';
import { state } from '../state.js';

test('Tarjan SCC: обнаружение взаимных циклических зависимостей', () => {
    const testFiles = [
        { id: 'a.py', folder: 'pkg', dependencies: [{ target: 'b.py' }] },
        { id: 'b.py', folder: 'pkg', dependencies: [{ target: 'c.py' }] },
        { id: 'c.py', folder: 'pkg', dependencies: [{ target: 'a.py' }] }, // Цикл: a -> b -> c -> a
        { id: 'orphan.py', folder: 'pkg', dependencies: [] }
    ];

    const sccs = findStronglyConnectedComponents(testFiles);
    const cycles = sccs.filter(c => c.length > 1);

    assert.equal(cycles.length, 1, 'Должен быть обнаружен ровно 1 цикл');
    assert.equal(cycles[0].length, 3, 'Цикл должен содержать 3 файла');
    assert.ok(cycles[0].includes('a.py'));
    assert.ok(cycles[0].includes('b.py'));
    assert.ok(cycles[0].includes('c.py'));
});

test('Метрики графа: корректный расчет In-degree, Out-degree и плотности', () => {
    const testFiles = [
        { id: 'core/db.py', folder: 'core', dependencies: [] },
        { id: 'services/user.py', folder: 'services', dependencies: [{ target: 'core/db.py' }] },
        { id: 'api/routes.py', folder: 'api', dependencies: [{ target: 'services/user.py' }, { target: 'core/db.py' }] },
        { id: 'orphan.py', folder: 'utils', dependencies: [] }
    ];

    const metrics = computeGraphMetrics(testFiles);

    assert.equal(metrics.inDegreeMap.get('core/db.py'), 2, 'core/db.py должен иметь In-degree = 2');
    assert.equal(metrics.outDegreeMap.get('api/routes.py'), 2, 'api/routes.py должен иметь Out-degree = 2');
    assert.equal(metrics.isolatedFiles.length, 1, 'orphan.py должен быть изолированным');
    assert.equal(metrics.isolatedFiles[0], 'orphan.py');
    assert.equal(metrics.crossModuleEdgesCount, 3, 'Все 3 связи являются межмодульными');
    assert.ok(metrics.density > 0 && metrics.density < 1, 'Плотность должна быть в диапазоне (0, 1)');
});

test('Маршрутизация: проверка пересечения отрезка с прямоугольником карточки', () => {
    const cardRect = { x: 100, y: 100, width: 180, height: 68 };

    // Отрезок проходит насквозь через центр карточки
    const directHit = segmentIntersectsRect({ x: 50, y: 130 }, { x: 320, y: 130 }, cardRect, 0);
    assert.equal(directHit, true, 'Должно быть зафиксировано пересечение');

    // Отрезок проходит выше карточки с запасом
    const safeMiss = segmentIntersectsRect({ x: 50, y: 50 }, { x: 320, y: 50 }, cardRect, 10);
    assert.equal(safeMiss, false, 'Не должно быть пересечения');
});

test('Маршрутизация: обход препятствий карточек через путевые каналы', () => {
    const srcRect = { x: 50, y: 100, width: 180, height: 68 };
    const obstacleRect = { x: 280, y: 100, width: 180, height: 68 }; // Препятствие на прямой линии
    const tgtRect = { x: 520, y: 100, width: 180, height: 68 };

    const pathData = routeEdgeAvoidCards(srcRect, tgtRect, [srcRect, obstacleRect, tgtRect], 0);

    // Убеждаемся, что сгенерирован обходной путь (Q/T сплайн) вместо прямой линии
    assert.ok(pathData.includes('Q') || pathData.includes('C'), 'Должен быть построен обходной сплайн');
    assert.ok(pathData.startsWith('M '), 'SVG Path должен начинаться с команды Move');
});

test('Слоевой граф: отсутствие дублирования узлов при ромбовидных путях и циклах', () => {
    const files = [
        { id: 'root.py', folder: 'src', dependencies: [{ target: 'a.py' }, { target: 'b.py' }] },
        { id: 'a.py', folder: 'src', dependencies: [{ target: 'shared.py' }] },
        { id: 'b.py', folder: 'src', dependencies: [{ target: 'shared.py' }] },
        { id: 'shared.py', folder: 'src', dependencies: [{ target: 'root.py' }] } // Обратный цикл на корень
    ];

    const result = computeLayeredGraphLayout('root.py', files, 3);

    // Каждый физический файл должен присутствовать строго 1 раз
    const nodeIdsArray = Array.from(result.nodePositions.keys());
    const uniqueNodeIds = new Set(nodeIdsArray);

    assert.equal(nodeIdsArray.length, uniqueNodeIds.size, 'В слоевом графе не должно быть дубликатов узлов');
    assert.equal(uniqueNodeIds.size, 4, 'Все 4 файла должны быть уникально представлены');
});

test('Карта проекта: свернутая папка не меняет исходную модель зависимостей', () => {
    const files = [
        { id: 'pkg/a.py', folder: 'pkg', dependencies: [{ target: 'core/b.py' }] },
        { id: 'pkg/c.py', folder: 'pkg', dependencies: [] },
        { id: 'core/b.py', folder: 'core', dependencies: [] }
    ];

    const collapsed = new Set(['pkg']);
    const { clusters, nodePositions } = computeGraphLayout(files, new Set(files.map(f => f.id)), collapsed);

    const pkgCluster = clusters.find(c => c.folder === 'pkg');
    assert.ok(pkgCluster.isCollapsed, 'Кластер pkg должен иметь флаг isCollapsed: true');

    // Позиции файлов из свернутой папки перенаправляются на компактный контейнер папки
    const posA = nodePositions.get('pkg/a.py');
    assert.ok(posA.isCollapsedFolder, 'Файл должен быть помечен внутри свернутой папки');
});

test('Bundle дедупликация: транзитивное замыкание не содержит повторяющихся файлов', () => {
    state.projectFiles = [
        { id: 'a.py', name: 'a.py', lines: 50, dependencies: [{ target: 'b.py' }, { target: 'c.py' }] },
        { id: 'b.py', name: 'b.py', lines: 60, dependencies: [{ target: 'd.py' }] },
        { id: 'c.py', name: 'c.py', lines: 70, dependencies: [{ target: 'd.py' }] },
        { id: 'd.py', name: 'd.py', lines: 80, dependencies: [] }
    ];
    state.customContextFiles.clear();
    state.excludedContextFiles.clear();

    const bundleIds = getDeduplicatedBundleFileIds('a.py', false);

    assert.equal(bundleIds.length, 4, 'Бандл должен содержать ровно 4 уникальных файла');
    assert.equal(bundleIds[0], 'a.py', 'Корневой файл должен быть первым в очереди');
    assert.equal(new Set(bundleIds).size, 4, 'В бандле не должно быть дубликатов');
});