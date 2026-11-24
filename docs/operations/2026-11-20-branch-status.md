# Estado de la rama — 20 de noviembre de 2026

Rama: `refactor/workflow-routing`. Cierre local, sin push ni release.

La transición de módulos compila y pasa sus pruebas. Esto no significa que el
ahorro entre modelos esté demostrado ni que el router experimental esté activo.

## Implementado y comprobado localmente

| Parte | Estado comprobado |
|---|---|
| Routing de modelos | `routeWorkflow` conserva la autoridad; `routeWork` añade política versionada y decisiones en sombra. La caracterización anterior sigue pasando. |
| Ejecución normal | `executeNativeRun` y la protección de carpetas viven en runtime; el CLI conserva la configuración y presentación. |
| Inicialización | Configuración de tecnologías, integraciones y modelos extraída a config; agentes de proyecto con modelo explícito y preservación de definiciones existentes. |
| Evidencia | Contratos, JSON Schemas, validación e importación inmutable e idempotente en SQLite. Ausencias quedan en N/D. |
| Experimentos | Runner factorial y jerárquico, planes congelados, semilla, revisión fresca, un reintento y recibos parciales: comprobados con sustitutos locales. |
| Puente nativo experimental | Comprobaciones de modelo, proveedor, contexto y aislamiento antes de invocar; probado con ejecutor sustituido, sin inferencia real nueva. |
| Telemetría | Una fuente en observability; operaciones, contexto cuando hay contadores, lectura de caché y metadatos sin guardar prompts o código en el ledger. |
| Informe | Generación fuera del banco original, tablas por escenario/modelo, calidad, costos, Pareto, lagunas y campaña presupuestada. |
| Controles | Imports entre paquetes por exports públicos, límite de tamaño, revisión de seguridad en pre-commit y hashes de copias generadas. |

Verificación del cierre: Node 24.18.0, pnpm 11.1.2, Windows. `pnpm typecheck`,
`pnpm lint:source`, `pnpm lint:boundaries` y `pnpm test` pasan. La prueba completa
local reportó **296 tests aprobados**, sin fallos. El paquete local se construye
con `pnpm package:local`. Los 27 archivos congelados de `.vpr/benchmarks/`
mantienen sus hashes. Los logs están en `.tmp/experiment-review/20261120-*`.

También se exportó el contenido preparado del commit a una carpeta sin
compilados ni dependencias previas. La instalación offline, compilación,
comprobación de tipos, controles, **296/296 tests** y empaquetado pasaron allí.
Esta prueba detectó y permitió corregir un fallo de publicación de tipos del
medidor que el compilado previo ocultaba. Evidencia:
`20261120-clean-tests-3.log` y `20261120-clean-package-3.log`.

La revisión manual de seguridad del cambio completo pasó: 99 archivos, cero
hallazgos y cero solicitudes de aprobación. **El hook no está activo en este
checkout**: `.git/config` apunta a `company-hooks` y no existe su `pre-commit`.
Husky y sus controles están en el repositorio, pero falta acordar si se
encadenan al hook corporativo o se selecciona `.husky/_`. No se sustituyó esa
configuración local durante este cierre.

El perfil personal `.vpr/profile.json` se conserva fuera del commit. Los informes,
recibos, bases de evidencia y carpetas de prueba locales tampoco se publican.

## Pendiente antes de declarar terminado el flujo experimental

Antes de depender de la protección automática al hacer commits, resolver la
configuración del hook indicada arriba. Los checks manuales de este cierre no
demuestran que un futuro commit quede protegido automáticamente.

1. **Una prueba integral sin modelos pagados.** Seguir una tarea desde backlog,
   pasando por el runner, los recibos canónicos y SQLite, hasta la decisión en
   sombra y el informe. Las piezas tienen pruebas; todavía falta demostrar el
   recorrido conjunto desde un único punto de entrada.
2. **Integración del consumidor de evidencia.** El comando `agent` conserva
   `routeWorkflow` y la biblioteca JSON anterior. La importación SQLite y
   `routeWork` están disponibles, pero no se debe afirmar que esa evidencia ya
   gobierna automáticamente el despacho normal. Mantener sombra durante esta
   integración.
3. **Entrada de campaña por proyecto.** `vpr experiments` permite `report` y
   `validate-handoff`; no hay un `run` que ejecute una campaña implícitamente.
   Hay que cerrar la configuración del proyecto, los checks externos y el
   guardado de sus resultados antes de lanzar corridas reales con los puertos
   nativos. Los efectos factoriales y A/B deben alimentarse con esas salidas
   controladas; el informe histórico no puede fabricarlos.
4. **Escalados comprobables.** Validar un caso que agote el reintento y vuelva al
   diseñador. El campo `returnedToDesigner` del runner identifica historias
   escaladas; por sí solo no demuestra que se haya ejecutado una nueva pasada
   de diseño. Verificar también la agregación de costos compartidos, versiones
   de un mismo recibo y cancelaciones sin doble conteo.

## Pendiente de pruebas reales y entorno

- Autorizar y ejecutar primero el bloque factorial F02: Sonnet/Opus diseñan una
  vez; Haiku/Sonnet/Codex Terra ejecutan el mismo artefacto, con tres repeticiones
  por condición de caché y revisión común. No se han ejecutado nuevas llamadas
  de modelos para este cierre.
- Verificar que los contadores y la guardia de 90.000 tokens se comporten en
  sesiones reales, incluyendo subagentes. Un test del contrato o del hook no
  demuestra por sí solo una compactación real en todas las instalaciones.
- Codex debe conservar N/D en caché escrita o contexto cuando el proveedor no
  los informe, y la identidad «solicitada, no confirmada» donde corresponda.
- Probar Copilot con una cuenta que tenga modelos habilitados; no consta una
  ejecución nueva autorizada con la cuenta corporativa destino.
- Ejecutar la matriz macOS/Linux/Windows sobre estos commits. En este cierre
  la comprobación real es Windows; la configuración de CI no equivale a una
  ejecución nueva de sus otros entornos.
- Instalar y verificar el archivo empaquetado en otra máquina/cuenta. Construir
  `dist/npm` no equivale a actualizar el plugin instalado globalmente.

## Informe y propuesta disponibles

Informe local:
`.vpr/reports/2026-11-20-branch-close/informe.html`.
Incluye los 119 registros de ejecución y 845 llamadas del banco existente.
Resultado: **cero reglas listas para activar** con los criterios nuevos.
No hay base para afirmar que una combinación alarga la suscripción.

`campaign.json`, junto al informe, contiene 318 celdas propuestas, semilla,
repeticiones, revisiones y reserva de una corrección. Son estimaciones API
basadas en catálogos fechados, no cuotas ni cargos de suscripción. No se aprueba
ni ejecuta la campaña por generar ese archivo.

## Siguiente paso recomendado

Cerrar primero la prueba integral local del punto 1 y sus conexiones pendientes.
Después revisar y autorizar solamente el bloque F02. Con sus resultados,
decidir si vale la pena ampliar la campaña. La activación de política, el push
y la release quedan para un cierre posterior.
