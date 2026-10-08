/**
 * @fileoverview Тестирование исключения файлов из контекста и построения подграфа связей.
 */

import { describe, it, expect } from 'vitest';
import { computeGraphSubgraph } from '../graph-engine.js';
import { buildAIContextBundle, state } from '../app.js';

describe('Логика подграфа и изоляции связей', () => {
    const mockFiles = [
        { id: 'a.dart', name: 'a.dart', dependencies: [{ target: 'b.dart' }] },
        { id: 'b.dart', name: 'b.dart', dependencies: [] },
        { id: 'orphan.dart', name: 'orphan.dart', is_orphan: true, dependencies: [] }
    ];

    it('должен возвращать весь проект при selectedFileId === null', () => {
        const { visibleNodes } = computeGraphSubgraph(mockFiles, null, true);
        expect(visibleNodes.has('a.dart')).toBe(true);
        expect(visibleNodes.has('b.dart')).toBe(true);
        expect(visibleNodes.has('orphan.dart')).toBe(true);
    });

    it('должен возвращать только связи выбранного файла при selectedFileId !== null', () => {
        const { visibleNodes } = computeGraphSubgraph(mockFiles, 'a.dart', true);
        expect(visibleNodes.has('a.dart')).toBe(true);
        expect(visibleNodes.has('b.dart')).toBe(true);
        expect(visibleNodes.has('orphan.dart')).toBe(false);
    });

    it('должен фильтровать сирот, если showOrphans === false', () => {
        const { visibleNodes } = computeGraphSubgraph(mockFiles, null, false);
        expect(visibleNodes.has('orphan.dart')).toBe(false);
    });
});

describe('Форматирование контекста для ИИ', () => {
    it('должен исключать из выгрузки файлы, деактивированные кликом', async () => {
        state.projectFiles = [
            { id: 'main.py', name: 'main.py', content: 'import sub', dependencies: [{ target: 'sub.py' }] },
            { id: 'sub.py', name: 'sub.py', content: 'print(1)', dependencies: [] }
        ];
        state.selectedFileId = 'main.py';

        // Исключаем sub.py
        state.contextExcludedFiles = new Set(['sub.py']);

        const bundle = await buildAIContextBundle('main.py', false);
        expect(bundle).toContain('## File: main.py');
        expect(bundle).toContain('// Path: main.py');
        expect(bundle).not.toContain('## File: sub.py');
    });
});