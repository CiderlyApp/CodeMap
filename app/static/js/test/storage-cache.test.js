/**
 * @fileoverview Автоматизированные тесты модуля долговременного кэширования storage-cache.js.
 * 
 * Документация как код:
 * - Проверяет сохранение, извлечение, удаление проектов и метаданных.
 * - Проверяет целостность данных графа после циклов сохранения/восстановления.
 *
 * @module tests/storageCache
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    saveProjectToCache,
    loadAllCachedProjects,
    removeProjectFromCache,
    saveActiveProjectName,
    loadActiveProjectName,
    saveSettingsToCache,
    loadSettingsFromCache
} from '../storage-cache.js';

test('Кэш проектов: сохранение и восстановление добавленного проекта', async () => {
    const mockFiles = [
        { id: 'mobile/lib/main.dart', name: 'main.dart', lines: 120, dependencies: [] },
        { id: 'mobile/lib/app.dart', name: 'app.dart', lines: 340, dependencies: [{ target: 'mobile/lib/main.dart' }] }
    ];

    await saveProjectToCache('my-mobile-app', mockFiles);

    const cachedProjects = await loadAllCachedProjects();
    assert.ok(cachedProjects.has('my-mobile-app'), 'Проект должен присутствовать в кэше');
    
    const restored = cachedProjects.get('my-mobile-app');
    assert.equal(restored.length, 2, 'Все файлы должны быть восстановлены');
    assert.equal(restored[0].id, 'mobile/lib/main.dart');
    assert.equal(restored[1].lines, 340);
});

test('Кэш проектов: удаление проекта очищает хранилище', async () => {
    await saveProjectToCache('temp-to-delete', [{ id: 'temp.py', name: 'temp.py', lines: 5 }]);
    
    let cached = await loadAllCachedProjects();
    assert.ok(cached.has('temp-to-delete'));

    await removeProjectFromCache('temp-to-delete');

    cached = await loadAllCachedProjects();
    assert.ok(!cached.has('temp-to-delete'), 'Проект должен быть удален из кэша');
});

test('Кэш метаданных: сохранение активного проекта и настроек', async () => {
    await saveActiveProjectName('my-mobile-app');
    const active = await loadActiveProjectName();
    assert.equal(active, 'my-mobile-app', 'Активный проект должен соответствовать сохраненному');

    const testSettings = {
        thresholds: { large: 450, critical: 850 },
        depth: 3
    };
    await saveSettingsToCache(testSettings);

    const loadedSettings = await loadSettingsFromCache();
    assert.ok(loadedSettings, 'Настройки должны быть извлечены');
    assert.equal(loadedSettings.thresholds.large, 450);
    assert.equal(loadedSettings.depth, 3);
});