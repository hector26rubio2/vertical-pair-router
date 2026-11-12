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

## Paquete y distribución

`pnpm package:local` prepara el paquete autocontenido en `dist/npm`. El objetivo
es adjuntar un `.tgz` a una release de GitHub e instalarlo con npm/pnpm, seguido
de `vpr plugin install`. No requiere publicarlo en npm ni en el catálogo público
de Claude Code. La instalación empaquetada sigue en validación. No hay release.

## Compatibilidad y documentación

Windows tiene evidencia local. La matriz CI está configurada para Windows,
macOS y Linux; los últimos dos necesitan ejecuciones reales antes de declarar
soporte verificado. PowerShell no es requisito del núcleo.

Los Markdown de la raíz son guías de contribución, conducta, soporte, seguridad
y atribuciones; no son funciones del runtime. Las atribuciones se conservan.

Consulta [el flujo local](docs/operations/local-workflow.md),
[portabilidad](docs/operations/portability.md) y
[el estado de ejecución](docs/backlog/execution.md).

