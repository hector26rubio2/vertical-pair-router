---
name: vpr-review
description: Revisa el diff real en dos ejes separados, aceptacion y estandares/seguridad, con hallazgos verificables.
disable-model-invocation: true
---

# Revisar cambios

Fija la base correcta y confirma que existe. Inspecciona commits y el diff real,
incluidos staged, unstaged y untracked segun politica. Identifica la Story/Task y
las fuentes de estandares.

Revisa por separado:

- **Aceptacion**: criterios ausentes/parciales, comportamiento incorrecto y
  alcance no pedido.
- **Estandares y seguridad**: reglas documentadas, secretos, procesos/rutas,
  errores, concurrencia y complejidad injustificada.

Cada finding incluye severidad, confianza, ruta/linea, evidencia y regla/criterio.
Verifica cada finding contra el codigo; no copies conjeturas. Separa revisor de
autor cuando la capacidad exista, pero no generes revision recursiva ni fan-out
infinito. La ausencia de findings no sustituye los checks.

