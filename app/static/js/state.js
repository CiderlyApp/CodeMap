/**
 * @fileoverview Единый источник правды (Single Source of Truth) для CodeMap.
 * Содержит структуру глобального состояния и JSDoc-определения типов.
 *
 * @module state
 */

import { PROJECT_DATA as DEMO_DATA } from './data.js';

/**
 * @typedef {Object} ViewTransform
 * @property {number} x - Смещение холста по горизонтали в пикселях.
 * @property {number} y - Смещение холста по вертикали в пикселях.
 * @property {number} scale - Масштаб холста (от 0.2 до 2.5).
 */

/**
 * @typedef {Object} LOCThresholds
 * @property {number} large - Порог строк для предупреждения о рефакторинге.
 * @property {number} critical - Порог критического размера файла.
 */

/**
 * @typedef {Object} IgnoreSettings
 * @property {string[]} excludeDirs - Массив каталогов, игнорируемых анализатором.
 * @property {string[]} excludeFiles - Массив масок файлов, исключаемых из парсинга.
 */

/**
 * @typedef {'all' | 'no-orphans' | 'only-orphans'} OrphanFilterMode
 */

/**
 * @typedef {Object} AppState
 * @property {Map<string, Array<import('./data.js').CodeFileNode>>} projects - Словарь проектов [имя -> файлы].
 * @property {string} activeProjectName - Имя текущего активного проекта.
 * @property {Array<import('./data.js').CodeFileNode>} projectFiles - Файлы активного проекта.
 * @property {string|null} selectedFileId - Идентификатор выбранного файла.
 * @property {Set<string>} focusFiles - Множество файлов в текущем фокусе.
 * @property {boolean} isOverviewMode - Флаг режима полного обзора (весь проект).
 * @property {boolean} isDrawerOpen - Флаг раскрытия правой панели-инспектора.
 * @property {OrphanFilterMode} orphanFilter - Режим фильтрации несвязанных файлов.
 * @property {Set<string>} excludedContextFiles - Файлы, исключённые из бандла контекста ИИ.
 * @property {Set<string>} customContextFiles - Произвольные файлы, добавленные пользователем в контекст.
 * @property {Set<string>} collapsedFolders - Список свернутых директорий в дереве.
 * @property {LOCThresholds} thresholds - Пороговые значения строк кода.
 * @property {IgnoreSettings} ignoreSettings - Конфигурация игнорирования файлов и директорий.
 * @property {ViewTransform} viewTransform - Параметры трансформации холста.
 * @property {boolean} isDragging - Статус перетаскивания рабочей области.
 * @property {{x: number, y: number}} dragStart - Начальная точка захвата курсора.
 */

/**
 * Глобальный реактивный объект состояния приложения.
 * @type {AppState}
 */
export const state = {
    projects: new Map([['ciderly-demo', [...DEMO_DATA]]]),
    activeProjectName: 'ciderly-demo',
    projectFiles: [...DEMO_DATA],

    selectedFileId: DEMO_DATA[0]?.id || null,
    focusFiles: new Set(),
    isOverviewMode: true,
    isDrawerOpen: true,
    orphanFilter: 'all',
    excludedContextFiles: new Set(),
    customContextFiles: new Set(),
    collapsedFolders: new Set(),

    thresholds: {
        large: 500,
        critical: 1000
    },
    ignoreSettings: {
        excludeDirs: [
            'node_modules', '.git', '.next', 'dist', 'build', 'venv', '.venv', 'env',
            '__pycache__', '.dart_tool', '.idea', '.vscode', 'coverage', '.gradle'
        ],
        excludeFiles: ['freezed.dart', '.g.dart', '*.min.js', '*.lock']
    },
    viewTransform: {
        x: 60,
        y: 40,
        scale: 0.85
    },
    isDragging: false,
    dragStart: { x: 0, y: 0 }
};