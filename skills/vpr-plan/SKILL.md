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

Para proponer modelos por fase, usa `vpr models plan --project <ruta> --input
<solicitud.json>`. Deriva tipo, complejidad, riesgo y checks de la Task; declara
los identificadores configurados del ejecutor preferido, planificador y
planificador avanzado. La decision local no llama a modelos ni ejecuta agentes.
La disponibilidad declarada debe comprobarse en el host antes de ejecutar.

Una tarea sencilla puede ir directamente al ejecutor ligero, sin un agente de
planificacion adicional. Para analisis normal usa el planificador configurado;
para analisis avanzado usa el de mayor capacidad. En esas rutas el planificador
y revisor no editan archivos: entrega al ejecutor objetivo, criterios, rutas,
dependencias, checks y preguntas pendientes. No supongas que delegar siempre
ahorra: compara el costo de todo el flujo, incluidos fallos y reintentos.
Necesitas al menos tres casos comparables por alternativa y calidad suficiente
antes de presentar un ranking empirico. Una propuesta no crea un Run.

