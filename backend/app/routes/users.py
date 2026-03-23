from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import User, UserBranch, Branch, AuditLog
from app.schemas import UserCreate, UserUpdate, UserResponse, BranchSimple
from app.auth import hash_password, require_role, get_current_user

router = APIRouter(prefix="/api/users", tags=["Users"])


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


@router.get("", response_model=list[UserResponse])
def list_users(
    is_active: Optional[bool] = None,
    branch_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_role("admin")),
):
    query = db.query(User)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    if branch_id:
        query = query.join(UserBranch).filter(UserBranch.branch_id == branch_id)
    users = query.order_by(User.last_name, User.first_name).all()
    return [build_user_response(u) for u in users]


@router.post("", response_model=UserResponse, status_code=201)
def create_user(
    data: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_role("admin")),
):
    # Check unique RUT
    existing = db.query(User).filter(User.rut == data.rut).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe un usuario con RUT '{data.rut}'")

    user = User(
        rut=data.rut,
        password_hash=hash_password(data.password),
        first_name=data.first_name,
        last_name=data.last_name,
        email=data.email,
        role=data.role,
    )
    db.add(user)
    db.flush()  # get user.id

    # Assign branches
    for branch_id in data.branch_ids:
        branch = db.query(Branch).filter(Branch.id == branch_id).first()
        if not branch:
            raise HTTPException(status_code=404, detail=f"Sucursal {branch_id} no encontrada")
        is_default = (branch_id == data.default_branch_id) or (branch_id == data.branch_ids[0])
        ub = UserBranch(user_id=user.id, branch_id=branch_id, is_default=is_default)
        db.add(ub)

    # Audit
    db.add(AuditLog(
        user_id=current.id, action="create", entity_type="user", entity_id=user.id,
        new_values={"rut": data.rut, "role": data.role},
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()
    db.refresh(user)
    return build_user_response(user)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return build_user_response(user)


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    old = {"rut": user.rut, "role": user.role}

    for field in ["first_name", "last_name", "email", "role", "is_active"]:
        val = getattr(data, field, None)
        if val is not None:
            setattr(user, field, val)

    # Re-assign branches if provided
    if data.branch_ids is not None:
        db.query(UserBranch).filter(UserBranch.user_id == user_id).delete()
        for branch_id in data.branch_ids:
            is_default = branch_id == data.default_branch_id
            db.add(UserBranch(user_id=user_id, branch_id=branch_id, is_default=is_default))

    db.add(AuditLog(
        user_id=current.id, action="update", entity_type="user", entity_id=user_id,
        old_values=old,
        new_values={"role": user.role, "is_active": user.is_active},
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()
    db.refresh(user)
    return build_user_response(user)


@router.delete("/{user_id}")
def deactivate_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="No puedes desactivarte a ti mismo")
    user.is_active = False
    db.add(AuditLog(
        user_id=current.id, action="delete", entity_type="user", entity_id=user_id,
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()
    return {"success": True, "message": f"Usuario '{user.rut}' desactivado"}


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_role("admin")),
):
    """Reset user password to default '1234'."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.password_hash = hash_password("1234")
    db.commit()
    return {"success": True, "message": "Contraseña restablecida a '1234'"}
