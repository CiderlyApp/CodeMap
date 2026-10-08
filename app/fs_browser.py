"""
Инспектор файловой системы для интерактивного выбора каталогов на сервере/хосте.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List


def list_directory_entries(target_path: str = "/") -> Dict[str, Any]:
    """
    Сканирует переданную директорию и возвращает подпапки для навигатора UI.

    Args:
        target_path: Путь в файловой системе.

    Returns:
        Словарь с текущим путем, родительской папкой и списком поддиректорий.
    """
    abs_path = os.path.abspath(target_path)
    if not os.path.exists(abs_path) or not os.path.isdir(abs_path):
        abs_path = os.path.abspath(os.sep)

    entries: List[Dict[str, str]] = []
    try:
        with os.scandir(abs_path) as it:
            for entry in it:
                if entry.is_dir() and not entry.name.startswith("."):
                    entries.append({"name": entry.name, "path": entry.path})
    except PermissionError:
        pass

    entries.sort(key=lambda x: x["name"].lower())

    parent_path = os.path.dirname(abs_path)
    if parent_path == abs_path:
        parent_path = None

    return {
        "current_path": abs_path,
        "parent_path": parent_path,
        "directories": entries,
    }