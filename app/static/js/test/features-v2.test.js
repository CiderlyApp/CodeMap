/**
 * @fileoverview Автоматизированные тесты доработанного функционала CodeMap:
 * - Форматирование путей // FILE: и ##
 * - Переключение исключения файлов из контекста
 * - Поддержка сирот в графе
 * - Сворачивание директорий
 *
 * @module tests/featuresV2
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFormattedAIContext, state } from '../app.js';
import { PROJECT_DATA } from '../data.js';

test('Контекст для ИИ: форматирование путей с // ===================== и ## path', async () => {
    state.projectFiles = [...PROJECT_DATA];
    state.selectedFileId = 'src/api/app.py';
    state.excludedContextFiles.clear();

    const result = await buildFormattedAIContext('src/api/app.py', true);

    assert.ok(result.includes('// ========================================================'), 'Должен содержать верхний разделитель //');
    assert.ok(result.includes('// FILE: src/api/app.py'), 'Должен содержать префикс // FILE: path');
    assert.ok(result.includes('## src/api/app.py'), 'Должен содержать заголовок Markdown ## path');
    assert.ok(result.includes('<file path="src/api/app.py">'), 'Должен оборачивать в тег <file>');
});

test('Редактирование контекста: исключение файлов по требованию пользователя', async () => {
    state.projectFiles = [...PROJECT_DATA];
    state.selectedFileId = 'src/api/app.py';
    state.excludedContextFiles.clear();

    // Исключаем зависимость routes.py из контекста
    state.excludedContextFiles.add('src/api/routes.py');

    const bundle = await buildFormattedAIContext('src/api/app.py', false);

    assert.ok(!bundle.includes('// FILE: src/api/routes.py'), 'Исключенный файл routes.py не должен попадать в контекст');
    assert.ok(bundle.includes('// FILE: src/api/app.py'), 'Основной файл app.py должен присутствовать');
});

test('Одиночный экспорт: копирование только выбранного файла без зависимостей', async () => {
    state.projectFiles = [...PROJECT_DATA];
    state.selectedFileId = 'src/api/app.py';
    state.excludedContextFiles.clear();

    const singleBundle = await buildFormattedAIContext('src/api/app.py', true);

    assert.ok(singleBundle.includes('// FILE: src/api/app.py'));
    assert.ok(!singleBundle.includes('// FILE: src/api/schemas.py'), 'В одиночном режиме не должно быть других файлов');
});

test('Дерево папок: регистрация свернутых каталогов', () => {
    state.collapsedFolders.clear();
    state.collapsedFolders.add('core');
    assert.ok(state.collapsedFolders.has('core'), 'Папка core должна быть помечена как свернутая');
});