# Compatibilidad, instalación y reversión

## Evidence matrix

| Surface | Windows 11 | macOS | Linux |
|---|---|---|---|
| Core policy, lifecycle and routing | VERIFIED locally | EXPERIMENTAL / NOT_RUN | EXPERIMENTAL / NOT_RUN |
| Node/pnpm clean checkout | VERIFIED locally | NOT_RUN | NOT_RUN |
| SQLite/WAL/backup/locking | VERIFIED locally | NOT_RUN | NOT_RUN |
| Safe process execution and quoting | VERIFIED locally, `shell: false` | NOT_RUN | NOT_RUN |
| Git worktree create/remove | VERIFIED locally | NOT_RUN | NOT_RUN |
| Claude Code plugin manifest/hooks | VERIFIED locally | NOT_RUN | NOT_RUN |
| Local dashboard | VERIFIED locally | NOT_RUN | NOT_RUN |

Los adaptadores admiten como destinos Windows, macOS y Linux; su disponibilidad
permanece desconocida hasta inspeccionar la máquina. La matriz distingue los
destinos implementados de los checks realmente ejecutados. La pipeline preparada
prueba los tres sistemas con Node 24.15 y 26; hasta ejecutar esos jobs, macOS y
Linux permanecen NOT_RUN y no se presentan como verificados.

## Prerequisites

- Windows 11 and PowerShell 7 for the currently verified path.
- Git.
- Node.js `>=24.15 <27`.
- pnpm `>=11 <12` (the repository pins 11.1.2).
- Claude Code 2.1.322 (versión verificada) only for the optional native host adapter. Core and CLI
  tests do not require a Claude account.

Docker and Python are not required.

## Checkout install and smoke test

```powershell
git clone <authorized-repository-url> vertical-pair-router
Set-Location vertical-pair-router
pnpm install --frozen-lockfile
pnpm check
pnpm vpr init --project .
claude --plugin-dir .
```

`vpr init` muestra una propuesta por defecto; `--apply` guarda el perfil e
instala las integraciones elegidas. `claude --plugin-dir .` carga el checkout
para esa sesión. El paquete también permite registro persistente local, probado
en Windows el 18/11/2026. No requiere subirlo a un catálogo público.

## Instalar el paquete descargado

Desde la carpeta donde está el archivo `.tgz`, usando su nombre real:

```sh
npm install --global ./vertical-pair-router-0.1.0.tgz
vpr plugin install
vpr plugin doctor
```

Sustituye el nombre por la versión descargada. Con pnpm se puede usar
`pnpm add --global ./archivo.tgz` (su directorio global debe estar configurado).
El registro crea el catálogo **local** `vpr-local` en la configuración personal
de Claude. No publica en un marketplace central. Reinicia Claude para cargarlo.
El paquete contiene un ejecutor autónomo, catálogos y un lockfile npm dentro
del plugin: funciona también cuando Claude copia únicamente esa carpeta.

En el proyecto destino:

```sh
vpr init --project . --interactive
vpr init --project . --interactive --apply
vpr tools doctor --project .
vpr plugin doctor
claude
```

Dentro de Claude, `/vpr-use` muestra los contadores observados y
`/vpr-run --preview tarea.json` comprueba la ruta sin ejecutar modelos.
`/vpr-run tarea.json` sí ejecuta los modelos autorizados y sus checks. La tarea
debe contener `prompt`, `allowedPaths`, `requiredChecks` y los metadatos de
complejidad/riesgo. Los comandos de checks se definen en `.vpr/profile.json`.
No se crean claves API. Cada proveedor usa el inicio de sesión nativo del usuario.

El aprovisionamiento de Archify descarga MIT 2.16.0 con un commit fijado si no
existe una instalación. Graphify requiere uv/Python y se fija a 0.9.106; su índice
y consulta son locales. Husky requiere un Git propio y un gestor Node. Los
requisitos ausentes se muestran como no disponibles; no se ocultan como éxito.

Run `pwsh -File tools/verify-clean-windows.ps1` to copy only Git-visible files
to a new temporary directory, install from the frozen lockfile, run all checks,
smoke the CLI usage path, and remove that directory. The script verifies its
cleanup target remains under the OS temporary root.

## Update, rollback and removal

Before an update, export project data and retain the prior commit/tag:

```powershell
pnpm vpr data export --db <db> --project-id <id> --out <new-file.jsonl>
git fetch --tags
git switch --detach <reviewed-commit-or-tag>
pnpm install --frozen-lockfile
pnpm check
```

Rollback repeats the last three commands with the previous reviewed commit/tag.
Schema readers reject future versions; backups never overwrite an existing
target. No automatic downgrade migration is claimed.

Para actualizar, conserva ambos `.tgz`, instala el nuevo y ejecuta
`claude plugin update vertical-pair-router@vpr-local --json`. Para volver a una
versión anterior, primero desregistra con
`claude plugin uninstall vertical-pair-router@vpr-local`, instala el archivo
anterior y repite `vpr plugin install`. Reinstalar sobre una versión superior
no garantiza que Claude acepte la bajada. Reinicia Claude y comprueba la versión
con `claude plugin list --json`.
No borres una versión anterior mientras haya sesiones que la estén usando.

Para retirar el registro: `claude plugin uninstall vertical-pair-router@vpr-local`.
Después, `npm uninstall --global vertical-pair-router` (o el equivalente pnpm).
Salir de Claude descarga un plugin cargado sólo con `--plugin-dir`. Los datos
del proyecto, los contadores en `~/.vpr` y las herramientas opcionales se
conservan para evitar pérdida de información; su eliminación es independiente.
VPR no escribe credenciales API. El registro persistente sí modifica los
ajustes de plugins de Claude mediante su comando oficial.

## Profiles

`examples/profiles/personal-global.json` demonstrates protected personal policy.
`examples/profiles/company-project.json` demonstrates repository-owned checks,
glossary and stricter local policy without proprietary rules or secrets. The
project profile belongs at `.vpr/profile.json`; do not copy private company
configuration into a global distributable package.
