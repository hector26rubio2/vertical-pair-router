# Vertical Pair Router

> Protección Haiku verificada localmente el 18/11/2026: el módulo cuenta el
> contexto completo antes del envío, incluidos los prefijos que Claude Code
> conserva en sus hilos. Bloquea desde 90.000 tokens estimados y configura una
> ventana nativa de compactación de 100.000, que puede compactar antes del umbral.
> Una prueba grande completó dos compactaciones automáticas; su mayor prompt
> observado fue 54.391 tokens. Una petición de prueba estimada en 452.168 fue
> bloqueada con cero tokens de inferencia. El contador del proveedor es una
> estimación; se conserva un margen de 10.000 frente al tramo caro. Si no puede
> contarse el contexto, la ejecución se detiene. La cuenta corporativa necesita
> verificar su política compatible; otras sesiones sin el módulo no están cubiertas.
> Contar no genera tokens de modelo; la propia compactación sí se contabiliza.

La protección de Haiku está implementada para Claude de primera parte. Haiku
mediante otro proveedor queda excluido hasta contar con una protección previa
equivalente; listar el modelo no basta para prometer el límite de contexto.

VPR organiza trabajo de ingeniería con Stories, Tasks, Runs, checks y evidencia
local. Incluye un CLI y un plugin de Claude Code. La ejecución Claude está
probada localmente. Codex ya corrigió un archivo en una copia aislada y pasó sus
cinco casos de aceptación. Sonnet→Codex Terra y Sonnet→Codex Sol también aprobaron
los nueve criterios externos, regresiones y compilación del caso real Finanzas;
Sol conservó un hallazgo medio y no se recomienda como caso positivo de routing.
La aceptación de Copilot con cuenta corporativa sigue pendiente.
Su adaptador utiliza el SDK oficial 2.0.1 y CLI 1.0.114; el arranque y consulta
de cuenta se comprobaron sin inferencia, con cero modelos habilitados en esta cuenta.

## Qué funciona

- Backlog persistente, planificación, checks con límites/cancelación y revisión.
- Dashboard local con métricas, glosario y trazas de eventos observados.
- Inicialización con entrevista de tecnologías, integraciones y modelos.
- Aprovisionamiento de Husky, Graphify y Archify si se seleccionan y están
  disponibles sus requisitos. Las versiones descargadas están fijadas.
- Reglas de routing probadas: modelo ligero para código simple de bajo riesgo
  con checks y autorización; escalado por riesgo y complejidad. La configuración
  no prueba por sí sola la calidad o disponibilidad del modelo en una cuenta.
- Propuesta local de modelos por fase: ejecución directa o planificación,
  implementación y revisión. El planificador/revisor no escribe archivos y el
  ejecutor preferido es configurable. La propuesta no lanza agentes por sí sola.
- Ejecución real con `vpr agent run` y `/vpr-run`, contadores por modelo/fase,
  checks ejecutados por el controlador y revisión final visible. No hace commits
  automáticos de las modificaciones de un agente.

## Instalar y probar el paquete local

La distribución usa un `.tgz` de GitHub Releases, instalable con npm o pnpm.
Para la versión 0.1.0:

```sh
npm install --global https://github.com/hector26rubio2/vertical-pair-router/releases/download/v0.1.0/vertical-pair-router-0.1.0.tgz
vpr plugin install
vpr plugin doctor
```

Con pnpm, sustituye la primera orden por `pnpm add --global` con la misma URL;
su directorio global debe estar configurado. La release incluye `SHA256SUMS`
y el inventario de dependencias `SBOM.json`.

La compilación local genera ese mismo formato; los pasos de registro, actualización y retirada
están en [la guía de instalación](docs/operations/portability.md).
`vpr plugin install` registra el plugin en Claude desde el paquete instalado;
no lo publica en un catálogo central. Reinicia Claude y usa `/vpr-use` para
ver el consumo observado sin generar tokens de modelo.

Los Markdown de contribución, conducta, soporte y seguridad explican cómo
colaborar y comunicar problemas; no son funciones ni aumentan los tokens del
agente por existir. Las instrucciones cargadas como skills sí pueden formar
parte del contexto y su costo debe incluirse en las mediciones.

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
vpr tools doctor --project .
vpr tools graph --project .
vpr tools query --project . --question BacklogService
vpr tools diagram --project . --type architecture --input diagrama.json --out .vpr/diagramas/sistema.html
```

Graphify indexa sólo código mediante AST, sin modelo. Su instalación opcional
necesita Python y uv; no son requisitos del núcleo. Archify genera diagramas
desde especificaciones validadas; usa el skill local o `VPR_ARCHIFY_HOME`.
Si no existe una instalación y se elige en `init --apply`, descarga la versión
MIT 2.16.0 del repositorio oficial, fijada al commit
`c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`, en `~/.vpr/tools` mediante Git.
No sustituye una instalación existente ni sigue automáticamente `main`.
Los comandos están incluidos en el paquete instalado. La búsqueda consulta el
grafo local mediante recorrido acotado; no consulta un modelo. Pedir a un agente
que analice código o diseñe la especificación del diagrama sí usa ese agente.

## Configurar un proyecto e impedir secretos en commits

```sh
vpr init --project ruta/al/proyecto --integrations husky,graphify,archify --apply
vpr tools doctor --project ruta/al/proyecto
vpr security check --project ruta/al/proyecto
```

`init` detecta tecnologías a partir de archivos locales y conserva el perfil
existente. También admite carpetas sin `package.json`. Si falta una herramienta
opcional o un requisito, lo informa como no disponible. No instala un sustituto
de las herramientas ni cambia un `core.hooksPath` ajeno. Husky requiere un repositorio Git
propio y un gestor Node disponible. La preparación y la búsqueda no llaman a IA.

El pre-commit inspecciona los **blobs preparados**, incluidos archivos nuevos y
renombrados. Bloquea `appsettings*`, archivos de entorno y material de credenciales;
detecta patrones de claves, tokens, contraseñas y URLs con credenciales. Imprime
regla, ruta y línea, sin mostrar el valor sensible. No existe una variable
`ALLOW_SECRETS` que conceda permiso. La detección es heurística y puede requerir
revisión; no garantiza encontrar toda información sensible.

Para permitir una configuración sanitizada se exige una firma Ed25519 del
titular, ligada a repositorio, ruta, SHA-256 del blob y caducidad (máximo 24 h).
El chequeo devuelve una solicitud y su texto exacto para firma; **no firma ni
genera aprobaciones**. La clave privada permanece bajo control del titular.
La clave pública confiable se configura en Git a nivel de sistema, fuera del
repo: `git config --system vpr.securityOwnerKey <archivo-publico-protegido>`.
El titular deposita las firmas en `<git-dir>/vpr-config-approvals.json`, con
formato `{ "approvals": [{ "path": "...", "sha256": "...", "expiresAt": "...", "signature": "base64..." }] }`.
Una aprobación de configuración nunca exime un secreto detectado. Cambiar el
contenido invalida la firma. No guardes claves privadas en el repositorio ni en
variables usadas como autorizaciones del hook.

Los hooks locales pueden omitirse desde Git. Para hacer obligatoria la política
remota hay que activar los checks de CI y la revisión del titular en GitHub;
`CODEOWNERS` por sí solo no activa esas protecciones.

## Medición de tokens

Recolectar y mostrar contadores es procesamiento local sin inferencia. Ejecutar
agentes sí consume tokens. Las métricas conservan su fuente; lo no observado
es `unavailable`. La comparación usa la misma tarea, commit y aceptación. Para
comparar estrategias se declaran sus modelos y roles y se contabiliza todo el
árbol, incluyendo preparación de contexto, orquestación, subtareas y reintentos.
Un control del efecto del contexto mantiene el mismo modelo en ambos brazos.
Un ensayo controlado Sonnet solo frente a Sonnet coordinador + un Haiku logró
menor costo de referencia, con más tokens y mayor tiempo. No demuestra ahorro
general ni facturación de una suscripción.

El dashboard permite **Actualizar consumo nativo** y alternar entre cuenta/modelo
y ejecución/fase, con entradas, salidas, caché, USD y tiempo hasta el recibo.
Lee el mismo registro local que `vpr use all --detail`; no llama a modelos ni
mezcla cuentas distintas. Los registros anteriores a la activación y los de
otras máquinas no se reconstruyen automáticamente.

Los ensayos ampliados cubren conflictos de código, requerimientos, diagnóstico
y corrección de bugs, inicialización offline, refactor estructural, análisis de
proyecto y caché LRU. Se conservan intentos fallidos y correcciones del banco de
pruebas sin volver a ejecutar el modelo. Los datos locales están en
`.vpr/benchmarks/`; se excluyen de Git. Una prueba acotada no demuestra ahorro
general ni sustituye una evaluación en proyectos grandes.

```sh
pnpm vpr models plan --project . --input .vpr/workflow-request.json
```

Este comando consulta casos locales de `.vpr/benchmarks/workflow-cases.json`
sin inferencia. Sólo compara casos con el mismo tipo, firma de tarea,
complejidad, riesgo, proveedor, modelos y esfuerzo; exige tres casos por alternativa y
calidad suficiente antes de emitir una previsión por costo del flujo completo.
Incluye fallos y reintentos. Sin evidencia suficiente usa reglas configuradas y
no presenta el resultado como el modelo más barato demostrado. La disponibilidad
del archivo de solicitud es declarada por el llamante; no es un sondeo en vivo.
Invocarlo dentro de un chat no elimina los tokens que ese chat ya recibió.

El puente experimental Claude→Codex comprobó la llamada MCP y devolvió
contadores de ambas sesiones. Los intentos bloqueados de escritura se conservan
y no cuentan como implementación completada ni ahorro. El CLI oficial independiente
de Codex resolvió el arranque en Windows y superó el piloto de edición de archivos.
Copilot no se ejecutó con una cuenta real. No se usan
claves API ni se extraen credenciales para aprovechar una suscripción.

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

Desde el repositorio, para un piloto real separado de la misma API HTTP/SQLite,
con Sonnet solo frente a Sonnet que delega en un único Haiku:

```sh
pnpm build
pnpm package:local
node tools/benchmark-orchestrated-project.mjs --approve-provider
node tools/report-orchestrated-project.mjs --report .tmp/delegation-pilot-<id>/report.json
```

Los roles se pueden intercambiar o configurar con IDs completos. Por ejemplo,
para añadir Haiku como orquestador y Sonnet como ejecutor al mismo piloto:

```sh
node tools/benchmark-orchestrated-project.mjs --approve-provider --resume .tmp/delegation-pilot-<id> --coordinator-model claude-haiku-5-5 --executor-model claude-sonnet-5-5
```

La reanudación conserva los brazos aceptados y rechaza sobrescribir intentos
incompletos. Verifica los modelos realmente observados y mantiene separados
los roles. Si ambos roles usan el mismo modelo, los contadores agregados se
etiquetan como roles combinados; no se inventa un reparto por agente.

Este comando consume la suscripción nativa de Claude Code. Conserva proyectos
y recibos de consumo en `.tmp/delegation-pilot-*`; no publica ni usa API keys.
Carga la copia empaquetada del plugin para que el proyecto no quede dentro de
la carpeta protegida del propio plugin. Una ejecución por variante es exploratoria:
no demuestra ahorro general ni cuánto más durará una suscripción.

El coordinador tiene sólo lectura y delegación; el ejecutor tiene lectura y
edición. El informe verifica una llamada `Agent` real a Haiku y ausencia de
ediciones del coordinador. Usa `result.modelUsage` para incluir a los subagentes;
`result.usage` contiene sólo el bucle principal y no se suma otra vez.
Desglosa conteos y dólares por entrada, salida, lectura/escritura de caché,
modelo, rol y total. Registra tiempos de API, trabajo del subagente, cierre y
checks por separado. No atribuye tokens exactos a archivos cuando el host no
expone ese dato.

Si las pruebas propias de la línea base fallan por la limpieza del SQLite,
`node tools/repair-pilot-baseline.mjs --approve-provider --report <report.json>`
permite una corrección con el mismo Sonnet. Sus tokens y costos quedan añadidos
al informe; volver a ejecutar el generador de resumen recalcula los totales.
El antiguo `benchmark-project.mjs` es un control con el mismo modelo, sin
delegación; no debe presentarse como prueba del orquestador.

## Paquete y distribución

Antes de conectar proveedores, cada usuario inicia sesión en sus propios CLIs.
Para Codex: `codex login` y `codex login status`; no se necesita una API key.
`vpr models status --provider codex` consulta modelos/esfuerzos y cuota sin
iniciar un turno de IA. Los créditos ausentes se muestran como desconocidos;
el porcentaje restante nunca se calcula a partir de precios API.

El [perfil Claude/Codex](examples/profiles/claude-codex-project.json) muestra
roles separados para Sonnet, Haiku, Opus, Sol, Terra y Luna. Es una base para
incorporar al perfil del proyecto; conserva sus checks y su identidad.
`models plan` admite `executionRole` y `executorModelIds`: las revisiones e
inventarios no proponen escribir archivos. Añade `--capability-query` para
recuperar recomendaciones locales con fuentes y `--live-status` para comprobar
los modelos/esfuerzos y la cuota actual de Codex. La selección es una propuesta;
`vpr agent run --project . --input tarea.json` ejecuta las fases propuestas con
los CLIs nativos y registra el consumo. Requiere sesión propia, proveedores
autorizados y checks de aceptación para modificar código.

Las fichas oficiales orientan la primera elección; los casos locales deciden
si una ruta medida resulta más barata. Sonnet también implementa, Haiku puede
analizar tareas acotadas y Sol/Terra/Luna no se consideran intercambiables por
tener acceso a la misma suscripción. No se reutiliza evidencia de implementación
como si validara una revisión. Consulta la [configuración paso a paso](docs/operations/pilot-and-release.md#configurar-proveedores-en-otra-máquina).

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

## Uso y ejecución en la cuenta de cada usuario

Dentro de Claude Code, `/vpr-use` muestra la sesión y el contexto actuales;
`/vpr-use all` acumula sesiones registradas en esta máquina y `/vpr-use account`
filtra la cuenta conectada. Añade `detail` para distinguir agente y fase.
El comando utiliza la API nativa de visualización y no añade su salida al
contexto del modelo. No solicita un recuento remoto de contexto.

En la terminal: `vpr use --session <id>`, `vpr use --all` y
`vpr use --account-provider claude` (también `codex` o `copilot`). Añade
`--detail --json` para exportar metadatos. `--offline` evita la consulta de cuota
de Codex. El registro vive fuera del repositorio, en `~/.vpr/usage`, separa
cuentas mediante identificadores locales con sal y no guarda correos,
credenciales, prompts, respuestas ni código. No mezcla cuentas no identificadas.

La cuota del proveedor puede abarcar otras máquinas; el desglose por modelos
cubre las sesiones que VPR ha registrado localmente desde su activación.
Los datos ausentes o vencidos se muestran como desconocidos, no como consumo cero.
Los dólares de referencia del modelo y las cuotas se mantienen separados.

`/vpr-run ruta/tarea.json` ejecuta una tarea explícita desde Claude y enlaza su
consumo delegado con la sesión principal. El equivalente en terminal es
`vpr agent run --project . --input tarea.json`. `--preview` detecta las sesiones
y muestra filtros y propuesta sin consumir tokens de modelo. La ejecución
se detiene ante errores de permisos o de checks; aprobar los checks no sustituye
la revisión final del resultado.

Para la prueba en otra máquina se incluye `examples/pilot-project` dentro del
paquete instalado. Copia esa carpeta a un directorio propio antes de ejecutarla:
contiene un bug intencional, cinco pruebas externas y una tarea JSON. El piloto
permite los tres proveedores sólo para ese código sintético; reduce la lista de
proveedores autorizados antes de usar VPR con código de una empresa.

```sh
vpr plugin doctor
vpr agent run --project ruta/al/piloto --input ruta/al/piloto/task.json --preview
vpr agent run --project ruta/al/piloto --input ruta/al/piloto/task.json
vpr use --all --detail
```

`plugin doctor` debe reconocer `vpr-use` antes de invocarlo dentro de Claude.
Después carga la carpeta que devuelve `vpr plugin path` con `claude --plugin-dir`.
El comando aparece en el autocompletado de esa sesión. Un host antiguo o un
plugin no cargado puede interpretar un comando desconocido como texto dirigido
al modelo; usa `vpr use` en la terminal mientras no se haya verificado la carga.
La validación local de módulos y el diagnóstico de licencia para publicación
se informan por separado. Esta preparación no publica el paquete.

Consulta [el flujo local](docs/operations/local-workflow.md),
[portabilidad](docs/operations/portability.md) y
[el estado de ejecución](docs/backlog/execution.md).

