/**
 * @fileoverview Подсистема долговременного хранения и кэширования проектов CodeMap.
 *
 * Документация как код:
 * - Использует транзакционную базу данных IndexedDB ('CodeMapDatabase') для хранения
 *   тяжелых графов проектов, исходных текстов и зависимостей без ограничений localStorage по объему.
 * - Для сред без поддержки IndexedDB (например, Node.js при тестировании или закрытых песочниц)
 *   предусмотрен отказоустойчивый резервный адаптер InMemoryStorageAdapter.
 * - Гарантирует сохранение проектов, выбранного активного проекта и пользовательских порогов при F5.
 *
 * @module storageCache
 */

/**
 * Имя базы данных IndexedDB.
 * @type {string}
 */
const DB_NAME = 'CodeMapDatabase';

/**
 * Версия схемы базы данных.
 * @type {number}
 */
const DB_VERSION = 1;

/**
 * Имена таблиц (Object Stores).
 * @enum {string}
 */
const STORES = {
    PROJECTS: 'projects',
    METADATA: 'metadata'
};

/**
 * Внутреннее хранилище для сред без поддержки IndexedDB.
 * @type {Map<string, Map<string, any>>}
 */
const memoryStore = new Map([
    [STORES.PROJECTS, new Map()],
    [STORES.METADATA, new Map()]
]);

/**
 * Проверяет доступность IndexedDB в текущем окружении.
 *
 * @returns {boolean} True, если IndexedDB поддерживается и доступен.
 */
function isIndexedDBAvailable() {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/**
 * Инициализирует и открывает подключение к IndexedDB.
 *
 * @async
 * @returns {Promise<IDBDatabase|null>} Экземпляр базы данных или null в случае ошибки.
 */
export function openDatabase() {
    if (!isIndexedDBAvailable()) {
        return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
                db.createObjectStore(STORES.PROJECTS, { keyPath: 'name' });
            }

            if (!db.objectStoreNames.contains(STORES.METADATA)) {
                db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.warn('Не удалось открыть IndexedDB, переключение на резервный кэш:', request.error);
            resolve(null);
        };
    });
}

/**
 * Сохраняет спарсенный проект в долговременный кэш.
 *
 * @async
 * @param {string} projectName - Уникальное имя проекта.
 * @param {Array<Object>} files - Массив файлов со структурой, строками кода и зависимостями.
 * @returns {Promise<void>}
 */
export async function saveProjectToCache(projectName, files) {
    if (!projectName || !Array.isArray(files)) return;

    const payload = {
        name: projectName,
        files: files,
        updatedAt: Date.now()
    };

    const db = await openDatabase();
    if (!db) {
        memoryStore.get(STORES.PROJECTS).set(projectName, payload);
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PROJECTS, 'readwrite');
        const store = tx.objectStore(STORES.PROJECTS);
        const req = store.put(payload);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Загружает все сохраненные проекты из кэша.
 *
 * @async
 * @returns {Promise<Map<string, Array<Object>>>} Словарь [имя_проекта -> массив_файлов].
 */
export async function loadAllCachedProjects() {
    const result = new Map();

    const db = await openDatabase();
    if (!db) {
        memoryStore.get(STORES.PROJECTS).forEach((val, key) => {
            result.set(key, val.files);
        });
        return result;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORES.PROJECTS, 'readonly');
        const store = tx.objectStore(STORES.PROJECTS);
        const req = store.getAll();

        req.onsuccess = () => {
            const records = req.result || [];
            records.forEach(r => {
                if (r.name && r.files) {
                    result.set(r.name, r.files);
                }
            });
            resolve(result);
        };

        req.onerror = () => {
            console.warn('Ошибка чтения кэша проектов из IndexedDB:', req.error);
            resolve(result);
        };
    });
}

/**
 * Удаляет проект из кэша.
 *
 * @async
 * @param {string} projectName - Имя удаляемого проекта.
 * @returns {Promise<void>}
 */
export async function removeProjectFromCache(projectName) {
    const db = await openDatabase();
    if (!db) {
        memoryStore.get(STORES.PROJECTS).delete(projectName);
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PROJECTS, 'readwrite');
        const store = tx.objectStore(STORES.PROJECTS);
        const req = store.delete(projectName);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Сохраняет имя текущего активного проекта.
 *
 * @async
 * @param {string} projectName - Имя активного проекта.
 * @returns {Promise<void>}
 */
export async function saveActiveProjectName(projectName) {
    const payload = { key: 'activeProject', value: projectName };

    const db = await openDatabase();
    if (!db) {
        memoryStore.get(STORES.METADATA).set('activeProject', payload);
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORES.METADATA, 'readwrite');
        const store = tx.objectStore(STORES.METADATA);
        store.put(payload);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

/**
 * Читает имя последнего активного проекта из кэша.
 *
 * @async
 * @returns {Promise<string|null>} Имя проекта или null.
 */
export async function loadActiveProjectName() {
    const db = await openDatabase();
    if (!db) {
        const item = memoryStore.get(STORES.METADATA).get('activeProject');
        return item ? item.value : null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORES.METADATA, 'readonly');
        const store = tx.objectStore(STORES.METADATA);
        const req = store.get('activeProject');

        req.onsuccess = () => {
            resolve(req.result ? req.result.value : null);
        };
        req.onerror = () => resolve(null);
    });
}

/**
 * Сохраняет настройки порогов и глубины в кэш.
 *
 * @async
 * @param {Object} settings - Объект настроек { thresholds, depth }.
 * @returns {Promise<void>}
 */
export async function saveSettingsToCache(settings) {
    const payload = { key: 'appSettings', value: settings };

    const db = await openDatabase();
    if (!db) {
        memoryStore.get(STORES.METADATA).set('appSettings', payload);
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORES.METADATA, 'readwrite');
        const store = tx.objectStore(STORES.METADATA);
        store.put(payload);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

/**
 * Загружает сохраненные настройки из кэша.
 *
 * @async
 * @returns {Promise<Object|null>} Объект сохраненных настроек или null.
 */
export async function loadSettingsFromCache() {
    const db = await openDatabase();
    if (!db) {
        const item = memoryStore.get(STORES.METADATA).get('appSettings');
        return item ? item.value : null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORES.METADATA, 'readonly');
        const store = tx.objectStore(STORES.METADATA);
        const req = store.get('appSettings');

        req.onsuccess = () => {
            resolve(req.result ? req.result.value : null);
        };
        req.onerror = () => resolve(null);
    });
}