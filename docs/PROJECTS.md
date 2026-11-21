# Proyectos

Un proyecto es un nombre y un workspace dentro de una conexión. El catálogo y la selección se guardan en este dispositivo; no modifican el almacenamiento de conversaciones del motor.

- La identidad combina endpoint y ruta, para distinguir rutas iguales en servidores diferentes.
- Cada proyecto contiene un workspace y puede agrupar varias conversaciones.
- El selector de la barra lateral permite crear, renombrar y archivar proyectos. En local se puede escoger una carpeta; en remoto se escribe una ruta del servidor.
- Seleccionar un proyecto reutiliza una conversación abierta normal de ese workspace, o crea una si no existe. No cancela las conversaciones que están trabajando en otros workspaces.
- La barra lateral filtra las conversaciones abiertas y guardadas por el workspace del proyecto. Las conversaciones antiguas sin workspace siguen accesibles en «Todas las conversaciones».
- Archivar solo oculta el proyecto del catálogo activo y limpia su selección. No borra archivos ni conversaciones. Añadir de nuevo la misma ruta y conexión restaura el proyecto archivado.
- Abrir una conversación de otro workspace fuera de la barra lateral vuelve a la vista de todas las conversaciones, sin moverla de proyecto.
- En remoto, esta primera versión solo permite activar proyectos que coincidan con el workspace de la conexión actual. Para otro workspace hay que cambiar la conexión; no se cambia el servidor ni se reconecta automáticamente.

La selección local se restaura al arrancar. La conexión remota conserva siempre el workspace autorizado al conectarse. Las rutas se comparan sin separadores finales, conservando las raíces; no se resuelven enlaces simbólicos ni se unifican rutas que solo difieran en mayúsculas.
