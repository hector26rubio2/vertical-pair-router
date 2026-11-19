# ADR-0009: Cerrar el ciclo evidencia → decisión

- Estado: Propuesto; implementación incremental autorizada, únicamente en sombra.
- Fecha: 2026-11-19
- Decisor de activación: Héctor.

Se adopta como dirección experimental la opción B del documento del titular:
contratos versionados, EvidenceStore local, experimentos tipados y decisiones
deterministas con evidencia. Los JSON originales no se reescriben; datos ausentes
son N/D, no cero. La campaña de modelos requiere aprobación independiente.

## Ajuste al handoff de la consolidación

La rama refactor/workflow-routing consolidó los routers de modelos en
routeWorkflow antes de este bloque. Se respeta esa decisión: no se restauran los
tres módulos eliminados ni sus interfaces. routeRequest selecciona adaptadores
y no se declara obsoleto. routeWork es la fachada experimental de siete etapas;
reutiliza routeWorkflow para reglas y permisos y no despacha agentes.

La política YAML tiene versión y hash, fases, operaciones, umbrales y límites.
En esta entrega describe intenciones en sombra; no sustituye los modelos activos
del usuario. Las protecciones de proveedor, privacidad y contexto de Haiku no
son propiedades editables de la política.

## Estado verificable

- Contratos y validadores públicos añadidos, con pruebas de rechazo.
- SQLite append-only e importación idempotente de 119 corridas y 845 llamadas.
- Similitud compartida que exige protocolo y contrato de aceptación conocidos.
- routeWork en sombra, con trazabilidad de etapas, versión y hash.
- Verificación por hash de las copias generadas del ledger y seguridad.

Siguen pendientes: conectar runner factorial y jerárquico, medidor único,
integración al backlog, informe ampliado, generación de agentes de proyecto y
campaña presupuestada. No se declara completado el ADR ni se habilita enforce.

Cambiar a enforce requerirá evidencia compatible de al menos tres corridas y
80 % de calidad aceptada, además de autorización explícita y protecciones del
host. Tokens de decisión: cero; costos de modelos son referencias y no cuotas.
