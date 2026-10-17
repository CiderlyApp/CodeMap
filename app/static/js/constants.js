/**
 * @fileoverview Архитектурные справочники типов, схемы цветового кодирования и правила сопоставления слоев.
 * @module constants
 */

/**
 * Палитра акцентных цветов проектов.
 * @type {string[]}
 */
export const PROJECT_COLORS_POOL = [
    '#8e44ad', '#16a085', '#e67e22', '#2980b9', '#c0392b', '#27ae60', '#d35400', '#2c3e50'
];

/**
 * Карта сопоставления архитектурных маркеров директорий с HEX-значениями заливки узлов.
 * @type {Object<string, string>}
 */
export const GLOBAL_TYPE_COLORS = {
    'screens': '#fde2e4', 'pages': '#fde2e4', 'views': '#fde2e4',
    'services': '#e2f0cb', 'controllers': '#e2f0cb', 'routes': '#e2f0cb',
    'providers': '#fef5e7', 'bloc': '#fef5e7', 'state': '#fef5e7', 'contexts': '#fef5e7',
    'components': '#e8e8f4', 'widgets': '#e8e8f4',
    'models': '#d4e6f1', 'entities': '#d4e6f1', 'db': '#d4e6f1',
    'utils': '#eaeded', 'helpers': '#eaeded', 'config': '#eaeded',
    'fallback': '#ffffff'
};

/**
 * Вычисляет фоновый цвет узла графа на основе пути группы.
 *
 * @param {string} groupPath - Идентификатор архитектурного слоя (например, "backend/services/user").
 * @returns {string} HEX-код цвета для элемента Vis.js.
 */
export function getGlobalTypeColor(groupPath) {
    if (!groupPath) return GLOBAL_TYPE_COLORS['fallback'];

    const parts = groupPath.toLowerCase().split('/');
    for (const part of parts) {
        if (GLOBAL_TYPE_COLORS[part]) {
            return GLOBAL_TYPE_COLORS[part];
        }
    }
    return GLOBAL_TYPE_COLORS['fallback'];
}