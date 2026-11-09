---
name: vpr-verify
description: Verifica el repositorio despues de un cambio y reporta evidencia observada sin inventar checks verdes.
allowed-tools: Bash(pnpm check), PowerShell(pnpm check), Read, Grep, Glob
---

# Verificar VPR

Usa esta Skill solo dentro de un repositorio confiable seleccionado por el usuario.

1. Inspecciona el estado Git y el diff real relevante.
2. Resuelve checks desde el perfil; en este repo ejecuta `pnpm check` desde la raiz.
3. Reporta comando, exit status, total de pruebas, truncacion, timeout y skips.
   Un comando no ejecutado es `NOT_RUN`, nunca aprobado.
4. Si hubo cambios posteriores, marca la evidencia obsoleta y repite el check.
5. No cambies settings, permisos, credenciales, estado de release ni recursos
   remotos. No publiques ni instales el plugin.

