---
name: vpr-plan
description: Convierte una Story clara en Tasks verticales, verificables y con dependencias reales; no crea Runs.
disable-model-invocation: true
---

# Planificar trabajo VPR

Parte de una Story del `BacklogService`. Si no existe, produce un `StoryDraft` y
solicita su preview/confirmacion; no uses una spec Markdown como intermediario
obligatorio.

Cada Task debe entregar un comportamiento completo y demostrable, declarar
criterios falsables, checks, rutas permitidas, bloqueos y dependencias reales.
Evita tareas horizontales por capa. Para un refactor amplio usa expandir,
migrar por lotes verdes y contraer. No crees un Run hasta que se pida ejecutar
una Task.

Usa una spec adjunta solo si el riesgo, el tamano multisesion o el usuario la
justifican. Conserva decisiones costosas de revertir como propuestas de ADR.

