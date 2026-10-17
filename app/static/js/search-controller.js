/**
 * @fileoverview Контроллер быстрого глобального поиска файлов.
 * @module searchController
 */

import { state } from './state.js';
import { selectFile } from './tree-controller.js';

export function initSearch() {
    const input = document.getElementById('global-search-input');
    const dropdown = document.getElementById('search-results-dropdown');
    const clearBtn = document.getElementById('clear-search-btn');

    if (!input || !dropdown) return;

    input.oninput = (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) {
            dropdown.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        if (clearBtn) clearBtn.style.display = 'block';
        const matches = state.projectFiles.filter(f => 
            f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)
        );

        dropdown.innerHTML = matches.map(f => `
            <div class="search-item" data-id="${f.id}">
                <div>
                    <div style="font-weight:600;color:#fff;">${f.name}</div>
                    <div style="font-size:11px;color:#64748b;">${f.id}</div>
                </div>
                <div>${f.lines} loc</div>
            </div>
        `).join('') || '<div style="padding:10px;color:#64748b;">Ничего не найдено</div>';
        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.search-item').forEach(it => {
            it.onclick = () => {
                const id = it.dataset.id;
                dropdown.style.display = 'none';
                input.value = '';
                selectFile(id, true);
            };
        });
    };

    if (clearBtn) {
        clearBtn.onclick = () => {
            input.value = '';
            dropdown.style.display = 'none';
            clearBtn.style.display = 'none';
        };
    }
}