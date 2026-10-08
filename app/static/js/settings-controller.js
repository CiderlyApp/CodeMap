/**
 * @fileoverview Контроллер модального окна настроек.
 * Управляет порогами размера файлов (LOC) и правилами игнорирования каталогов и масок файлов.
 *
 * @module settingsController
 */

import { state } from './state.js';
import { isFileIgnored } from './project-scanner.js';
import { saveSettingsToCache } from './storage-cache.js';
import { renderGraph } from './canvas-controller.js';
import { initTree, selectFile } from './tree-controller.js';
import { updateCandidates } from './project-controller.js';

/**
 * Исключает из активного списка файлов те, которые соответствуют новым правилам игнорирования.
 *
 * @returns {void}
 */
export function applyIgnoreFilterToCurrentProject() {
    const { excludeDirs, excludeFiles } = state.ignoreSettings;
    const dirsSet = new Set(excludeDirs);

    state.projectFiles = state.projectFiles.filter(file => {
        // Проверка по каталогу
        if (dirsSet.has(file.folder)) return false;
        // Проверка по маске файла
        if (isFileIgnored(file.name, excludeFiles)) return false;
        return true;
    });

    // Если текущий выделенный файл отфильтрован — сбрасываем выбор
    if (state.selectedFileId && !state.projectFiles.some(f => f.id === state.selectedFileId)) {
        state.selectedFileId = state.projectFiles[0]?.id || null;
    }
}

/**
 * Инициализирует диалоговое окно настроек приложения.
 *
 * @returns {void}
 */
export function initSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('btn-open-settings');
    const closeBtn = document.getElementById('btn-close-settings-modal');
    const cancelBtn = document.getElementById('btn-cancel-settings');
    const applyBtn = document.getElementById('btn-apply-settings');

    const largeInput = document.getElementById('thresh-large');
    const critInput = document.getElementById('thresh-critical');
    const dirsTextarea = document.getElementById('settings-exclude-dirs');
    const filesInput = document.getElementById('settings-exclude-files');

    if (!modal || !openBtn) return;

    /**
     * Заполняет поля формы актуальными данными из состояния.
     */
    const populateForm = () => {
        if (largeInput) largeInput.value = state.thresholds.large;
        if (critInput) critInput.value = state.thresholds.critical;
        if (dirsTextarea) dirsTextarea.value = (state.ignoreSettings?.excludeDirs || []).join(', ');
        if (filesInput) filesInput.value = (state.ignoreSettings?.excludeFiles || []).join(', ');
    };

    openBtn.onclick = () => {
        populateForm();
        modal.classList.add('active');
    };

    const close = () => modal.classList.remove('active');
    if (closeBtn) closeBtn.onclick = close;
    if (cancelBtn) cancelBtn.onclick = close;

    if (applyBtn) {
        applyBtn.onclick = async () => {
            // 1. Пороги LOC
            if (largeInput) state.thresholds.large = parseInt(largeInput.value, 10) || 500;
            if (critInput) state.thresholds.critical = parseInt(critInput.value, 10) || 1000;

            // 2. Игнорируемые папки и маски файлов
            if (dirsTextarea) {
                state.ignoreSettings.excludeDirs = dirsTextarea.value
                    .split(/[,\n]/)
                    .map(d => d.trim())
                    .filter(Boolean);
            }
            if (filesInput) {
                state.ignoreSettings.excludeFiles = filesInput.value
                    .split(/[,\n]/)
                    .map(f => f.trim())
                    .filter(Boolean);
            }

            // 3. Сохранение в IndexedDB
            await saveSettingsToCache({
                thresholds: state.thresholds,
                ignoreSettings: state.ignoreSettings
            });

            // 4. Синхронизация с бэкендом (если запущен)
            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        exclude_dirs: state.ignoreSettings.excludeDirs.join(', '),
                        exclude_files: state.ignoreSettings.excludeFiles.join(', ')
                    })
                });
            } catch {
                // Сервер недоступен — автономный режим
            }

            // 5. Применение фильтрации и обновление UI
            applyIgnoreFilterToCurrentProject();
            close();
            updateCandidates();
            initTree();
            renderGraph(selectFile);
        };
    }
}