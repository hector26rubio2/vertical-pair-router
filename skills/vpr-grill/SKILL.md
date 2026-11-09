---
name: vpr-grill
description: Entrevista sobre una funcionalidad ambigua usando repo, backlog y glosario; produce StoryDraft o StoryPatch, no una spec obligatoria.
disable-model-invocation: true
---

# Aclarar una funcionalidad

Antes de preguntar, busca Stories equivalentes y lee solo contexto relevante.
Modela un arbol de decisiones. En cada ronda pregunta el frente cuyas
precondiciones ya estan resueltas, numera las preguntas y ofrece una recomendacion
que pueda aceptarse con "si". Investiga hechos disponibles localmente; reserva
al owner decisiones de producto, seguridad, datos, licencia y alcance.

Captura objetivo, actores, casos limite, criterios de aceptacion, exclusiones,
privacidad, supuestos, preguntas abiertas y terminos candidatos. Contrasta el
lenguaje con el glosario/codigo y presenta cambios de glosario o ADR como diff;
no los escribas silenciosamente.

Al cerrar, produce `StoryDraft` o `StoryPatch` con procedencia para
`BacklogService`. Busca duplicados antes de crear. Solo deriva Tasks cuando los
criterios sean implementables. Si `BacklogService` no esta disponible, devuelve
el draft y marca persistencia `BLOCKED`; no inventes un archivo Markdown como
fuente paralela.

