"""
Модуль статического анализа зависимостей исходного кода.

Обеспечивает парсинг зависимостей, разрешение путей импортов,
инкрементальное mtime-кэширование, дедупликацию связей и детекцию циклов.
"""

import os
import re
import ast
import json
import threading
from typing import Dict, List, Set, Tuple, Optional, Any


class CodeDependencyParser:
    """
    Парсер и анализатор графа межфайловых зависимостей проектов.

    :ivar root_dir: Базовая директория сканирования (обычно /projects).
    :vartype root_dir: str
    :ivar cache_file: Абсолютный путь к файлу персистентного кэша.
    :vartype cache_file: str
    :ivar nodes: Словарь метаданных узлов графа с ключом rel_path.
    :vartype nodes: Dict[str, Dict[str, Any]]
    :ivar edges: Список ориентированных дуг графа (from -> to).
    :vartype edges: List[Dict[str, str]]
    :ivar cache: Содержимое кэша метаданных файлов.
    :vartype cache: Dict[str, Any]
    """

    def __init__(
        self, 
        root_dir: Optional[str] = None, 
        cache_file: Optional[str] = None
    ) -> None:
        """
        Инициализирует парсер зависимостей.

        :param root_dir: Корневой путь к каталогу с проектами. Если None,
            считывается переменная окружения CODE_DIR (по умолчанию '/projects').
        :type root_dir: Optional[str]
        :param cache_file: Пользовательский путь к cache.json.
        :type cache_file: Optional[str]
        """
        if root_dir is None:
            root_dir = os.getenv("CODE_DIR", "/projects")
        self.root_dir: str = os.path.abspath(root_dir)
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, str]] = []
        self._lock: threading.Lock = threading.Lock()
        
        if cache_file:
            self.cache_file = os.path.abspath(cache_file)
        else:
            data_dir = os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
            os.makedirs(data_dir, exist_ok=True)
            self.cache_file = os.path.join(data_dir, "cache.json")
            
        self.cache: Dict[str, Any] = self._load_cache()

    def _normalize_path(self, path_str: str) -> str:
        """
        Нормализует путь к файлу, заменяя обратные слеши Windows на прямые.

        :param path_str: Путь к файлу.
        :type path_str: str
        :return: Нормализованный путь с разделителями '/'.
        :rtype: str
        """
        return path_str.replace('\\', '/')

    def _load_cache(self) -> Dict[str, Any]:
        """
        Загружает cache.json с диска.

        :return: Десериализованный словарь кэша или пустая структура при ошибке.
        :rtype: Dict[str, Any]
        """
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {"files": {}}

    def _save_cache(self) -> None:
        """
        Сохраняет текущее состояние кэша на диск.

        :raises OSError: При ошибках ввода-вывода (подавляется с выводом в лог).
        """
        try:
            os.makedirs(os.path.dirname(self.cache_file), exist_ok=True)
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Ошибка сохранения кэша: {e}")

    def get_group(self, filepath: str) -> str:
        """
        Определяет архитектурный слой (группу) файла на основе сегментов пути.

        :param filepath: Полный или относительный путь к файлу.
        :type filepath: str
        :return: Идентификатор слоя в формате "проект/маркер/подгруппа" или имя проекта.
        :rtype: str
        """
        rel_path = self._normalize_path(os.path.relpath(filepath, self.root_dir))
        parts = rel_path.split('/')
        
        if len(parts) > 1:
            project_prefix = parts[0]
            for marker in ['screens', 'pages', 'features', 'services', 'components', 'app', 'controllers', 'routes']:
                if marker in parts:
                    idx = parts.index(marker)
                    if idx + 1 < len(parts):
                        return f"{project_prefix}/{marker}/{parts[idx+1]}"
            return project_prefix
        return "root"

    def resolve_js_path(self, current_file: str, import_str: str) -> Optional[str]:
        """
        Разрешает пути JavaScript / TypeScript импортов (относительные и префикс '@/').

        :param current_file: Абсолютный путь к исходному файлу.
        :type current_file: str
        :param import_str: Строка спецификатора импорта.
        :type import_str: str
        :return: Относительный нормализованный путь к целевому файлу или None.
        :rtype: Optional[str]
        """
        if not import_str:
            return None
        
        rel_to_root = self._normalize_path(os.path.relpath(current_file, self.root_dir))
        project_folder = rel_to_root.split('/')[0]
        project_root = os.path.join(self.root_dir, project_folder)

        if import_str.startswith('@/'):
            base_search_src = os.path.join(project_root, 'src', import_str[2:])
            base_search_root = os.path.join(project_root, import_str[2:])
            if os.path.exists(base_search_src) or os.path.exists(os.path.dirname(base_search_src)):
                base_search = base_search_src
            else:
                base_search = base_search_root
        elif import_str.startswith('.') or import_str.startswith('..'):
            base_search = os.path.abspath(os.path.join(os.path.dirname(current_file), import_str))
        else:
            return None

        extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']
        for ext in extensions:
            test_path = base_search + ext
            if os.path.exists(test_path) and os.path.isfile(test_path):
                return self._normalize_path(os.path.relpath(test_path, self.root_dir))
        return None

    def resolve_py_path(self, current_file: str, import_parts: Tuple[Optional[str], Optional[str]]) -> Optional[str]:
        """
        Сопоставляет импорты Python с физическими модулями на диске.

        :param current_file: Абсолютный путь к исходному файлу.
        :type current_file: str
        :param import_parts: Кортеж (module, name).
        :type import_parts: Tuple[Optional[str], Optional[str]]
        :return: Относительный нормализованный путь к файлу Python или пакету.
        :rtype: Optional[str]
        """
        module_str = import_parts[0] or import_parts[1]
        if not module_str:
            return None
            
        parts = module_str.split('.')
        rel_to_root = self._normalize_path(os.path.relpath(current_file, self.root_dir))
        project_folder = rel_to_root.split('/')[0]
        project_root = os.path.join(self.root_dir, project_folder)

        possible_paths = [
            os.path.join(os.path.dirname(current_file), *parts) + '.py',
            os.path.join(project_root, *parts) + '.py',
            os.path.join(project_root, *parts, '__init__.py')
        ]
        for path in possible_paths:
            if os.path.exists(path) and os.path.isfile(path):
                return self._normalize_path(os.path.relpath(path, self.root_dir))
        return None

    def resolve_dart_path(self, current_file: str, import_str: str) -> Optional[str]:
        """
        Разрешает пути зависимостей Dart и Flutter.

        :param current_file: Абсолютный путь к dart-файлу.
        :type current_file: str
        :param import_str: Строка импорта.
        :type import_str: str
        :return: Относительный нормализованный путь к файлу или None.
        :rtype: Optional[str]
        """
        if not import_str or import_str.startswith('package:flutter/') or import_str.startswith('dart:'):
            return None
            
        rel_to_root = self._normalize_path(os.path.relpath(current_file, self.root_dir))
        project_folder = rel_to_root.split('/')[0]
        project_root = os.path.join(self.root_dir, project_folder)

        if not import_str.startswith('package:'):
            target_path = os.path.abspath(os.path.join(os.path.dirname(current_file), import_str))
            if os.path.exists(target_path):
                return self._normalize_path(os.path.relpath(target_path, self.root_dir))
        else:
            parts = import_str.replace('package:', '').split('/')
            if len(parts) > 1:
                test_path = os.path.join(project_root, 'lib', *parts[1:])
                if os.path.exists(test_path):
                    return self._normalize_path(os.path.relpath(test_path, self.root_dir))
        return None

    def _extract_py_imports_ast(self, filepath: str) -> List[str]:
        """
        Извлекает импорты Python с помощью встроенного AST.

        :param filepath: Полный путь к файлу Python.
        :type filepath: str
        :return: Список уникальных импортированных модулей.
        :rtype: List[str]
        """
        imports: List[str] = []
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            tree = ast.parse(content, filename=filepath)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imports.append(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        imports.append(node.module)
        except Exception:
            return self._extract_imports_from_file_line(filepath, '.py')
        return list(dict.fromkeys(imports))

    def _extract_imports_from_file_line(self, filepath: str, ext: str) -> List[str]:
        """
        Построчный регулярный парсинг импортов для JS, TS, Dart и fallback для Python.

        :param filepath: Полный путь к файлу.
        :type filepath: str
        :param ext: Расширение файла.
        :type ext: str
        :return: Список строк-спецификаторов импорта.
        :rtype: List[str]
        """
        imports: List[str] = []
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    if len(line) > 1000:
                        continue
                    line = line.strip()
                    if not line:
                        continue

                    if ext in ['.js', '.jsx', '.ts', '.tsx']:
                        req_m = re.search(r'require\([\'"]([^\'"]+)[\'"]\)', line)
                        if req_m:
                            imports.append(req_m.group(1))
                            continue
                        if ('import' in line or 'export' in line) and 'from' in line:
                            from_m = re.search(r'from\s+[\'"]([^\'"]+)[\'"]', line)
                            if from_m:
                                imports.append(from_m.group(1))

                    elif ext == '.py':
                        if line.startswith('from '):
                            m = re.match(r'^from\s+([\w\.]+)\s+import', line)
                            if m: imports.append(m.group(1))
                        elif line.startswith('import '):
                            m = re.match(r'^import\s+([\w\.,\s]+)', line)
                            if m:
                                for part in m.group(1).split(','):
                                    imports.append(part.strip())

                    elif ext == '.dart':
                        if 'import' in line or 'part' in line or 'export' in line:
                            m = re.search(r'(?:import|part|export)\s+[\'"]([^\'"]+)[\'"]', line)
                            if m:
                                imports.append(m.group(1))
        except Exception as e:
            print(f"Ошибка построчного парсинга {filepath}: {e}")
        return list(dict.fromkeys(imports))

    def scan(
        self, 
        exclude_dirs_list: Optional[List[str]] = None, 
        extensions_list: Optional[List[str]] = None, 
        exclude_files_list: Optional[List[str]] = None,
        target_dirs: Optional[List[str]] = None
    ) -> None:
        """
        Выполняет потокобезопасное mtime-сканирование указанных директорий проектов.
        Автоматически дедуплицирует ребра и нормализует пути.

        :param exclude_dirs_list: Папки для исключения из обхода.
        :type exclude_dirs_list: Optional[List[str]]
        :param extensions_list: Разрешенные расширения файлов.
        :type extensions_list: Optional[List[str]]
        :param exclude_files_list: Подстроки имен файлов для пропуска.
        :type exclude_files_list: Optional[List[str]]
        :param target_dirs: Список выбранных каталогов проектов (относительно root_dir).
        :type target_dirs: Optional[List[str]]
        :return: None.
        """
        with self._lock:
            self.nodes = {}
            self.edges = []
            
            exclude_dirs = set(exclude_dirs_list) if exclude_dirs_list else {
                'node_modules', '.next', '.git', 'venv', 'env', 
                'build', '.dart_tool', '__pycache__', 'dist', '.gradle', 'ios', 'android', 'l10n'
            }
            allowed_extensions = set(extensions_list) if extensions_list else {
                '.js', '.jsx', '.ts', '.tsx', '.py', '.dart'
            }
            exclude_files = [f.strip() for f in exclude_files_list if f.strip()] if exclude_files_list else ['freezed.dart', '.g.dart']

            scan_roots: List[str] = []
            if target_dirs:
                clean_targets = list(dict.fromkeys([d.strip() for d in target_dirs if d and d.strip()]))
                for td in clean_targets:
                    target_path = os.path.join(self.root_dir, td)
                    if os.path.exists(target_path) and os.path.isdir(target_path):
                        scan_roots.append(target_path)
            
            if not scan_roots:
                scan_roots = [self.root_dir]

            # Шаг 1: Обход файлов
            for base_path in scan_roots:
                for root, dirs, files in os.walk(base_path):
                    dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
                    for file in files:
                        should_skip = False
                        for pattern in exclude_files:
                            if pattern in file:
                                should_skip = True
                                break
                        if should_skip:
                            continue

                        ext = os.path.splitext(file)[1]
                        if ext in allowed_extensions:
                            full_path = os.path.join(root, file)
                            rel_path = self._normalize_path(os.path.relpath(full_path, self.root_dir))
                            
                            try:
                                mtime = os.path.getmtime(full_path)
                            except Exception:
                                mtime = 0.0

                            cached = self.cache["files"].get(rel_path)
                            if cached and cached.get("mtime") == mtime:
                                self.nodes[rel_path] = {
                                    "id": rel_path,
                                    "label": file,
                                    "group": cached["group"],
                                    "path": full_path,
                                    "ext": ext,
                                    "lines": cached["lines"],
                                    "raw_imports": cached["raw_imports"]
                                }
                                continue

                            lines_count = 0
                            try:
                                with open(full_path, 'rb') as f:
                                    lines_count = sum(1 for _ in f)
                            except Exception:
                                pass

                            if ext == '.py':
                                raw_imports = self._extract_py_imports_ast(full_path)
                            else:
                                raw_imports = self._extract_imports_from_file_line(full_path, ext)

                            node_data = {
                                "id": rel_path,
                                "label": file,
                                "group": self.get_group(full_path),
                                "path": full_path,
                                "ext": ext,
                                "lines": lines_count,
                                "raw_imports": raw_imports
                            }
                            
                            self.nodes[rel_path] = node_data
                            self.cache["files"][rel_path] = {
                                "mtime": mtime,
                                "lines": lines_count,
                                "group": node_data["group"],
                                "raw_imports": raw_imports
                            }

            self._save_cache()

            # Шаг 2: Разрешение ребер с обязательной дедупликацией
            seen_edges: Set[Tuple[str, str]] = set()
            for rel_path, info in self.nodes.items():
                resolved_targets: List[str] = []
                for imp in info["raw_imports"]:
                    resolved = None
                    if info["ext"] in ['.js', '.jsx', '.ts', '.tsx']:
                        resolved = self.resolve_js_path(info["path"], imp)
                    elif info["ext"] == '.py':
                        resolved = self.resolve_py_path(info["path"], (imp, None))
                    elif info["ext"] == '.dart':
                        resolved = self.resolve_dart_path(info["path"], imp)
                    
                    if resolved:
                        resolved_targets.append(resolved)

                for target in set(resolved_targets):
                    if target in self.nodes and target != rel_path:
                        edge_pair = (rel_path, target)
                        if edge_pair not in seen_edges:
                            seen_edges.add(edge_pair)
                            self.edges.append({"from": rel_path, "to": target})

    def find_circular_dependencies(self) -> List[Dict[str, str]]:
        """
        Ищет циклы в графе зависимостей обходом в глубину (DFS).

        :return: Дедуплицированный список пар узлов, образующих циклы.
        :rtype: List[Dict[str, str]]
        """
        adj: Dict[str, List[str]] = {node: [] for node in self.nodes}
        for edge in self.edges:
            if edge["from"] in adj:
                adj[edge["from"]].append(edge["to"])
                
        circular_edges: Set[Tuple[str, str]] = set()
        path: List[str] = []
        visited: Set[str] = set()
        stack_set: Set[str] = set()

        def dfs(node: str) -> None:
            visited.add(node)
            path.append(node)
            stack_set.add(node)
            
            for neighbor in adj.get(node, []):
                if neighbor in stack_set:
                    idx = path.index(neighbor)
                    cycle_nodes = path[idx:]
                    for i in range(len(cycle_nodes)):
                        u = cycle_nodes[i]
                        v = cycle_nodes[(i + 1) % len(cycle_nodes)]
                        circular_edges.add((u, v))
                elif neighbor not in visited:
                    dfs(neighbor)
                    
            stack_set.remove(node)
            path.pop()

        for node in self.nodes:
            if node not in visited:
                dfs(node)
                
        return [{"from": u, "to": v} for u, v in sorted(circular_edges)]

    def get_all_related_nodes(self, start_node: str) -> Set[str]:
        """
        Возвращает полное множество транзитивных зависимостей узла (Upstream + Downstream).

        :param start_node: Идентификатор стартового файла.
        :type start_node: str
        :return: Множество ID связанных файлов.
        :rtype: Set[str]
        """
        upstream_visited: Set[str] = set()
        downstream_visited: Set[str] = set()
        
        queue = [start_node]
        upstream_visited.add(start_node)
        while queue:
            curr = queue.pop(0)
            targets = [edge["to"] for edge in self.edges if edge["from"] == curr]
            for t in targets:
                if t not in upstream_visited and t in self.nodes:
                    upstream_visited.add(t)
                    queue.append(t)
                    
        queue = [start_node]
        downstream_visited.add(start_node)
        while queue:
            curr = queue.pop(0)
            sources = [edge["from"] for edge in self.edges if edge["to"] == curr]
            for s in sources:
                if s not in downstream_visited and s in self.nodes:
                    downstream_visited.add(s)
                    queue.append(s)
                    
        return upstream_visited.union(downstream_visited)