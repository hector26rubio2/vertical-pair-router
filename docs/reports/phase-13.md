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

## Nueve pruebas reales por tarea y esfuerzo — 2026-11-12

Se repitió la medición con identificadores completos, configuración aislada y
sin herramientas, skills o MCP. Esta vez los recibos confirmaron las familias
solicitadas. No se modificó la configuración del usuario ni se usaron API keys.
Cada ejecución tuvo un único trabajador. Son pruebas aisladas de funciones
puras; no una demostración del ahorro del workflow completo de VPR.

| Tarea | Haiku medium | Haiku high | Sonnet medium |
|---|---:|---:|---:|
| Normalizar SKU | 1.093 / PASS | 1.246 / FAIL | 816 / PASS |
| Ordenar dependencias | 1.955 / PASS | 2.864 / PASS | 1.139 / FAIL |
| Planificar DAG con límites y conflictos de rutas | 7.158 / PASS | 7.151 / PASS | 2.174 / PASS |

Las cifras son tokens reportados incluyendo entrada, salida y caché: 25.596 en
las nueve ejecuciones. La instrumentación sólo procesa JSON localmente. El nivel
de esfuerzo es el solicitado al CLI; el recibo no lo confirma independientemente.
Hay una muestra por combinación. Se conservan fallos de formato/aceptación; no
se eliminan para favorecer ningún modelo. No se deriva ahorro monetario ni una
clasificación general a partir de esta muestra.

Se amplió el retrieval local con fichas versionadas de capacidades, URLs
oficiales, vencimiento, búsqueda léxica ponderada, términos en español y métricas
por esfuerzo. Distingue documentación de disponibilidad de cuenta y evidencia
empírica. Filtra nivel de complejidad y modelos sustituidos; no usa embeddings
ni inferencia para consultar. El catálogo es una base inicial para ampliar y
validar, no un modelo universal de calidad.

La consulta está expuesta como `vpr models query --query "codigo simple"` tanto
en el checkout como en el bundle del paquete. El acceso a cuenta observado
caduca a los cinco minutos; el historial sigue disponible sin presentarlo como
acceso vigente. `pnpm check` final pasó 115/115 pruebas. El bundle se reconstruyó
y la consulta empaquetada devolvió cero tokens de inferencia para decidir.

## Comparación ponderada por tarifas oficiales — 2026-11-12

Se añadió un catálogo fechado de tarifas oficiales Claude API y un estimador
local que separa entrada, salida, lectura y escritura de caché. Para Haiku aplica
el nivel de precio correspondiente al tamaño del prompt. Con TTL de escritura
no expuesto se conserva un intervalo 5m/1h; no se inventa un valor exacto.

En el caso complejo, ambos resultados aprobaron los mismos checks:

| Modelo/esfuerzo | Tokens | Costo de referencia API, USD |
|---|---:|---:|
| Haiku 5.5 medium | 7.158 | 0,0032377–0,0033058 |
| Haiku 5.5 high | 7.151 | 0,003174055–0,00320293 |
| Sonnet 5.5 medium | 2.174 | 0,0150715–0,016402 |

Más tokens no significan más costo. Se añadió el objetivo `reference-cost` al
selector de casos locales: compara costo estimado por resultado aceptado,
incluyendo intentos fallidos, y rechaza tarifas vencidas o desconocidas.
Tokens, costo de referencia API y cuota de suscripción permanecen dimensiones
distintas; estos valores no son facturas ni descuento medido de una suscripción.
El cálculo usa los recibos ya obtenidos; no se hicieron nuevas inferencias.

Fuentes: https://platform.claude.com/docs/en/models/haiku-5-5/overview y
https://platform.claude.com/docs/en/models/sonnet-5-5/overview.

## Suscripciones y proyecto piloto real — 2026-11-12

Se añadió un catálogo independiente de suscripciones con fuentes oficiales,
fecha y vencimiento: Claude Pro/Max/Ultra, Codex Business Standard y Copilot
Pro/Pro+/Max. Separa mensualidad, anualidad, créditos y límites. El estado público
de `claude auth status` confirmó Claude Pro en esta máquina. No se almacenaron
identidad, correo ni credenciales. Otros planes se seleccionan por usuario;
los desconocidos no reciben tarifas inventadas. `init --interactive` detecta
Claude cuando lo informa el host y permite cambiar la selección.

Claude Pro publica USD 20/mes o USD 200/año, pero no una conversión fija de
tokens de Haiku/Sonnet a cuota. Codex tampoco permite deducir cuota incluida
desde sus precios de créditos. Copilot tiene créditos y una excepción para
planes anuales antiguos; no se aplican multiplicadores antiguos universalmente.

El objetivo `subscription-quota` del selector local compara cuota observada por
resultado aceptado, con intentos fallidos incluidos. Exige tres casos por
modelo, mismo plan/límite, fuente, aislamiento y vigencia; sin datos conserva
la ruta por reglas y no sustituye cuota por costo API. La lectura y decisión
usan cero tokens de inferencia. El contexto enviado al agente sí consume.
El CLI permite consultar planes y procesar pares antes/después. El dashboard
persiste y muestra observaciones por Run mediante una ruta autenticada con
protección CSRF. Se rechazan reinicios, actividad concurrente y cero por redondeo.
No hay aún captura automática universal de porcentaje restante por proveedor.

Se creó una API de inventario HTTP/SQLite separada, en
`.tmp/inventory-pilot-1794491936055`, con seis pruebas externas para reservas
idempotentes, validación, falta de stock, concurrencia y cierre/reapertura.
Todos los brazos partieron del árbol Git
`bcceedd91d6d4a3bdf481fea01186ecd56233730`; la prueba existente pasó y las seis
nuevas fallaron antes de la implementación. Se ejecutaron modelos nativos con
suscripción y configuración aislada, sin API keys. La asignación de modelos
fue experimental y explícita; no prueba despacho automático del orquestador.

| Brazo | Tokens reportados, con caché | Pruebas externas | Limitación |
|---|---:|---:|---|
| Sonnet sin VPR | 70.919 | 6/6 | Una muestra |
| Sonnet con copia empaquetada VPR | 164.266 | 6/6 | Proceso cancelado a 300 s; hubo recibo terminal y siete pruebas propias aprobadas |
| Haiku con copia empaquetada VPR | No disponible | 6/6 | Timeout a 300 s, pruebas propias bloqueadas; no llegó recibo terminal |

Sonnet con VPR consumió 131,6% más tokens observados en este ensayo, incluyendo
lecturas/escrituras de caché acumuladas. No es ahorro. Tampoco es una comparación
válida de latencia final debido al cierre del proceso. Tres intentos anteriores
fallaron porque el proyecto estaba dentro de la carpeta del plugin y el host
lo consideró contenido sensible. Se conservaron sus 339.124 tokens en el informe;
se corrigió cargando el plugin empaquetado fuera del proyecto. No se desactivaron
las protecciones del host. Una sonda diagnóstica adicional consumió 3.728 tokens.
El informe del piloto suma 574.309 tokens conocidos, más un brazo de consumo
desconocido; no presenta ese consumo desconocido como cero. La sonda se registra
separadamente. No se midió delta de cuota real ni extensión de la suscripción.
Estas cifras corresponden a las sesiones Claude del experimento. El consumo
del chat de desarrollo/coordinación Codex no está instrumentado en ese total.

El resumen derivado en `summary.json` sustituye estimaciones antiguas de costos
por contexto para las sesiones Haiku: los contadores acumulados de múltiples
peticiones no permiten determinar un nivel de contexto por petición. Sin ese
dato, el costo queda no disponible. La carga del plugin está confirmada; la
activación interna del skill pedido no tiene recibo independiente.

La API generada con Sonnet funciona localmente: GET stock devolvió 10; reservar
una unidad y repetir la clave devolvió `replayed:false` y `replayed:true`, con
stock final 9. Arranque reproducible:
`node tools/serve-pilot.mjs --project .tmp/inventory-pilot-1794491936055/vpr-packaged`.

Se probó instalación npm local y sin red del `.tgz`, seguida de detección de
Claude Pro desde el CLI instalado. No se publicó ni se hizo push. No se ejecutó
instalación global/permanente del plugin, ni pruebas reales macOS/Linux.
Los checks del producto pasan 126/126; el piloto Haiku no está verde.
Modelo del coordinador: GPT-6.1 Sol según la interfaz. Modelos de pruebas:
Claude Sonnet 5.5 y Haiku 5.5 confirmados en recibos/mensajes; esfuerzo medium
solicitado, no confirmado independientemente. Cuota disponible: no disponible.

Fuentes de suscripciones:
[Claude](https://claude.com/pricing),
[límites Claude](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work),
[Codex](https://learn.chatgpt.com/docs/pricing),
[planes Copilot](https://docs.github.com/en/copilot/get-started/plans) y
[consumo por modelo Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).

La aclaración final del owner prioriza conteo y valor por la tabla oficial,
sin medir cuota. Por ello la entrevista conserva `reference-cost` como objetivo
predeterminado; `subscription-quota` queda opcional. El catálogo de precios se
amplió con Fable 5.2 y Opus 5.5 y se verificó contra el enlace aportado por el
owner: https://platform.claude.com/docs/es/about-claude/pricing. No se hicieron
ejecuciones de esos dos modelos ni se presume acceso de cuenta.
