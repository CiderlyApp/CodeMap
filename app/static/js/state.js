/**
 * @fileoverview Единый источник правды (Single Source of Truth) для CodeMap.
 * Содержит структуру глобального состояния, параметры режимов визуализации и метрики.
 *
 * @module state
 */

import { PROJECT_DATA as DEMO_DATA } from './data.js';

/**
 * @typedef {'map' | 'layered' | 'free' | 'matrix'} ViewMode
 * @typedef {'import' | 'from_import' | 'export' | 're_export' | 'dynamic' | 'test'} EdgeType
 * @typedef {'all' | 'no-orphans' | 'only-orphans'} OrphanFilterMode
 * @typedef {'files' | 'modules'} MatrixLevel
 */

/**
 * Глобальный реактивный объект состояния приложения.
 */
export const state = {
    // Проекты и файлы
    projects: new Map([['ciderly-demo', [...DEMO_DATA]]]),
    activeProjectName: 'ciderly-demo',
    projectFiles: [...DEMO_DATA],

    // Выбор и фокус
    selectedFileId: DEMO_DATA[0]?.id || null,
    focusFiles: new Set(),
    isOverviewMode: true,
    isDrawerOpen: true,

    // Текущий режим визуализации
    currentViewMode: 'map', // 'map' | 'layered' | 'free' | 'matrix'

    // Фильтр типов связей (по умолчанию включены все)
    activeEdgeTypes: new Set(['import', 'from_import', 'export', 're_export', 'dynamic', 'test']),

    // Фильтрация файлов-сирот
    orphanFilter: 'all',

    // Контекст и Bundle для LLM
    excludedContextFiles: new Set(),
    customContextFiles: new Set(),

    // Свернутые директории в режиме «Карта проекта»
    collapsedFolders: new Set(),

    // Параметры режима «Слоевой граф»
    layeredSettings: {
        depth: 2,
        direction: 'both' // 'both' | 'upstream' | 'downstream'
    },

    // Сохраненные координаты узлов для режима «Свободный граф»
    freeLayoutPositions: new Map(),
    freeSimulationRunning: false,

    // Параметры режима «Матрица зависимостей»
    matrixSettings: {
        level: 'files', // 'files' | 'modules'
        searchQuery: '',
        sortBy: 'name', // 'name' | 'in-degree' | 'out-degree' | 'lines'
        sortAsc: true,
        selectedCell: null // { source: string, target: string }
    },

    // Пороги рефакторинга
    thresholds: {
        large: 500,
        critical: 1000
    },

    // Правила игнорирования файлов и папок
    ignoreSettings: {
        excludeDirs: [
            'node_modules', '.git', '.next', 'dist', 'build', 'venv', '.venv', 'env',
            '__pycache__', '.dart_tool', '.idea', '.vscode', 'coverage', '.gradle'
        ],
        excludeFiles: ['freezed.dart', '.g.dart', '*.min.js', '*.lock']
    },

    // Трансформация холста для графовых режимов
    viewTransform: {
        x: 60,
        y: 40,
        scale: 0.85
    },
    isDragging: false,
    dragStart: { x: 0, y: 0 }
};