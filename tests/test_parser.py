"""
Тесты логики статического анализатора и построения графа зависимостей.
"""

import os
import tempfile
import unittest

from app.parser import CodeDependencyParser


class TestDependencyParser(unittest.TestCase):
    """Набор тестов для проверки разрешения AST-импортов и петель."""

    def setUp(self) -> None:
        self.test_dir = tempfile.TemporaryDirectory()
        self.root = self.test_dir.name

        # Создаем тестовую архитектуру файлов
        # a.py -> imports b.py; b.py -> imports a.py (цикл)
        self.file_a = os.path.join(self.root, "a.py")
        self.file_b = os.path.join(self.root, "b.py")
        self.file_c = os.path.join(self.root, "c.py")

        with open(self.file_a, "w", encoding="utf-8") as f:
            f.write("import b\nclass ServiceA:\n    pass\n")

        with open(self.file_b, "w", encoding="utf-8") as f:
            f.write("import a\ndef helper():\n    pass\n")

        with open(self.file_c, "w", encoding="utf-8") as f:
            f.write("import b\n")

        self.parser = CodeDependencyParser(roots=[self.root])
        self.alias = os.path.basename(self.root)

    def tearDown(self) -> None:
        self.test_dir.cleanup()

    def test_scan_and_node_discovery(self) -> None:
        """Проверка корректного обнаружения узлов и экспортов."""
        self.parser.scan()
        node_a_id = f"{self.alias}/a.py"
        self.assertIn(node_a_id, self.parser.nodes)
        self.assertEqual(self.parser.nodes[node_a_id]["exports"], ["ServiceA"])

    def test_circular_dependency_detection(self) -> None:
        """Проверка детекции взаимного импорта (циклической связи)."""
        self.parser.scan()
        cycles = self.parser.find_circular_dependencies()
        self.assertTrue(len(cycles) >= 2)
        cycle_pairs = {(c["from"], c["to"]) for c in cycles}
        self.assertIn((f"{self.alias}/a.py", f"{self.alias}/b.py"), cycle_pairs)
        self.assertIn((f"{self.alias}/b.py", f"{self.alias}/a.py"), cycle_pairs)

    def test_subgraph_investigation_extraction(self) -> None:
        """Проверка изоляции подграфа при расследовании файла."""
        self.parser.scan()
        # Расследуем c.py с глубиной 1: должны получить c.py и b.py
        pivot = f"{self.alias}/c.py"
        subgraph = self.parser.extract_investigation_subgraph(pivots=[pivot], depth=1, direction="upstream")
        subgraph_nodes = {n["id"] for n in subgraph["nodes"]}

        self.assertIn(f"{self.alias}/c.py", subgraph_nodes)
        self.assertIn(f"{self.alias}/b.py", subgraph_nodes)
        self.assertNotIn(f"{self.alias}/a.py", subgraph_nodes)



        