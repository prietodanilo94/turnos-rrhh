from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, AuditLog, UserBranch
from app.schemas import LoginRequest, LoginResponse, TokenResponse, UserResponse, BranchSimple
from app.auth import (
    verify_password,
    create_access_token, create_refresh_token, decode_token,
    get_current_user, get_user_by_rut,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])


def build_user_response(user: User) -> UserResponse:
    branches = [BranchSimple(id=ub.branch.id, name=ub.branch.name, code=ub.branch.code)
                for ub in user.user_branches if ub.branch]
    default_id = next((ub.branch_id for ub in user.user_branches if ub.is_default), None)
    if not default_id and user.user_branches:
        default_id = user.user_branches[0].branch_id
    return UserResponse(
        id=user.id,
        rut=user.rut,
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        role=user.role,
        branches=branches,
        default_branch_id=default_id,
        is_active=user.is_active,
    )


@router.post("/login", response_model=LoginResponse)
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = get_user_by_rut(db, data.rut)
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="RUT o contraseña incorrectos")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Usuario inactivo")

    user.last_login = datetime.utcnow()
    db.commit()

    token_data = {"sub": str(user.id), "role": user.role}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    audit = AuditLog(
        user_id=user.id,
        action="login",
        entity_type="user",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(audit)
    db.commit()

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=900,
        user=build_user_response(user),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(refresh: str, db: Session = Depends(get_db)):
    payload = decode_token(refresh)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token no es de tipo refresh")

    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")

    token_data = {"sub": str(user.id), "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        expires_in=900,
    )


@router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)):
    return build_user_response(user)
