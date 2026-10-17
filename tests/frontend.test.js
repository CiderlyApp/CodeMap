/**
 * @fileoverview Автоматизированные тесты для UI, сервиса экспорта и констант фронтенда.
 * Тестируется в окружении Vitest / JSDOM.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGlobalTypeColor, GLOBAL_TYPE_COLORS } from '../app/static/js/constants.js';
import { appState } from '../app/static/js/state.js';
import { 
    addToBasket, 
    removeFromBasket, 
    clearBasket, 
    basketFilesSet,
    getDeduplicatedBasketFiles,
    collectCheckedDependencies
} from '../app/static/js/exportService.js';
import { UI } from '../app/static/js/ui.js';

describe('Константы архитектурных слоев (constants.js)', () => {
    it('должен возвращать цвет слоя по вхождению ключевого слова', () => {
        expect(getGlobalTypeColor('app/controllers/user')).toBe(GLOBAL_TYPE_COLORS['controllers']);
        expect(getGlobalTypeColor('features/auth/screens/Login')).toBe(GLOBAL_TYPE_COLORS['screens']);
        expect(getGlobalTypeColor('unknown/package/path')).toBe(GLOBAL_TYPE_COLORS['fallback']);
    });
});

describe('Сервис корзины экспорта (exportService.js)', () => {
    beforeEach(() => {
        clearBasket();
        appState.allNodes = [
            { id: 'src/a.ts', label: 'a.ts' },
            { id: 'src/b.ts', label: 'b.ts' },
            { id: 'src/c.ts', label: 'c.ts' }
        ];
        appState.allEdges = [
            { from: 'src/a.ts', to: 'src/b.ts' }
        ];
        document.body.innerHTML = `
            <div id="basket-list"></div>
            <span id="basket-count">0</span>
            <div id="basket-actions"></div>
            <button id="btn-clear-basket"></button>
            <div id="list-imports"></div>
            <div id="list-dependents"></div>
        `;
    });

    it('должен добавлять существующие файлы и отклонять несуществующие', () => {
        window.alert = vi.fn();
        addToBasket('src/a.ts');
        expect(basketFilesSet.has('src/a.ts')).toBe(true);

        addToBasket('src/not-exist.ts');
        expect(basketFilesSet.has('src/not-exist.ts')).toBe(false);
        expect(window.alert).toHaveBeenCalled();
    });

    it('должен дедуплицировать связи корзины при сборе бандла', () => {
        addToBasket('src/a.ts');
        const files = getDeduplicatedBasketFiles();
        // Включает сам src/a.ts + связанный src/b.ts
        expect(files).toContain('src/a.ts');
        expect(files).toContain('src/b.ts');
        expect(files.length).toBe(2);
    });

    it('должен собирать пути только отмеченных чекбоксами файлов', () => {
        document.getElementById('list-imports').innerHTML = `
            <li class="dep-list-item">
                <input type="checkbox" class="dep-checkbox" checked />
                <span class="dep-text">src/checked.ts</span>
            </li>
            <li class="dep-list-item">
                <input type="checkbox" class="dep-checkbox" />
                <span class="dep-text">src/unchecked.ts</span>
            </li>
        `;

        const result = collectCheckedDependencies('root.ts');
        expect(result).toContain('root.ts');
        expect(result).toContain('src/checked.ts');
        expect(result).not.toContain('src/unchecked.ts');
    });
});

describe('UI модули (ui.js)', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="info-box"></div>
            <button id="btn-save-single" disabled></button>
            <button id="btn-save-all" disabled></button>
            <button id="btn-add-to-basket" disabled></button>
            <button id="btn-copy-ai" style="display:none;" disabled></button>
            <input id="search-input" />
            <div id="dependency-details" style="display:none;"></div>
            <button id="theme-toggle-btn"></button>
        `;
    });

    it('должен активировать контролы при выборе файла', () => {
        UI.updateSelectedInfo('project/main.py');
        expect(document.getElementById('btn-save-single').disabled).toBe(false);
        expect(document.getElementById('btn-copy-ai').style.display).toBe('block');
        expect(document.getElementById('info-box').innerHTML).toContain('project/main.py');
    });

    it('должен деактивировать контролы при сбросе выбора', () => {
        UI.updateSelectedInfo(null);
        expect(document.getElementById('btn-save-single').disabled).toBe(true);
        expect(document.getElementById('btn-copy-ai').style.display).toBe('none');
    });
});