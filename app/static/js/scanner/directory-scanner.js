/**
 * @fileoverview Ввод/вывод файловой системы: доступ к локальным папкам через File System Access API.
 *
 * @module directoryScanner
 */

import {
    EXCLUDE_DIRS,
    DEFAULT_EXCLUDE_FILES,
    ALLOWED_EXTS,
    isFileIgnored
} from './scanner-filter.js';

/**
 * @typedef {Object} RawScannedFile
 * @property {string} id - Относительный путь от корня выбранной директории (POSIX).
 * @property {string} name - Имя файла с расширением.
 * @property {string} path - Полный относительный путь файла.
 * @property {string} content - Текстовое содержимое файла.
 * @property {number} lines - Количество строк кода (LOC).
 * @property {string} ext - Расширение файла с точкой.
 */

/**
 * @typedef {Object} ScannerIgnoreOptions
 * @property {string[]|Set<string>} [excludeDirs] - Пользовательский список игнорируемых папок.
 * @property {string[]} [excludeFiles] - Пользовательский список масок или имён файлов для исключения.
 */

/**
 * Запрашивает у пользователя выбор локальной директории на диске в режиме «только чтение».
 *
 * @async
 * @returns {Promise<FileSystemDirectoryHandle|null>} Дескриптор папки или null, если диалог отменён.
 * @throws {Error} Если File System Access API не поддерживается средой браузера.
 */
export async function pickProjectDirectoryReadOnly() {
    if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API не поддерживается данным браузером. Используйте Chromium-совместимый браузер или запасной загрузчик папок.');
    }

    try {
        const handle = await window.showDirectoryPicker({
            id: 'codemap-project-dir',
            mode: 'read'
        });
        return handle;
    } catch (err) {
        if (err.name === 'AbortError') {
            return null;
        }
        throw err;
    }
}

/**
 * Рекурсивно сканирует директорию файловой системы через File System Access API.
 * Пропускает бинарные файлы, скрытые служебные папки, каталоги из списка исключений
 * и файлы, соответствующие заданным маскам.
 *
 * @async
 * @param {FileSystemDirectoryHandle} dirHandle - Дескриптор директории браузера.
 * @param {string} [currentPath=''] - Текущий относительный путь при рекурсивном спуске.
 * @param {ScannerIgnoreOptions} [options={}] - Опции фильтрации каталогов и масок файлов.
 * @returns {Promise<RawScannedFile[]>} Список прочитанных файлов с содержимым и метаданными.
 */
export async function scanLocalDirectory(dirHandle, currentPath = '', options = {}) {
    const files = [];

    const activeExcludeDirs = options.excludeDirs instanceof Set
        ? options.excludeDirs
        : new Set(options.excludeDirs || EXCLUDE_DIRS);
    const activeExcludeFiles = options.excludeFiles || DEFAULT_EXCLUDE_FILES;

    for await (const [name, handle] of dirHandle.entries()) {
        if (activeExcludeDirs.has(name) || name.startsWith('.')) continue;

        const relPath = currentPath ? `${currentPath}/${name}` : name;

        if (handle.kind === 'directory') {
            const nested = await scanLocalDirectory(handle, relPath, options);
            files.push(...nested);
        } else if (handle.kind === 'file') {
            if (isFileIgnored(name, activeExcludeFiles)) {
                continue;
            }

            const extMatch = name.lastIndexOf('.');
            const ext = extMatch !== -1 ? name.substring(extMatch) : '';

            if (ALLOWED_EXTS.has(ext)) {
                try {
                    const fileObj = await handle.getFile();
                    const content = await fileObj.text();
                    const lines = content.split('\n').length;
                    files.push({
                        id: relPath,
                        name,
                        path: relPath,
                        content,
                        lines,
                        ext
                    });
                } catch (readError) {
                    console.warn(`[CodeMap Scanner] Пропущен файл ${relPath} из-за ошибки чтения:`, readError);
                }
            }
        }
    }

    return files;
}