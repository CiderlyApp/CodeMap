/**
 * @fileoverview Автоматизированные тесты дедупликации файлов и очистки разметки бандла контекста.
 *
 * @module tests/contextDedup
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { state } from '../state.js';
import {
    getDeduplicatedContextFileIds,
    buildFormattedAIContext,
    toggleCustomContextFile,
    clearCustomContext
} from '../inspector-controller.js';

test('getDeduplicatedContextFileIds: строгая дедупликация зависимостей и кастомных файлов', () => {
    // Создаем проект со взаимными связями
    state.projectFiles = [
        {
            id: 'lib/models/enums.dart',
            name: 'enums.dart',
            lines: 30,
            dependencies: [
                { target: 'lib/models/user.dart', type: 'import' }
            ]
        },
        {
            id: 'lib/models/user.dart',
            name: 'user.dart',
            lines: 100,
            dependencies: [
                { target: 'lib/models/enums.dart', type: 'import' }
            ]
        },
        {
            id: 'lib/services/api.dart',
            name: 'api.dart',
            lines: 150,
            dependencies: [
                { target: 'lib/models/enums.dart', type: 'import' }
            ]
        }
    ];

    state.excludedContextFiles.clear();
    state.customContextFiles.clear();

    // Добавляем файл user.dart вручную, хотя он уже есть в зависимостях
    toggleCustomContextFile('lib/models/user.dart');
    // Добавляем файл enums.dart вручную (он же root)
    toggleCustomContextFile('lib/models/enums.dart');

    const resultIds = getDeduplicatedContextFileIds('lib/models/enums.dart', false);

    // Должны присутствовать: enums.dart (root), user.dart (прямой импорт и кастом), api.dart (обратная ссылка)
    assert.equal(resultIds.length, 3, 'Каждый файл должен быть включен ровно один раз без дубликатов');
    assert.equal(resultIds[0], 'lib/models/enums.dart', 'Главный файл должен идти первым');
    assert.ok(resultIds.includes('lib/models/user.dart'));
    assert.ok(resultIds.includes('lib/services/api.dart'));
});

test('buildFormattedAIContext: чистый формат без "## path" и XML-тегов <file>', async () => {
    state.projectFiles = [
        {
            id: 'lib/models/enums.dart',
            name: 'enums.dart',
            content: 'enum Status { active, disabled }',
            lines: 1,
            dependencies: []
        }
    ];
    state.excludedContextFiles.clear();
    state.customContextFiles.clear();

    const output = await buildFormattedAIContext('lib/models/enums.dart', true);

    // Проверяем наличие ожидаемого разделителя
    assert.ok(output.includes('// ========================================================'), 'Должен содержать разделитель // ===');
    assert.ok(output.includes('// FILE: lib/models/enums.dart'), 'Должен содержать строку // FILE:');
    assert.ok(output.includes('enum Status { active, disabled }'), 'Должен содержать тело файла');

    // Проверяем отсутствие удаленных мусорных строк
    assert.ok(!output.includes('## lib/models/enums.dart'), 'Не должен содержать ## path');
    assert.ok(!output.includes('<file path='), 'Не должен содержать открывающий тег <file>');
    assert.ok(!output.includes('</file>'), 'Не должен содержать закрывающий тег </file>');
});

test('toggleCustomContextFile и clearCustomContext: корректное управление состоянием', () => {
    clearCustomContext();
    assert.equal(state.customContextFiles.size, 0);

    toggleCustomContextFile('src/a.py');
    assert.ok(state.customContextFiles.has('src/a.py'), 'Файл должен добавиться');

    toggleCustomContextFile('src/a.py');
    assert.ok(!state.customContextFiles.has('src/a.py'), 'Повторный вызов должен удалить файл');

    toggleCustomContextFile('src/b.py');
    toggleCustomContextFile('src/c.py');
    assert.equal(state.customContextFiles.size, 2);

    clearCustomContext();
    assert.equal(state.customContextFiles.size, 0, 'Очистка должна удалить все кастомные файлы');
});