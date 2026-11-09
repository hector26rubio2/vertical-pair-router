---
name: vpr-bugfix
description: Corrige un bug ya reproducible con prueba de regresion, cambio minimo, checks y revision del diff.
disable-model-invocation: true
---

# Corregir bug simple

Confirma el comportamiento observado y esperado. Acuerda el seam mas alto que
reproduce el patron real. Convierte la reproduccion minima en una prueba que
falle por el sintoma, ejecutala roja, aplica el cambio minimo y ejecutala verde.

Despues corre regresion cercana y checks obligatorios, elimina instrumentacion
temporal y revisa staged, unstaged y untracked segun politica. Reporta causa
demostrada, no una hipotesis plausible. Si la reproduccion no es determinista o
falta, usa `vpr-diagnose`.

