/**
 * @fileoverview Доменная модель проекта: эталонный набор демонстрационных данных.
 * @module data
 */

export const PROJECT_DATA = [
    {
        id: "src/api/app.py",
        name: "app.py",
        folder: "api",
        role: "API entry point",
        lines: 1284,
        language: "Python",
        tags: ["Python", "API", "Entry point"],
        exports: ["create_app()", "app", "main()"],
        dependencies: [
            { target: "src/api/routes.py", type: "from_import", statement: "from api.routes import api_router" },
            { target: "src/api/schemas.py", type: "from_import", statement: "from api.schemas import HealthResponse" },
            { target: "src/core/config.py", type: "import", statement: "import core.config" },
            { target: "src/core/database.py", type: "import", statement: "import core.database" },
            { target: "src/core/logger.py", type: "import", statement: "import core.logger" },
            { target: "src/services/cider_service.py", type: "from_import", statement: "from services.cider_service import CiderService" },
            { target: "src/services/user_service.py", type: "from_import", statement: "from services.user_service import UserService" },
            { target: "src/utils/helpers.py", type: "import", statement: "import utils.helpers" }
        ]
    },
    {
        id: "src/api/routes.py",
        name: "routes.py",
        folder: "api",
        role: "endpoints router",
        lines: 480,
        language: "Python",
        tags: ["Python", "API", "Router"],
        exports: ["api_router", "register_routes()"],
        dependencies: [
            { target: "src/api/schemas.py", type: "from_import", statement: "from api.schemas import CiderCreateSchema" },
            { target: "src/services/cider_service.py", type: "from_import", statement: "from services.cider_service import CiderService" }
        ]
    },
    {
        id: "src/api/schemas.py",
        name: "schemas.py",
        folder: "api",
        role: "pydantic schemas",
        lines: 260,
        language: "Python",
        tags: ["Python", "API", "DTO"],
        exports: ["CiderCreateSchema", "UserResponseSchema", "HealthResponse"],
        dependencies: []
    },
    {
        id: "src/api/dependencies.py",
        name: "dependencies.py",
        folder: "api",
        role: "request di injectors",
        lines: 190,
        language: "Python",
        tags: ["Python", "API", "DI"],
        exports: ["get_current_user", "get_db_session"],
        dependencies: [
            { target: "src/core/database.py", type: "from_import", statement: "from core.database import SessionLocal" },
            { target: "src/services/user_service.py", type: "from_import", statement: "from services.user_service import UserService" }
        ]
    },
    {
        id: "src/core/config.py",
        name: "config.py",
        folder: "core",
        role: "config, settings",
        lines: 145,
        language: "Python",
        tags: ["Python", "Core", "Settings"],
        exports: ["Settings", "get_settings()"],
        dependencies: []
    },
    {
        id: "src/core/database.py",
        name: "database.py",
        folder: "core",
        role: "db, connection pool",
        lines: 612,
        language: "Python",
        tags: ["Python", "Core", "DB"],
        exports: ["engine", "SessionLocal", "BaseModel"],
        dependencies: [
            { target: "src/core/config.py", type: "from_import", statement: "from core.config import get_settings" },
            { target: "src/core/logger.py", type: "import", statement: "import core.logger" }
        ]
    },
    {
        id: "src/core/logger.py",
        name: "logger.py",
        folder: "core",
        role: "structured logging",
        lines: 110,
        language: "Python",
        tags: ["Python", "Core", "Observability"],
        exports: ["logger", "setup_logging()"],
        dependencies: []
    },
    {
        id: "src/services/cider_service.py",
        name: "cider_service.py",
        folder: "services",
        role: "business logic",
        lines: 740,
        language: "Python",
        tags: ["Python", "Service", "Domain"],
        exports: ["CiderService"],
        dependencies: [
            { target: "src/models/cider.py", type: "from_import", statement: "from models.cider import Cider" },
            { target: "src/core/database.py", type: "from_import", statement: "from core.database import SessionLocal" },
            { target: "src/services/notification_service.py", type: "from_import", statement: "from services.notification_service import NotificationService" }
        ]
    },
    {
        id: "src/services/user_service.py",
        name: "user_service.py",
        folder: "services",
        role: "user management",
        lines: 947,
        language: "Python",
        tags: ["Python", "Service", "Auth"],
        exports: ["UserService"],
        dependencies: [
            { target: "src/models/user.py", type: "from_import", statement: "from models.user import User" },
            { target: "src/core/database.py", type: "from_import", statement: "from core.database import SessionLocal" },
            { target: "src/utils/helpers.py", type: "from_import", statement: "from utils.helpers import hash_password" }
        ]
    },
    {
        id: "src/services/notification_service.py",
        name: "notification_service.py",
        folder: "services",
        role: "email & push dispatches",
        lines: 320,
        language: "Python",
        tags: ["Python", "Service", "Messaging"],
        exports: ["NotificationService", "send_push()"],
        dependencies: [
            { target: "src/core/logger.py", type: "import", statement: "import core.logger" }
        ]
    },
    {
        id: "src/models/cider.py",
        name: "cider.py",
        folder: "models",
        role: "cider model entity",
        lines: 310,
        language: "Python",
        tags: ["Python", "Models", "ORM"],
        exports: ["Cider", "AppleVarietyEnum"],
        dependencies: [
            { target: "src/core/database.py", type: "from_import", statement: "from core.database import BaseModel" },
            { target: "src/models/user.py", type: "from_import", statement: "from models.user import User" }
        ]
    },
    {
        id: "src/models/user.py",
        name: "user.py",
        folder: "models",
        role: "user model entity",
        lines: 240,
        language: "Python",
        tags: ["Python", "Models", "ORM"],
        exports: ["User", "UserRoleEnum"],
        dependencies: [
            { target: "src/core/database.py", type: "from_import", statement: "from core.database import BaseModel" }
        ]
    },
    {
        id: "src/utils/helpers.py",
        name: "helpers.py",
        folder: "utils",
        role: "utility toolkit",
        lines: 180,
        language: "Python",
        tags: ["Python", "Utils"],
        exports: ["hash_password()", "generate_slug()", "format_date()"],
        dependencies: []
    },
    {
        id: "tests/test_app.py",
        name: "test_app.py",
        folder: "tests",
        role: "e2e & smoke tests",
        lines: 350,
        language: "Python",
        tags: ["Python", "Testing"],
        exports: ["test_health()", "test_app_init()"],
        dependencies: [
            { target: "src/api/app.py", type: "test", statement: "from src.api.app import app" },
            { target: "src/core/config.py", type: "test", statement: "from src.core.config import get_settings" }
        ]
    },
    {
        id: "tests/test_services.py",
        name: "test_services.py",
        folder: "tests",
        role: "unit tests",
        lines: 410,
        language: "Python",
        tags: ["Python", "Testing"],
        exports: ["test_user_create()", "test_cider_lookup()"],
        dependencies: [
            { target: "src/services/cider_service.py", type: "test", statement: "from src.services.cider_service import CiderService" },
            { target: "src/services/user_service.py", type: "test", statement: "from src.services.user_service import UserService" }
        ]
    }
];

export const FILE_MAP = new Map(PROJECT_DATA.map(f => [f.id, f]));