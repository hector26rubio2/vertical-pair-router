# Diagnóstico de ampliación experimental — 2026-11-19

Base: rama refactor/workflow-routing, consolidación autorizada por el titular. Este diagnóstico sustituye las referencias a cinco routers de modelos del ADR pegado: ahora existe routeWorkflow; routeRequest es selección de adaptadores y se conserva.

| Requisito | Evidencia actual | Trabajo necesario |
|---|---|---|
| A1 factorial | tools/lib/measured-recipes.mjs vuelve a planificar por receta | Artefacto inmutable con hash, diseñador compartido y asignación por recibos reales |
| A2 jerarquía | packages/backlog/src/backlog-service.ts:52 PlannedSlice y :66 PlanningHandoff | Historias independientes, motivos de escalado y guardia de un reintento |
| A3 operaciones | tools/lib/native-session-meter.mjs:21 NativeSessionMeter | Canonizar operaciones y conservar desconocida ante ambigüedad; A/B explícito |
| A4 sombra | packages/core/src/workflow-routing.ts:561 routeWorkflow | Decisión versionada y similitud con protocolo/contrato obligatorios; no activar despacho |
| A5 handoff | El runner histórico recorta el texto, no valida invariantes | Schema, límites y context-pack verificado antes de ejecutar |
| A6 rigor | attempt y snapshot existen; no hay aleatorización factorial | Semilla, tres repeticiones, condición de caché solicitada separada de observada |
| B evidencia | JSON locales y recibos nativos por modelo | Contrato nullable, importación inmutable e idempotente en SQLite |
| C informe | 17 tareas, 119 intentos; una muestra por combinación | Sin decisión con n<3, gráficos condicionados a calidad y protocolo; lagunas visibles |

## Corrección y compatibilidad

- workflow-routing.ts:304 exige taskSignature exacta; :315 filtra historial. Esto limita acumular muestras entre tareas distintas. La similitud nueva deberá exigir protocolo, contrato de aceptación, rol, nivel y riesgo iguales; no basta compartir nombre o complejidad. Con metadatos desconocidos no se agrupa.
- workflow-routing.ts:465 suma usdMax de intentos y divide por éxitos. Solo sirve si la entrada incorpora revisión y fallos completos; los JSON legados no permiten asumirlo por defecto. La importación nueva registra procedencia y no promueve ceros implícitos a mediciones.
- Los objetivos tokens y subscription-quota siguen explícitamente rule-based después de la consolidación. No se interpreta una tarifa API como cuota de suscripción.
- Codex devuelve contadores acumulados; contexto por llamada y categoría ausente deben ser N/D. Identidad solicitada no equivale a identidad confirmada. No se reescriben los recibos históricos.
- La caracterización actual tiene 12 casos de routeWorkflow y los previews del CLI. No se restauran APIs eliminadas por el refactor autorizado del titular.

## Entregas y límites

Se añaden exports públicos aditivos de contratos, EvidenceStore y experimentos tipados; no se cambian los contratos existentes de routeWorkflow ni de BacklogService. La política nueva se ejecutará únicamente en sombra. El banco original se mantiene congelado, sin mover .tmp y sin ejecutar modelos pagados. El informe nuevo vive en una carpeta distinta. La campaña requiere aprobación posterior.
