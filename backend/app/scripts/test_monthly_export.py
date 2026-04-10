"""
test_monthly_export.py
======================
Script de validación para verificar que el export mensual genera el formato correcto.

Uso:
    python backend/app/scripts/test_monthly_export.py

Valida:
    1. Siempre hay exactamente 31 columnas DIA (DIA1..DIA31)
    2. Las celdas con turno tienen formato "HH:MM a HH:MM"
    3. Los días que no existen en el mes son celdas vacías
    4. El export no incluye placeholders (solo RUTs reales)
    5. Columna A = RUT con formato chileno
"""
import re
import sys
import calendar
from pathlib import Path

# Intentar importar openpyxl
try:
    import openpyxl
except ImportError:
    print("❌ openpyxl no instalado. Ejecuta: pip install openpyxl")
    sys.exit(1)


TIME_TEXT_RE = re.compile(r"^\d{2}:\d{2} a \d{2}:\d{2}$")
RUT_RE       = re.compile(r"^\d{1,3}\.\d{3}\.\d{3}-[\dKk]$")


def validate_export_file(xlsx_path: str, year: int, month: int):
    """Valida un archivo Excel exportado por el planificador mensual."""
    path = Path(xlsx_path)
    if not path.exists():
        print(f"❌ Archivo no encontrado: {xlsx_path}")
        return False

    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.active

    errors   = []
    warnings = []
    days_in_month = calendar.monthrange(year, month)[1]

    print(f"\n{'='*60}")
    print(f"  Validando: {path.name}")
    print(f"  Mes: {month}/{year} ({days_in_month} días reales)")
    print(f"{'='*60}\n")

    # ── Fila 2: Headers ───────────────────────────────────────────
    header_row = list(ws.iter_rows(min_row=2, max_row=2, values_only=True))[0]

    # Columna A debe ser "RUT"
    if str(header_row[0]).strip().upper() != "RUT":
        errors.append(f"Columna A fila 2 debería ser 'RUT', encontrado: {header_row[0]!r}")

    # Deben existir exactamente 31 columnas DIA (columnas B-AF)
    dia_headers = [str(v).strip() if v else "" for v in header_row[1:32]]
    expected    = [f"DIA{d}" for d in range(1, 32)]

    for i, (got, exp) in enumerate(zip(dia_headers, expected)):
        if got != exp:
            errors.append(f"Columna {i+2} — header esperado '{exp}', encontrado: {got!r}")

    if len(dia_headers) < 31:
        errors.append(f"Faltan columnas DIA: se encontraron {len(dia_headers)}, esperadas 31")

    print(f"  Headers: {'✅ OK' if not errors else '❌ ' + str(len(errors)) + ' errores'}")

    # ── Filas de datos ────────────────────────────────────────────
    worker_count = 0
    for row_num, row in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        if not any(row):
            break
        worker_count += 1
        rut = row[0]

        # Validar RUT
        if rut is None:
            errors.append(f"Fila {row_num}: Columna RUT vacía")
        elif not RUT_RE.match(str(rut)):
            warnings.append(f"Fila {row_num}: RUT con formato inesperado: {rut!r}")

        # Validar celdas DIA
        for d in range(1, 32):
            cell_val = row[d] if d < len(row) else None
            col_name = f"DIA{d}"

            if d > days_in_month:
                # Días que no existen → deben ser vacíos
                if cell_val is not None and str(cell_val).strip() != "":
                    errors.append(
                        f"Fila {row_num} ({rut}) {col_name}: día inexistente "
                        f"pero tiene valor: {cell_val!r}"
                    )
            else:
                # Días existentes → vacío (libre) o "HH:MM a HH:MM"
                if cell_val is not None and str(cell_val).strip() != "":
                    if not TIME_TEXT_RE.match(str(cell_val).strip()):
                        errors.append(
                            f"Fila {row_num} ({rut}) {col_name}: "
                            f"formato inválido {cell_val!r} "
                            f"(esperado 'HH:MM a HH:MM' o vacío)"
                        )

    print(f"  Trabajadores: {worker_count}")

    # ── Resultado ─────────────────────────────────────────────────
    print()
    if warnings:
        print(f"  ⚠️  Advertencias ({len(warnings)}):")
        for w in warnings:
            print(f"     - {w}")

    if errors:
        print(f"\n  ❌ ERRORES ({len(errors)}):")
        for e in errors:
            print(f"     - {e}")
        print(f"\n{'='*60}")
        print("  RESULTADO: EXPORT INVÁLIDO")
        print(f"{'='*60}\n")
        return False
    else:
        print(f"  ✅ RESULTADO: EXPORT VÁLIDO")
        print(f"     {worker_count} trabajadores · 31 columnas DIA · formato OK")
        print(f"{'='*60}\n")
        return True


# ── Main ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Validar archivo Excel de export mensual")
    parser.add_argument("file",  help="Ruta al archivo .xlsx a validar")
    parser.add_argument("--year",  type=int, required=True, help="Año del plan (ej: 2026)")
    parser.add_argument("--month", type=int, required=True, help="Mes del plan (1-12)")
    args = parser.parse_args()

    ok = validate_export_file(args.file, args.year, args.month)
    sys.exit(0 if ok else 1)
