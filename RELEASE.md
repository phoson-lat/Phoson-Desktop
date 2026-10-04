# Release — primera alpha

Checklist operativa para publicar `0.1.0-alpha.1` (multiplataforma).

## 1. Requisitos (una vez)

- [ ] **Secreto `TAURI_SIGNING_PRIVATE_KEY`** en GitHub Actions con el contenido
      de `~/.tauri/phoson-desktop.key` (fuera del repo).
- [ ] **Secreto `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** (vacío si la clave no
      tiene password).
- [ ] Guardar la **clave privada** en un gestor de secretos (si se pierde, no se
      pueden firmar updates).

## 2. Publicar el tag

Requisito previo: el **repo debe ser público** (el endpoint del updater es
`releases/latest/download/latest.json`; en un repo privado devuelve 404 sin auth).

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

Esto dispara `.github/workflows/release.yml`:
matrix **Linux / Windows / macOS(Apple Silicon)** → compila el sidecar de cada
plataforma y sube bundles + `latest.json` a un release **draft + prerelease**.
> macOS Intel (`macos-13`) está **fuera** del matrix (runners Intel escasos);
> reactivable añadiendo `- platform: macos-13`.

- [ ] Revisar el draft en GitHub Releases y **publicarlo**.
- [ ] **Quitar la marca *Pre-release*** al publicar: GitHub **excluye los
      *prereleases* de `/releases/latest`**, así que con esa marca el updater
      devuelve 404. La versión puede seguir diciendo `alpha.1`.

Público ya (verificado):

```bash
curl -sI https://github.com/phoson-lat/Phoson-Desktop/releases/latest/download/latest.json | head -1
```

## 3. QA manual (sobre el build empaquetado, en cada SO)

Arranque y base:
- [ ] Abre la app: arranca sin crash y muestra la conversación (o onboarding).
- [ ] Cold start percibido razonable (ver presupuestos en `PERF.md`).

Conversación:
- [ ] Envía un primer mensaje → responde en streaming.
- [ ] Tras el primer turno, el **título** del sidebar/cabecera se actualiza al
      generado por el modelo.
- [ ] Cancelar un turno en curso.
- [ ] Adjuntar imagen y otro archivo (se sube al workspace y se referencia).

Sesiones / workspace:
- [ ] Nueva sesión, cambiar entre sesiones abiertas, cerrar.
- [ ] Abrir una sesión guardada (replay del historial).
- [ ] Eliminar una sesión guardada.
- [ ] Cambiar de workspace desde el 📁 y comprobar que la cabecera lo refleja.
- [ ] El motor por workspace se reinicia si se cae (aviso).

Ajustes / extras:
- [ ] Ajustes: modelo/proveedor, MCP, tema.
- [ ] Dictado por voz (si el SO lo soporta).
- [ ] Comando `Ctrl/⌘+K` (paleta) y `Ctrl/⌘+E` (esfuerzo de razonamiento).

Secciones:
- [ ] **Swarms de agentes** aparece como **«Próximamente»** (placeholder).

## 4. Limitaciones conocidas (esperadas en esta alpha)

- **Swarms**: gated en «próximamente» (código presente, no expuesto).
- **Firma de instaladores** (Windows Authenticode / macOS notarización):
  **pendiente**; el SO mostrará avisos de origen desconocido.
- **Updater**: funciona una vez **publicado** (no draft) el release con
  `latest.json`.
- **Rendimiento**: el primer `session.list` puede tardar (lectura completa del
  historial); el resto va por caché. Root fix pendiente en el engine (ver `PERF.md`).

## 5. Después de publicar

- [ ] Verificar `latest.json` en
      `https://github.com/phoson-lat/Phoson-Desktop/releases/latest/download/latest.json`.
- [ ] Instalar el alpha, y con uno anterior comprobar el flujo de actualización
      (Ajustes → Acerca de).
