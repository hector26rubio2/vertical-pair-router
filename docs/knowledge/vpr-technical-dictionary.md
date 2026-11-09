# VPR technical dictionary

Este diccionario pequeño alinea términos técnicos que suelen confundirse. No es
una enciclopedia externa ni reemplaza [el glosario canónico](../../GLOSSARY.md).

| Término | Significado en VPR | No significa |
|---|---|---|
| Host | Aplicación y máquina que ofrecen el entorno de ejecución | Provider |
| Provider | Destino autorizado que presta inferencia de modelo | Cuenta o credencial |
| Executor | Adaptador que inicia y controla un Run | Modelo |
| Model | Identidad confirmada por el host/provider para una ejecución | Nombre pedido en un prompt |
| Context | Entradas mínimas autorizadas que necesita una tarea | Copia completa del repo |
| Session | Contenedor de interacción del host | Run |
| Turn | Una entrada y su respuesta dentro de una sesión | Task |
| Token | Unidad reportada por un provider; si no hay recibo es `unavailable` | Estimación presentada como medición |
| Skill | Instrucciones de workflow y enrutamiento | Proceso con permisos propios |
| Tool | Capacidad concreta invocada por un agente | Autorización implícita |
| Run | Intento auditable sobre una Task | Sesión o conversación |
| Evidence | Resultado factual, fechado y trazable | Estado verde inferido |
| Measured cost | Importe obtenido de un recibo/medición real | Cálculo aproximado |
| Estimated cost | Cálculo declarado como estimación | Consumo facturado |

Cuando el host no confirma modelo, tokens o costo, el valor canónico es
`unavailable`; VPR no rellena el vacío con una suposición.
