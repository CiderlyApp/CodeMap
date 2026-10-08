/**
 * @fileoverview Автоматизированные тесты для проверки функции сопоставления масок файлов
 * и работы правил игнорирования каталогов.
 *
 * @module tests/ignoreSettings
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { matchFileMask, isFileIgnored } from '../project-scanner.js';
import { saveSettingsToCache, loadSettingsFromCache } from '../storage-cache.js';

test('matchFileMask: корректное сопоставление по wildcard-маскам (* и ?)', () => {
    // Проверка расширений через *
    assert.ok(matchFileMask('user_model.g.dart', '*.g.dart'), 'Должен распознать *.g.dart');
    assert.ok(matchFileMask('bundle.min.js', '*.min.js'), 'Должен распознать *.min.js');
    assert.ok(matchFileMask('app.test.tsx', '*.test.*'), 'Должен распознать *.test.*');
    assert.ok(!matchFileMask('app.component.tsx', '*.test.*'), 'Не должен матчить обычный файл');

    // Проверка одного символа через ?
    assert.ok(matchFileMask('file1.py', 'file?.py'), 'Должен матчить одиночный символ ?');
    assert.ok(!matchFileMask('file12.py', 'file?.py'), 'Не должен матчить два символа вместо ?');

    // Проверка вхождения подстроки без спецсимволов
    assert.ok(matchFileMask('freezed.dart', 'freezed.dart'), 'Точное совпадение');
    assert.ok(matchFileMask('my_freezed.dart', 'freezed.dart'), 'Совпадение подстроки');
    assert.ok(!matchFileMask('main.dart', 'freezed.dart'), 'Не совпадает');
});

test('isFileIgnored: пакетная проверка массива масок', () => {
    const masks = ['*.g.dart', 'freezed.dart', '*.lock', 'temp_*'];

    assert.ok(isFileIgnored('state.g.dart', masks));
    assert.ok(isFileIgnored('yarn.lock', masks));
    assert.ok(isFileIgnored('temp_cache.json', masks));
    assert.ok(!isFileIgnored('normal_service.dart', masks));
});

test('Кэш настроек: сохранение и загрузка ignoreSettings в хранилище', async () => {
    const customSettings = {
        thresholds: { large: 600, critical: 1200 },
        ignoreSettings: {
            excludeDirs: ['dist', 'coverage', '.cache'],
            excludeFiles: ['*.tmp', '*.generated.py']
        }
    };

    await saveSettingsToCache(customSettings);
    const loaded = await loadSettingsFromCache();

    assert.ok(loaded, 'Настройки должны успешно загрузиться');
    assert.deepEqual(loaded.ignoreSettings.excludeDirs, ['dist', 'coverage', '.cache']);
    assert.deepEqual(loaded.ignoreSettings.excludeFiles, ['*.tmp', '*.generated.py']);
    assert.equal(loaded.thresholds.large, 600);
});