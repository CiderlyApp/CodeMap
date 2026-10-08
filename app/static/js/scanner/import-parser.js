/**
 * @fileoverview Синтаксический статический анализатор директив импорта для Python, JS/TS и Dart.
 *
 * @module importParser
 */

/**
 * @typedef {'import' | 'from_import' | 'export' | 're_export' | 'dynamic' | 'test'} ScannedDependencyType
 */

/**
 * @typedef {Object} ParsedImport
 * @property {string} targetModule - Строковое имя целевого модуля или относительный путь.
 * @property {ScannedDependencyType} type - Семантический тип связи.
 */

/**
 * Производит статический синтаксический анализ импортов в исходном коде.
 *
 * Особенности разбора по языкам:
 * - Python: поддержка `import a`, `from a import b`, а также относительных импортов (`from . import b`, `from ..c import d`).
 * - JS/TS: поддержка ESM `import ... from '...'`, реэкспортов `export ... from '...'` и CommonJS `require('...')`.
 * - Dart: поддержка `import '...'`, `part '...'` и библиотечных реэкспортов `export '...'`.
 *
 * @param {string} content - Исходный код файла.
 * @param {string} ext - Расширение файла (.py, .js, .ts, .dart и т.д.).
 * @returns {ParsedImport[]} Список обнаруженных спецификаторов импортов.
 */
export function parseImportsFromCode(content, ext) {
    const results = [];
    const lines = content.split('\n');

    for (const rawLine of lines) {
        // Пропускаем слишком длинные строки для защиты от минифицированного кода
        if (rawLine.length > 1200) continue;

        const line = rawLine.trim();
        if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('*')) continue;

        // 1. Python
        if (ext === '.py') {
            parsePythonLine(line, results);
        }
        // 2. JavaScript / TypeScript
        else if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') {
            parseJavaScriptLine(line, results);
        }
        // 3. Dart / Flutter
        else if (ext === '.dart') {
            parseDartLine(line, results);
        }
    }

    return results;
}

/**
 * Парсит одну строку Python-файла на наличие импортов.
 *
 * @param {string} line - Строка кода.
 * @param {ParsedImport[]} results - Результирующий массив.
 */
function parsePythonLine(line, results) {
    const fromMatch = line.match(/^from\s+(\.*[\w\.]*)\s+import/);
    if (fromMatch && fromMatch[1]) {
        results.push({ targetModule: fromMatch[1], type: 'from_import' });
        return;
    }

    const importMatch = line.match(/^import\s+([\w\.,\s]+)/);
    if (importMatch) {
        importMatch[1].split(',').forEach(m => {
            const trimmed = m.trim().split(/\s+/)[0];
            if (trimmed) results.push({ targetModule: trimmed, type: 'import' });
        });
    }
}

/**
 * Парсит одну строку JavaScript/TypeScript на наличие ESM/CommonJS импортов.
 *
 * @param {string} line - Строка кода.
 * @param {ParsedImport[]} results - Результирующий массив.
 */
function parseJavaScriptLine(line, results) {
    // Re-export: export { x } from './y' или export * from './y'
    const reExportMatch = line.match(/export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/);
    if (reExportMatch) {
        results.push({ targetModule: reExportMatch[1], type: 're_export' });
        return;
    }

    // Стандартный ESM import
    const esmMatch = line.match(/(?:import)\s+.*?\s+from\s+['"]([^'"]+)['"]/);
    if (esmMatch) {
        results.push({ targetModule: esmMatch[1], type: 'import' });
        return;
    }

    // CommonJS require
    const cjsMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
    if (cjsMatch) {
        results.push({ targetModule: cjsMatch[1], type: 'dynamic' });
    }
}

/**
 * Парсит одну строку Dart-файла на наличие директив импорта.
 *
 * @param {string} line - Строка кода.
 * @param {ParsedImport[]} results - Результирующий массив.
 */
function parseDartLine(line, results) {
    const dartReExport = line.match(/^export\s+['"]([^'"]+)['"]/);
    if (dartReExport) {
        results.push({ targetModule: dartReExport[1], type: 're_export' });
        return;
    }

    const dartMatch = line.match(/^(?:import|part)\s+['"]([^'"]+)['"]/);
    if (dartMatch) {
        results.push({ targetModule: dartMatch[1], type: 'import' });
    }
}