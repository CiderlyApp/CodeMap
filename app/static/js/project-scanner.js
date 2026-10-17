/**
 * @fileoverview Фасад сканера каталогов в браузере с разбором зависимостей.
 * @module projectScanner
 */

const ALLOWED_EXTS = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.dart']);

export function matchFileMask(filename, mask) {
    if (!filename || !mask) return false;
    const trimmed = mask.trim();
    if (!trimmed) return false;

    if (trimmed.includes('*') || trimmed.includes('?')) {
        const escaped = trimmed
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`, 'i').test(filename);
    }
    return filename.toLowerCase().includes(trimmed.toLowerCase());
}

export function isFileIgnored(filename, masks = []) {
    return Array.isArray(masks) && masks.some(m => matchFileMask(filename, m));
}

export async function pickProjectDirectoryReadOnly() {
    if (!('showDirectoryPicker' in window)) return null;
    try {
        return await window.showDirectoryPicker({ id: 'codemap-dir', mode: 'read' });
    } catch (err) {
        if (err.name === 'AbortError') return null;
        throw err;
    }
}

export async function scanLocalDirectory(dirHandle, currentPath = '', ignoreSettings = {}) {
    const files = [];
    const exDirs = new Set(ignoreSettings.excludeDirs || ['node_modules', '.git', 'dist', 'build']);
    const exFiles = ignoreSettings.excludeFiles || ['.g.dart', '*.min.js'];

    for await (const [name, handle] of dirHandle.entries()) {
        if (exDirs.has(name) || name.startsWith('.')) continue;
        const relPath = currentPath ? `${currentPath}/${name}` : name;

        if (handle.kind === 'directory') {
            const nested = await scanLocalDirectory(handle, relPath, ignoreSettings);
            files.push(...nested);
        } else if (handle.kind === 'file') {
            if (isFileIgnored(name, exFiles)) continue;

            const ext = name.substring(name.lastIndexOf('.'));
            if (ALLOWED_EXTS.has(ext)) {
                try {
                    const fObj = await handle.getFile();
                    const content = await fObj.text();
                    files.push({
                        id: relPath,
                        name,
                        path: relPath,
                        content,
                        lines: content.split('\n').length,
                        ext
                    });
                } catch (e) {
                    console.warn(`Ошибка чтения файла: ${relPath}`, e);
                }
            }
        }
    }
    return files;
}

export function buildGraphFromScannedFiles(rawFiles) {
    const allPaths = rawFiles.map(f => f.id);

    return rawFiles.map(file => {
        const deps = [];
        const lines = file.content.split('\n');

        lines.forEach(line => {
            line = line.trim();
            let targetModule = null;
            let type = 'import';

            if (file.ext === '.py') {
                const fromM = line.match(/^from\s+(\.*[\w\.]+)\s+import/);
                if (fromM) {
                    targetModule = fromM[1];
                    type = 'from_import';
                } else {
                    const impM = line.match(/^import\s+([\w\.]+)/);
                    if (impM) targetModule = impM[1];
                }
            } else if (file.ext === '.dart') {
                const dartM = line.match(/^(?:import|part|export)\s+['"]([^'"]+)['"]/);
                if (dartM) {
                    targetModule = dartM[1];
                    if (line.startsWith('export')) type = 'export';
                }
            } else {
                const esmM = line.match(/(?:import|export\s+(?:\{[^}]*\}|\*)\s+from)\s+['"]([^'"]+)['"]/);
                if (esmM) {
                    targetModule = esmM[1];
                    if (line.startsWith('export')) type = 're_export';
                } else {
                    const reqM = line.match(/require\(['"]([^'"]+)['"]\)/);
                    if (reqM) {
                        targetModule = reqM[1];
                        type = 'dynamic';
                    }
                }
            }

            if (targetModule) {
                const resolved = resolveImportPath(file.id, targetModule, allPaths);
                if (resolved && resolved !== file.id && !deps.some(d => d.target === resolved)) {
                    deps.push({ target: resolved, type, statement: targetModule });
                }
            }
        });

        const parts = file.id.split('/');
        const folder = parts.length > 1 ? parts[parts.length - 2] : 'root';

        return {
            id: file.id,
            name: file.name,
            folder,
            role: file.id.includes('test') ? 'test suite' : 'module',
            lines: file.lines,
            language: file.ext === '.py' ? 'Python' : (file.ext === '.dart' ? 'Dart' : 'TypeScript/JS'),
            tags: [file.ext.replace('.', '').toUpperCase(), folder],
            exports: [],
            content: file.content,
            dependencies: deps
        };
    });
}

function resolveImportPath(currentFile, targetModule, allPaths) {
    if (!targetModule) return null;

    if (targetModule.startsWith('.')) {
        const curDir = currentFile.includes('/') ? currentFile.substring(0, currentFile.lastIndexOf('/')) : '';
        const combined = curDir ? `${curDir}/${targetModule}` : targetModule;
        const segments = combined.split('/');
        const stack = [];
        for (const s of segments) {
            if (s === '.' || s === '') continue;
            if (s === '..') stack.pop();
            else stack.push(s);
        }
        const norm = stack.join('/');
        for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.dart', '/index.ts', '/index.js']) {
            if (allPaths.includes(norm + ext)) return norm + ext;
        }
    }

    if (targetModule.startsWith('@/') || targetModule.startsWith('~/')) {
        const sub = targetModule.substring(2);
        for (const base of [sub, `src/${sub}`]) {
            for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
                if (allPaths.includes(base + ext)) return base + ext;
            }
        }
    }

    const simpleName = targetModule.split('/').pop().replace(/\.py$/, '');
    for (const p of allPaths) {
        if (p.endsWith('/' + simpleName + '.py') || p.endsWith('/' + simpleName + '.ts') || p.endsWith('/' + simpleName + '.dart')) {
            return p;
        }
    }
    return null;
}