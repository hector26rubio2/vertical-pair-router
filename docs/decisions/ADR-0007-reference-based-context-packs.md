# ADR-0007: Reference-based context packs

- Status: ACCEPTED
- Date: 2026-11-09

## Context

VPR debe reanudar una Story/Task después de compactación o transferencia sin
tratar un resumen potencialmente obsoleto como fuente, copiar el repositorio ni
persistir código, prompts o secretos. Las fuentes originales deben conservar la
autoridad.

## Decision

Un context pack persiste sólo Story/Task, commit, rutas relativas, rangos de
líneas opcionales, tamaño, SHA-256, pendientes y fecha. La reanudación valida
ruta, hash y tamaño contra la fuente antes de usarla. Los handoffs apuntan a ese
pack y añaden estado Git, checks y siguiente acción; no incrustan cuerpos fuente.

Las rutas se resuelven y realinean dentro del root para impedir escapes y
symlinks externos. Se rechazan credenciales, `.env`, claves, logs, bases de datos
y metadatos Git. Los límites de archivos y bytes son obligatorios. El cache de
hash usa tamaño y mtime y admite invalidación explícita.

## Alternatives

- Copiar cuerpos completos en cada pack: descartado por privacidad, tamaño y
  obsolescencia.
- Guardar sólo un resumen narrativo: descartado porque no es verificable.
- Releer todo el repositorio: descartado por costo y ruido.

## Consequences

- La reanudación falla de forma visible cuando una referencia cambió o falta.
- El consumidor debe volver a leer sólo las fuentes válidas mencionadas.
- Los context packs no sirven como backups ni como fuente canónica.
- Una transferencia durable necesita un handoff; la compactación dentro de la
  misma sesión puede usar el mecanismo nativo del host.
