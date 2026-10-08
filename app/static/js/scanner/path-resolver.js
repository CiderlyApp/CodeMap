/**
 * @fileoverview Алгоритмический резолвер путей импорта в физические пути файлов графа.
 *
 * @module pathResolver
 */

/**
 * Нормализует точечные относительные импорты Python (.routes, ..services.user)
 * в стандартные POSIX-пути (./routes, ../services/user).
 *
 * @param {string} currentPath - Путь текущего файла.
 * @param {string} targetModule - Исходная строка модуля.
 * @returns {string} Нормализованная строка пути.
 */
function normalizePythonRelativeModule(currentPath, targetModule) {
    if (!currentPath.endsWith('.py')) return targetModule;
    if (!targetModule.startsWith('.') || targetModule.includes('/')) return targetModule;

    const dotMatch = targetModule.match(/^(\.+)(.*)$/);
    if (!dotMatch) return targetModule;

    const dotCount = dotMatch[1].length;
    const modName = dotMatch[2].replace(/\./g, '/');
    const prefix = dotCount === 1 ? './' : '../'.repeat(dotCount - 1);

    return modName ? `${prefix}${modName}` : `${prefix}`;
}

/**
 * Разрешает строковый идентификатор импорта в канонический относительный путь файла графа.
 *
 * Поддерживаемые стратегии:
 * 1. Относительные пути (JS/TS, Dart, нормализованный Python): `./utils`, `../models`.
 * 2. Алиасы корневых каталогов фронтенда: `@/components/Button` или `~/utils`.
 * 3. Абсолютные внутрипроектные модули Python: `core.database` -> `src/core/database.py`.
 * 4. Пакетные и прямые импорты Dart: `package:app/models/user.dart`.
 *
 * @param {string} currentPath - Относительный путь текущего файла (например: 'src/api/app.py').
 * @param {string} targetModule - Строка импорта (например: './config', '../models', 'core.database').
 * @param {string[]} allRelativePaths - Полный реестр относительных путей файлов проекта.
 * @returns {string|null} Канонический путь к зависимому файлу или null, если модуль внешний.
 */
export function resolveDependencyPath(currentPath, targetModule, allRelativePaths) {
    if (!targetModule) return null;

    let normalizedModule = normalizePythonRelativeModule(currentPath, targetModule);

    // 1. Относительные пути (начинаются с '.')
    if (normalizedModule.startsWith('.')) {
        const lastSlash = currentPath.lastIndexOf('/');
        const currentDir = lastSlash !== -1 ? currentPath.substring(0, lastSlash) : '';
        const rawCombined = currentDir ? `${currentDir}/${normalizedModule}` : normalizedModule;
        const parts = rawCombined.split('/');
        const stack = [];

        for (const segment of parts) {
            if (segment === '.' || segment === '') continue;
            if (segment === '..') {
                stack.pop();
            } else {
                stack.push(segment);
            }
        }

        const normalized = stack.join('/');
        const extensionsToTry = [
            '', '.py', '.ts', '.tsx', '.js', '.jsx', '.dart',
            '/__init__.py', '/index.ts', '/index.js'
        ];

        for (const ext of extensionsToTry) {
            const probe = normalized + ext;
            if (allRelativePaths.includes(probe)) {
                return probe;
            }
        }

        for (const candidate of allRelativePaths) {
            const withoutExt = candidate.substring(0, candidate.lastIndexOf('.')) || candidate;
            if (withoutExt === normalized) {
                return candidate;
            }
        }
        return null;
    }

    // 2. Алиасы корня фронтенда (@/ и ~/)
    if (normalizedModule.startsWith('@/') || normalizedModule.startsWith('~/')) {
        const subPath = normalizedModule.substring(2);
        const aliasCandidates = [
            subPath,
            `src/${subPath}`
        ];

        for (const cand of aliasCandidates) {
            for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
                const probe = cand + ext;
                if (allRelativePaths.includes(probe)) {
                    return probe;
                }
            }
        }
        return null;
    }

    // 3. Абсолютные модули Python (точечная нотация: core.database -> core/database)
    const dotToSlash = targetModule.replace(/\./g, '/');
    for (const candidate of allRelativePaths) {
        const withoutExt = candidate.substring(0, candidate.lastIndexOf('.')) || candidate;

        if (withoutExt === dotToSlash || withoutExt.endsWith('/' + dotToSlash)) {
            return candidate;
        }
    }

    // 4. Dart пакетные и библиотечные импорты
    const simpleName = targetModule.split('/').pop();
    if (simpleName) {
        for (const candidate of allRelativePaths) {
            if (candidate === simpleName || candidate.endsWith('/' + simpleName)) {
                return candidate;
            }
        }
    }

    return null;
}