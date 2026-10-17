"""
Интеграционные тесты REST API эндпоинтов FastAPI.

Проверяет:
    - Проводник по каталогам /api/fs/projects.
    - Сохранение выбранных каталогов в /api/settings.
    - Получение топологии графа /api/graph.
"""

import os
import pytest
from fastapi.testclient import TestClient
from app.main import app, analyzer, CODE_DIR


@pytest.fixture(autouse=True)
def setup_test_environment(tmp_path, monkeypatch):
    """
    Инициализирует тестовое дерево каталогов для файлового API.
    """
    proj_a = tmp_path / "backend-api"
    proj_a.mkdir()
    (proj_a / "requirements.txt").write_text("fastapi", encoding="utf-8")
    (proj_a / "server.py").write_text("print('ok')", encoding="utf-8")

    proj_b = tmp_path / "frontend-web"
    proj_b.mkdir()
    (proj_b / "package.json").write_text("{}", encoding="utf-8")
    (proj_b / "index.js").write_text("console.log()", encoding="utf-8")

    # Подменяем пути анализатора и модуля
    analyzer.root_dir = str(tmp_path)
    import app.main as app_module
    app_module.CODE_DIR = str(tmp_path)


def test_list_filesystem_projects():
    """
    Проверяет получение списка доступных каталогов проектов из смонтированного раздела.
    """
    client = TestClient(app)
    response = client.get("/api/fs/projects")
    assert response.status_code == 200

    data = response.json()
    assert "available_projects" in data
    names = [p["name"] for p in data["available_projects"]]
    assert "backend-api" in names
    assert "frontend-web" in names

    # Проверяем маркеры стека
    backend = next(p for p in data["available_projects"] if p["name"] == "backend-api")
    assert "Python" in backend["markers"]


def test_save_and_apply_selected_directories():
    """
    Проверяет сохранение списка выбранных папок и их применение в графе.
    """
    client = TestClient(app)
    payload = {
        "selected_dirs": ["backend-api"],
        "exclude_dirs": "node_modules",
        "extensions": ".py, .js",
        "exclude_files": ".g.dart"
    }

    save_resp = client.post("/api/settings", json=payload)
    assert save_resp.status_code == 200

    # Проверяем пересканирование графа
    graph_resp = client.get("/api/graph?refresh=true")
    assert graph_resp.status_code == 200
    nodes = graph_resp.json()["nodes"]

    # Должен присутствовать только backend-api
    assert any("backend-api" in n["id"] for n in nodes)
    assert not any("frontend-web" in n["id"] for n in nodes)