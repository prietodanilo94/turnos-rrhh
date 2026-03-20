from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import Branch, User
from app.schemas import BranchCreate, BranchUpdate, BranchResponse
from app.auth import require_role

router = APIRouter(prefix="/api/branches", tags=["Branches"])


@router.get("", response_model=list[BranchResponse])
def list_branches(
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    query = db.query(Branch)
    if is_active is not None:
        query = query.filter(Branch.is_active == is_active)
    # Managers only see their own branch
    if user.role == "manager" and user.branch_id:
        query = query.filter(Branch.id == user.branch_id)
    return query.order_by(Branch.name).all()


@router.post("", response_model=BranchResponse, status_code=201)
def create_branch(
    data: BranchCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    # Check unique code
    existing = db.query(Branch).filter(Branch.code == data.code).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe una sucursal con código '{data.code}'")

    branch = Branch(**data.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


@router.get("/{branch_id}", response_model=BranchResponse)
def get_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    # Managers can only see their own branch
    if user.role == "manager" and user.branch_id != branch.id:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta sucursal")
    return branch


@router.put("/{branch_id}", response_model=BranchResponse)
def update_branch(
    branch_id: int,
    data: BranchUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(branch, key, value)

    db.commit()
    db.refresh(branch)
    return branch


@router.delete("/{branch_id}")
def deactivate_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    branch.is_active = False
    db.commit()
    return {"success": True, "message": f"Sucursal '{branch.name}' desactivada"}
