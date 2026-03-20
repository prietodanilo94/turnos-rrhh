"""
Script to create the initial admin user.
Run: python -m app.scripts.create_admin
"""
import sys
import os

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import User, Branch
from app.auth import hash_password
from app.config import settings


def create_admin():
    db: Session = SessionLocal()

    try:
        # Check if admin exists
        existing = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
        if existing:
            print(f"✅ Admin ya existe: {settings.ADMIN_EMAIL}")
            return

        # Create a default branch for admin if none exists
        branch = db.query(Branch).first()
        if not branch:
            branch = Branch(name="Casa Matriz", code="HQ", region="Región Metropolitana")
            db.add(branch)
            db.commit()
            db.refresh(branch)
            print(f"🏢 Sucursal creada: {branch.name} ({branch.code})")

        # Create admin user
        admin = User(
            email=settings.ADMIN_EMAIL,
            password_hash=hash_password(settings.ADMIN_PASSWORD),
            first_name="Admin",
            last_name="RRHH",
            rut=settings.ADMIN_RUT,
            role="admin",
            branch_id=None,  # Admin sees all branches
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

        print(f"👤 Admin creado exitosamente:")
        print(f"   Email: {settings.ADMIN_EMAIL}")
        print(f"   Password: {settings.ADMIN_PASSWORD}")
        print(f"   RUT: {settings.ADMIN_RUT}")
        print(f"   Role: admin")
        print()
        print("⚠️  Cambia la contraseña después del primer login!")

    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    create_admin()
