# Evidencia experimental canónica v1

Contratos públicos aditivos: `EvidenceRecord`, `WorkFeatures`, `Handoff`, `RoutingPolicy`, sus JSON Schemas y validadores en @vpr/contracts. @vpr/storage-sqlite exporta EvidenceStore; @vpr/experiments inicia la migración tipada y no ejecuta proveedores.

Cada dato desconocido conserva null y una causa en unavailable. La operación desconocida es explícita. No se interpreta el total acumulado de una sesión como su contexto máximo. Un cero de caché escrita heredado de Codex sin recibo pasa a N/D en la vista nueva; el JSON de origen no cambia. No se reparte el costo agregado entre llamadas sin un recibo que lo permita.

La importación conserva ruta, SHA-256 y puntero JSON. Los IDs dependen del hash de origen y de la posición del registro. Es idempotente; una colisión con contenido distinto falla, no actualiza. Un lote inválido se revierte de forma completa. Las tablas de evidencia tienen versión propia y no sustituyen domain_events.

La similitud exige protocolo, hash de contrato de aceptación, tipo, rol, diseño, ejecución, riesgo y señales de API/persistencia/transacciones/seguridad/dinero compatibles y conocidas. Archivos distintos pueden compartir un grupo; contratos desconocidos no. El orden de resultados es estable. Esta operación solo consulta: no autoriza despacho.

## Verificación local

El banco congelado de 2026-11-17 se importó en `.tmp/experiment-review/evidence-v1.sqlite`: 964 registros (119 corridas + 845 llamadas observadas). Segunda importación: 0 inserciones, 964 sin cambios. Celdas aptas para similitud: 0; faltan etiquetas manuales separadas y señales verificadas. Eso no invalida sus mediciones históricas, pero impide promoverlas automáticamente a política. No hubo inferencias de pago.

Pruebas: contratos incompletos y límites, parámetros protegidos, evidencia inválida, inmutabilidad, idempotencia, rollback, separación de protocolo/contrato/rol y N/D de Codex. El reporte histórico permanece disponible y no se sobrescribe.

## Pendiente de integrar

Este bloque proporciona almacenamiento e importación; aún no conecta EvidenceStore al CLI de ejecución, ni activa política. Siguen pendientes la capa sombra, runner factorial/jerárquico, medidor único, ampliación analítica y campaña. El YAML se validará fuera del core puro. Los contratos no permiten activar enforce.
