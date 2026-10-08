/**
 * @fileoverview Единый фасад подсистемы сканирования репозитория.
 * Реэкспортирует функции модулей фильтрации, синтаксического анализа,
 * разрешения путей и построения графа.
 *
 * @module projectScanner
 */

export {
    EXCLUDE_DIRS,
    DEFAULT_EXCLUDE_FILES,
    ALLOWED_EXTS,
    matchFileMask,
    isFileIgnored
} from './scanner/scanner-filter.js';

export {
    parseImportsFromCode
} from './scanner/import-parser.js';

export {
    resolveDependencyPath
} from './scanner/path-resolver.js';

export {
    pickProjectDirectoryReadOnly,
    scanLocalDirectory
} from './scanner/directory-scanner.js';

export {
    buildGraphFromScannedFiles
} from './scanner/graph-builder.js';