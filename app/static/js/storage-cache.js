/**
 * @fileoverview Подсистема постоянного хранения (IndexedDB + In-Memory fallback).
 * @module storageCache
 */

const DB_NAME = 'CodeMapDatabase';
const DB_VERSION = 1;
const STORES = { PROJECTS: 'projects', METADATA: 'metadata' };

const memoryStore = new Map([
    [STORES.PROJECTS, new Map()],
    [STORES.METADATA, new Map()]
]);

function isIndexedDBAvailable() {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export function openDatabase() {
    if (!isIndexedDBAvailable()) return Promise.resolve(null);

    return new Promise((resolve) => {
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
        request.onerror = () => resolve(null);
    });
}

export async function saveProjectToCache(projectName, files) {
    if (!projectName || !Array.isArray(files)) return;
    const payload = { name: projectName, files, updatedAt: Date.now() };

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

export async function loadAllCachedProjects() {
    const result = new Map();
    const db = await openDatabase();
    if (!db) {
        memoryStore.get(STORES.PROJECTS).forEach((val, key) => result.set(key, val.files));
        return result;
    }
    return new Promise((resolve) => {
        const tx = db.transaction(STORES.PROJECTS, 'readonly');
        const store = tx.objectStore(STORES.PROJECTS);
        const req = store.getAll();
        req.onsuccess = () => {
            (req.result || []).forEach(r => {
                if (r.name && r.files) result.set(r.name, r.files);
            });
            resolve(result);
        };
        req.onerror = () => resolve(result);
    });
}

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
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

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
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}