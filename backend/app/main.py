from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import settings
from app.routes import auth, branches, workers, templates, schedules, users, status, export, monthly_plans


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-seed admin user on startup if none exists."""
    _seed_admin()
    yield


def _seed_admin():
    from app.database import SessionLocal
    from app.models import User, Branch, UserBranch
    from app.auth import hash_password

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.rut == settings.ADMIN_RUT).first()
        if existing:
            return

        # Create a default branch if none exists
        branch = db.query(Branch).first()
        if not branch:
            branch = Branch(name="Casa Matriz", code="HQ", region="Región Metropolitana")
            db.add(branch)
            db.commit()
            db.refresh(branch)

        admin = User(
            rut=settings.ADMIN_RUT,
            password_hash=hash_password(settings.ADMIN_PASSWORD),
            first_name="Admin",
            last_name="RRHH",
            role="admin",
        )
        db.add(admin)
        db.flush()

        # Link admin to default branch
        db.add(UserBranch(user_id=admin.id, branch_id=branch.id, is_default=True))
        db.commit()
        print(f"✅ Admin creado: RUT={settings.ADMIN_RUT} / Password={settings.ADMIN_PASSWORD}")
    except Exception as e:
        db.rollback()
        print(f"⚠️  No se pudo crear admin: {e}")
    finally:
        db.close()


app = FastAPI(
    title="TurnosRRHH API",
    description="API para gestión de horarios de trabajadores",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(branches.router)
app.include_router(workers.router)
app.include_router(templates.router)
app.include_router(schedules.router)
app.include_router(status.router)
app.include_router(export.router)
app.include_router(monthly_plans.router)


@app.get("/")
def root():
    return {"name": "TurnosRRHH API", "version": "2.0.0", "status": "running", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
