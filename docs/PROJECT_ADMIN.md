# Contrato RPC de administración del proyecto

La pantalla Desktop usa el bridge JSON-RPC existente y envía `workspace` (ruta absoluta al directorio del proyecto) en cada llamada. Las memorias son Markdown locales por proyecto, almacenadas por `phoson_cli.memory`; el sidecar no debe inferir el ámbito de su cwd. El contrato es:

- `memory.list {}` → lista de objetos `{key, content}` (o `{items: [...]}`).
- `memory.read {key}` → `{key, content}`.
- `memory.write {key, content}` → resultado de escritura satisfactorio.
- `memory.delete {key}` → resultado satisfactorio.
- `mcp.project.get {}` → lista `{name, approved}` (o `{mcps: [...]}`).
- `mcp.project.approve {name}` y `mcp.project.revoke {name}` → resultado satisfactorio.

Los métodos de escritura y revocación deben autorizarse para el proyecto del workspace indicado; un error RPC debe rechazarse (no responder éxito simulado). Los nombres de memoria son claves estables y los servidores MCP deben tener identificadores `name` estables. La UI actualiza las listas tras cada mutación.
