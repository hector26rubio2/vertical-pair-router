# Pilot and release runbook

## Reproducible pilot

Run three cases: a small feature with observable acceptance criteria; a
reproduced bug with a regression test; and a multilayer change with an ADR.
Create their Stories using `vpr story` preview/apply or the dashboard. Plan
Tasks through BacklogService, and create a Run before execution.

For each case, start baseline and VPR in separate clean checkouts of the same
base commit. Use identical acceptance criteria, tool versions, tests and time
limits. Authenticate with the owner's own host account. Obtain provider/budget
authorization before starting inference. Record commit, Story, model receipt,
checks, review findings, interventions, duration and tokens/cost with source.
Missing provider values remain unavailable. Record failed and cancelled runs.

Use `UsageSampleRecorded` for comparable measurements with `storyId`, `commit`,
`label` (baseline/plugin), `metric`, `source`, and `sampleSize`. Do not combine
different units into one sample. Export evidence through `vpr data export`.
Three cases provide exploratory evidence only; they cannot substantiate a
general savings claim. Provider pilots remain NOT_RUN until actually executed.

### Ensayos locales ampliados

Los siguientes comandos consumen la sesión nativa del proveedor sólo cuando
incluyen `--approve-provider`. No usan claves API. La medición y generación de
informes no llaman a modelos. Ejecútalos secuencialmente para no introducir
competencia entre experimentos; conserva los controles de caché y orden.

```sh
node tools/benchmark-routing-matrix.mjs --approve-provider
node tools/benchmark-routing-matrix.mjs --approve-provider --suite workflows --arms haiku-solo,opus-haiku,opus-solo
node tools/benchmark-routing-matrix.mjs --approve-provider --suite workflows --arms opus-haiku --planning-control --resume <directorio-del-ensayo>
node tools/benchmark-orchestrated-project.mjs --approve-provider --baseline-model claude-opus-5-5 --coordinator-model claude-opus-5-5 --executor-model claude-haiku-5-5
node tools/benchmark-real-refactor.mjs --approve-provider
```

El control `--planning-control` mide deliberadamente el sobrecosto de planificar
tareas claras; no es la configuración recomendada de producción. El refactor
real congela el código fuente del dashboard en copias aisladas, conserva las
pruebas y verifica compilación, límites de edición y separación de módulos.
No integra ninguno de los cambios experimentales en el dashboard de trabajo.

```sh
node tools/report-routing-matrix.mjs --report <matriz.json> --additional <flujos.json> --inventory <resumen-inventario.json> --output .vpr/benchmarks/informe-local --case-library .vpr/benchmarks/workflow-cases.json
```

`--additional` y `--inventory` se pueden repetir. El informe muestra cada tarea,
rol, modelo, entrada sin caché, input total, salida, caché leída/escrita, precios,
tiempos y aceptación. Incluye intentos incompletos y conserva la procedencia de
las evidencias. Los precios son referencia oficial API, no cargos de suscripción.
El total acumulado de input no determina el nivel de contexto de una petición:
se requieren contadores por petición o límites que lo demuestren. Los rangos no
se convierten en un importe exacto cuando falta información de caché o contexto.

`vpr models plan --project <ruta> --input <solicitud.json>` propone una ruta
sin ejecutarla. La solicitud declara `kind`, `taskSignature`, `complexity`,
`risk`, `hasAcceptanceChecks`, `needsPlanning`, `currentModelId`,
`preferredExecutorId`, `plannerId`, `advancedPlannerId`, `allowedProviders`,
`verifiedModelIds` e `history`. Los identificadores son los del perfil, no
necesariamente los nombres comerciales. `history` puede ser vacío; se añade la
biblioteca local automáticamente. `taskSignature` identifica el mismo contrato
de aceptación; no se mezclan tareas sólo por compartir nivel de dificultad.

Las bibliotecas guardan costos del flujo entero, no sólo del ejecutor. Se mapean
a modelos/esfuerzos configurados y no autorizan proveedores ni prueban acceso
actual. Con menos de tres casos comparables por alternativa se aplican reglas,
sin afirmar un ahorro empírico. Los pasos de planificación y revisión comparten
el planificador; no se abren tres agentes por defecto.

Claude→Codex se ensayó con `tools/benchmark-claude-codex.mjs` mediante un puente
MCP local, sesión ChatGPT nativa y permisos acotados. El transporte y los
contadores funcionaron, pero Codex respondió sólo lectura y no implementó.
El owner autorizó retomar la prueba el 17 de noviembre. El nuevo intento con
Sonnet→Terra volvió a informar sólo lectura; se conserva como incompleto, con
su consumo. No confundir conexión y listado de modelos con edición funcional.
Copilot permanece sin probar por falta de suscripción.

### Límites de la ejecución nativa y calidad

Cada tarea usa `phaseTimeoutMs` (predeterminado 180.000; máximo 300.000) y
`totalTimeoutMs` (predeterminado y máximo 1.500.000). Los checks pueden definir
`timeoutMs` entre 1.000 y 600.000 en su entrada del perfil; el valor por defecto
es 60.000. Esto permite compilar aplicaciones reales sin convertir la espera
en una ejecución ilimitada. `/vpr-run` usa un proceso ligado a la cancelación
del comando; no deja un trabajo independiente de la sesión.

El controlador compara hashes del árbol de fuentes antes y después de cada
fase, omitiendo dependencias y directorios generados comunes. Detiene cambios
fuera de `allowedPaths` y modificaciones de checks o perfil. Las pruebas
existentes y un `package.json` existente están protegidos por defecto. La tarea
del owner puede declarar `allowExistingTestChanges: true` o
`allowPackageChanges: true` cuando ese cambio es precisamente parte del alcance;
eso no autoriza secretos ni elimina la revisión final. Las pruebas nuevas se
pueden añadir dentro del alcance. No se revierten archivos automáticamente al
detectar una infracción: se conserva evidencia para revisar lo sucedido.

Los trabajadores Claude sólo reciben herramientas de lectura/escritura de su
fase, sin skills ni comandos adicionales y con MCP vacío. Se conservan los
ajustes y permisos del host. Graphify, si está configurado, aporta hasta 4.800
caracteres de pistas locales; el modelo debe comprobarlas contra el código
actual. Su consulta no genera tokens de modelo; incluir esas pistas en la
petición y analizarlas sí consume tokens. Su ahorro aún no está demostrado.

Los tiempos de la campaña Finanzas se observaron en una máquina de desarrollo
compartida, sin aislar carga ni caché. No prueban la velocidad intrínseca de un
modelo. Los bloqueos técnicos, cuotas y protocolos distintos se conservan en
los datos pero se excluyen de la comparación pertinente. Las observaciones
medias pendientes impiden recomendar una ruta o aprenderla como caso positivo,
aunque se haya aprobado el contrato estructural.

### Configurar proveedores en otra máquina

Cada usuario inicia sesión con su propia cuenta. VPR no copia credenciales.
Instalar el CLI de Codex (`npm install -g @openai/codex`), ejecutar `codex login`
y comprobar `codex login status`. Usar el inicio de sesión ChatGPT; no añadir
una API key para intentar utilizar la suscripción. [Autenticación oficial](https://learn.chatgpt.com/docs/auth).
En Claude Code, completar su inicio de sesión nativo; el plugin no inicia ni
transfiere esa sesión a Codex.

En Windows, VPR resuelve el binario nativo del paquete npm de Codex, incluido
el directorio global de Volta, sin ejecutar un `.cmd`. Si hay varias instalaciones,
`VPR_CODEX_CLI` permite seleccionar una ruta absoluta al binario. Una selección
inválida bloquea la conexión; no se usa otra instalación silenciosamente.
El CLI npm independiente no hereda la identidad de arranque MSIX del escritorio.
Se mantienen los permisos configurados y las restricciones administradas.
Antes de gastar tokens, VPR comprueba la ejecución Windows con un comando fijo
local, política administrada incluida, acceso al proyecto y red desactivada.
Un fallo detiene la fase con cero inferencia y un diagnóstico; no se repara
la configuración del sistema ni se amplían permisos automáticamente.

`vpr models status --provider codex` consulta el servidor nativo mediante
`model/list` y `account/rateLimits/read`: no inicia un chat ni un turno de modelo.
Devuelve modelos/esfuerzos disponibles, porcentaje restante por ventana y saldo
de créditos sólo si el servicio lo informa. No devuelve identidad, credenciales
ni IDs de créditos de reinicio; no compra ni consume reinicios.
[Protocolo oficial](https://learn.chatgpt.com/docs/app-server).
Un modelo listado no demuestra permisos de escritura ni que la tarea terminará.

El perfil de ejemplo `examples/profiles/claude-codex-project.json` separa Sonnet,
Haiku, Opus, Luna, Terra y Sol por proveedor y roles. Incorporar los bloques
revisados en `.vpr/profile.json` después de `vpr init --project . --apply`,
conservando el ID, tecnologías y checks del proyecto propio. No sustituir todo
el perfil con el ejemplo. El ejemplo mantiene ejecución de comandos desactivada;
la prueba nativa habilita comandos sólo en su copia aislada y exige permisos de
escritura del host. No modifica los permisos administrados de Codex.

La solicitud de `models plan` admite `executionRole` (`coding`, `review` o
`inventory`) y `executorModelIds`, por ejemplo
`["haiku","codex-luna","codex-terra","codex-sol"]`. `preferredExecutorId`
es la opción inicial; las alternativas compiten con evidencias del flujo entero,
incluyendo planificación, revisión y correcciones, para el mismo contrato y rol.
Las pruebas de implementación no prueban calidad de revisión. Las fases de
revisión e inventario proponen `writeFiles:false`.

```sh
vpr models plan --project . --input solicitud.json --capability-query "revisión arquitectura compleja" --live-status
```

`--capability-query` recupera fichas oficiales locales, sus fuentes y caducidad;
añade candidatos configurados sin autorizar otros proveedores ni afirmar que
son óptimos. No usa embeddings remotos ni un modelo para elegir otro modelo.
`--live-status` verifica modelos/esfuerzos Codex y consulta su cuota antes de
proponer. Excluye un proveedor cuyo límite reciente está alcanzado. Los datos
de más de cinco minutos pasan a desconocidos. `requireKnownCapacity:true`
bloquea propuestas sin capacidad conocida; el valor por defecto permite cuota
desconocida y la muestra explícitamente. No convierte dólares API en créditos.
Claude recibe las ventanas de cuota mediante el módulo nativo de medición;
Copilot consulta el método de cuota de su SDK cuando existe. Los datos no
informados permanecen desconocidos. `models plan` propone; `agent run` ejecuta.
Claude Code documenta `rate_limits` en los datos de la barra de estado para
planes compatibles, después de la primera respuesta. Esa es una vía oficial
para el capturador local, sin leer credenciales. El módulo utiliza las mismas
ventanas mediante `session.measure`. [Campos de la barra de estado](https://code.claude.com/docs/en/statusline).
Copilot ofrece `/usage` para consumo por modelo/sesión; ese consumo no es por
sí solo saldo mensual restante. [Uso de Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview).

Para Copilot, instalar `@github/copilot@1.0.114` (pareja probada con el SDK 2.0.1),
abrir `copilot`, completar `/login` y elegir entre los modelos ofrecidos por
ese cliente/cuenta. Añadir `copilot` a la política y un modelo con su ID real
sólo tras verificar acceso. No reutilizar el ID, precio o sesión de Claude para
un modelo homónimo en Copilot. El adaptador está implementado mediante el SDK;
su validación con una cuenta corporativa permanece pendiente. [Instalación oficial](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).

Comprobación en el otro computador:

1. Instalar el paquete VPR y registrar el plugin con `vpr plugin install`.
2. Instalar el CLI oficial de Copilot, abrirlo y completar `/login` con la cuenta
   corporativa. Consultar `/model`; la organización debe permitir el CLI y el modelo.
3. Ejecutar `vpr init --project . --interactive --apply`. Elegir los modelos por
   sus IDs reales y autorizar `copilot` en la política del proyecto. Si se combina
   con Claude, conservar los roles y proveedores propios de cada modelo.
4. Consultar `vpr models status --provider copilot` y preparar una tarea con
   alcance de archivos y checks reales. Usar primero `/vpr-run --preview tarea.json`.
5. Ejecutar `/vpr-run tarea.json` en una copia de prueba. Verificar el diff, los
   checks y `/vpr-use`; éste muestra los contadores que entregue el SDK por fase.

Los modelos no listados, deshabilitados o atribuidos a BYOK quedan excluidos.
Las peticiones de aprobación corporativa no se aprueban automáticamente. VPR
no copia sesiones de otra cuenta y elimina PAT y claves API heredadas del proceso
hijo para usar el login nativo. Una cuota o categoría de tokens no informada
se muestra como desconocida, sin convertirla en cero ni en una factura.

El catálogo local incorpora fichas Copilot independientes para Haiku, Sonnet,
Opus, Luna, Terra, Sol, MAI Code 2 y MAI Code 2 Flash. Los roles recomendados son
políticas iniciales de VPR derivadas de la documentación; no resultados locales.
Los IDs nativos de las fichas son candidatos que deben contrastarse con `/model`.
La disponibilidad puede diferir entre CLI, IDE, plan y política de organización.
Las fichas no habilitan Copilot en el perfil actual ni envían código.

`vpr models prices --provider copilot` muestra las tarifas oficiales locales
de GitHub, sus umbrales por petición, promociones y caducidad, sin llamar a un
modelo. `--provider claude` y `--provider codex` consultan los catálogos separados.
No reutilizar tarifas o resultados de la API directa para Copilot.
GitHub publica 1 AI credit = USD 0,01, pero planes anuales heredados pueden usar
multiplicadores de solicitudes. La consulta no detecta cuál corresponde a una
cuenta ni equivale a un débito observado.
[Tarifas de Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
MAI Code 2 Flash figura con tarifa promocional menor que Haiku/Luna; sólo es
candidato más barato por token, no prueba de menor costo por tarea aprobada.
La revisión elegida por VPR en el CLI es distinta del producto de revisión de PR
de Copilot, donde GitHub no revela el modelo y puede cobrar minutos de Actions.

## Local release preparation

Actualización de integración local (17 de noviembre de 2026): `agent run`
ejecuta fases nativas y guarda recibos en `.vpr/runs`; `models plan` conserva su
comportamiento de propuesta. `agent run --preview` muestra el filtro por política,
sesión nativa, modelo/esfuerzo, cuota conocida, rol y complejidad. Los perfiles
globales de `~/.vpr/global.json` se intersectan con la política del proyecto;
la ejecución no amplía las restricciones administradas de los proveedores.
Las alternativas no disponibles no reciben código ni prompts.

El adaptador Copilot utiliza `@microsoft/copilot-sdk` 2.0.1 por stdio explícito,
con el CLI `@github/copilot` 1.0.114 y el login nativo
y sólo los modelos atribuidos a Copilot y habilitados por política. Nunca usa
configuraciones BYOK. La lectura de cuotas usa el método nativo `account.getQuota`
cuando existe y conserva las unidades del servicio. La cuenta de esta prueba no
tiene una suscripción Copilot. El arranque real del SDK y el login GitHub respondieron
sin inferencia, pero el catálogo devolvió cero modelos habilitados. Eso bloquea
la delegación y no se presenta como una prueba de ejecución con Copilot.
No se mezclan SDK 1 y protocolo 4; una incompatibilidad de cliente/runtime
se detiene antes de enviar la tarea.

El comando `/vpr-use` es un módulo nativo, no una skill que pida una respuesta
a un modelo. Consulta el contexto sin `breakdown:full` y dibuja con `ui.log`,
que no añade su salida al contexto del modelo. La verificación headless real
confirmó cero input, output y modelos utilizados. El primer intento falló por
una importación no admitida y consumió una respuesta de Sonnet; ese intento no
se considera una medición gratuita. La importación quedó corregida y validada.

Las llamadas a modelos de ejecución se registran por cuenta local anonimizada,
sesión principal, proveedor, modelo y fase. El acumulado local no reconstruye
sesiones anteriores a la activación ni sesiones de otras máquinas. Los saldos
globales de cuenta sólo se muestran cuando los informa el proveedor. No se
convierten tokens o dólares de referencia en cuota de suscripción.

El piloto nativo de Haiku corrigió el carrito y aprobó tres checks externos.
Los primeros intentos Codex con Terra fallaron al arrancar la ejecución Windows;
sus recibos y consumo se conservaron. Con el CLI npm oficial 0.170.0, Terra modificó
únicamente `src/solution.mjs` y pasó los cinco casos externos del piloto SKU.
La fase observó 16.936 tokens de entrada sin caché, 47.232 de caché leída y 493
de salida: 64.661 tokens, referencia condicional USD 0,0217626 y 15,106 segundos.
Eso verifica edición y checks en el piloto; no demuestra ahorro general ni calidad
equivalente en tareas complejas. Las pruebas Finanzas se evalúan aparte.

En F02, Sonnet→Codex Terra aprobó nueve criterios externos, 17 regresiones/pruebas
propias y compilación completa, con revisión fresca y tres hallazgos bajos.
Sonnet→Codex Sol aprobó los nueve criterios y 27 regresiones/pruebas propias,
pero su revisión dejó un hallazgo medio: no se promueve como caso positivo de routing.
Los intentos Opus→Codex alcanzaron el límite común de 15 turnos de planificación;
Codex no llegó a ejecutarse y su costo completo no se interpreta como cero.
Se conservan los intentos fallidos y las limitaciones de mocks e identidad del
modelo solicitado. Son pruebas de un contrato, no garantía general de calidad.

Las tarifas Codex se verificaron de nuevo en la página oficial el 18/11/2026.
Si el CLI sólo ofrece entrada acumulada y no contexto por petición, se calcula
un intervalo con tarifas oficiales de contexto corto/largo. El acumulado no
demuestra que una petición haya usado contexto largo. Los costos siguen siendo
referencia condicional al modelo solicitado, independientes de la suscripción.

Run the following after the final code change:

```powershell
pnpm check
pwsh -NoProfile -File tools/verify-clean-windows.ps1
pnpm audit --json
claude plugin validate --strict --json .
node tools/release-audit.mjs --out <new-audit.json>
```

The audit inventories Git-tracked source files with SHA-256 hashes, excludes
local profiles/databases/logs/credentials/build outputs, and produces a
CycloneDX dependency inventory from the installed frozen-lockfile dependency
tree. It records the lockfile hash and source commit. Install dependencies
first. `--release` returns nonzero while the license gate is open. The audit
is preparation evidence; it does not authorize publication or certify security.

Approve ownership/license and public destination, finish the real pilot and a
second-machine lifecycle test, then create a reviewed release tag and archive
only the inventory's approved files. Include LICENSE, notices, changelog,
support matrix and the generated SBOM. Verify the archive inventory and checksums
before upload. Public upload and invitations require owner authorization.

## Onboarding

Follow portability.md to install with the user's own account. Start in a public
fixture repository with local-only policy; review the proposed profile and
glossary. Preview a Story, approve it, run its checks and inspect evidence and
usage. Stop the session to unload the development plugin. Follow the documented
rollback/removal path. Report redacted feedback through the repository template.

The second-machine acceptance record must include install, update, rollback,
unload/removal, OS/host versions, commands, actual exit codes and any assistance
needed. A same-machine temporary checkout does not close that gate.
