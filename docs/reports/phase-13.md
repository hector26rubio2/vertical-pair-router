# Phase 13 checkpoint: integral evaluation and security

Date: 2026-11-11
Status: IN PROGRESS; provider pilot and release gates are pending.

## Executed evidence

- `pnpm check`: 88/88 tests passed after the security changes.
- `pnpm audit --json`: exit 0, zero advisories across three development
  dependencies; no third-party production dependencies. This is a point-in-time
  registry audit, not a guarantee of absence of defects.
- `pnpm licenses list --json`: TypeScript 5.9.3 Apache-2.0,
  @types/node 24.10.1 MIT, undici-types 7.16.0 MIT.
- Strict Claude plugin manifest validation passed in Phase 11. Directory
  publication remains blocked by the missing owner-selected license.
- Windows fresh dependency install and full suite passed in Phase 12.

## Security correction

Retention previously selected all old events. That could invalidate event
replay for existing Stories and Runs. The storage deletion predicate, CLI
preview and observability preview now select only `UsageObserved` and
`UsageSampleRecorded`. A regression test proves a durable old Story event
survives rotation. Explicit whole-project deletion retains exact-ID confirmation.

Added executed adversarial coverage for literal shell metacharacters, a forged
HTTP Host, foreign Origin and bodies exceeding 64 KiB. Existing tests cover
timeouts, cancellation, huge process output, secret-shaped event fields,
unsupported profiles, stale glossary/context and disallowed provider fallback.

## Acceptance matrix

| Gate | Evidence/status |
|---|---|
| Core, policy, routing, lifecycle | PASS local unit/contract suite |
| CLI, SQLite recovery, backup, locking | PASS local integration suite |
| Dashboard auth, mutation and canonical glossary | PASS integration; browser QA Phase 11 |
| Windows clean install | PASS same-machine clean temporary checkout |
| Host hooks and plugin manifest | PASS local hooks/schema tests and strict manifest validation |
| Feature/bug/multilayer provider pilots | NOT_RUN; fixtures are not provider execution evidence |
| Baseline/plugin comparison | Comparison contract tested; real pilot samples NOT_RUN |
| Provider authentication/execution | NOT_RUN pending authorized account/budget |
| macOS/Linux and second physical machine | NOT_RUN |
| Public license/title/publication | Owner decision pending |

No general token/time savings are claimed. The three planned pilot cases must
share base commits, criteria and checks across baseline/plugin arms and record
human intervention and quality. Their outcomes must be exploratory.

Coordinator: gpt-6.1-sol (interface-confirmed). No subagents. Tokens/cost
unavailable. No provider-backed inference calls were made.

## Local functionality follow-up

Added CLI Task plan/list/check/review integration over the existing
BacklogService. A real-process test covers Story creation, Task planning,
command preview, successful checks, recovered Run, explicit review and a failed
check. The latest full suite passes 90/90 tests. Commands use the project's
profile ID, shell-free executable resolution, bounded execution, cancellation
and metadata-only persistence. This validates local checks, not autonomous
provider implementation or the unexecuted provider pilot.

Added a dependency SBOM/file inventory generator with exclusion tests and a
pilot/onboarding runbook. License and publication are deferred at the owner's
explicit request; local functionality proceeds independently.

## Seguimiento: selección y medición real — 2026-11-12

La suite más reciente pasa 104/104 pruebas. Se añadieron reglas para comparar
ejecución única, dividida o mixta, contabilizando coordinación, contexto repetido,
revisión y reintentos. El objetivo puede ser tokens, latencia o costo con unidades
comparables. Los costos desconocidos no se convierten en cero ni en gratuidad.
Las previsiones históricas siguen etiquetadas como estimaciones.

Se ejecutó un microbenchmark real en la cuenta de Claude: tres funciones puras
independientes, una solución con Sonnet frente a coordinador Sonnet y tres
trabajadores solicitados como Haiku, con máximo dos trabajadores simultáneos.
Los mismos checks deterministas aprobaron ambas soluciones.

| Brazo | Tokens reportados, incluyendo caché | Checks |
|---|---:|---|
| Un trabajador Sonnet | 71.856 | PASS |
| Coordinador y tres trabajadores | 296.343 | PASS |

No hubo ahorro en esta muestra. Además, todos los mensajes de los trabajadores
solicitados como Haiku reportaron `claude-sonnet-5-5`. No es evidencia de una
comparación real Haiku/Sonnet. Se añadió una verificación que marca esa
sustitución en lugar de etiquetar como Haiku un recibo de Sonnet.

Los contadores incluyen lecturas/escrituras de caché; no equivalen a dinero ni
cuota de suscripción. El benchmark es exploratorio y no ejecuta aún el pipeline
autónomo completo de VPR. No justifica conclusiones generales de ahorro.

La entrevista de init guarda tecnologías, integraciones y modelos; el
aprovisionamiento detecta requisitos ausentes. Graphify 0.9.106 indexó el código
local sin modelo: 825 nodos y 1.759 relaciones. Archify pasó doctor; la nueva
interfaz de generación aún requiere prueba de un artefacto real. El descriptor
del paquete pasó validación estricta y se generó un tarball local; queda pendiente
la prueba completa de instalación y registro. La matriz CI incluye Windows,
macOS y Linux, sin resultados ejecutados todavía en los dos últimos.

Pendientes funcionales: conectar análisis automático de tareas, decisiones y
delegación real; completar/verificar UI; probar modelos efectivos de cada cuenta;
comparar una tarea representativa con criterios equivalentes. Copilot sólo tiene
un shim local, no un CLI usable. No se hará otro push ni una release hasta el
cierre acordado con el owner.

## Corrección del criterio de delegación — 2026-11-12

La decisión normal ya no supone varios trabajadores. `decideLocalExecution`
consulta casos locales por tipo de tarea, complejidad y riesgo, sin embeddings
ni inferencia. Puede recomendar ejecución directa (cero trabajadores) o un único
trabajador; la división explícita sigue siendo una estrategia separada.

Sólo compara historias con modelo confirmado y contabilidad completa, incluye
intentos fallidos y exige evidencia de calidad. Sin historial suficiente,
conserva el agente activo capaz para evitar nueva sobrecarga, sin afirmar ahorro.
La decisión no consume tokens de inferencia. Aún debe conectarse al dispatcher
automático y al historial producido por ejecuciones reales del producto.
