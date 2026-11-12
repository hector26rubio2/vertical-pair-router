# Vertical Pair Router

VPR organiza trabajo de ingeniería con Stories, Tasks, Runs, checks y evidencia
local. Incluye un CLI y un plugin de Claude Code. Sigue en desarrollo: aún falta
completar la delegación real entre proveedores y el experimento de ahorro.

## Qué funciona

- Backlog persistente, planificación, checks con límites/cancelación y revisión.
- Dashboard local con métricas, glosario y trazas de eventos observados.
- Inicialización con entrevista de tecnologías, integraciones y modelos.
- Aprovisionamiento de Husky y Graphify si se seleccionan y están disponibles
  sus requisitos. Archify comprueba el skill local mediante su diagnóstico.
- Reglas de routing probadas: modelo ligero para código simple de bajo riesgo
  con checks y autorización; escalado por riesgo y complejidad. La configuración
  no prueba por sí sola la calidad o disponibilidad del modelo en una cuenta.

## Probar desde el código fuente

Requiere Git, Node.js >=24.15 y <27, y pnpm 11. Claude Code es opcional para el
núcleo y necesario para cargar el plugin en ese host.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm vpr init --project . --interactive
```

La inicialización propone un perfil. Añadir `--apply` guarda el perfil y
aprovisiona las integraciones elegidas; puede descargar herramientas. Los
perfiles y hooks existentes se conservan. Los modelos se configuran con alias
o identificadores de la cuenta del usuario, sin extraer credenciales.

```sh
pnpm vpr init --project . --interactive --apply
claude --plugin-dir .
```

En Windows, `pwsh -File tools/start-local.ps1` inicia el dashboard. Abre la
dirección local impresa; contiene autorización de sesión y no debe compartirse.

## Graphify y Archify

```sh
node tools/integrations.mjs doctor
node tools/integrations.mjs graph --project .
node tools/integrations.mjs query --project . --question BacklogService
```

Graphify indexa sólo código mediante AST, sin modelo. Su instalación opcional
necesita Python y uv; no son requisitos del núcleo. Archify genera diagramas
desde especificaciones validadas; usa el skill local o `VPR_ARCHIFY_HOME`.

## Medición de tokens

Recolectar y mostrar contadores es procesamiento local sin inferencia. Ejecutar
agentes sí consume tokens. Las métricas conservan su fuente; lo no observado
es `unavailable`. La comparación debe usar la misma tarea/commit/modelo y checks
equivalentes e incluir preparación de contexto, orquestación y subtareas.
Todavía no hay un porcentaje de ahorro demostrado ni una factura calculada.

El objetivo predeterminado de la entrevista es `reference-cost`: compara el
valor de referencia por tarea aprobada según la
[tabla oficial por modelo](https://platform.claude.com/docs/es/about-claude/pricing),
separando entrada, salida y caché. Incluye Fable 5.2, Opus 5.5, Sonnet 5.5 y
los dos niveles de contexto de Haiku 5.5. Esto no cambia cómo pagas tu suscripción.

El objetivo opcional `subscription-quota` compara cuota observada por resultado aceptado,
incluidos fallos y reintentos. No convierte dólares API en cuota. La selección
por reglas y la lectura de contadores no llaman a modelos; las instrucciones
del plugin que se envían al agente sí forman parte de su contexto y consumo.

```sh
pnpm vpr models subscriptions --detect --provider claude
pnpm vpr models subscriptions --plan codex-business-standard
pnpm vpr models quota --input observaciones.json
```

`init --interactive` detecta el plan mediante el estado público de Claude Code
y permite corregirlo. Si el host no lo expone, el usuario elige el plan; un plan
desconocido conserva cuota y precio como no disponibles. No se fija Claude Pro
para todos los usuarios ni se leen credenciales. El catálogo fechado incluye
planes Claude, Codex Business Standard y Copilot, con fuentes oficiales y
vencimiento. No es un catálogo exhaustivo de todos los contratos empresariales.

En Claude Pro el precio publicado es USD 20/mes o USD 200/año; no hay una tarifa
pública fija de cuota por millón de tokens de Haiku/Sonnet. Sus límites dependen
del modelo, esfuerzo y contexto. Consulta [precios](https://claude.com/pricing)
y [límites de uso](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work).
Codex también distingue cuota incluida y créditos comprados; consulta sus
[límites y precios](https://learn.chatgpt.com/docs/pricing).

Las observaciones contienen `before` y `after` con `bucketId` anónimo,
`planId`, `resetAt`, `observedAt`, `usedPercent` y `source`
(`provider_reported` o `user_reported`), además de `isolated: true` sólo si no
hubo otra actividad. Deben pertenecer al mismo límite y periodo. El medidor
rechaza reinicios, actividad concurrente y cero visible por redondeo. El panel
muestra las observaciones ligadas a cada Run; no tiene aún lectura automática
universal del porcentaje restante de todos los proveedores.

Para un piloto real separado, con la misma API HTTP/SQLite y pruebas externas:

```sh
pnpm build
pnpm package:local
node tools/benchmark-project.mjs --approve-provider --include-haiku
```

Este comando consume la suscripción nativa de Claude Code. Conserva proyectos
y recibos de consumo en `.tmp/inventory-pilot-*`; no publica ni usa API keys.
Carga la copia empaquetada del plugin para que el proyecto no quede dentro de
la carpeta protegida del propio plugin. Una ejecución por variante es exploratoria:
no demuestra ahorro general ni cuánto más durará una suscripción.

## Paquete y distribución

`pnpm package:local` prepara el paquete autocontenido en `dist/npm`. El objetivo
es adjuntar un `.tgz` a una release de GitHub e instalarlo con npm/pnpm, seguido
de `vpr plugin install`. No requiere publicarlo en npm ni en el catálogo público
de Claude Code. La instalación del `.tgz` con npm y la carga de la copia del
plugin se probaron localmente en Windows. El registro permanente sigue pendiente
de validación. No hay release.

## Compatibilidad y documentación

Windows tiene evidencia local. La matriz CI está configurada para Windows,
macOS y Linux; los últimos dos necesitan ejecuciones reales antes de declarar
soporte verificado. PowerShell no es requisito del núcleo.

Los Markdown de la raíz son guías de contribución, conducta, soporte, seguridad
y atribuciones; no son funciones del runtime. Las atribuciones se conservan.

Consulta [el flujo local](docs/operations/local-workflow.md),
[portabilidad](docs/operations/portability.md) y
[el estado de ejecución](docs/backlog/execution.md).

