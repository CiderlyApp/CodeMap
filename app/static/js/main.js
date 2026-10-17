/**
 * @fileoverview Точка сборки клиентской логики. Регистрирует глобальные обработчики событий.
 * @module main
 */

import { appState } from './state.js';
import { UI } from './ui.js';
import { 
    copyToClipboardAI, 
    downloadExport,
    addToBasket,
    clearBasket,
    exportBasketAI,
    exportBasketTxt
} from './exportService.js';
import { 
    loadGraph, 
    changeElementDistance, 
    changeProjectDistance, 
    handleDeselect, 
    selectAndFocus 
} from './graphRenderer.js';

// Инициализация переключателя темы и проводника настроек
UI.initThemeToggle();
UI.initSettingsModal(() => loadGraph(true));

const btnAddToBasket = document.getElementById('btn-add-to-basket');
if (btnAddToBasket) {
    btnAddToBasket.onclick = () => {
        if (appState.selectedNodeId) addToBasket(appState.selectedNodeId);
    };
}

const btnAddSearchToBasket = document.getElementById('btn-add-search-to-basket');
if (btnAddSearchToBasket) {
    btnAddSearchToBasket.onclick = () => {
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) {
            addToBasket(searchInput.value.trim());
        }
    };
}

const btnClearBasket = document.getElementById('btn-clear-basket');
if (btnClearBasket) {
    btnClearBasket.onclick = clearBasket;
}

const btnExportBasketTxt = document.getElementById('btn-export-basket-txt');
if (btnExportBasketTxt) {
    btnExportBasketTxt.onclick = exportBasketTxt;
}

const btnCopyBasketAi = document.getElementById('btn-copy-basket-ai');
if (btnCopyBasketAi) {
    btnCopyBasketAi.onclick = exportBasketAI;
}

const sliderElemDist = document.getElementById('slider-elem-dist');
const sliderProjDist = document.getElementById('slider-proj-dist');

if (sliderElemDist) {
    sliderElemDist.addEventListener('change', (e) => changeElementDistance(e.target.value));
    sliderElemDist.addEventListener('input', (e) => {
        document.getElementById('val-elem-dist').innerText = `${e.target.value}px`;
    });
}

if (sliderProjDist) {
    sliderProjDist.addEventListener('change', (e) => changeProjectDistance(e.target.value));
    sliderProjDist.addEventListener('input', (e) => {
        document.getElementById('val-proj-dist').innerText = `${e.target.value}px`;
    });
}

const filterOrphans = document.getElementById('filter-orphans');
if (filterOrphans) {
    filterOrphans.addEventListener('change', (e) => {
        appState.orphanFilterMode = e.target.value;
        if (appState.nodesView) appState.nodesView.refresh();
        handleDeselect();
        if (appState.network) appState.network.fit();
    });
}

const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (appState.nodesDataSet && appState.nodesDataSet.get(val)) {
            selectAndFocus(val);
        }
    });
}

const btnSaveSingle = document.getElementById('btn-save-single');
if (btnSaveSingle) {
    btnSaveSingle.onclick = () => {
        if (appState.selectedNodeId) downloadExport(appState.selectedNodeId, 'single');
    };
}

const btnSaveAll = document.getElementById('btn-save-all');
if (btnSaveAll) {
    btnSaveAll.onclick = () => {
        if (appState.selectedNodeId) downloadExport(appState.selectedNodeId, 'all');
    };
}

const btnCopyAi = document.getElementById('btn-copy-ai');
if (btnCopyAi) {
    btnCopyAi.onclick = () => {
        if (appState.selectedNodeId) copyToClipboardAI(appState.selectedNodeId);
    };
}

const btnRefresh = document.getElementById('btn-refresh');
if (btnRefresh) btnRefresh.onclick = () => loadGraph(true);

const btnFit = document.getElementById('btn-fit');
if (btnFit) {
    btnFit.onclick = () => {
        if (appState.network) appState.network.fit({ animation: { duration: 500 } });
    };
}

window.addEventListener('DOMContentLoaded', () => loadGraph(false));