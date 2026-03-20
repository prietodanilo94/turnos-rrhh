from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import auth, branches, workers, templates, schedules

app = FastAPI(
    title="TurnosRRHH API",
    description="API para gestión de horarios de trabajadores",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
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
app.include_router(branches.router)
app.include_router(workers.router)
app.include_router(templates.router)
app.include_router(schedules.router)


@app.get("/")
def root():
    return {
        "name": "TurnosRRHH API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
