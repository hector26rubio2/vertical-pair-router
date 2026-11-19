# ADR-0010: Adaptadores nativos Codex y Copilot

- Estado: Aceptado para integración local protegida; disponibilidad por verificar en cada máquina.
- Fecha: 2026-11-19
- Relación: ADR-0003, ADR-0008 y ADR-0009.

Los adaptadores nativos reutilizan exclusivamente la autenticación de los CLI
instalados por el usuario. No extraen credenciales, no guardan tokens de acceso,
no convierten la suscripción en autorización API y no transmiten contexto a
un proveedor fuera de la política permitida. Las referencias API no son cargos
de suscripción ni permiten deducir saldo restante.

Cada instalación verifica ejecutable, autenticación, modelos disponibles y
permisos. Una cuenta corporativa puede bloquear modelos o escritura; instalar
el plugin no evita esas restricciones. El despacho queda bloqueado cuando la
capacidad no está verificada o cuando el proveedor informa un límite agotado.

Codex puede informar contadores acumulados y el modelo solicitado sin confirmar
la identidad realmente servida. Se etiqueta requested-only y se conserva N/D
en contexto por llamada o categorías no informadas. Un cero normalizado por un
adaptador antiguo no se convierte en medición nueva.

La prueba de aceptación por instalación es una tarea aislada autorizada, con
permiso de escritura explícito, checks, recibo y preservación del proyecto
original. Copilot no se considera validado por detectar el CLI o autenticar:
debe existir un modelo autorizado y una prueba real aprobada por el titular.
Esta campaña no ha ejecutado llamadas nuevas a Codex ni a Copilot.

La evidencia de una máquina o cuenta no demuestra disponibilidad en otra.
Esta decisión amplía el catálogo inicial de ADR-0008, sin autorizar uso automático
de otro proveedor ni nuevos gastos.
