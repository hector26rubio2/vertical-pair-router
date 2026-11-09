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

