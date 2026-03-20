# Comunicación entre Agentes - TurnosRRHH

> **IMPORTANTE**: Leer este archivo antes de hacer cualquier cambio en el proyecto.

## Resumen del Proyecto

**TurnosRRHH** es un sistema web para gestión de horarios semanales de trabajadores en sucursales de venta.

- **Backend**: FastAPI (Python 3.11) + PostgreSQL 15
- **Frontend**: React + Vite
- **Deploy**: Docker Compose + Nginx (Proxy Inverso)

## Arquitectura de Deploy

```
PC Local (Windows + OneDrive)
    │
    │── git push ───► GitHub (privado)
    │                      │
    │                      │──► VPS (173.212.220.77)
    │                           /opt/turnos-rrhh
    │                           Docker Compose
    │
    └── URL: https://turnos.dpmake.cl
```

## Estructura de Archivos Sensibles

### .env (NO SE SUBE A GIT)
- Ubicación: `/opt/turnos-rrhh/.env` (solo en VPS)
- Contiene: Contraseñas reales de DB, JWT_SECRET, credenciales admin
- **NUNCA** subir a GitHub, ni siquiera a repos privados

### .env.example (SÍ SE SUBE A GIT)
- Plantilla con valores de ejemplo
- Guía para crear el .env real en nuevas instalaciones

## Acceso al VPS

```bash
# Conexión SSH (clave configurada)
ssh root@173.212.220.77

# Docker en VPS
cd /opt/turnos-rrhh
docker-compose ps
docker-compose logs -f backend
docker-compose logs -f frontend
```

## Flujo de Trabajo Git

### 1. En PC Local (desarrollo)
```bash
# Ver cambios
git status

# Agregar archivos
git add .

# Commit con mensaje descriptivo
git commit -m "feat: descripción del cambio"

# Subir a GitHub
git push origin main
```

### 2. En VPS (deploy)
```bash
cd /opt/turnos-rrhh
git pull
docker-compose up -d --build
```

## Comandos Útiles

### Backend (local)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend (local)
```bash
cd frontend
npm install
npm run dev
```

### Docker (VPS)
```bash
# Ver logs
docker-compose logs -f --tail 50

# Reiniciar servicios
docker-compose restart

# Reconstruir completamente
docker-compose down
docker-compose up -d --build
```

## URLs Importantes

| Servicio | Local | Producción (VPS) |
|----------|-------|------------------|
| Frontend | http://localhost:3000 | https://turnos.dpmake.cl |
| Backend API | http://localhost:8000 | https://turnos.dpmake.cl/api |
| API Docs | http://localhost:8000/docs | https://turnos.dpmake.cl/docs |

## Notas para Agentes

1. **Siempre** verificar que `.env` está en `.gitignore` antes de hacer commit
2. **Nunca** exponer contraseñas reales en el código o en conversaciones
3. El VPS tiene UFW configurado - solo puertos 80/443 están abiertos externamente
4. La base de datos de TurnosRRHH es independiente del PostgreSQL compartido de otras apps
5. Para cambios grandes, crear una rama: `git checkout -b feature/nueva-funcionalidad`

## Contacto/Contexto

- Usuario: Danilo Prieto
- Email: prieto.danilo94@gmail.com
- VPS: 173.212.220.77 (Hetzner)
- Dominio: dpmake.cl
- Proyecto creado: Marzo 2026
