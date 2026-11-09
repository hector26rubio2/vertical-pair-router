---
name: vpr-retro
description: Analiza un hito o incidente y propone mejoras verificables del entorno; nunca cambia reglas automaticamente.
disable-model-invocation: true
---

# Retrospectiva VPR

Lee evidencia primaria del Run, checks, diff y decisiones. Busca friccion en
navegacion, checks automaticos, estandares mecanizables, acceso a informacion,
economia de herramientas, no-ops e instrucciones excesivas.

Prioriza propuestas por impacto/riesgo. Prefiere un check determinista para una
regla mecanica y reserva documentacion para juicio humano. Cada propuesta
declara problema observado, cambio, costo, riesgo y evidencia de exito. Presenta
las propuestas para aprobacion; no edites Skills, standards, hooks o politicas
automaticamente.

