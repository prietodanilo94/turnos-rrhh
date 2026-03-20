from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import ShiftTemplate, User
from app.schemas import ShiftTemplateCreate, ShiftTemplateUpdate, ShiftTemplateResponse
from app.auth import require_role

router = APIRouter(prefix="/api/shift-templates", tags=["Shift Templates"])


@router.get("", response_model=list[ShiftTemplateResponse])
def list_templates(
    branch_id: Optional[int] = None,
    is_active: Optional[bool] = True,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    query = db.query(ShiftTemplate)

    if is_active is not None:
        query = query.filter(ShiftTemplate.is_active == is_active)

    if branch_id:
        # Return global + branch-specific
        query = query.filter(
            (ShiftTemplate.is_global == True) | (ShiftTemplate.branch_id == branch_id)
        )
    elif user.role == "manager" and user.branch_id:
        query = query.filter(
            (ShiftTemplate.is_global == True) | (ShiftTemplate.branch_id == user.branch_id)
        )

    return query.order_by(ShiftTemplate.name).all()


@router.post("", response_model=ShiftTemplateResponse, status_code=201)
def create_template(
    data: ShiftTemplateCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    # Managers can only create for their own branch
    if user.role == "manager":
        if data.is_global:
            raise HTTPException(status_code=403, detail="Solo admin puede crear plantillas globales")
        data.branch_id = user.branch_id

    template = ShiftTemplate(
        name=data.name,
        code=data.code,
        start_time=data.start_time,
        end_time=data.end_time,
        color=data.color,
        branch_id=data.branch_id,
        is_global=data.is_global,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.put("/{template_id}", response_model=ShiftTemplateResponse)
def update_template(
    template_id: int,
    data: ShiftTemplateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    template = db.query(ShiftTemplate).filter(ShiftTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")

    if user.role == "manager" and template.is_global:
        raise HTTPException(status_code=403, detail="No puedes editar plantillas globales")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}")
def deactivate_template(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    template = db.query(ShiftTemplate).filter(ShiftTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    template.is_active = False
    db.commit()
    return {"success": True, "message": f"Plantilla '{template.name}' desactivada"}
