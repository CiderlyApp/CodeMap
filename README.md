# ☲ Code Dependency ER-Mapper

Интерактивная карта архитектурных связей и зависимостей исходного кода в стиле ER-диаграмм (DBeaver/DataGrip).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-green)

---

## 🌟 Ключевые возможности

1. **ER-структура файлов и папок (Compound Nodes)**:
   - В отличие от хаотичных физических графов («орбит»), файлы сгруппированы в контейнеры-директории в виде компактных блоков.
2. **Динамический выбор каталогов**:
   - Больше нет необходимости жестко задавать пути в конфиге Docker. Встроенный проводник позволяет подключать и комбинировать несколько папок прямо на лету.
3. **Investigation Mode (Режим расследования файла)**:
   - Быстрый поиск любого файла (например, `app.py` или `auth.service.ts`).
   - Изоляция зависимостей с выбором глубины трассировки (`Depth 1, 2, 3, All`) и направления (`Upstream / Downstream`).
4. **Семантическая типизация связей**:
   - `import`, `from ... import`, `re-export`, динамические вызовы `require()`.
   - Подсветка архитектурных циклов (петли взаимных импортов).
5. **Контекстный экспорт для LLM**:
   - Сборка дедуплицированного XML/Markdown бандла в один клик для ChatGPT, Claude или локальных моделей.

---

## 🚀 Быстрый запуск

### Вариант 1: Docker Compose (Рекомендуемый)

```bash
git clone https://github.com/your-username/code-dependency-mapper.git
cd code-dependency-mapper
docker-compose up -d --build