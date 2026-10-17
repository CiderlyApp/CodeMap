/**
 * @fileoverview Legacy-модуль оркестрации графа зависимостей. 
 * Сохранен для обратной совместимости монолитной сборки без ES Modules.
 * @deprecated Рекомендуется использовать модульную связку graphRenderer.js / exportService.js / state.js
 */

let allNodes = [];
let allEdges = [];
let nodesDataSet = null;
let edgesDataSet = null;
let nodesView = null;
let activeProjects = new Set();
let network = null;
let selectedNodeId = null; 

let currentProjDistance = 1800;
let currentElemDistance = 160; 
let orphanFilterMode = 'no-orphans'; 

let highlightedNodes = [];
let highlightedEdges = [];

let dashAnimationInterval = null;

const circularSet = new Set();

const projectColorsPool = [
    '#8e44ad', '#16a085', '#e67e22', '#2980b9', '#c0392b', '#27ae60', '#d35400', '#2c3e50'
];

const globalTypeColors = {
    'screens': '#fde2e4', 'pages': '#fde2e4', 'views': '#fde2e4',
    'services': '#e2f0cb', 'controllers': '#e2f0cb', 'routes': '#e2f0cb',
    'providers': '#fef5e7', 'bloc': '#fef5e7', 'state': '#fef5e7', 'contexts': '#fef5e7',
    'components': '#e8e8f4', 'widgets': '#e8e8f4',
    'models': '#d4e6f1', 'entities': '#d4e6f1', 'db': '#d4e6f1',
    'utils': '#eaeded', 'helpers': '#eaeded', 'config': '#eaeded',
    'fallback': '#ffffff'
};

let projectColors = {};
let projectDirections = {};

function getGlobalTypeColor(groupPath) {
    const parts = groupPath.toLowerCase().split('/');
    for (let part of parts) {
        if (globalTypeColors[part]) {
            return globalTypeColors[part];
        }
    }
    return globalTypeColors['fallback'];
}

async function loadGraph(refresh = false) {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = "Анализ репозиториев...";

    try {
        const response = await fetch(`/api/graph?refresh=${refresh ? 'true' : 'false'}`);
        const data = await response.json();

        allNodes = data.nodes;
        allEdges = data.edges;

        if (!allNodes || allNodes.length === 0) {
            document.getElementById('loader').style.display = 'none';
            document.getElementById('network').innerHTML = `
                <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#7f8c8d; font-size:15px; flex-direction:column; gap:10px; text-align:center; padding: 20px;">
                    <span style="font-size: 24px;">⚠️</span>
                    <strong>Подходящие файлы не найдены</strong>
                </div>
            `;
            return;
        }

        const projects = [...new Set(allNodes.map(node => node.id.split('/')[0]))];
        activeProjects.clear();
        projectColors = {};
        projectDirections = {};

        projects.forEach((proj, idx) => {
            activeProjects.add(proj);
            projectColors[proj] = projectColorsPool[idx % projectColorsPool.length];
            const angle = (2 * Math.PI * idx) / projects.length;
            projectDirections[proj] = { x: Math.cos(angle), y: Math.sin(angle) };
        });

        UI.buildProjectFilters(projects, projectColors, (project, isChecked) => {
            if (isChecked) {
                activeProjects.add(project);
            } else {
                activeProjects.delete(project);
            }
            nodesView.refresh();
            handleDeselect();
        });

        UI.initAutocomplete(allNodes);

        document.getElementById('loader-text').innerText = "Распределение элементов...";

        const connectedNodes = new Set();
        allEdges.forEach(e => {
            connectedNodes.add(e.from);
            connectedNodes.add(e.to);
        });

        const lonelyCounts = {};

        const formattedNodes = allNodes.map(node => {
            const project = node.id.split('/')[0];
            const isLonely = !connectedNodes.has(node.id);

            const direction = projectDirections[project] || { x: 0, y: 0 };
            const centerX = direction.x * currentProjDistance;
            const centerY = direction.y * currentProjDistance;

            let posX, posY;
            let isFixed = false;
            let usePhysics = true;

            if (isLonely) {
                if (lonelyCounts[project] === undefined) {
                    lonelyCounts[project] = 0;
                }
                const count = lonelyCounts[project];
                lonelyCounts[project]++;

                const colLimit = 7; 
                const col = count % colLimit;
                const row = Math.floor(count / colLimit);

                posX = centerX - 350 + (col * 125);
                posY = centerY + 450 + (row * 45); 

                isFixed = true;
                usePhysics = false;
            } else {
                const angle = Math.random() * Math.PI * 2;
                const radius = 80 + Math.random() * 200;
                posX = centerX + Math.cos(angle) * radius;
                posY = centerY + Math.sin(angle) * radius;
            }

            const projBorderColor = projectColors[project] || '#7f8c8d';
            const globalBgColor = getGlobalTypeColor(node.group);

            const baseFontSize = 10;
            const additionalSize = Math.min(Math.log(node.lines || 1) * 1.5, 8); 
            const finalFontSize = Math.round(baseFontSize + additionalSize);

            return {
                id: node.id,
                label: node.label,
                customGroup: node.group, 
                project: project,
                x: posX,
                y: posY,
                isLonely: isLonely,
                fixed: isFixed,
                physics: usePhysics,
                color: {
                    border: isLonely ? '#bdc3c7' : projBorderColor,
                    background: globalBgColor,
                    highlight: { background: globalBgColor, border: projBorderColor },
                    hover: { background: globalBgColor, border: projBorderColor }
                },
                font: {
                    size: finalFontSize,
                    color: projBorderColor,
                    face: 'monospace'
                },
                borderDashes: isLonely ? [4, 4] : false
            };
        });

        circularSet.clear();
        if (data.circular_edges) {
            data.circular_edges.forEach(edge => {
                circularSet.add(`<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mrow><mi>e</mi><mi>d</mi><mi>g</mi><mi>e</mi><mi mathvariant="normal">.</mi><mi>f</mi><mi>r</mi><mi>o</mi><mi>m</mi></mrow><mo>−</mo><mo>&gt;</mo></mrow><annotation encoding="application/x-tex">{edge.from}-&gt;</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height:0.8889em;vertical-align:-0.1944em;"></span><span class="mord"><span class="mord mathnormal">e</span><span class="mord mathnormal">d</span><span class="mord mathnormal" style="margin-right:0.03588em;">g</span><span class="mord mathnormal">e</span><span class="mord">.</span><span class="mord mathnormal" style="margin-right:0.10764em;">f</span><span class="mord mathnormal" style="margin-right:0.02778em;">r</span><span class="mord mathnormal">o</span><span class="mord mathnormal">m</span></span><span class="mord">−</span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">&gt;</span></span></span></span>{edge.to}`);
            });
        }

        const warningBox = document.getElementById('cycles-warning');
        const cyclesList = document.getElementById('cycles-list');
        if (data.circular_edges && data.circular_edges.length > 0) {
            warningBox.style.display = 'block';
            cyclesList.innerHTML = '';
            data.circular_edges.forEach(edge => {
                const div = document.createElement('div');
                div.style.padding = '3px 0';
                div.style.borderBottom = '1px dashed #f8b4b4';
                div.style.cursor = 'pointer';
                div.style.fontSize = '12px';
                div.innerText = `🔄 ${edge.from.split('/').pop()} ⇄ ${edge.to.split('/').pop()}`;
                div.title = `Циклическая связь:\nИз: ${edge.from}\nВ: ${edge.to}`;
                div.onclick = () => { selectAndFocus(edge.from); };
                cyclesList.appendChild(div);
            });
        } else {
            warningBox.style.display = 'none';
        }

        nodesDataSet = new vis.DataSet(formattedNodes);
        edgesDataSet = new vis.DataSet(allEdges.map(edge => {
            const edgeId = `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mrow><mi>e</mi><mi>d</mi><mi>g</mi><mi>e</mi><mi mathvariant="normal">.</mi><mi>f</mi><mi>r</mi><mi>o</mi><mi>m</mi></mrow><mo>−</mo><mo>&gt;</mo></mrow><annotation encoding="application/x-tex">{edge.from}-&gt;</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height:0.8889em;vertical-align:-0.1944em;"></span><span class="mord"><span class="mord mathnormal">e</span><span class="mord mathnormal">d</span><span class="mord mathnormal" style="margin-right:0.03588em;">g</span><span class="mord mathnormal">e</span><span class="mord">.</span><span class="mord mathnormal" style="margin-right:0.10764em;">f</span><span class="mord mathnormal" style="margin-right:0.02778em;">r</span><span class="mord mathnormal">o</span><span class="mord mathnormal">m</span></span><span class="mord">−</span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">&gt;</span></span></span></span>{edge.to}`;
            const isCircular = circularSet.has(edgeId);
            return {
                id: edgeId,
                from: edge.from,
                to: edge.to,
                arrows: 'to',
                color: { 
                    color: isCircular ? '#e74c3c' : '#bdc3c7', 
                    highlight: '#3498db' 
                },
                width: isCircular ? 3.5 : 1.5,
                title: isCircular ? '⚠️ Архитектурная петля (циклическая зависимость)' : ''
            };
        }));

        nodesView = new vis.DataView(nodesDataSet, {
            filter: (item) => {
                const belongsToProject = activeProjects.has(item.project);
                if (!belongsToProject) return false;

                if (orphanFilterMode === 'no-orphans') {
                    return !item.isLonely;
                } else if (orphanFilterMode === 'only-orphans') {
                    return item.isLonely;
                }
                return true;
            }
        });

        const container = document.getElementById('network');
        const options = {
            nodes: { shape: 'box', margin: 10, borderWidth: 2 },
            edges: { smooth: { type: 'cubicBezier', forceDirection: 'none', roundness: 0.6 } },
            physics: {
                enabled: true,
                solver: 'barnesHut',
                barnesHut: {
                    gravitationalConstant: -45000, 
                    centralGravity: 0.1,         
                    springLength: currentElemDistance * 1.5, 
                    springConstant: 0.04,
                    damping: 0.12,
                    avoidOverlap: 1               
                },
                stabilization: { enabled: true, iterations: 250, updateInterval: 25 }
            },
            interaction: { hover: true, tooltipDelay: 150 }
        };

        network = new vis.Network(container, { nodes: nodesView, edges: edgesDataSet }, options);

        network.on("stabilizationProgress", function(params) {
            const progress = Math.round((params.iterations / params.total) * 100);
            document.getElementById('loader-text').innerText = `Формирование орбит: ${progress}%`;
        });

        network.on("stabilizationIterationsDone", function() {
            document.getElementById('loader').style.display = 'none';
            network.setOptions({ physics: { enabled: false } });
            network.fit();
        });

        network.on("selectNode", (params) => handleSelect(params.nodes[0]));
        network.on("deselectNode", () => handleDeselect());

    } catch (err) {
        document.getElementById('loader-text').innerHTML = `
            <span style="color: #c0392b; font-size: 16px;">Ошибка загрузки графа</span><br>
            <small style="color: #7f8c8d; font-size: 12px; font-weight: normal; margin-top: 5px; display: block;">
                ${err.message}. Проверьте консоль браузера.
            </small>
        `;
        console.error("Ошибка инициализации Vis.js:", err);
    }
}

async function copyToClipboardAI(nodeId) {
    let files = [nodeId];

    const importItems = document.querySelectorAll('#list-imports .dep-list-item');
    const dependentItems = document.querySelectorAll('#list-dependents .dep-list-item');

    importItems.forEach(el => {
        const cb = el.querySelector('.dep-checkbox');
        const textEl = el.querySelector('.dep-text');
        if (cb && cb.checked && textEl) {
            const path = textEl.innerText.trim();
            if (path && !files.includes(path)) {
                files.push(path);
            }
        }
    });

    dependentItems.forEach(el => {
        const cb = el.querySelector('.dep-checkbox');
        const textEl = el.querySelector('.dep-text');
        if (cb && cb.checked && textEl) {
            const path = textEl.innerText.trim();
            if (path && !files.includes(path)) {
                files.push(path);
            }
        }
    });

    const btn = document.getElementById('btn-copy-ai');
    btn.disabled = true;
    const oldText = btn.innerText;
    btn.innerText = '📡 Сборка кода...';

    try {
        const response = await fetch('/api/export_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: files, node: nodeId })
        });

        if (response.ok) {
            const data = await response.json();
            await navigator.clipboard.writeText(data.text);

            btn.innerText = '✅ Скопировано в буфер!';
            btn.style.backgroundColor = '#27ae60';
            setTimeout(() => {
                btn.innerText = oldText;
                btn.style.backgroundColor = '#8e44ad';
                btn.disabled = false;
            }, 2000);
        } else {
            alert('Не удалось собрать контекст.');
            btn.innerText = oldText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error("Ошибка буфера обмена:", err);
        alert('Ошибка при копировании.');
        btn.innerText = oldText;
        btn.disabled = false;
    }
}

async function downloadExport(nodeId, mode) {
    let files = [nodeId];

    if (mode === 'all') {
        const importItems = document.querySelectorAll('#list-imports .dep-list-item');
        const dependentItems = document.querySelectorAll('#list-dependents .dep-list-item');

        importItems.forEach(el => {
            const cb = el.querySelector('.dep-checkbox');
            const textEl = el.querySelector('.dep-text');
            if (cb && cb.checked && textEl) {
                const path = textEl.innerText.trim();
                if (path && !files.includes(path)) {
                    files.push(path);
                }
            }
        });

        dependentItems.forEach(el => {
            const cb = el.querySelector('.dep-checkbox');
            const textEl = el.querySelector('.dep-text');
            if (cb && cb.checked && textEl) {
                const path = textEl.innerText.trim();
                if (path && !files.includes(path)) {
                    files.push(path);
                }
            }
        });
    }

    try {
        const response = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: files, node: nodeId })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export_${nodeId.replace(/\//g, '_')}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } else {
            alert('Не удалось сформировать файл экспорта.');
        }
    } catch (err) {
        console.error("Ошибка при экспорте:", err);
        alert('Ошибка при скачивании файла.');
    }
}

function changeElementDistance(newDistance) {
    currentElemDistance = parseInt(newDistance);
    document.getElementById('val-elem-dist').innerText = `${currentElemDistance}px`;

    if (!network) return;
    const gravity = -250 * currentElemDistance;

    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = "Пересчет геометрии файлов...";

    network.setOptions({
        physics: {
            enabled: true,
            barnesHut: {
                springLength: currentElemDistance * 1.5,
                gravitationalConstant: gravity
            }
        }
    });
    network.stabilize(180);
}

function changeProjectDistance(newDistance) {
    const nextD = parseInt(newDistance);
    document.getElementById('val-proj-dist').innerText = `${nextD}px`;

    if (!nodesDataSet) return;
    const scaleFactor = nextD / currentProjDistance;

    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = "Перемещение проектов...";

    const updates = nodesDataSet.get().map(node => {
        return {
            id: node.id,
            x: node.x * scaleFactor,
            y: node.y * scaleFactor
        };
    });

    nodesDataSet.update(updates);
    currentProjDistance = nextD;

    network.setOptions({ physics: { enabled: true } });
    network.stabilize(100);
}

function resetHighlighting() {
    if (dashAnimationInterval) {
        clearInterval(dashAnimationInterval);
        dashAnimationInterval = null;
    }

    if (highlightedNodes.length > 0) {
        const nodeReset = allNodes.map(node => ({
            id: node.id,
            opacity: 1.0,
            borderWidth: 2
        }));
        nodesDataSet.update(nodeReset);
        highlightedNodes = [];
    }

    if (highlightedEdges.length > 0) {
        const edgeReset = highlightedEdges.map(edgeId => {
            const isCircular = circularSet.has(edgeId);
            return {
                id: edgeId,
                color: { color: isCircular ? '#e74c3c' : '#bdc3c7' },
                width: isCircular ? 3.5 : 1.5,
                dashes: false
            };
        });
        edgesDataSet.update(edgeReset);
        highlightedEdges = [];
    }
}

function handleSelect(nodeId) {
    selectedNodeId = nodeId; 
    UI.updateSelectedInfo(nodeId);

    const upstream = new Set();
    const downstream = new Set();

    function findUpstream(node) {
        allEdges.forEach(e => {
            if (e.from === node && !upstream.has(e.to)) {
                upstream.add(e.to);
                findUpstream(e.to);
            }
        });
    }

    function findDownstream(node) {
        allEdges.forEach(e => {
            if (e.to === node && !downstream.has(e.from)) {
                downstream.add(e.from);
                findDownstream(e.from);
            }
        });
    }

    findUpstream(nodeId);
    findDownstream(nodeId);

    resetHighlighting();

    const nodeUpdate = [];
    allNodes.forEach(node => {
        let opacity = 0.15;
        let borderWidth = 2;

        if (node.id === nodeId || upstream.has(node.id) || downstream.has(node.id)) {
            opacity = 1.0;
            highlightedNodes.push(node.id);
        }
        if (node.id === nodeId) {
            borderWidth = 4;
        }

        nodeUpdate.push({ 
            id: node.id, 
            opacity: opacity, 
            borderWidth: borderWidth
        });
    });
    nodesDataSet.update(nodeUpdate);

    const edgeUpdate = [];
    const currentAnimateEdges = [];

    allEdges.forEach(edge => {
        const edgeId = `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mrow><mi>e</mi><mi>d</mi><mi>g</mi><mi>e</mi><mi mathvariant="normal">.</mi><mi>f</mi><mi>r</mi><mi>o</mi><mi>m</mi></mrow><mo>−</mo><mo>&gt;</mo></mrow><annotation encoding="application/x-tex">{edge.from}-&gt;</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height:0.8889em;vertical-align:-0.1944em;"></span><span class="mord"><span class="mord mathnormal">e</span><span class="mord mathnormal">d</span><span class="mord mathnormal" style="margin-right:0.03588em;">g</span><span class="mord mathnormal">e</span><span class="mord">.</span><span class="mord mathnormal" style="margin-right:0.10764em;">f</span><span class="mord mathnormal" style="margin-right:0.02778em;">r</span><span class="mord mathnormal">o</span><span class="mord mathnormal">m</span></span><span class="mord">−</span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">&gt;</span></span></span></span>{edge.to}`;
        let color = null;
        let width = null;
        let animate = false;

        if (edge.from === nodeId || (upstream.has(edge.from) && upstream.has(edge.to))) {
            color = '#e67e22';
            width = 2.5;
            animate = true;
        } else if (edge.to === nodeId || (downstream.has(edge.from) && downstream.has(edge.to))) {
            color = '#2980b9';
            width = 2.5;
            animate = true;
        }

        if (color) {
            edgeUpdate.push({ 
                id: edgeId, 
                color: { color: color }, 
                width: width,
                dashes: animate ? [5, 5] : false
            });
            highlightedEdges.push(edgeId);
            if (animate) {
                currentAnimateEdges.push({ id: edgeId, color: color });
            }
        }
    });
    edgesDataSet.update(edgeUpdate);

    if (currentAnimateEdges.length > 0) {
        let dashOffset = 0;
        dashAnimationInterval = setInterval(() => {
            dashOffset = (dashOffset + 2) % 16;
            const animUpdates = currentAnimateEdges.map(edge => {
                const p1 = Math.max(0.1, dashOffset);
                const p2 = 8;
                const p3 = Math.max(0.1, 16 - dashOffset);
                const p4 = 8;
                return {
                    id: edge.id,
                    dashes: [p1, p2, p3, p4]
                };
            });
            edgesDataSet.update(animUpdates);
        }, 80);
    }

    UI.renderDependencyLists(upstream, downstream, selectAndFocus);
}

function handleDeselect() {
    selectedNodeId = null; 
    UI.updateSelectedInfo(null);
    resetHighlighting();
}

function selectAndFocus(nodeId) {
    if (nodesDataSet.get(nodeId)) {
        network.selectNodes([nodeId]);
        handleSelect(nodeId);
        network.focus(nodeId, {
            scale: 1.1,
            animation: { duration: 500, easingFunction: 'easeInOutQuad' }
        });
    }
}
