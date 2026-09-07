# CODEX_TASK_TEMPLATE.md

Usá esta plantilla cuando quieras darle una tarea importante a Codex.

```text
Objetivo:
[describir exactamente el cambio]

Resultado esperado:
[qué debe hacer o verse distinto]

Restricciones:
- Mantener funcionalidades existentes.
- No debilitar la frontera de seguridad.
- No introducir escrituras directas Firestore desde src/.
- Mantener compatibilidad online/offline si la tarea toca ventas o datos.
- Respetar dark/light y responsive si es UI.
- No modificar archivos no relacionados.

Antes de implementar:
1. Leer AGENTS.md.
2. Leer PROJECT_CONTEXT.md.
3. Inspeccionar la implementación actual.
4. Identificar archivos y dependencias reales.
5. Buscar callables/componentes reutilizables.

Al finalizar:
- Ejecutar npm run check.
- Si se modificó functions/index.js, ejecutar también cd functions && npm run check.
- Informar archivos modificados.
- Informar pruebas manuales concretas.
- No afirmar validaciones que no fueron ejecutadas.
```
