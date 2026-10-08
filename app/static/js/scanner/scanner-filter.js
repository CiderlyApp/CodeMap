/**
 * @fileoverview Модуль фильтрации и сопоставления glob-масок файлов и каталогов.
 *
 * @module scannerFilter
 */

/**
 * Каталоги, исключаемые из обхода по умолчанию для защиты от переполнения памяти.
 * @type {Set<string>}
 */
export const EXCLUDE_DIRS = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', 'venv', '.venv', 'env',
    '__pycache__', '.dart_tool', '.idea', '.vscode', 'coverage', '.gradle',
    '.turbo', 'out', 'target', '.pytest_cache'
]);

/**
 * Маски файлов, исключаемые по умолчанию.
 * @type {string[]}
 */
export const DEFAULT_EXCLUDE_FILES = [
    'freezed.dart', '.g.dart', '*.min.js', '*.lock'
];

/**
 * Поддерживаемые расширения файлов исходного кода.
 * @type {Set<string>}
 */
export const ALLOWED_EXTS = new Set([
    '.py', '.js', '.jsx', '.ts', '.tsx', '.dart'
]);

/**
 * Проверяет соответствие имени файла заданной маске или подстроке.
 * Поддерживает подстановочные знаки:
 * - `*` — любое количество символов;
 * - `?` — один произвольный символ.
 * Если спецсимволы отсутствуют, выполняется регистронезависимая проверка подстроки.
 *
 * @param {string} filename - Имя проверяемого файла (например: "schema.g.dart", "bundle.min.js").
 * @param {string} mask - Маска или подстрока (например: "*.g.dart", "freezed.dart").
 * @returns {boolean} True, если имя файла удовлетворяет условию исключения.
 */
export function matchFileMask(filename, mask) {
    if (!filename || !mask) return false;
    const trimmed = mask.trim();
    if (!trimmed) return false;

    // Если маска содержит wildcard (* или ?), компилируем её в регулярное выражение
    if (trimmed.includes('*') || trimmed.includes('?')) {
        const escaped = trimmed
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`, 'i').test(filename);
    }

    // Если спецсимволов нет — проверяем как вхождение подстроки без учёта регистра
    return filename.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Проверяет, должен ли файл быть проигнорирован на основе набора масок.
 *
 * @param {string} filename - Имя файла (например: "user.g.dart").
 * @param {string[]} [masks=[]] - Массив масок исключений.
 * @returns {boolean} True, если файл совпал хотя бы с одной маской.
 */
export function isFileIgnored(filename, masks = []) {
    if (!Array.isArray(masks) || masks.length === 0) return false;
    return masks.some(mask => matchFileMask(filename, mask));
}