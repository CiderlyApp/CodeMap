/**
 * @fileoverview Сервис экспорта файлов проекта, управления корзиной и копирования контекста для ИИ.
 * @module exportService
 */

import { appState } from './state.js';

/**
 * Множество путей файлов, добавленных в корзину экспорта.
 * @type {Set<string>}
 */
export const basketFilesSet = new Set();

/**
 * Добавляет указанный файл в корзину экспорта.
 *
 * @param {string} filePath - Относительный путь к файлу в проекте.
 * @returns {void}
 */
export function addToBasket(filePath) {
    if (!filePath) return;

    const exists = appState.allNodes.some(n => n.id === filePath);
    if (!exists) {
        alert(`Файл "${filePath}" не найден в сканируемом проекте!`);
        return;
    }

    basketFilesSet.add(filePath);
    if (window.UI) {
        window.UI.renderBasket(basketFilesSet, removeFromBasket);
    }
}

/**
 * Удаляет указанный файл из корзины экспорта.
 *
 * @param {string} filePath - Относительный путь к файлу.
 * @returns {void}
 */
export function removeFromBasket(filePath) {
    basketFilesSet.delete(filePath);
    if (window.UI) {
        window.UI.renderBasket(basketFilesSet, removeFromBasket);
    }
}

/**
 * Полностью очищает список выбранных в корзину файлов.
 * @returns {void}
 */
export function clearBasket() {
    basketFilesSet.clear();
    if (window.UI) {
        window.UI.renderBasket(basketFilesSet, removeFromBasket);
    }
}

/**
 * Вычисляет транзитивное объединение файлов корзины и их смежных дуг первого порядка.
 *
 * @returns {string[]} Дедуплицированный перечень относительных путей файлов.
 */
export function getDeduplicatedBasketFiles() {
    const combined = new Set(basketFilesSet);

    basketFilesSet.forEach(fileId => {
        appState.allEdges.forEach(e => {
            if (e.from === fileId) combined.add(e.to);
            if (e.to === fileId) combined.add(e.from);
        });
    });

    return Array.from(combined);
}

/**
 * Асинхронно формирует AI-бандл корзины и копирует его в буфер обмена операционной системы.
 *
 * @async
 * @returns {Promise<void>}
 */
export async function exportBasketAI() {
    const files = getDeduplicatedBasketFiles();
    if (files.length === 0) return alert('Корзина пуста!');

    const btn = document.getElementById('btn-copy-basket-ai');
    if (!btn) return;

    btn.disabled = true;
    const oldText = btn.innerText;
    btn.innerText = '📡 Сборка дедуплицированного контекста...';

    try {
        const response = await fetch('/api/export_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files })
        });

        if (response.ok) {
            const data = await response.json();
            await navigator.clipboard.writeText(data.text);
            btn.innerText = '✅ Скопировано в буфер!';
            btn.style.backgroundColor = '#27ae60';
            setTimeout(() => {
                btn.innerText = oldText;
                btn.style.backgroundColor = '#8e44ad';
                btn.disabled = false;
            }, 2000);
        } else {
            alert('Не удалось сформировать бандл.');
            btn.innerText = oldText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Ошибка сборки корзины:', err);
        alert('Ошибка сборки бандла.');
        btn.innerText = oldText;
        btn.disabled = false;
    }
}

/**
 * Инициирует браузерную выгрузку содержимого корзины единым текстовым файлом.
 *
 * @async
 * @returns {Promise<void>}
 */
export async function exportBasketTxt() {
    const files = getDeduplicatedBasketFiles();
    if (files.length === 0) return alert('Корзина пуста!');

    try {
        const response = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, node: 'basket_bundle' })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `basket_export_${new Date().toISOString().slice(0, 10)}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } else {
            alert('Не удалось сформировать файл.');
        }
    } catch (err) {
        console.error('Ошибка экспорта корзины:', err);
        alert('Ошибка при скачивании.');
    }
}

/**
 * Считывает выбранные чекбоксами связи из панели сайдбара.
 *
 * @param {string} rootNodeId - ID основного файла.
 * @returns {string[]} Список путей файлов.
 */
export function collectCheckedDependencies(rootNodeId) {
    const files = [rootNodeId];
    const importItems = document.querySelectorAll('#list-imports .dep-list-item');
    const dependentItems = document.querySelectorAll('#list-dependents .dep-list-item');

    const processItem = (el) => {
        const cb = el.querySelector('.dep-checkbox');
        const textEl = el.querySelector('.dep-text');
        if (cb && cb.checked && textEl) {
            const path = textEl.innerText.trim();
            if (path && !files.includes(path)) {
                files.push(path);
            }
        }
    };

    importItems.forEach(processItem);
    dependentItems.forEach(processItem);

    return files;
}

/**
 * Копирует контекст одиночного узла и его отмеченных связей для AI.
 *
 * @async
 * @param {string} nodeId - Идентификатор узла.
 * @returns {Promise<void>}
 */
export async function copyToClipboardAI(nodeId) {
    const files = collectCheckedDependencies(nodeId);
    const btn = document.getElementById('btn-copy-ai');
    if (!btn) return;

    btn.disabled = true;
    const oldText = btn.innerText;
    btn.innerText = '📡 Сборка кода...';

    try {
        const response = await fetch('/api/export_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, node: nodeId })
        });

        if (response.ok) {
            const data = await response.json();
            await navigator.clipboard.writeText(data.text);

            btn.innerText = '✅ Скопировано в буфер!';
            btn.style.backgroundColor = '#27ae60';
            setTimeout(() => {
                btn.innerText = oldText;
                btn.style.backgroundColor = '#8e44ad';
                btn.disabled = false;
            }, 2000);
        } else {
            alert('Не удалось собрать контекст.');
            btn.innerText = oldText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error("Ошибка буфера обмена:", err);
        alert('Ошибка при копировании.');
        btn.innerText = oldText;
        btn.disabled = false;
    }
}

/**
 * Инициирует скачивание отдельного файла либо файла со связями в формате TXT.
 *
 * @async
 * @param {string} nodeId - Идентификатор узла.
 * @param {'single'|'all'} mode - Режим выборки (только файл или файл + зависимости).
 * @returns {Promise<void>}
 */
export async function downloadExport(nodeId, mode) {
    const files = mode === 'all' ? collectCheckedDependencies(nodeId) : [nodeId];

    try {
        const response = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, node: nodeId })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export_${nodeId.replace(/\//g, '_')}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } else {
            alert('Не удалось сформировать файл экспорта.');
        }
    } catch (err) {
        console.error("Ошибка при экспорте:", err);
        alert('Ошибка при скачивании файла.');
    }
}