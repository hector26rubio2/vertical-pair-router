# Revisión del banco de experimentos — 2026-11-19

## Alcance y estado inicial

La fase vigente es experimentación. No se han autorizado nuevas llamadas a
modelos ni borrados. La campaña se entregará como propuesta. No se modifica el
router desplegado para aplicar una política nueva. El ADR-0009 se integra de
forma incremental y en sombra, conservando las firmas existentes.

Sólo está trabajando el coordinador; el inventario de agentes no encontró otro
agente editando estos archivos. `.vpr/profile.json` contiene cambios locales del
usuario y queda fuera de los commits. Se revisaron los cambios pendientes del
analizador, cobertura, dashboard y exportador, los tres módulos de veredictos y
sus pruebas. Se cierran como línea base, separados de las ampliaciones A–D.

Las mejoras previas distinguen checks de calidad revisada, resultados
incompletos de combinaciones no probadas y candidatos de piloto de rutas
automáticas. No demuestran calidad general equivalente ni selección óptima.

Desde este encargo, los 27 archivos existentes en `.vpr/benchmarks/` están
inventariados por tamaño y SHA-256 en
`.tmp/experiment-review/frozen-input-index.json`. Las salidas nuevas se escribirán
fuera de ese árbol. No se eliminará ni sobrescribirá evidencia antigua.

## Línea base medida

Entorno real: Node **24.18.0**, pnpm **11.1.2**, Windows.

| Comando | Resultado | Tiempo de pared |
|---|---|---:|
| `pnpm build` | Aprobado | 1,020 s |
| `pnpm typecheck` | Aprobado | 0,680 s |
| `pnpm test` | 223 aprobadas, 0 fallidas | 4,347 s |

Son mediciones locales, con compilación incremental; no son tiempos de instalación
limpia ni de ejecución de modelos. Los logs y el recibo de esta comprobación
están en `.tmp/experiment-review/baseline-*`.

Se midieron 169 archivos fuente en `tools/` y `packages/`, excluyendo dependencias
y compilados: **221 líneas superan 300 caracteres**. El máximo es de **8.158
caracteres**, `tools/lib/benchmark-dashboard.mjs:49` en este commit.

## Hallazgos de corrección — referencias anteriores al refactor

Las líneas siguientes corresponden al estado de este commit; el refactor posterior
las renumerará. No se corrigen en silencio durante la extracción de funciones.

1. **Agrupación demasiado exacta.**
   `packages/core/src/workflow-routing.ts:77` exige `taskSignature` idéntica,
   además de tipo, complejidad, riesgo y rol. Permite acumular repeticiones del
   mismo contrato, pero normalmente no tareas equivalentes con texto diferente.
   Conservar la firma como identidad reproducible y añadir un grupo de
   comparabilidad explícito: protocolo, contrato/aceptación versionados, rol,
   señales y restricciones compatibles. La similitud no debe mezclar contratos
   diferentes por compartir una etiqueta «medio».

2. **No falta todo productor de evidencia.**
   `tools/report-routing-matrix.mjs` ya exporta `WorkflowCase[]` con
   `--case-library`; el CLI los consume. Esto matiza la premisa del ADR-0009:
   falta un productor/store canónico, tipado y auditable, no toda conexión.
   El cierre previo de calidad deja 9 casos evaluados y sólo 1 positivo; no
   habilita un ranking automático. Se preservó copia de los 51 casos previos
   en `.tmp/workflow-cases-before-quality-review-20261119.json`, antes de este
   encargo. Desde la congelación actual no se vuelve a modificar ese archivo.

3. **Costo de revisión y fallos.**
   `packages/core/src/workflow-routing.ts:125` suma `usdMax` de los casos y divide
   entre aceptados. La corrección depende de que el productor incluya el flujo
   completo. Las recetas nuevas de F02 sí incluyen revisión fresca, corrección
   y segunda revisión cuando existen; no es correcto afirmar que toda revisión
   está en N/D. Sin embargo, los ensayos antiguos carecen de esa fase y los
   intentos incompletos no permiten un total completo. Nunca deben convertirse
   en cero ni desaparecer del denominador económico. Un diseño compartido no
   debe cobrarse entero a cada ejecutor.

4. **Protocolos mezclables.**
   `tools/lib/benchmark-analysis.mjs:13–14` favorece la serie de una corrección
   cuando existe; en otros casos conserva todas las filas. Esto no constituye
   una clave completa de protocolo, caché, presupuesto y snapshot.
   `tools/lib/benchmark-cost-allocation.mjs:28–29` aún muestra históricos de
   varios protocolos en la misma celda, aunque distinga el subconjunto comparable.
   El esquema nuevo separará esas celdas; las filas viejas se conservarán.

5. **Caché Codex no demostrada como cero.**
   `packages/runtime/src/native-agent.ts:88` convierte una escritura de caché
   omitida en `0`. `tools/lib/codex-reference-cost.mjs:3` requiere ese contador;
   por tanto, un cero normalizado no prueba que el proveedor lo haya informado.
   La migración mantendrá el recibo original, pero representará como N/D lo que
   no tenga procedencia observable. La lectura se resta de la entrada total;
   el razonamiento no se suma otra vez a la salida. La identidad Codex es
   **solicitada, no confirmada**, y el contexto acumulado no es contexto por llamada.

6. **El traspaso no es verificable.**
   `packages/core/src/workflow-routing.ts:154` devuelve nombres de campos.
   `tools/benchmark-finanzas-recipes.mjs:61` recorta el traspaso a los últimos
   16.000 caracteres. Puede perder contratos o invariantes; no hay hash ni
   validación del artefacto entregado. El fallo 7/9 de F02 está observado;
   atribuirlo al plan es una hipótesis que requiere el factorial de A1.

7. **Faltan controles experimentales.**
   `tools/benchmark-finanzas-recipes.mjs:58,69,93` ejecuta diseño, ejecución y
   revisión de nuevo. Los límites existen (`measured-recipes.mjs:40`) y los
   fallos se conservan, pero faltan planes compartidos inmutables, orden con
   semilla y estratos de caché. Cambiar de proveedor también cambia herramientas
   y contexto nativo; no es un aislamiento perfecto del efecto del modelo.

8. **Atribución por operación y archivo ausente.**
   `tools/lib/native-session-meter.mjs:58,65,104` conserva TTL, modelo pedido
   al subagente y herramientas, pero no operación ni bytes/tokens por archivo.
   Un resultado de `Read` puede estar recortado o contener numeración: sus bytes
   no equivalen al tamaño del archivo ni a tokens facturados de ese archivo.
   Esos campos requieren recibo específico o N/D con causa.

## Decisión de tipado (0.3)

Se adopta **`@vpr/experiments` en TypeScript**, conforme al ADR-0009, para contratos
de experimentos, normalización, diseño factorial, campaña, estadísticas y
análisis nuevo. El medidor tendrá una fuente en `@vpr/observability`. Los scripts
de `tools/` serán adaptadores graduales; no se reescribe todo de una vez.

La razón es que un esquema común debe servir al runner, SQLite y al informe.
JSDoc en cada script duplicaría contratos y no resolvería los imports internos.
Se conservarán wrappers de compatibilidad, pruebas de caracterización y formatos
antiguos. No se cambiarán firmas públicas existentes; los exports nuevos serán
aditivos y quedarán documentados. La decisión de routing nueva permanecerá en sombra.

## Propuesta de limpieza (0.4) — no ejecutada

- No borrar ni mover `.tmp/` ahora: varios informes apuntan a artefactos dentro
  de ella y un traslado rompería la revalidación de citas y hashes.
- Inventariar tamaños y referencias antes de proponer archivos concretos para
  archivo; pedir autorización antes de mover o borrar.
- Si se aprueba, archivar por campaña con manifiesto SHA-256, conservar la copia
  mientras se verifica la restauración y documentar los enlaces afectados.
- Aislar el runner nuevo en copias que excluyan `.tmp/`, `dist/` y
  `node_modules/`; limitar búsquedas a esa copia. No usar `--no-ignore` sobre el
  repositorio de trabajo. Las salidas nuevas irán a un árbol generado separado.

## Secuencia restante

1. Refactor sin cambiar decisiones ni resultados: funciones con nombre, plantilla
   separada, control de longitud y comparación de `summary.json`/`analysis.json`.
2. Diagnóstico de A–C y contratos canónicos aditivos: política, evidencia y handoff.
3. Store local/importación no destructiva, runner experimental con simulaciones
   y decisiones en sombra, integración del medidor e informe ampliado.
4. Campaña estratificada con semilla y presupuestos explícitamente estimados.
   Ninguna corrida de modelos se iniciará sin aprobación del owner.

## Bloque 0.2 — legibilidad y equivalencia (2026-11-19)

- Etapas privadas con nombre, integradas con la consolidación autorizada de la otra sesión: el punto público es ahora `routeWorkflow` y su caracterización conserva 12 decisiones. `routeRequest` sigue siendo routing de adaptadores. No se restauran los módulos eliminados por esa sesión.
- Plantilla, CSS y comportamiento del informe separados en `tools/lib/benchmark-dashboard-template.mjs`, `.css` y `.client.js`. Formato legible en fuentes de tools/packages; los textos de fixtures y prompts se conservan mediante concatenaciones.
- Control `pnpm lint:source`: máximo 300 caracteres por línea y 250 instrucciones por función. Excluye explícitamente node_modules, dist, generated y .tmp; se ejecuta en Husky y CI. El propio control está tipado y cubierto por pruebas.
- Validación real: build incluido en test, typecheck verde, 222 pruebas aprobadas tras integrar el handoff (3.184 s del runner), control de tamaño sin hallazgos. summary.json y analysis.json iguales antes/después excluyendo únicamente `at`; 27 hashes originales intactos. Evidencia local: `.tmp/experiment-review/refactor-equivalence.json` y `refactor-tests-final.log`.
- No se ejecutaron proveedores. `.vpr/profile.json` queda fuera de estos commits. No se borró ni archivó contenido.
