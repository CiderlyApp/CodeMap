/**
 * @fileoverview Автоматизированные тесты для модулей сканера:
 * сопоставление масок, парсинг импортов, нормализация путей и построение графа.
 *
 * @module tests/scannerModular
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { matchFileMask, isFileIgnored } from '../scanner/scanner-filter.js';
import { parseImportsFromCode } from '../scanner/import-parser.js';
import { resolveDependencyPath } from '../scanner/path-resolver.js';
import { buildGraphFromScannedFiles } from '../scanner/graph-builder.js';

test('scanner-filter: matchFileMask корректно проверяет glob-шаблоны и подстроки', () => {
    assert.ok(matchFileMask('schema.g.dart', '*.g.dart'));
    assert.ok(matchFileMask('app.test.tsx', '*.test.*'));
    assert.ok(matchFileMask('bundle.min.js', '*.min.js'));
    assert.ok(matchFileMask('config.local.json', '*.local.?son'));
    assert.ok(!matchFileMask('component.tsx', '*.test.*'));
    assert.ok(matchFileMask('freezed.dart', 'freezed.dart'));
});

test('scanner-filter: isFileIgnored отфильтровывает файлы по списку масок', () => {
    const masks = ['*.lock', 'yarn.lock', '*.g.dart'];
    assert.ok(isFileIgnored('package-lock.json', masks) === false);
    assert.ok(isFileIgnored('yarn.lock', masks));
    assert.ok(isFileIgnored('model.g.dart', masks));
});

test('import-parser: извлечение зависимостей для Python, JS/TS и Dart', () => {
    // Python
    const pyCode = `
from .models import User
import core.config as cfg
from ..services.user import get_user
    `;
    const pyImports = parseImportsFromCode(pyCode, '.py');
    assert.equal(pyImports.length, 3);
    assert.ok(pyImports.some(i => i.targetModule === '.models' && i.type === 'from_import'));
    assert.ok(pyImports.some(i => i.targetModule === 'core.config' && i.type === 'import'));

    // JS/TS
    const tsCode = `
import React, { useState } from 'react';
export * from './button';
const db = require('./db');
    `;
    const tsImports = parseImportsFromCode(tsCode, '.ts');
    assert.equal(tsImports.length, 3);
    assert.ok(tsImports.some(i => i.targetModule === './button' && i.type === 're_export'));
    assert.ok(tsImports.some(i => i.targetModule === './db' && i.type === 'dynamic'));

    // Dart
    const dartCode = `
import 'package:flutter/material.dart';
export 'src/auth.dart';
part 'model.g.dart';
    `;
    const dartImports = parseImportsFromCode(dartCode, '.dart');
    assert.equal(dartImports.length, 3);
    assert.ok(dartImports.some(i => i.targetModule === 'src/auth.dart' && i.type === 're_export'));
});

test('path-resolver: разрешение относительных путей Python и корневых файлов', () => {
    const allPaths = [
        'main.py',
        'api/routes.py',
        'api/schemas.py',
        'services/cider.py'
    ];

    // Python относительный импорт .schemas из api/routes.py
    const relPy = resolveDependencyPath('api/routes.py', '.schemas', allPaths);
    assert.equal(relPy, 'api/schemas.py', 'Должен нормализовать .schemas в api/schemas.py');

    // Python относительный импорт ..services.cider из api/routes.py
    const parentPy = resolveDependencyPath('api/routes.py', '..services.cider', allPaths);
    assert.equal(parentPy, 'services/cider.py', 'Должен подняться до services/cider.py');

    // Файл лежит прямо в корне (без папки)
    const rootRel = resolveDependencyPath('main.py', './api/routes', allPaths);
    assert.equal(rootRel, 'api/routes.py');
});

test('path-resolver: поддержка алиасов @/ и ~/', () => {
    const allPaths = [
        'src/components/Button.tsx',
        'src/utils/format.ts'
    ];

    const resolvedAlias = resolveDependencyPath('src/pages/index.tsx', '@/components/Button', allPaths);
    assert.equal(resolvedAlias, 'src/components/Button.tsx');
});

test('graph-builder: построение графа без самоссылок и дубликатов', () => {
    const rawFiles = [
        {
            id: 'src/app.py',
            name: 'app.py',
            path: 'src/app.py',
            content: 'import src.helper\nimport src.helper',
            lines: 2,
            ext: '.py'
        },
        {
            id: 'src/helper.py',
            name: 'helper.py',
            path: 'src/helper.py',
            content: '# empty',
            lines: 1,
            ext: '.py'
        }
    ];

    const graph = buildGraphFromScannedFiles(rawFiles);
    assert.equal(graph.length, 2);

    const appNode = graph.find(n => n.id === 'src/app.py');
    assert.ok(appNode);
    // Дублирующийся импорт helper.py должен быть дедуплицирован
    assert.equal(appNode.dependencies.length, 1);
    assert.equal(appNode.dependencies[0].target, 'src/helper.py');
});