"""
Тесты для проверки отдачи кода файлов и правильности форматирования путей в AI-бандле.
"""

from fastapi.testclient import TestClient
from app.main import app, analyzer


def test_file_content_endpoint(tmp_path):
    """Проверяет эндпоинт GET /api/file/content для просмотра кода."""
    file = tmp_path / "hello.py"
    file.write_text("def greeting(): return 'hello'", encoding="utf-8")

    rel = "hello.py"
    analyzer.root_dir = str(tmp_path)
    analyzer.nodes = {
        rel: {
            "id": rel,
            "label": "hello.py",
            "folder": "root",
            "path": str(file),
            "lines": 1,
            "raw_imports": []
        }
    }

    client = TestClient(app)
    res = client.get(f"/api/file/content?path={rel}")
    assert res.status_code == 200
    assert "def greeting():" in res.text


def test_ai_bundle_contains_path_markers(tmp_path):
    """Проверяет наличие маркеров ## и // в выгрузке для ИИ."""
    file = tmp_path / "test_mod.dart"
    file.write_text("void main() {}", encoding="utf-8")

    rel = "test_mod.dart"
    analyzer.nodes[rel] = {
        "id": rel,
        "label": "test_mod.dart",
        "path": str(file),
        "lines": 1
    }

    client = TestClient(app)
    res = client.post("/api/export_ai", json={"files": [rel]})
    assert res.status_code == 200
    data = res.json()["text"]
    assert "## File: test_mod.dart" in data
    assert "// Path: test_mod.dart" in data