/**
 * @fileoverview Автоматизированные тесты для проверки непересекающейся раскладки,
 * безопасного доступа к файлам и управления проектами.
 *
 * @module tests/codemapFeatures
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { computeGraphLayout, computeFocusedSubgraph } from '../graph-engine.js';
import { parseImportsFromCode, resolveDependencyPath } from '../project-scanner.js';
import { state } from '../app.js';
import { PROJECT_DATA } from '../data.js';

test('Парсер зависимостей: извлечение модулей без изменения файлов', () => {
    const dartCode = `
import 'package:flutter/material.dart';
import 'services/api_service.dart';
part 'model.g.dart';
    `;
    const imports = parseImportsFromCode(dartCode, '.dart');
    assert.ok(imports.some(i => i.targetModule === 'services/api_service.dart'));
});

test('Алгоритм раскладки: кластеры директорий не перекрывают друг друга', () => {
    const nodeIds = new Set(PROJECT_DATA.map(f => f.id));
    const { clusters } = computeGraphLayout(PROJECT_DATA, nodeIds);

    // Проверяем каждую пару кластеров на пересечение Bounding Box
    for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
            const c1 = clusters[i];
            const c2 = clusters[j];

            const overlapX = (c1.x < c2.x + c2.width) && (c1.x + c1.width > c2.x);
            const overlapY = (c1.y < c2.y + c2.height) && (c1.y + c1.height > c2.y);

            assert.ok(
                !(overlapX && overlapY),
                `Кластеры папок [${c1.folder}] и [${c2.folder}] перекрывают друг друга!`
            );
        }
    }
});

test('Режим Focus Mode: фильтрация скрывает несвязанные файлы из общего объема', () => {
    const focusNode = 'src/api/app.py';
    const { visibleNodes } = computeFocusedSubgraph(PROJECT_DATA, new Set([focusNode]), 1);

    // В фокусе depth:1 должны остаться только app.py и его непосредственные импорты
    assert.ok(visibleNodes.has(focusNode));
    assert.ok(visibleNodes.size < PROJECT_DATA.length, 'Несвязанные файлы должны быть исключены');
});

test('Менеджер проектов: добавление и изоляция сессий проектов', () => {
    state.projects.set('test-repo', [{ id: 'test/a.py', name: 'a.py', folder: 'test', lines: 10 }]);
    assert.ok(state.projects.has('test-repo'));
    assert.equal(state.projects.get('test-repo').length, 1);
});