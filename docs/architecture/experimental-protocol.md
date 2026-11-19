# Protocolo experimental: implementación incremental

Las nuevas primitivas tipadas están en @vpr/experiments. No llaman proveedores.

- freezeHandoff valida el JSON Schema antes de producir bytes, hash y campos
  completos. El tamaño en tokens queda N/D si no hay recibo del contador.
- validateFrozenHandoff detecta cambios de bytes y tamaño. El mismo artefacto
  puede entregarse a distintos ejecutores sin volver a diseñar.
- executeFrozenHandoff valida también el hash del context pack antes del
  ejecutor inyectado. Los experimentos nativos exigen autorización explícita;
  las simulaciones no consumen inferencia. Propaga cancelación y tiempo límite.
- El ejecutor nativo que se conecte deberá respetar AbortSignal, límites de
  turnos/contexto y registrar costos parciales antes de cerrar. Esta capa no
  puede matar un proceso que ignore el contrato; aún no hay conexión nativa.
- scheduleStories valida dependencias, evita ciclos y separa archivos
  superpuestos, con máximo dos trabajadores. Ordena por modelo para favorecer
  reutilización; esto no afirma que el proveedor haya reutilizado caché.
- allocateSharedDesign conserva costo compartido y prorratea únicamente entre
  IDs de recibos efectivos y distintos. No divide entre consumidores planeados.
- stableRolePrompt conserva herramientas, sistema y contexto estático antes de
  la Task, con hash del prefijo separado. Un hash idéntico no prueba un hit de
  caché: hacen falta contadores.
- randomizeCells registra semilla y conserva etiquetas de condición solicitada.
  La etiqueta fría no significa que se haya vaciado la caché del proveedor.

## Cobertura y límites actuales

Las pruebas se escribieron primero y fallaron por ausencia de exports. Cubren
hash alterado, handoff incompleto, orden reproducible, ciclos y archivos
compartidos, asignación por recibos, prefijos y bloqueo de llamadas nativas.
No son ensayos de calidad o rendimiento de Haiku/Sonnet/Opus/Codex.

Siguen pendientes el coordinador completo factorial y jerárquico, emisión de
TaskDraft por BacklogService, límite por intento/modelo y recibos de cancelación.
No se ha conectado esta capa al despacho del plugin; no se deben presentar
estas primitivas como una campaña real ya ejecutada.
