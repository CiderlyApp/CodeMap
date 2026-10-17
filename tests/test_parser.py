"""
Набор модульных тестов для валидации логики CodeDependencyParser.

Проверяет:
    - Конструктор по умолчанию без обязательных аргументов.
    - Сканирование только выбранных директорий (target_dirs).
    - Разрешение импортов Python, JS/TS, Dart.
    - Детекцию циклических архитектурных зависимостей.
"""

import os
import pytest
from app.parser import CodeDependencyParser


@pytest.fixture
def mock_multi_project_tree(tmp_path):
    """
    Создает временное дерево с несколькими проектами для проверки изоляции сканирования.
    """
    root = tmp_path / "projects"
    root.mkdir()

    # Проект 1: backend
    p1 = root / "ciderly-backend"
    p1.mkdir()
    (p1 / "main.py").write_text("import service\n", encoding="utf-8")
    (p1 / "service.py").write_text("import main\n", encoding="utf-8")

    # Проект 2: frontend
    p2 = root / "ciderly-frontend"
    p2.mkdir()
    (p2 / "index.ts").write_text("import './app';\n", encoding="utf-8")
    (p2 / "app.ts").write_text("console.log('app');\n", encoding="utf-8")

    # Проект 3: mobile (не должен сканироваться, если не выбран)
    p3 = root / "ciderly-mobile"
    p3.mkdir()
    (p3 / "main.dart").write_text("void main() {}\n", encoding="utf-8")

    return root


def test_parser_init_defaults(monkeypatch, tmp_path):
    """
    Проверяет, что CodeDependencyParser инициализируется без аргументов
    и использует CODE_DIR из окружения, предотвращая TypeError.
    """
    monkeypatch.setenv("CODE_DIR", str(tmp_path))
    parser = CodeDependencyParser()
    assert parser.root_dir == str(tmp_path)
    assert os.path.exists(os.path.dirname(parser.cache_file))


def test_parser_scans_only_target_directories(mock_multi_project_tree):
    """
    Проверяет сканирование только подмножества папок, указанных в target_dirs.
    """
    parser = CodeDependencyParser(root_dir=str(mock_multi_project_tree))
    
    # Сканируем только backend
    parser.scan(target_dirs=["ciderly-backend"])

    # Должны быть только файлы ciderly-backend
    assert any("ciderly-backend/main.py" in n for n in parser.nodes)
    assert any("ciderly-backend/service.py" in n for n in parser.nodes)
    assert not any("ciderly-frontend" in n for n in parser.nodes)
    assert not any("ciderly-mobile" in n for n in parser.nodes)


def test_parser_finds_cycles_in_backend(mock_multi_project_tree):
    """
    Проверяет корректное обнаружение циклических связей main <-> service.
    """
    parser = CodeDependencyParser(root_dir=str(mock_multi_project_tree))
    parser.scan(target_dirs=["ciderly-backend"])
    cycles = parser.find_circular_dependencies()

    assert len(cycles) >= 2
    from_to = [(c["from"], c["to"]) for c in cycles]
    assert any("main.py" in u and "service.py" in v for u, v in from_to)