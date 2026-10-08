"""
Модуль синтаксического анализа и разрешения межфайловых зависимостей.

Документация как код (Docs-as-Code):
- CodeDependencyParser выполняет:
    1. Синтаксический разбор AST для Python-модулей.
    2. Построчный регулярный разбор для JavaScript/TypeScript и Dart.
    3. Разрешение относительных путей, псевдонимов (aliases: @/, ~/) и абсолютных импортов.
    4. Инкрементальное кэширование на базе времени модификации (mtime).
    5. Расчёт топологических связей, поиск циклических зависимостей и построение подграфов (BFS).
"""

from __future__ import annotations

import ast
import json
import os
import re
import tempfile
from typing import Any, Dict, List, Optional, Set, Tuple


class DependencyEdge:
    """
    Представление направленной связи (ребра графа) между двумя файлами.

    Attributes:
        source (str): Канонический идентификатор файла-источника (<alias>/<rel_path>).
        target (str): Канонический идентификатор зависимого файла (<alias>/<rel_path>).
        edge_type (str): Тип связи:
            - 'import': стандартный импорт модуля.
            - 'from_import': импорт конкретных символов из модуля/пакета.
            - 're_export': реэкспорт символов наружу (export ... from ...).
            - 'dynamic': отложенный/динамический импорт (require(), import()).
        symbols (List[str]): Список конкретных импортируемых символов/функций/классов.
    """

    def __init__(
        self,
        source: str,
        target: str,
        edge_type: str = "import",
        symbols: Optional[List[str]] = None,
    ) -> None:
        self.source = source
        self.target = target
        self.edge_type = edge_type
        self.symbols = symbols or []

    def to_dict(self) -> Dict[str, Any]:
        """
        Сериализует ребро в контракт данных DTO для передачи клиенту (JSON API).
        """
        return {
            "from": self.source,
            "to": self.target,
            "type": self.edge_type,
            "symbols": self.symbols,
        }


class CodeDependencyParser:
    """
    Анализатор исходного кода и топологии зависимостей между файлами.

    Инварианты архитектуры:
    - Все файлы индексируются под уникальным `canonical_id` вида `<folder_alias>/<rel_path>`.
    - Все разделители путей нормализуются в POSIX-формат ('/').
    - Кэш синхронизируется на диске и отслеживает `mtime` каждого файла.
    """

    def __init__(self, roots: Optional[List[str]] = None) -> None:
        """
        Инициализация парсера.

        Args:
            roots: Список абсолютных путей к корневым каталогам проектов.
        """
        self.roots: List[str] = [os.path.abspath(r) for r in (roots or []) if os.path.exists(r)]
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[DependencyEdge] = []
        self.cache_file = os.path.join(os.path.dirname(__file__), "cache.json")
        self.cache: Dict[str, Any] = self._load_cache()

    def set_roots(self, roots: List[str]) -> None:
        """
        Обновляет перечень активных корневых каталогов для последующего сканирования.
        """
        self.roots = [os.path.abspath(r) for r in roots if os.path.exists(r)]

    def _load_cache(self) -> Dict[str, Any]:
        """
        Загружает кэш mtime и метаданных файлов из локального JSON-файла.
        При повреждении или отсутствии файла возвращает пустую структуру.
        """
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and "files" in data:
                        return data
            except Exception:
                pass
        return {"files": {}}

    def _save_cache(self) -> None:
        """
        Атомарно сохраняет кэш на диск через запись во временный файл
        с последующим переименованием во избежание повреждения данных (race condition / crash).
        """
        try:
            cache_dir = os.path.dirname(self.cache_file)
            with tempfile.NamedTemporaryFile("w", dir=cache_dir, delete=False, encoding="utf-8") as tf:
                json.dump(self.cache, tf, indent=2, ensure_ascii=False)
                temp_name = tf.name
            os.replace(temp_name, self.cache_file)
        except Exception:
            pass

    def get_parent_directory_group(self, canonical_id: str) -> str:
        """
        Определяет путь виртуальной родительской папки для группировки в UI (кластеры папок).

        Args:
            canonical_id: Идентификатор файла, например: 'my-project/src/api/routes.py'.

        Returns:
            Канонический путь к каталогу: 'my-project/src/api'.
        """
        dirname = os.path.dirname(canonical_id).replace("\\", "/")
        return dirname if dirname else "root"

    def _extract_py_entities_and_imports(
        self, filepath: str
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """
        Выполняет AST-анализ Python-файла:
        - Извлекает публичные классы и функции (экспорты).
        - Извлекает прямые импорты (`import os`, `import a.b as c`).
        - Извлекает относительные и абсолютные `from ... import ...` с фиксацией глубины (`level`).
        """
        imports: List[Dict[str, Any]] = []
        exports: List[str] = []

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            tree = ast.parse(content, filename=filepath)

            for node in ast.walk(tree):
                # 1. Извлечение публичных сущностей (без ведущего подчеркивания)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    if not node.name.startswith("_"):
                        exports.append(node.name)

                # 2. Обработка обычного импорта: `import foo.bar as baz`
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        imports.append({
                            "module": alias.name,
                            "type": "import",
                            "symbol": alias.asname or alias.name,
                            "level": 0,
                            "symbols": [alias.asname or alias.name],
                        })

                # 3. Обработка блочного импорта: `from ...foo import bar, baz`
                elif isinstance(node, ast.ImportFrom):
                    mod_name = node.module or ""
                    # Восстанавливаем точки относительности: level=1 -> '.', level=2 -> '..'
                    dots = "." * (node.level or 0)
                    full_module_str = f"{dots}{mod_name}" if dots else mod_name

                    imported_symbols = [a.name for a in node.names]
                    imports.append({
                        "module": full_module_str,
                        "raw_module": mod_name,
                        "type": "from_import",
                        "symbols": imported_symbols,
                        "level": node.level or 0,
                    })
        except Exception:
            # Если файл содержит синтаксические ошибки, возвращаем то, что удалось найти
            pass

        return imports, exports

    def _extract_js_ts_entities_and_imports(
        self, filepath: str
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """
        Выполняет регулярный синтаксический анализ JavaScript и TypeScript файлов:
        - Распознает ESM импорты: `import ... from '...'`
        - Распознает реэкспорты: `export { x } from '...'` и `export * from '...'`
        - Распознает динамические вызовы: `require('...')` и `import('...')`
        - Извлекает имена экспортируемых функций, классов, констант и типов.
        """
        imports: List[Dict[str, Any]] = []
        exports: List[str] = []

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    # Игнорируем экстремально длинные минифицированные строки
                    if len(line) > 1500:
                        continue
                    line = line.strip()

                    # 1. Реэкспорт: `export * from './module'` или `export { A } from './module'`
                    re_exp = re.search(r'export\s+(?:\{[^}]*\}|\*)\s+from\s+[\'"]([^\'"]+)[\'"]', line)
                    if re_exp:
                        imports.append({"module": re_exp.group(1), "type": "re_export", "symbols": []})
                        continue

                    # 2. ESM импорт: `import { X } from './module'` или `import Default from 'mod'`
                    imp_m = re.search(r'import\s+(?:[\w\s{},*]+from\s+)?[\'"]([^\'"]+)[\'"]', line)
                    if imp_m:
                        imports.append({"module": imp_m.group(1), "type": "import", "symbols": []})
                        continue

                    # 3. Dynamic import / CommonJS require: `require('./module')` или `import('./module')`
                    dyn_m = re.search(r'(?:require|import)\([\'"]([^\'"]+)[\'"]\)', line)
                    if dyn_m:
                        imports.append({"module": dyn_m.group(1), "type": "dynamic", "symbols": []})
                        continue

                    # 4. Декларации экспорта: `export const foo = ...`, `export function bar()`, `export class Baz`
                    exp_sym = re.search(
                        r'export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)',
                        line,
                    )
                    if exp_sym:
                        exports.append(exp_sym.group(1))
        except Exception:
            pass

        return imports, exports

    def _extract_dart_entities_and_imports(
        self, filepath: str
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """
        Выполняет регулярный синтаксический анализ для файлов языка Dart:
        - Распознает директивы: `import 'package:...';`, `import 'relative.dart';`
        - Распознает связывание частей: `part 'model.g.dart';` и `part of '...';`
        - Распознает реэкспорты: `export '...';`
        """
        imports: List[Dict[str, Any]] = []
        exports: List[str] = []

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if len(line) > 1200:
                        continue
                    line = line.strip()

                    # 1. Директивы зависимостей Dart
                    dart_match = re.search(r'^(?:import|export|part)\s+[\'"]([^\'"]+)[\'"]', line)
                    if dart_match:
                        raw_target = dart_match.group(1)
                        edge_type = "re_export" if line.startswith("export") else "import"
                        imports.append({"module": raw_target, "type": edge_type, "symbols": []})
                        continue

                    # 2. Экспорты классов, миксинов и расширений
                    cls_match = re.search(r'^(?:abstract\s+)?(?:class|mixin|extension|enum)\s+([A-Za-z0-9_]+)', line)
                    if cls_match:
                        exports.append(cls_match.group(1))
        except Exception:
            pass

        return imports, exports

    def resolve_import_path(
        self,
        current_file_path: str,
        import_meta: Dict[str, Any],
        root_dir: str,
        alias: str,
    ) -> Optional[str]:
        """
        Разрешает спецификатор импорта в конкретный файл на диске с учетом языка.

        Поддерживаемые стратегии:
        1. Относительные пути Python с учетом `level` (уровня вложенности точек).
        2. Относительные пути JS/TS/Dart (`./utils`, `../models`).
        3. Webpack/Vite/TS псевдонимы корневой папки (`@/` и `~/`).
        4. Абсолютные модульные импорты внутри проекта (`core.config` -> `<root>/core/config.py`).
        5. Автоподстановка индексных файлов (`index.ts`, `index.js`, `__init__.py`).

        Returns:
            Канонический идентификатор файла в графе (`<alias>/<relative_path>`) или None.
        """
        module_str = import_meta.get("module", "")
        level = import_meta.get("level", 0)

        # Если модуль пустой и нет относительного перехода — импорт невозможно разрешить
        if not module_str and level == 0:
            return None

        current_dir = os.path.dirname(current_file_path)

        # =========================================================================
        # 1. Разрешение относительных импортов Python (когда указан level > 0)
        # =========================================================================
        if level > 0:
            # level=1 означает текущий пакет (текущую папку)
            # level=2 означает подняться на один уровень выше и т.д.
            base_dir = current_dir
            for _ in range(max(0, level - 1)):
                base_dir = os.path.dirname(base_dir)

            raw_mod = import_meta.get("raw_module", "").strip()

            # Случай А: `from . import foo` (raw_module пустой, целевой модуль берется из symbols)
            if not raw_mod:
                symbols = import_meta.get("symbols", [])
                for sym in symbols:
                    candidate_file = os.path.join(base_dir, f"{sym}.py")
                    if os.path.isfile(candidate_file):
                        rel = os.path.relpath(candidate_file, root_dir).replace("\\", "/")
                        return f"{alias}/{rel}"

                    candidate_pkg = os.path.join(base_dir, sym, "__init__.py")
                    if os.path.isfile(candidate_pkg):
                        rel = os.path.relpath(candidate_pkg, root_dir).replace("\\", "/")
                        return f"{alias}/{rel}"

                # Если это был импорт из самого текущего пакета `__init__.py`
                init_cand = os.path.join(base_dir, "__init__.py")
                if os.path.isfile(init_cand) and init_cand != current_file_path:
                    rel = os.path.relpath(init_cand, root_dir).replace("\\", "/")
                    return f"{alias}/{rel}"

            # Случай Б: `from .submodule import bar` или `from ..core.db import Session`
            else:
                py_parts = raw_mod.split(".")
                candidates = [
                    os.path.join(base_dir, *py_parts) + ".py",
                    os.path.join(base_dir, *py_parts, "__init__.py"),
                ]
                for cand in candidates:
                    if os.path.isfile(cand):
                        rel = os.path.relpath(cand, root_dir).replace("\\", "/")
                        return f"{alias}/{rel}"

            return None

        # =========================================================================
        # 2. Относительные импорты JS / TS / Dart (начинающиеся с точки: ./ или ../)
        # =========================================================================
        if module_str.startswith("."):
            target_candidate = os.path.abspath(os.path.join(current_dir, module_str))
            search_extensions = [
                "",
                ".ts",
                ".tsx",
                ".d.ts",
                ".js",
                ".jsx",
                ".dart",
                ".py",
                "/index.ts",
                "/index.tsx",
                "/index.js",
                "/index.jsx",
                "/__init__.py",
            ]
            for ext in search_extensions:
                test_path = target_candidate + ext
                if os.path.isfile(test_path):
                    rel = os.path.relpath(test_path, root_dir).replace("\\", "/")
                    return f"{alias}/{rel}"
            return None

        # =========================================================================
        # 3. Алиасы корневых папок фронтенда (@/ и ~/)
        # =========================================================================
        if module_str.startswith("@/") or module_str.startswith("~/"):
            sub_path = module_str[2:]
            search_dirs = [
                os.path.join(root_dir, "src", sub_path),
                os.path.join(root_dir, sub_path),
            ]
            search_extensions = [
                "",
                ".ts",
                ".tsx",
                ".d.ts",
                ".js",
                ".jsx",
                "/index.ts",
                "/index.tsx",
                "/index.js",
                "/index.jsx",
            ]
            for base in search_dirs:
                for ext in search_extensions:
                    test_path = base + ext
                    if os.path.isfile(test_path):
                        rel = os.path.relpath(test_path, root_dir).replace("\\", "/")
                        return f"{alias}/{rel}"
            return None

        # =========================================================================
        # 4. Абсолютные внутрипроектные импорты Python (например: `core.database`)
        # =========================================================================
        py_parts = module_str.split(".")
        py_candidates = [
            os.path.join(root_dir, *py_parts) + ".py",
            os.path.join(root_dir, *py_parts, "__init__.py"),
            os.path.join(root_dir, "src", *py_parts) + ".py",
            os.path.join(root_dir, "src", *py_parts, "__init__.py"),
            os.path.join(current_dir, *py_parts) + ".py",
            os.path.join(current_dir, *py_parts, "__init__.py"),
        ]
        for cand in py_candidates:
            if os.path.isfile(cand):
                rel = os.path.relpath(cand, root_dir).replace("\\", "/")
                return f"{alias}/{rel}"

        # =========================================================================
        # 5. Специфичные Dart-импорты по короткому имени файла
        # =========================================================================
        if module_str.endswith(".dart"):
            fname = os.path.basename(module_str)
            for cand_dir in [root_dir, os.path.join(root_dir, "lib")]:
                test_path = os.path.join(cand_dir, fname)
                if os.path.isfile(test_path):
                    rel = os.path.relpath(test_path, root_dir).replace("\\", "/")
                    return f"{alias}/{rel}"

        return None

    def scan(
        self,
        exclude_dirs: Optional[List[str]] = None,
        allowed_extensions: Optional[List[str]] = None,
        exclude_files: Optional[List[str]] = None,
    ) -> None:
        """
        Выполняет инкрементальное сканирование всех зарегистрированных корней проектов:
        - Обходит каталоги с фильтрацией системных и сборочных директорий.
        - Использует кэш mtime, повторно парсит только изменившиеся файлы.
        - Удаляет из кэша стёртые файлы.
        - Строит узлы (`self.nodes`) и связывает их ребрами (`self.edges`).
        """
        self.nodes = {}
        self.edges = []

        ex_dirs = set(exclude_dirs or [
            "node_modules", ".next", ".git", "venv", ".venv", "env", "build",
            ".dart_tool", "__pycache__", "dist", ".gradle", "ios", "android",
            ".idea", ".vscode", "coverage"
        ])
        extensions = set(allowed_extensions or [
            ".js", ".jsx", ".ts", ".tsx", ".py", ".dart"
        ])
        ex_files = set(exclude_files or [
            "freezed.dart", ".g.dart", ".min.js"
        ])

        scanned_canonical_ids: Set[str] = set()

        # -------------------------------------------------------------------------
        # ШАГ 1: Поиск и индексация узлов файлов
        # -------------------------------------------------------------------------
        for root in self.roots:
            alias = os.path.basename(root.rstrip("/\\")) or "root"

            for dirpath, dirnames, filenames in os.walk(root):
                # Исключаем служебные каталоги из дальнейшего обхода
                dirnames[:] = [d for d in dirnames if d not in ex_dirs and not d.startswith(".")]

                for fname in filenames:
                    # Проверка паттернов исключения файлов
                    if any(pat in fname for pat in ex_files):
                        continue

                    _, ext = os.path.splitext(fname)
                    if ext not in extensions:
                        continue

                    full_path = os.path.abspath(os.path.join(dirpath, fname))
                    rel_to_root = os.path.relpath(full_path, root).replace("\\", "/")
                    canonical_id = f"{alias}/{rel_to_root}"
                    scanned_canonical_ids.add(canonical_id)

                    try:
                        mtime = os.path.getmtime(full_path)
                    except OSError:
                        mtime = 0.0

                    # Проверка валидности mtime в кэше
                    cached_entry = self.cache.get("files", {}).get(canonical_id)
                    if cached_entry and cached_entry.get("mtime") == mtime:
                        self.nodes[canonical_id] = cached_entry["data"]
                        continue

                    # Подсчет количества строк кода (LOC)
                    lines_count = 0
                    try:
                        with open(full_path, "rb") as f:
                            lines_count = sum(1 for _ in f)
                    except OSError:
                        pass

                    # Парсинг в зависимости от расширения
                    if ext == ".py":
                        raw_imports, exports = self._extract_py_entities_and_imports(full_path)
                    elif ext in [".js", ".jsx", ".ts", ".tsx"]:
                        raw_imports, exports = self._extract_js_ts_entities_and_imports(full_path)
                    elif ext == ".dart":
                        raw_imports, exports = self._extract_dart_entities_and_imports(full_path)
                    else:
                        raw_imports, exports = [], []

                    # Формирование полезной нагрузки узла
                    node_payload = {
                        "id": canonical_id,
                        "label": fname,
                        "parent": self.get_parent_directory_group(canonical_id),
                        "project": alias,
                        "root": root,  # Фиксируем точный корневой путь для резолвера
                        "path": full_path,
                        "ext": ext,
                        "lines": lines_count,
                        "exports": exports,
                        "raw_imports": raw_imports,
                    }

                    self.nodes[canonical_id] = node_payload
                    self.cache.setdefault("files", {})[canonical_id] = {
                        "mtime": mtime,
                        "data": node_payload,
                    }

        # -------------------------------------------------------------------------
        # Очистка кэша от удаленных с диска файлов
        # -------------------------------------------------------------------------
        cached_files = self.cache.get("files", {})
        stale_keys = [k for k in cached_files if k not in scanned_canonical_ids]
        for k in stale_keys:
            del cached_files[k]

        self._save_cache()

        # -------------------------------------------------------------------------
        # ШАГ 2: Разрешение топологических межфайловых связей (рёбер)
        # -------------------------------------------------------------------------
        for node_id, info in self.nodes.items():
            current_root = info.get("root")
            if not current_root or not os.path.exists(current_root):
                continue
            alias = info.get("project", "root")

            for imp in info.get("raw_imports", []):
                target_id = self.resolve_import_path(
                    current_file_path=info["path"],
                    import_meta=imp,
                    root_dir=current_root,
                    alias=alias,
                )

                # Добавляем ребро только если целевой файл найден в графе и нет петли на себя
                if target_id and target_id in self.nodes and target_id != node_id:
                    self.edges.append(
                        DependencyEdge(
                            source=node_id,
                            target=target_id,
                            edge_type=imp.get("type", "import"),
                            symbols=imp.get("symbols", []),
                        )
                    )

    def find_circular_dependencies(self) -> List[Dict[str, str]]:
        """
        Выполняет поиск циклических зависимостей (архитектурных петель) в графе
        с помощью алгоритма поиска циклов на базе поиска в глубину (DFS).

        Returns:
            Список словарей ребер, входящих в циклы: [{'from': 'A', 'to': 'B'}, ...]
        """
        adj: Dict[str, List[str]] = {n: [] for n in self.nodes}
        for edge in self.edges:
            adj[edge.source].append(edge.target)

        visited: Set[str] = set()
        stack: Set[str] = set()
        path: List[str] = []
        cycles: Set[Tuple[str, str]] = set()

        def dfs(node: str) -> None:
            visited.add(node)
            stack.add(node)
            path.append(node)

            for neighbor in adj.get(node, []):
                # Если сосед уже в текущем стеке рекурсии — обнаружен цикл
                if neighbor in stack:
                    cycle_start_idx = path.index(neighbor)
                    cycle_nodes = path[cycle_start_idx:]
                    for i in range(len(cycle_nodes)):
                        u = cycle_nodes[i]
                        v = cycle_nodes[(i + 1) % len(cycle_nodes)]
                        cycles.add((u, v))
                elif neighbor not in visited:
                    dfs(neighbor)

            stack.remove(node)
            path.pop()

        for node in self.nodes:
            if node not in visited:
                dfs(node)

        return [{"from": u, "to": v} for u, v in cycles]

    def extract_investigation_subgraph(
        self, pivots: List[str], depth: int = 1, direction: str = "both"
    ) -> Dict[str, Any]:
        """
        Формирует сфокусированный локальный подграф расследования.

        Алгоритм:
        Двунаправленный обход в ширину (BFS) с контролем радиуса трассировки (depth metric).

        Args:
            pivots: Список файлов, находящихся в центре расследования.
            depth: Радиус связности (1 — прямые связи, 2 — связи соседей и т.д.).
            direction:
                - 'both': входящие и исходящие связи.
                - 'upstream': только кого импортирует текущий узел (зависимости).
                - 'downstream': только кто импортирует текущий узел (использующие файлы).

        Returns:
            Словарь с узлами, ребрами и уникальными родительскими директориями подграфа.
        """
        valid_pivots = [p for p in pivots if p in self.nodes]
        if not valid_pivots:
            return {"nodes": [], "edges": [], "parent_groups": [], "pivots": []}

        # Индексация смежности для быстрого O(1) поиска соседей
        upstream_adj: Dict[str, Set[DependencyEdge]] = {n: set() for n in self.nodes}
        downstream_adj: Dict[str, Set[DependencyEdge]] = {n: set() for n in self.nodes}

        for edge in self.edges:
            upstream_adj[edge.source].add(edge)
            downstream_adj[edge.target].add(edge)

        matched_nodes: Set[str] = set(valid_pivots)
        matched_edges: Set[DependencyEdge] = set()

        # 1. BFS по исходящим связям (Imports / Upstream)
        if direction in ("both", "upstream"):
            frontier = set(valid_pivots)
            for _ in range(depth):
                next_frontier = set()
                for curr in frontier:
                    for e in upstream_adj.get(curr, set()):
                        matched_nodes.add(e.target)
                        matched_edges.add(e)
                        next_frontier.add(e.target)
                frontier = next_frontier

        # 2. BFS по входящим связям (Dependents / Downstream)
        if direction in ("both", "downstream"):
            frontier = set(valid_pivots)
            for _ in range(depth):
                next_frontier = set()
                for curr in frontier:
                    for e in downstream_adj.get(curr, set()):
                        matched_nodes.add(e.source)
                        matched_edges.add(e)
                        next_frontier.add(e.source)
                frontier = next_frontier

        # Сбор родительских папок для правильного рендеринга визуальных кластеров
        parents: Set[str] = set()
        nodes_result = []
        for n_id in matched_nodes:
            node_data = self.nodes[n_id]
            nodes_result.append(node_data)
            parents.add(node_data["parent"])

        return {
            "pivots": valid_pivots,
            "nodes": nodes_result,
            "edges": [e.to_dict() for e in matched_edges],
            "parent_groups": sorted(list(parents)),
        }