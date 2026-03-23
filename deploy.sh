#!/bin/bash
# ============================================================
# deploy.sh — Script de actualización de TurnosRRHH en VPS
# Uso: bash deploy.sh
# ============================================================

set -e  # Si cualquier comando falla, el script se detiene

PROJECT_DIR="/opt/turnos-rrhh"
BRANCH="main"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       TurnosRRHH — Deploy Manual             ║"
echo "╚══════════════════════════════════════════════╝"
echo "⏰ Hora: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 1. Ir al directorio del proyecto
echo "📂 Directorio: $PROJECT_DIR"
cd "$PROJECT_DIR" || { echo "❌ No se encontró el directorio $PROJECT_DIR"; exit 1; }

# 2. Mostrar rama actual
CURRENT_BRANCH=$(git branch --show-current)
echo "🌿 Rama actual: $CURRENT_BRANCH"

# 3. Bajar últimos cambios de GitHub
echo ""
echo "⬇️  Bajando cambios desde GitHub ($BRANCH)..."
git pull origin "$BRANCH"

LAST_COMMIT=$(git log -1 --pretty=format:"%h %s (%an, %ar)")
echo "✅ Último commit: $LAST_COMMIT"

# 4. Reconstruir y reiniciar contenedores Docker
echo ""
echo "🐳 Reconstruyendo contenedores Docker..."
docker compose up -d --build

# 5. Esperar que los servicios inicien
echo ""
echo "⏳ Esperando que los servicios inicien (5s)..."
sleep 5

# 6. Mostrar estado de los contenedores
echo ""
echo "📊 Estado de los servicios:"
docker compose ps

# 7. Mostrar últimas líneas del log del backend
echo ""
echo "📋 Últimos logs del backend:"
docker compose logs backend --tail=20 --no-log-prefix

# 8. Mensaje final
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ Deploy completado exitosamente            ║"
echo "║                                              ║"
echo "║  🌐 Frontend:  http://turnos.dpmake.cl       ║"
echo "║  📡 API Docs:  http://turnos.dpmake.cl/docs  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
