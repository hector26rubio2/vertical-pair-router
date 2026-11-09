# Glosario canónico de Vertical Pair Router

Este archivo es la única fuente autoritativa de términos del proyecto. El
`glossaryPath` del profile debe apuntar aquí. Cada cambio se propone con diff,
Story de origen y resolución explícita; el dashboard sólo proyecta su contenido.

## BacklogService

Servicio de dominio compartido que conserva Stories y Tasks, aplica control de
concurrencia y registra sus versiones.

- Alias: servicio de backlog
- Evitar: base de datos del dashboard
- Enlaces: Fase 6, ADR-0004
- Fuente: plan vigente
- Fecha: 2026-11-09
- Owner: VPR

## Capability

Observación con vigencia y evidencia sobre una función disponible en el host.

- Alias: capacidad
- Evitar: suposición del entorno
- Enlaces: `@vpr/runtime`
- Fuente: plan vigente
- Fecha: 2026-11-09
- Owner: VPR

## Context Pack

Conjunto acotado de referencias verificables para reanudar una Story/Task: rutas,
líneas, hashes, commit y pendientes, sin copiar el contenido fuente.

- Alias: paquete de contexto
- Evitar: volcado de contexto, copia del repositorio
- Enlaces: ADR-0007, `@vpr/knowledge`
- Fuente: STORY-005 / plan Fase 5
- Fecha: 2026-11-09
- Owner: VPR

## Evidence

Registro factual de un check, revisión, aprobación o capacidad, con momento,
origen y límites declarados.

- Alias: evidencia
- Evitar: afirmación sin ejecución
- Enlaces: `@vpr/contracts`
- Fuente: plan vigente
- Fecha: 2026-11-09
- Owner: VPR

## Handoff

Transferencia durable y pequeña entre sesiones, agentes, hosts o personas que
apunta al context pack, estado Git, checks y siguiente acción.

- Alias: relevo
- Evitar: resumen autoritativo, sustituto de las fuentes
- Enlaces: ADR-0007, `@vpr/knowledge`
- Fuente: STORY-005 / plan Fase 5
- Fecha: 2026-11-09
- Owner: VPR

## Run

Intento auditable de ejecutar una Task con estado, revisión, evidencia y consumo
propios.

- Alias: ejecución
- Evitar: sesión, tarea
- Enlaces: `@vpr/contracts`, ADR-0004
- Fuente: plan vigente
- Fecha: 2026-11-09
- Owner: VPR

## Story

Unidad de necesidad y resultado del producto, con criterios de aceptación,
exclusiones, preguntas y estado versionado.

- Alias: historia
- Evitar: spec obligatoria
- Enlaces: `@vpr/contracts`, BacklogService
- Fuente: plan vigente
- Fecha: 2026-11-09
- Owner: VPR

## Task

Unidad ejecutable derivada de una Story lista, con resultado falsable, rutas,
dependencias y checks requeridos.

- Alias: tarea
- Evitar: prompt suelto
- Enlaces: `@vpr/contracts`, BacklogService
- Fuente: plan vigente
- Fecha: 2026-11-09
- Owner: VPR
