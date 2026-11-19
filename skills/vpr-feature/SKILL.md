---
name: vpr-feature
description: Implementa una funcionalidad con alcance claro mediante una ruta ligera, TDD cuando aplica y evidencia vigente.
disable-model-invocation: true
---

# Implementar funcionalidad

1. Recupera Story, Task, perfil, terminos y ADRs relevantes; no cargues todo el
   repositorio. Si hay ambiguedad material, devuelve control a `vpr-grill`.
2. Declara el seam publico que observara el test. Escribe una prueba roja,
   confirma que falla por el motivo esperado y aplica el cambio minimo verde.
3. Para wiring, texto o configuracion sin seam conductual, registra TDD
   `NOT_APPLICABLE` con motivo y usa una validacion adecuada.
4. Ejecuta checks despues del ultimo cambio, revisa el diff real y registra
   salida, exit code, duracion, version y truncacion.
5. No hagas commit, merge, publicacion ni cambio de proveedor salvo que el Run y
   la politica lo autoricen expresamente.

Antes de abrir otro agente, consulta la propuesta local de modelos de la Task.
Si recomienda ejecutar en el agente actual, evita una delegacion adicional.
Si recomienda planificar e implementar por separado, entrega un handoff acotado
al ejecutor configurado (preferentemente el ligero); conserva planificacion y
revision sin permisos de escritura. Comprueba disponibilidad, permisos y checks
antes de empezar. No cambies modelos reales mediante una afirmacion en el prompt.
Si el host no permite registrar ese ejecutor, marca la ruta como no disponible.
No sustituyas un bloqueo de permisos por un bypass. En particular, una conexion
con Codex que termina en solo lectura no es una implementacion completada.

