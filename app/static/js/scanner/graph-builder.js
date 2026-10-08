/**
 * @fileoverview Построитель графа связей CodeMap на основе прочитанных файлов.
 *
 * @module graphBuilder
 */

import { parseImportsFromCode } from './import-parser.js';
import { resolveDependencyPath } from './path-resolver.js';

/**
 * Строит канонический граф зависимостей CodeMap на основе сырых просканированных файлов.
 *
 * @param {import('./directory-scanner.js').RawScannedFile[]} rawFiles - Массив сырых файлов с текстом.
 * @returns {import('../data.js').CodeFileNode[]} Массив нормализованных узлов графа.
 */
export function buildGraphFromScannedFiles(rawFiles) {
    const allPaths = rawFiles.map(f => f.id);

    return rawFiles.map(file => {
        const rawImports = parseImportsFromCode(file.content, file.ext);
        const resolvedDeps = [];

        rawImports.forEach(imp => {
            const resolved = resolveDependencyPath(file.id, imp.targetModule, allPaths);
            // Исключаем петли на самого себя и дубликаты связей
            if (resolved && resolved !== file.id) {
                const alreadyAdded = resolvedDeps.some(d => d.target === resolved && d.type === imp.type);
                if (!alreadyAdded) {
                    resolvedDeps.push({
                        target: resolved,
                        type: imp.type,
                        statement: imp.targetModule
                    });
                }
            }
        });

        const pathParts = file.id.split('/');
        const folder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'root';

        return {
            id: file.id,
            name: file.name,
            folder: folder,
            role: file.id.toLowerCase().includes('test') ? 'test suite' : 'module',
            lines: file.lines,
            language: file.ext === '.py' ? 'Python' : file.ext === '.dart' ? 'Dart' : 'TypeScript/JS',
            tags: [file.ext.replace('.', '').toUpperCase(), folder],
            exports: [],
            content: file.content,
            dependencies: resolvedDeps
        };
    });
}

