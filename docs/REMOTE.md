# Conectar Desktop a `phoson-cli serve`

Este modo conecta Desktop al gateway del engine; no usa la API del proyecto
`Phoson-Server`. Los modelos, las herramientas y los archivos viven en el servidor.

## Prueba en el mismo equipo

Desde el proyecto que quieras usar como workspace:

```bash
phoson-cli extras install remote
phoson-cli serve --pair --allow-origin tauri://localhost
```

En Desktop pulsa **Elegir conexión → Servidor remoto**. Introduce
`ws://127.0.0.1:7337/v1`, el código que imprime el servidor y un nombre de dispositivo.
La ruta del workspace es opcional y siempre se refiere al servidor.

En desarrollo añade `--allow-origin http://localhost:1420`. En Windows/Linux la
webview puede usar `http://tauri.localhost`; autoriza el origen concreto de tu
plataforma. No uses un comodín para los orígenes.

## Otro equipo

Esta primera versión requiere `wss://` fuera de loopback. Configura TLS con
`--tls-cert` y `--tls-key`, o termina TLS en un proxy que reenvíe WebSocket.
También puedes usar un túnel SSH y conectar a su puerto local:

```bash
ssh -N -L 7337:127.0.0.1:7337 usuario@servidor
```

No expongas el gateway sin cifrado a Internet. Un código de emparejamiento permite
crear un dispositivo autorizado: compártelo solo con quien deba ejecutar herramientas.

## Alcance actual

- Un servidor/workspace por conexión. Cambiar de modo recarga la interfaz.
- Token en el llavero del sistema al marcar «Recordar este dispositivo»; nunca en
  localStorage. El perfil solo contiene URL, workspace y nombre de dispositivo.
- Chat, sesiones, archivos vía RPC y confirmaciones reutilizan el bridge existente.
- Editor, terminal y Git locales no actúan sobre rutas remotas. OAuth, micrófono del
  servidor y cambios de configuración/plugins/MCP están bloqueados en este MVP.
- Reconexión manual: al perder la conexión, recarga y vuelve a conectar. No se
  reenvían turnos automáticamente, pues podrían seguir ejecutándose en el servidor.
- Para revocar el acceso usa `phoson-cli remote devices` y `phoson-cli remote revoke`
  en el servidor. Volver al modo local no revoca el dispositivo.

## Verificación

```bash
pnpm test:unit
PHOSON_REMOTE_INTEGRATION=1 pnpm exec vitest run src/bridge/remote.integration.test.ts
```

La integración necesita el engine hermano y su `.venv/bin/python` con el extra
remote. Usa HOME/workspace temporales y un entorno sin credenciales de proveedores.
Comprueba el enrutado con un bridge falso y, por separado, el bridge real offline:
emparejamiento, inicialización, listado de archivos del workspace y reconexión con
token. No ejecuta turnos ni consume un proveedor LLM.

La prueba en navegador cubre el selector y el formulario; la validación del llavero
nativo y una conversación completa en Tauri siguen requiriendo una prueba manual.
