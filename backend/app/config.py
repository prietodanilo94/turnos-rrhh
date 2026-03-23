from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://turnos_user:turnos_secure_2026@db:5432/turnos_rrhh"

    # JWT
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3010,http://localhost:5173"

    # Admin (login by RUT, default password)
    ADMIN_RUT: str = "11.111.111-1"
    ADMIN_PASSWORD: str = "1234"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
