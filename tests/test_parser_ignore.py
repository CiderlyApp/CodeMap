"""
Тесты проверки исключения файлов по маскам и каталогам в CodeDependencyParser.
"""

import os
import tempfile
import pytest
from app.parser import CodeDependencyParser


@pytest.fixture
def temp_project_dir():
    """Создает временную файловую структуру с файлами подпадающими под маски."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        # 1. Валидный файл
        main_py = os.path.join(tmp_dir, "main.py")
        with open(main_py, "w", encoding="utf-8") as f:
            f.write("import utils\n")

        # 2. Файл, подпадающий под маску *.gen.py
        gen_py = os.path.join(tmp_dir, "schema.gen.py")
        with open(gen_py, "w", encoding="utf-8") as f:
            f.write("class GeneratedSchema: pass\n")

        # 3. Файл в игнорируемой директории 'build'
        build_dir = os.path.join(tmp_dir, "build")
        os.makedirs(build_dir, exist_ok=True)
        build_py = os.path.join(build_dir, "output.py")
        with open(build_py, "w", encoding="utf-8") as f:
            f.write("x = 1\n")

        yield tmp_dir


def test_parser_scan_filters_by_mask_and_dir(temp_project_dir):
    parser = CodeDependencyParser(roots=[temp_project_dir])

    # Запуск сканирования с маской файлов '*.gen.py' и папкой 'build'
    parser.scan(
        exclude_dirs=["build"],
        allowed_extensions=[".py"],
        exclude_files=["*.gen.py"],
    )

    scanned_labels = [n["label"] for n in parser.nodes.values()]

    assert "main.py" in scanned_labels, "Основной файл должен присутствовать"
    assert "schema.gen.py" not in scanned_labels, "Файл с маской *.gen.py должен быть проигнорирован"
    assert "output.py" not in scanned_labels, "Файл внутри папки build должен быть проигнорирован"