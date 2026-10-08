/**
 * @fileoverview Автоматизированные тесты контроллеров:
 * фильтрация игнорируемых ресурсов, переключение фокуса файлов и поиск.
 *
 * @module tests/controllers
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { state } from '../state.js';
import { applyIgnoreFilterToCurrentProject } from '../settings-controller.js';
import { selectFile } from '../tree-controller.js';

test('settingsController: applyIgnoreFilterToCurrentProject отсекает файлы по каталогам и маскам', () => {
    // Подготовка тестового набора файлов
    state.projectFiles = [
        { id: 'src/main.py', name: 'main.py', folder: 'src', lines: 100 },
        { id: 'src/user.g.dart', name: 'user.g.dart', folder: 'src', lines: 50 },
        { id: 'dist/bundle.js', name: 'bundle.js', folder: 'dist', lines: 400 },
        { id: 'tests/test_api.py', name: 'test_api.py', folder: 'tests', lines: 80 }
    ];

    state.ignoreSettings = {
        excludeDirs: ['dist'],
        excludeFiles: ['*.g.dart']
    };

    applyIgnoreFilterToCurrentProject();

    const remainingIds = state.projectFiles.map(f => f.id);

    assert.ok(remainingIds.includes('src/main.py'), 'Обычный файл должен сохраниться');
    assert.ok(remainingIds.includes('tests/test_api.py'), 'Тест не под маской должен сохраниться');
    assert.ok(!remainingIds.includes('src/user.g.dart'), 'Файл с маской *.g.dart должен быть исключен');
    assert.ok(!remainingIds.includes('dist/bundle.js'), 'Файл из папки dist должен быть исключен');
});

test('treeController: selectFile корректно переводит состояние в режим фокуса', () => {
    state.projectFiles = [
        { id: 'src/app.py', name: 'app.py', folder: 'src', lines: 200, dependencies: [] }
    ];

    selectFile('src/app.py', false);

    assert.equal(state.selectedFileId, 'src/app.py', 'selectedFileId должен быть обновлен');
    assert.equal(state.isOverviewMode, false, 'isOverviewMode должен быть выключен');
    assert.ok(state.focusFiles.has('src/app.py'), 'focusFiles должен содержать выбранный файл');
    assert.equal(state.excludedContextFiles.size, 0, 'Исключенные файлы контекста должны быть сброшены');
});