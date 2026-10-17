"""
Веб-приложение FastAPI для интерактивной визуализации архитектурных связей и экспорта кода.

Реализует REST API управления настройками сканирования, проводник по папкам
проектов, генерацию графа для Vis.js и экспорт контекста для языковых моделей.
"""

import os
import json
import asyncio
from typing import Dict, Any, List
from io import BytesIO
from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from parser import CodeDependencyParser

# Базовая директория для исходного кода проектов (по умолчанию /projects из docker-compose)
CODE_DIR: str = os.getenv("CODE_DIR", "/projects")

# Каталог для хранения персистентных данных: settings.json и cache.json
DATA_DIR: str = os.getenv("DATA_DIR", "/app/data" if os.path.exists("/app/data") else os.path.join(os.path.dirname(__file__), "data"))
os.makedirs(DATA_DIR, exist_ok=True)

SETTINGS_FILE: str = os.path.join(DATA_DIR, "settings.json")
CACHE_FILE: str = os.path.join(DATA_DIR, "cache.json")

app: FastAPI = FastAPI(
    title="Code Dependency Mapper",
    description="Интерактивная архитектурная карта зависимостей исходного кода с возможностью выбора каталогов",
    version="1.1.0"
)

app.mount(
    "/static", 
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), 
    name="static"
)

templates: Jinja2Templates = Jinja2Templates(
    directory=os.path.join(os.path.dirname(__file__), "templates")
)

# Инициализируем парсер с корректным root_dir и путем к кэшу в DATA_DIR
analyzer: CodeDependencyParser = CodeDependencyParser(root_dir=CODE_DIR, cache_file=CACHE_FILE)


def load_settings() -> Dict[str, Any]:
    """
    Загружает параметры сканирования из settings.json.

    :return: Словарь с настройками (selected_dirs, exclude_dirs, extensions, exclude_files).
    :rtype: Dict[str, Any]
    """
    default_settings: Dict[str, Any] = {
        "selected_dirs": [],
        "exclude_dirs": "node_modules, .next, .git, venv, env, build, .dart_tool, __pycache__, dist, .gradle, ios, android, l10n",
        "extensions": ".js, .jsx, .ts, .tsx, .py, .dart",
        "exclude_files": "freezed.dart, .g.dart"
    }
    
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    default_settings.update(data)
                    return default_settings
        except Exception:
            pass
            
    return default_settings


def perform_scan(cfg: Dict[str, Any]) -> None:
    """
    Вспомогательная функция выполнения сканирования на основе словаря конфигурации.

    :param cfg: Словарь параметров сканирования.
    :type cfg: Dict[str, Any]
    :return: None.
    """
    ex_dirs = [d.strip() for d in cfg.get("exclude_dirs", "").split(",") if d.strip()]
    exts = [e.strip() for e in cfg.get("extensions", "").split(",") if e.strip()]
    ex_files = [f.strip() for f in cfg.get("exclude_files", "").split(",") if f.strip()]
    selected_dirs = cfg.get("selected_dirs", [])
    if isinstance(selected_dirs, str):
        selected_dirs = [d.strip() for d in selected_dirs.split(",") if d.strip()]

    analyzer.scan(
        exclude_dirs_list=ex_dirs,
        extensions_list=exts,
        exclude_files_list=ex_files,
        target_dirs=selected_dirs
    )


@app.on_event("startup")
async def startup_event() -> None:
    """
    Событие старта веб-сервера. Запускает первичное сканирование в фоновом потоке.
    """
    cfg = load_settings()
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, perform_scan, cfg)


@app.get("/", response_class=HTMLResponse)
async def read_index(request: Request) -> HTMLResponse:
    """
    Рендерит главную страницу приложения.

    :param request: Объект HTTP-запроса.
    :type request: Request
    :return: Шаблон index.html.
    :rtype: HTMLResponse
    """
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/fs/projects")
async def list_filesystem_projects() -> Dict[str, Any]:
    """
    Сканирует корневую директорию CODE_DIR и возвращает список доступных подкаталогов первого уровня.

    :return: Словарь со списком доступных каталогов проектов и текущей базовой папкой.
    :rtype: Dict[str, Any]
    """
    available_folders: List[Dict[str, Any]] = []
    
    if os.path.exists(CODE_DIR) and os.path.isdir(CODE_DIR):
        try:
            for item in sorted(os.listdir(CODE_DIR)):
                full_item_path = os.path.join(CODE_DIR, item)
                if os.path.isdir(full_item_path) and not item.startswith("."):
                    # Проверяем маркеры проектов
                    markers = []
                    if os.path.exists(os.path.join(full_item_path, "package.json")):
                        markers.append("Node/JS")
                    if os.path.exists(os.path.join(full_item_path, "pubspec.yaml")):
                        markers.append("Dart/Flutter")
                    if os.path.exists(os.path.join(full_item_path, "requirements.txt")) or os.path.exists(os.path.join(full_item_path, "pyproject.toml")):
                        markers.append("Python")

                    available_folders.append({
                        "name": item,
                        "path": item,
                        "markers": markers
                    })
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Ошибка чтения директории {CODE_DIR}: {e}")

    return {
        "root_dir": CODE_DIR,
        "available_projects": available_folders
    }


@app.get("/api/graph")
async def get_graph(refresh: bool = False) -> Dict[str, Any]:
    """
    Возвращает актуальный граф зависимостей.

    :param refresh: Флаг принудительной реиндексации.
    :type refresh: bool
    :return: Узлы, ребра, циклические зависимости и выбранные папки.
    :rtype: Dict[str, Any]
    """
    cfg = load_settings()
    if refresh:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, perform_scan, cfg)
        
    return {
        "nodes": list(analyzer.nodes.values()),
        "edges": analyzer.edges,
        "circular_edges": analyzer.find_circular_dependencies(),
        "selected_dirs": cfg.get("selected_dirs", [])
    }


@app.get("/api/settings")
async def get_settings() -> Dict[str, Any]:
    """
    Возвращает конфигурацию сканирования.

    :return: Объект настроек.
    :rtype: Dict[str, Any]
    """
    return load_settings()


@app.post("/api/settings")
async def save_settings(data: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    """
    Сохраняет обновленные настройки (включая выбранные папки проектов) в settings.json.

    :param data: Новая конфигурация.
    :type data: Dict[str, Any]
    :raises HTTPException: При ошибке записи.
    :return: Статус выполнения.
    :rtype: Dict[str, str]
    """
    try:
        current = load_settings()
        current.update(data)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=4, ensure_ascii=False)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка сохранения настроек: {e}")


@app.post("/api/export")
async def export_code_post(data: Dict[str, Any] = Body(...)) -> StreamingResponse:
    """
    Формирует монолитный текстовый файл со сплошным кодом переданных путей.

    :param data: JSON со списком путей files и именем узла node.
    :type data: Dict[str, Any]
    :raises HTTPException: Если список путей пуст.
    :return: Потоковый файл для скачивания.
    :rtype: StreamingResponse
    """
    files: List[str] = data.get("files", [])
    node: str = data.get("node", "export")
    
    if not files:
        raise HTTPException(status_code=400, detail="Список файлов для экспорта пуст")
        
    output: List[str] = []
    for rel_path in files:
        if rel_path in analyzer.nodes:
            file_data = analyzer.nodes[rel_path]
            output.append("// ========================================================")
            output.append(f"// FILE: {rel_path}")
            output.append("// ========================================================\n")
            try:
                with open(file_data["path"], 'r', encoding='utf-8', errors='ignore') as f:
                    output.append(f.read())
            except Exception as e:
                output.append(f"// Ошибка чтения содержимого файла: {e}")
            output.append("\n\n")

    content = "\n".join(output)
    buffer = BytesIO(content.encode('utf-8'))
    
    return StreamingResponse(
        buffer, 
        media_type="text/plain", 
        headers={"Content-Disposition": f'attachment; filename="export_{node.replace("/", "_")}.txt"'}
    )


@app.post("/api/export_ai")
async def export_code_ai(data: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    """
    Форматирует файлы проекта в Markdown/XML для контекста языковых моделей (LLM).

    :param data: JSON со списком файлов files.
    :type data: Dict[str, Any]
    :raises HTTPException: При пустом списке файлов.
    :return: Словарь с полем text.
    :rtype: Dict[str, str]
    """
    files: List[str] = data.get("files", [])
    if not files:
        raise HTTPException(status_code=400, detail="Список файлов для экспорта пуст")
        
    output: List[str] = []
    for rel_path in files:
        if rel_path in analyzer.nodes:
            file_data = analyzer.nodes[rel_path]
            output.append(f"### Файл: `{rel_path}`")
            output.append(f'<file path="{rel_path}">')
            try:
                with open(file_data["path"], 'r', encoding='utf-8', errors='ignore') as f:
                    output.append(f.read())
            except Exception as e:
                output.append(f"// Ошибка чтения содержимого файла: {e}")
            output.append("</file>\n")
            
    return {"text": "\n".join(output)}