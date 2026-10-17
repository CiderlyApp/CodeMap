/**
 * @fileoverview Управление компонентами пользовательского интерфейса:
 * переключение темы, автокомплит, проводник проектов и модальное окно настроек.
 * @module ui
 */

export const UI = {
    /**
     * Инициализирует переключатель темы с сохранением состояния в localStorage.
     * @returns {void}
     */
    initThemeToggle() {
        const btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;

        const currentTheme = localStorage.getItem('dep_theme') || 'light';

        if (currentTheme === 'dark') {
            document.body.classList.add('dark-theme');
            btn.innerText = '☀️ Светлая тема';
        } else {
            document.body.classList.remove('dark-theme');
            btn.innerText = '🌙 Темная тема';
        }

        btn.onclick = () => {
            document.body.classList.toggle('dark-theme');
            const isDark = document.body.classList.contains('dark-theme');
            localStorage.setItem('dep_theme', isDark ? 'dark' : 'light');
            btn.innerText = isDark ? '☀️ Светлая тема' : '🌙 Темная тема';
        };
    },

    /**
     * Заполняет datalist автокомплита поиска файлов.
     *
     * @param {Array<{id: string, label: string}>} nodes - Список узлов графа.
     * @returns {void}
     */
    initAutocomplete(nodes) {
        const datalist = document.getElementById('files-list');
        if (!datalist) return;
        datalist.innerHTML = '';
        nodes.forEach(node => {
            const option = document.createElement('option');
            option.value = node.id;
            option.innerText = node.label;
            datalist.appendChild(option);
        });
    },

    /**
     * Отрисовывает чекбоксы видимости проектов в сайдбаре.
     *
     * @param {string[]} projects - Список обнаруженных проектов в графе.
     * @param {Object<string, string>} projectColors - Цветовая палитра проектов.
     * @param {function(string, boolean): void} onFilterChange - Колбэк изменения видимости.
     * @returns {void}
     */
    buildProjectFilters(projects, projectColors, onFilterChange) {
        const container = document.getElementById('project-filters');
        if (!container) return;
        container.innerHTML = '';
        
        projects.forEach(proj => {
            const label = document.createElement('label');
            label.className = 'filter-item-label';
            label.style.color = projectColors[proj] || '#2c3e50';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.value = proj;

            checkbox.addEventListener('change', (e) => {
                onFilterChange(proj, e.target.checked);
            });

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(proj));
            container.appendChild(label);
        });
    },

    /**
     * Обновляет панель выбранного файла и переключает состояние кнопок экспорта.
     *
     * @param {string|null} nodeId - ID выбранного узла или null для сброса.
     * @returns {void}
     */
    updateSelectedInfo(nodeId) {
        const infoBox = document.getElementById('info-box');
        const btnAddBasket = document.getElementById('btn-add-to-basket');

        if (nodeId) {
            infoBox.innerHTML = `<strong>Выбран файл:</strong><br>${nodeId}`;
            document.getElementById('btn-save-single').disabled = false;
            document.getElementById('btn-save-all').disabled = false;
            if (btnAddBasket) btnAddBasket.disabled = false;
            
            const btnAi = document.getElementById('btn-copy-ai');
            if (btnAi) {
                btnAi.style.display = 'block';
                btnAi.disabled = false;
            }
        } else {
            infoBox.innerText = "Выберите файл на схеме";
            document.getElementById('btn-save-single').disabled = true;
            document.getElementById('btn-save-all').disabled = true;
            if (btnAddBasket) btnAddBasket.disabled = true;
            
            const btnAi = document.getElementById('btn-copy-ai');
            if (btnAi) {
                btnAi.style.display = 'none';
                btnAi.disabled = true;
            }
            
            document.getElementById('search-input').value = '';
            document.getElementById('dependency-details').style.display = 'none';
        }
    },

    /**
     * Отрисовывает состав корзины экспорта.
     *
     * @param {Set<string>} basketSet - Список файлов в корзине.
     * @param {function(string): void} onRemoveItem - Обработчик удаления файла.
     * @returns {void}
     */
    renderBasket(basketSet, onRemoveItem) {
        const listContainer = document.getElementById('basket-list');
        const countSpan = document.getElementById('basket-count');
        const actionsDiv = document.getElementById('basket-actions');
        const clearBtn = document.getElementById('btn-clear-basket');

        if (!listContainer || !countSpan) return;

        countSpan.innerText = basketSet.size;
        listContainer.innerHTML = '';

        if (basketSet.size === 0) {
            listContainer.innerHTML = '<div class="empty-text" style="padding:5px;">Корзина пуста. Добавляйте файлы кнопкой «+» или кликом на схеме.</div>';
            if (actionsDiv) actionsDiv.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        if (actionsDiv) actionsDiv.style.display = 'flex';
        if (clearBtn) clearBtn.style.display = 'inline-block';

        const ul = document.createElement('ul');
        ul.className = 'dep-list';

        basketSet.forEach(filePath => {
            const li = document.createElement('li');
            li.className = 'dep-list-item';

            const span = document.createElement('span');
            span.className = 'dep-text';
            span.innerText = filePath;

            const trashBtn = document.createElement('button');
            trashBtn.className = 'dep-trash-btn';
            trashBtn.innerHTML = '🗑️';
            trashBtn.title = 'Удалить из корзины';
            trashBtn.onclick = (e) => {
                e.stopPropagation();
                onRemoveItem(filePath);
            };

            li.appendChild(span);
            li.appendChild(trashBtn);
            ul.appendChild(li);
        });

        listContainer.appendChild(ul);
    },

    /**
     * Отображает списки влияющих и зависимых файлов.
     *
     * @param {Set<string>} upstream - Входящие зависимости (импорты).
     * @param {Set<string>} downstream - Зависящие от файла компоненты.
     * @param {function(string): void} onItemClick - Клик по узлу в списке.
     * @returns {void}
     */
    renderDependencyLists(upstream, downstream, onItemClick) {
        const importsList = document.getElementById('list-imports');
        const dependentsList = document.getElementById('list-dependents');

        if (!importsList || !dependentsList) return;

        importsList.innerHTML = '';
        dependentsList.innerHTML = '';

        if (upstream.size === 0) {
            importsList.innerHTML = '<li class="empty-text">Не имеет внешних связей</li>';
        } else {
            upstream.forEach(dep => {
                const li = document.createElement('li');
                li.className = 'dep-list-item';
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'dep-checkbox';
                cb.checked = true;
                cb.onclick = (e) => { e.stopPropagation(); };

                const span = document.createElement('span');
                span.className = 'dep-text';
                span.innerText = dep;
                span.onclick = () => onItemClick(dep);

                const trashBtn = document.createElement('button');
                trashBtn.className = 'dep-trash-btn';
                trashBtn.innerHTML = '🗑️';
                trashBtn.title = 'Исключить';
                trashBtn.onclick = (e) => { e.stopPropagation(); li.remove(); };

                li.appendChild(cb);
                li.appendChild(span);
                li.appendChild(trashBtn);
                importsList.appendChild(li);
            });
        }

        if (downstream.size === 0) {
            dependentsList.innerHTML = '<li class="empty-text">Не используется в других файлах</li>';
        } else {
            downstream.forEach(dep => {
                const li = document.createElement('li');
                li.className = 'dep-list-item';
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'dep-checkbox';
                cb.checked = true;
                cb.onclick = (e) => { e.stopPropagation(); };

                const span = document.createElement('span');
                span.className = 'dep-text';
                span.innerText = dep;
                span.onclick = () => onItemClick(dep);

                const trashBtn = document.createElement('button');
                trashBtn.className = 'dep-trash-btn';
                trashBtn.innerHTML = '🗑️';
                trashBtn.title = 'Исключить';
                trashBtn.onclick = (e) => { e.stopPropagation(); li.remove(); };

                li.appendChild(cb);
                li.appendChild(span);
                li.appendChild(trashBtn);
                dependentsList.appendChild(li);
            });
        }

        document.getElementById('dependency-details').style.display = 'block';
    },

    /**
     * Инициализирует проводник проектов и модальное окно настроек.
     *
     * @param {function(): void} onSaveCallback - Колбэк после сохранения.
     * @returns {void}
     */
    initSettingsModal(onSaveCallback) {
        const modal = document.getElementById('settings-modal');
        const btnOpen = document.getElementById('btn-open-settings');
        const btnClose = document.getElementById('btn-close-settings');
        const btnSave = document.getElementById('btn-save-settings');
        const dirsContainer = document.getElementById('available-projects-list');
        const btnSelectAll = document.getElementById('btn-select-all-projects');
        const btnDeselectAll = document.getElementById('btn-deselect-all-projects');

        if (!btnOpen || !modal) return;

        const loadDirectoryExplorer = async (selectedList) => {
            if (!dirsContainer) return;
            dirsContainer.innerHTML = '<div style="font-size:12px; color:#7f8c8d;">Сканирование каталогов...</div>';

            try {
                const resp = await fetch('/api/fs/projects');
                const data = await resp.json();
                
                dirsContainer.innerHTML = '';
                const selectedSet = new Set(selectedList || []);

                if (!data.available_projects || data.available_projects.length === 0) {
                    dirsContainer.innerHTML = `
                        <div style="font-size:12px; color:#e67e22;">
                            В каталоге <code>${data.root_dir}</code> подкаталоги не найдены.
                        </div>
                    `;
                    return;
                }

                data.available_projects.forEach(item => {
                    const label = document.createElement('label');
                    label.className = 'project-dir-item';

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'project-dir-checkbox';
                    cb.value = item.name;
                    cb.checked = selectedSet.size === 0 || selectedSet.has(item.name);

                    const titleSpan = document.createElement('span');
                    titleSpan.className = 'project-dir-name';
                    titleSpan.innerText = item.name;

                    label.appendChild(cb);
                    label.appendChild(titleSpan);

                    if (item.markers && item.markers.length > 0) {
                        const markerBadge = document.createElement('span');
                        markerBadge.className = 'project-dir-badge';
                        markerBadge.innerText = item.markers.join(', ');
                        label.appendChild(markerBadge);
                    }

                    dirsContainer.appendChild(label);
                });
            } catch (err) {
                dirsContainer.innerHTML = `<div style="font-size:12px; color:#e74c3c;">Ошибка загрузки каталогов: ${err.message}</div>`;
            }
        };

        if (btnSelectAll) {
            btnSelectAll.onclick = () => {
                document.querySelectorAll('.project-dir-checkbox').forEach(cb => { cb.checked = true; });
            };
        }

        if (btnDeselectAll) {
            btnDeselectAll.onclick = () => {
                document.querySelectorAll('.project-dir-checkbox').forEach(cb => { cb.checked = false; });
            };
        }

        btnOpen.addEventListener('click', async () => {
            const resp = await fetch('/api/settings');
            const data = await resp.json();
            
            document.getElementById('settings-exclude-dirs').value = data.exclude_dirs || '';
            document.getElementById('settings-extensions').value = data.extensions || '';
            document.getElementById('settings-exclude-files').value = data.exclude_files || "freezed.dart, .g.dart";
            
            await loadDirectoryExplorer(data.selected_dirs);
            modal.style.display = 'flex';
        });

        const closeModal = () => { modal.style.display = 'none'; };
        if (btnClose) btnClose.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const chosenDirs = [];
                document.querySelectorAll('.project-dir-checkbox:checked').forEach(cb => {
                    chosenDirs.push(cb.value);
                });

                const payload = {
                    selected_dirs: chosenDirs,
                    exclude_dirs: document.getElementById('settings-exclude-dirs').value,
                    extensions: document.getElementById('settings-extensions').value,
                    exclude_files: document.getElementById('settings-exclude-files').value
                };
                
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                closeModal();
                onSaveCallback();
            });
        }
    }
};

// Экспортируем в глобальную область браузера для обратной совместимости
if (typeof window !== 'undefined') {
    window.UI = UI;
}