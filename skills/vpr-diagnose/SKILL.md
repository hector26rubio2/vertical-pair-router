---
name: vpr-diagnose
description: Diagnostica bugs dificiles construyendo primero una reproduccion rapida y falsable; no salta a una causa por intuicion.
disable-model-invocation: true
---

# Diagnosticar bug complejo

1. Redacta secretos y construye un comando que detecte el sintoma exacto. Debe
   ser rapido, determinista (o elevar la tasa de reproduccion) y ejecutable sin
   intervencion.
2. Reproduce y minimiza cambiando una condicion por vez.
3. Escribe 3 a 5 hipotesis ordenadas; cada una declara una prediccion que puede
   falsarla. Presenta la lista y continua con la mejor evidencia disponible.
4. Instrumenta solo limites que distinguen hipotesis; etiqueta toda
   instrumentacion temporal para retirarla.
5. Convierte el repro minimo en regresion en el seam correcto, confirma rojo,
   corrige, confirma verde y vuelve a ejecutar el repro original.

Si no existe un loop valido, informa intentos/evidencia y pide el artefacto o
acceso minimo necesario. No declares causa raiz confirmada.

