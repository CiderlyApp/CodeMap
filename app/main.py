"""
FastAPI HTTP-сервис управления картой архитектурных зависимостей.
"""

from __future__ import annotations

import asyncio
import json
import os
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from fs_browser import list_directory_entries
from parser import CodeDependencyParser

BASE_DIR = os.path.dirname(__file__)
SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")

app = FastAPI(title="Code Architecture Dependency Grapher")
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

analyzer = CodeDependencyParser()


def get_default_settings() -> Dict[str, Any]:
    """Возвращает настройки по умолчанию."""
    default_dir = os.getenv("CODE_DIR", os.path.abspath("."))
    return {
        "sources": [default_dir] if os.path.exists(default_dir) else [],
        "exclude_dirs": "node_modules, .next, .git, venv, .venv, env, build, .dart_tool, __pycache__, dist",
        "extensions": ".js, .jsx, .ts, .tsx, .py, .dart",
        "exclude_files": "freezed.dart, .g.dart",
    }


def load_settings() -> Dict[str, Any]:
    """Чтение конфигурации сканирования."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return {**get_default_settings(), **json.load(f)}
        except Exception:
            pass
    return get_default_settings()


def save_settings(data: Dict[str, Any]) -> None:
    """Сохранение конфигурации сканирования."""
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@app.on_event("startup")
async def startup_event() -> None:
    """Первоначальное сканирование при старте."""
    cfg = load_settings()
    analyzer.set_roots(cfg.get("sources", []))
    ex_dirs = [d.strip() for d in cfg["exclude_dirs"].split(",") if d.strip()]
    exts = [e.strip() for e in cfg["extensions"].split(",") if e.strip()]
    ex_files = [f.strip() for f in cfg.get("exclude_files", "").split(",") if f.strip()]

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, analyzer.scan, ex_dirs, exts, ex_files)


@app.get("/", response_class=HTMLResponse)
async def index_view(request: Request) -> HTMLResponse:
    """Рендеринг основного окна приложения."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/sources/browse")
async def fs_browse(path: Optional[str] = None) -> Dict[str, Any]:
    """Просмотр директорий файловой системы для добавления в проект."""
    return list_directory_entries(path or os.path.abspath(os.sep))


@app.get("/api/sources")
async def get_sources() -> Dict[str, Any]:
    """Возвращает текущие активные каталоги сканирования."""
    cfg = load_settings()
    return {"sources": cfg.get("sources", [])}


@app.post("/api/sources")
async def update_sources(payload: Dict[str, List[str]] = Body(...)) -> Dict[str, str]:
    """Обновляет перечень отслеживаемых каталогов и запускает рескан."""
    sources = payload.get("sources", [])
    valid_sources = [os.path.abspath(s) for s in sources if os.path.isdir(s)]
    cfg = load_settings()
    cfg["sources"] = valid_sources
    save_settings(cfg)

    analyzer.set_roots(valid_sources)
    ex_dirs = [d.strip() for d in cfg["exclude_dirs"].split(",") if d.strip()]
    exts = [e.strip() for e in cfg["extensions"].split(",") if e.strip()]
    ex_files = [f.strip() for f in cfg.get("exclude_files", "").split(",") if f.strip()]

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, analyzer.scan, ex_dirs, exts, ex_files)
    return {"status": "ok"}


@app.get("/api/graph")
async def get_graph(refresh: bool = False) -> Dict[str, Any]:
    """Возвращает полный граф архитектуры проекта."""
    if refresh:
        cfg = load_settings()
        analyzer.set_roots(cfg.get("sources", []))
        ex_dirs = [d.strip() for d in cfg["exclude_dirs"].split(",") if d.strip()]
        exts = [e.strip() for e in cfg["extensions"].split(",") if e.strip()]
        ex_files = [f.strip() for f in cfg.get("exclude_files", "").split(",") if f.strip()]

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, analyzer.scan, ex_dirs, exts, ex_files)

    return {
        "nodes": list(analyzer.nodes.values()),
        "edges": [e.to_dict() for e in analyzer.edges],
        "circular_edges": analyzer.find_circular_dependencies(),
    }


@app.post("/api/subgraph")
async def get_subgraph(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Возвращает сфокусированный подграф расследования.

    Параметры payload:
    - files: список выбранных файлов (pivots).
    - depth: радиус трассировки (1, 2, 3...).
    - direction: 'both' | 'upstream' | 'downstream'.
    """
    pivots = payload.get("files", [])
    depth = int(payload.get("depth", 1))
    direction = payload.get("direction", "both")
    return analyzer.extract_investigation_subgraph(pivots=pivots, depth=depth, direction=direction)


@app.get("/api/settings")
async def get_settings() -> Dict[str, Any]:
    """Возвращает настройки парсера."""
    return load_settings()


@app.post("/api/settings")
async def set_settings(payload: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    """Обновляет настройки парсера."""
    cfg = load_settings()
    cfg.update(payload)
    save_settings(cfg)
    return {"status": "ok"}


@app.post("/api/export")
async def export_files(payload: Dict[str, Any] = Body(...)) -> StreamingResponse:
    """Упаковывает выбранные файлы в текстовый бандл."""
    files = payload.get("files", [])
    if not files:
        raise HTTPException(status_code=400, detail="Список файлов пуст")

    output = []
    for f_id in files:
        if f_id in analyzer.nodes:
            data = analyzer.nodes[f_id]
            output.append(f"// {'='*60}\n// FILE: {f_id}\n// {'='*60}\n")
            try:
                with open(data["path"], "r", encoding="utf-8", errors="ignore") as f:
                    output.append(f.read())
            except Exception as e:
                output.append(f"// Ошибка чтения: {e}")
            output.append("\n\n")

    buf = BytesIO("\n".join(output).encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="bundle.txt"'},
    )


@app.post("/api/export_ai")
async def export_files_ai(payload: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    """Форматирует контекст файлов в XML/Markdown для LLM."""
    files = payload.get("files", [])
    if not files:
        raise HTTPException(status_code=400, detail="Список файлов пуст")

    output = []
    for f_id in files:
        if f_id in analyzer.nodes:
            data = analyzer.nodes[f_id]
            output.append(f'<file path="{f_id}">')
            try:
                with open(data["path"], "r", encoding="utf-8", errors="ignore") as f:
                    output.append(f.read())
            except Exception as e:
                output.append(f"// Ошибка чтения: {e}")
            output.append("</file>\n")

    return {"text": "\n".join(output)}