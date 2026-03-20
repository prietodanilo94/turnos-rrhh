from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import get_db
from app.models import Worker, Branch, User
from app.schemas import WorkerCreate, WorkerUpdate, WorkerResponse
from app.auth import require_role

router = APIRouter(prefix="/api/workers", tags=["Workers"])


@router.get("", response_model=list[WorkerResponse])
def list_workers(
    branch_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    query = db.query(Worker).options(joinedload(Worker.branch))

    # Managers can only see their own branch
    if user.role == "manager" and user.branch_id:
        query = query.filter(Worker.branch_id == user.branch_id)
    elif branch_id:
        query = query.filter(Worker.branch_id == branch_id)

    if is_active is not None:
        query = query.filter(Worker.is_active == is_active)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (Worker.first_name.ilike(search_term)) |
            (Worker.last_name.ilike(search_term)) |
            (Worker.rut.ilike(search_term))
        )

    offset = (page - 1) * per_page
    return query.order_by(Worker.last_name, Worker.first_name).offset(offset).limit(per_page).all()


@router.post("", response_model=WorkerResponse, status_code=201)
def create_worker(
    data: WorkerCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    # Check unique RUT
    existing = db.query(Worker).filter(Worker.rut == data.rut).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe un trabajador con RUT '{data.rut}'")

    # Check branch exists
    branch = db.query(Branch).filter(Branch.id == data.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    worker = Worker(**data.model_dump())
    db.add(worker)
    db.commit()
    db.refresh(worker)
    return worker


@router.get("/by-rut/{rut}", response_model=WorkerResponse)
def get_worker_by_rut(
    rut: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    worker = db.query(Worker).options(joinedload(Worker.branch)).filter(Worker.rut == rut).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if user.role == "manager" and user.branch_id != worker.branch_id:
        raise HTTPException(status_code=403, detail="No tienes acceso a este trabajador")
    return worker


@router.get("/{worker_id}", response_model=WorkerResponse)
def get_worker(
    worker_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "manager")),
):
    worker = db.query(Worker).options(joinedload(Worker.branch)).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if user.role == "manager" and user.branch_id != worker.branch_id:
        raise HTTPException(status_code=403, detail="No tienes acceso a este trabajador")
    return worker


@router.put("/{worker_id}", response_model=WorkerResponse)
def update_worker(
    worker_id: int,
    data: WorkerUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(worker, key, value)

    db.commit()
    db.refresh(worker)
    return worker


@router.delete("/{worker_id}")
def deactivate_worker(
    worker_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    worker.is_active = False
    db.commit()
    return {"success": True, "message": f"Trabajador '{worker.full_name}' desactivado"}
