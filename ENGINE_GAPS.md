# Huecos del engine (`phoson-cli`) para soportar swarms peer-to-peer

> Documento para el equipo de **`phoson-engine-minimal` / `phoson-cli`**.
> Origen: la app de escritorio `Phoson-Desktop` ya integra el plugin `swarm`
> (vía `swarm_create/assign/message/collect/status/dissolve`), pero varias
> capacidades que queremos ofrecer en el editor de swarms **no son expresables
> con la API actual**.
>
> Estado: propuesta. No tenemos el código del engine en este repo; el
> comportamiento "actual" descrito abajo está **inferido** de la integración y
> de los prompts que el engine acepta. Corregid lo que esté mal.

---

## 1. Cómo funciona hoy (lo que usamos)

La app describe un swarm como un **árbol de dos niveles** y lo traduce a llamadas
del engine. Lo que se envía a `swarm_create`:

```jsonc
{
  "topology": "star" | "mesh" | "pipeline",   // enum cerrado, 3 valores
  "agents": [
    {
      "name": "investigador",
      "system_prompt": "...",                  // propósito + guía de comunicación
      "model": "…",                            // opcional
      "tools_allowlist": ["read_file", "…"],   // opcional
      "max_tokens": 4000                       // opcional
    }
  ]
}
```

Y para operar: `swarm_assign`, `swarm_message` (`sender`, `recipient`,
`content`, `topic`; `recipient:"*"` = difusión), `swarm_collect`, `swarm_status`,
`swarm_dissolve`.

**Consecuencias actuales que bloquean lo que queremos:**

- La topología es un **enum de 3 valores**; no hay forma de describir un grafo
  arbitrario ni un conjunto de rutas.
- El **maestro es el único enrutador**: a los miembros se les **retiran** las
  tools `swarm_*` (los prompts le dicen al rol "no puedes llamar a ninguna
  herramienta de mensajería"). Los roles solo pueden *mencionar* con `@` y
  esperar a que el maestro reenvíe.
- La entrega es **inbox-en-el-siguiente-run**: no hay canal en vivo, ni
  acuse de recibo, ni interrupción.
- No hay forma de **pausar/detener** a un miembro.

---

## 2. Lo que queremos (los 5 huecos)

Resumen: queremos una **red de agentes real**, dirigida o no, con aristas que
signifiquen algo, y mensajería **entre pares sin depender del maestro**. Hoy todo
eso es imposible desde la app porque el contrato del engine lo impide.

### G1 — Topología general (grafo arbitrario, dirigido o no)

**Queremos:** definir el swarm como un grafo (nodos + aristas), no como uno de
tres patrones fijos. Que el usuario pueda dibujar la forma que quiera, dirigida o
no.

**Hoy:** `swarm_create.topology` solo acepta `"star" | "mesh" | "pipeline"`.

**Pedimos al engine:** que `swarm_create` acepte una topología **general**, por
ejemplo:

```jsonc
{
  "agents": [ { "name": "…", "system_prompt": "…" } ],
  "graph": {
    "directed": false,                        // true = aristas con sentido
    "edges": [ { "from": "investigador", "to": "redactor" } ]
  },
  "roles": {                                  // opcional: qué puede hacer cada uno
    "investigador": { "can_route": true, "peers": ["redactor"] }
  }
}
```

Debe validarse: nombres existentes, sin auto-aristas, ciclos (si no se permiten),
límite de agentes, etc. Y devolver un error claro si algo no cuadra.

**Impacto:** alto. Sin esto, el lienzo del editor es puramente decorativo.

---

### G2 — Aristas como rutas reales (editar aristas con efecto)

**Queremos:** poder **añadir/quitar aristas** en el editor y que eso cambie de
verdad quién puede hablar con quién y cómo se ejecuta.

**Hoy:** las aristas no se envían al engine; solo mandamos el enum de topología.
El engine no conoce el grafo, así que dibujar aristas no cambiaría nada.

**Pedimos:** que el `graph.edges` de G1 **sea la fuente de verdad** del enrutado:
- Una arista `A → B` (dirigida) habilita `A` a mandar a `B`.
- Sin `directed` (no dirigido), la arista habilita en ambos sentidos.
- `swarm_message` debería **rechazar** envíos entre nodos no conectados (o
  avisar), en vez de permitir a cualquiera escribir a cualquiera.

**Impacto:** alto. Es lo que convierte el lienzo en el modelo real, no en un
dibujo.

---

### G3 — Mensajería directa entre miembros (A ↔ B sin el maestro)

**Queremos:** que un agente pueda escribir a otro **directamente**, sin que el
maestro tenga que reenviar `swarm_message` por él.

**Hoy:** a los miembros se les retiran las tools `swarm_*` — no pueden llamar a
`swarm_message`. Y aunque pudieran, no hay transporte directo: todo pasa por el
maestro.

**Pedimos al engine:** una de estas dos (preferimos la primera):

1. **Dar a los miembros una tool de mensajería acotada a sus pares**
   (según las aristas de G2), p. ej. `swarm_message` disponible en los roles pero
   validando `recipient ∈ peers(agente)`. Así A↔B es directo y sigue respetando
   el grafo.
2. **Exponer un `post_message`/`send` de bajo nivel** que no requiera ser el
   maestro.

**Impacto:** alto. Es el corazón de la petición "sin pasar por el maestro".

---

### G4 — `mesh` con conectividad real entre pares

**Queremos:** que "Malla" sea de verdad una malla: todos los agentes pueden
dirigirse a todos (o a sus conectados), con visibilidad compartida.

**Hoy:** `mesh` no cambia el enrutado: en los hechos el maestro sigue siendo el
hub. La app incluso pinta `star` y `mesh` **idénticos** (mismo abanico), porque el
engine no expone diferencia operativa que la UI pueda reflejar.

**Pedimos:** que `mesh` (o el grafo de G1) produzca conectividad **observable**:
que los mensajes puedan fluir entre pares y que `swarm_status` diga quién está
conectado con quién.

**Impacto:** medio-alto. Depende de G2/G3.

---

### G5 — Peer messaging sin intermediación obligatoria

**Queremos:** el checkbox de la app `peerMessaging` (hoy solo añade el roster `@`
al prompt) debe **habilitar enrutado real entre pares**, no depender de que el
maestro quiera reenviar.

**Hoy:** es un truco de prompt: el rol menciona `@otro` y el maestro decide si lo
entrega. Sin garantía.

**Pedimos:** que exista un modo del swarm donde el enrutado entre pares sea
**del engine** (con G3 y G2), no una convención de texto.

**Impacto:** medio. Es la formalización de G3 en la API del swarm.

---

### G6 — Pausar / interrumpir a un miembro (`swarm_stop` / pause)

**Queremos:** poder decirle a un agente **"detente y lee esto"** antes de
entregarle un mensaje.

**Hoy:** no existe ninguna tool de parada/pausa sobre un miembro. El único
"stop" es cancelar el turno del maestro (`cancelTurn`), que tumba todo el swarm.

**Pedimos:** una tool tipo `swarm_stop(target)` / `swarm_pause(target)` que
detenga a un miembro (o lo deje en un punto seguro) para que procese su bandeja,
y `swarm_resume(target)` para continuar.

**Impacto:** medio. Lo necesitamos para la feature "al hablar con un agente,
debe detenerse para leer nuestro mensaje".

---

### G7 — Estado runtime por agente (para el lienzo en vivo)

**Queremos:** pintar en el canvas el estado real de cada rol (inactivo,
trabajando, esperando, error).

**Hoy:** no hay estado por agente expuesto. La app lo **reconstruye** a partir
del stream de tool calls `swarm_*` del maestro, y por eso no puede distinguir
"asignado" de "ejecutándose".

**Pedimos:** que `swarm_status` (y/o un evento del stream) exponga por agente algo
como `{ name, state: "idle|running|waiting|error", current_task?, inbox_size }`.

**Impacto:** medio. Mejora mucho la UI; hoy lo aproximamos.

---

### G8 — Acuses de entrega/lectura

**Queremos:** saber si un mensaje `swarm_message` realmente se entregó (y si el
destinatario lo leyó), para no dar por hecho el enrutado.

**Hoy:** `swarm_message` devuelve "enviado"; no hay confirmación de entrega ni de
lectura. La app no puede distinguir "enrutado" de "ignorado".

**Pedimos:** que `swarm_message` devuelva/emita un **delivery receipt**, p. ej.
`{ delivered: true/false, reason?, read_at? }`.

**Impacto:** medio. Necesario para dar confianza en la mensajería.

---

## 3. Lo que NO necesita al engine (lo hacemos en la app)

Para que quede claro qué se puede hacer ya sin tocar `phoson-cli`:

- **Dibujar el grafo como no dirigido** (render) y **permitir editar aristas**
  en la UI. Podemos guardar el grafo y pintarlo desde ya; lo que **no** podemos
  es hacer que esas aristas afecten la ejecución (eso es G1/G2).
- **Pausar el turno entero** (cancelar) desde el composer.
- **Reconstruir un estado aproximado** por agente desde los tool calls (G7 lo
  sustituiría por el real).

Por eso la app puede mostrar el editor de grafo **antes** de que el engine lo
soporte, pero sería una simulación: hay que etiquetarlo como tal hasta que
existan G1/G2/G3.

---

## 4. Prioridad sugerida

| # | Hueco | Bloquea | Prio |
|---|---|---|---|
| G1 | Grafo/topología general en `swarm_create` | El lienzo entero | **P0** |
| G2 | Aristas como rutas reales | Edición de aristas con efecto | **P0** |
| G3 | Mensajería directa miembro↔miembro | "Sin pasar por el maestro" | **P0** |
| G6 | `swarm_stop`/pause por miembro | "Detente y lee" | P1 |
| G8 | Acuses de entrega/lectura | Confianza en la mensajería | P1 |
| G7 | Estado runtime por agente | Lienzo en vivo exacto | P1 |
| G4 | `mesh` con conectividad real | Malla de verdad | P2 |
| G5 | Peer messaging formal en la API | Reemplaza el truco del prompt | P2 |

---

## 5. Preguntas para el equipo

1. ¿El plugin `swarm` puede aceptar un **grafo** en `swarm_create`, o su diseño
   asume hub-and-spoke? ¿Qué coste tiene generalizarlo?
2. ¿Hay alguna **restricción de seguridad/aislamiento** que motive retirar
   `swarm_*` a los miembros? Si es así, ¿podría relajarse a un **subconjunto
   acotado por las aristas**?
3. ¿Existe ya infraestructura de **inbox/mensajería** reutilizable para dar a los
   roles una tool de envío directo, o habría que construirla?
4. ¿`swarm_status` podría exponer **estado por agente** sin cambios disruptivos?
5. ¿Hay un concepto de **pause/resume** de un subagente, o el agente es
   single-flight y habría que añadirlo?

---

## 6. Cómo verificar los cambios (para cuando lleguen)

- **G1/G2**: crear un swarm con un grafo no trivial (p. ej. A→B, B→C, A no
  conectado a C) y comprobar que `swarm_message` de A a C **falla** y A a B
  **funciona**.
- **G3/G5**: pedir a un rol que escriba a otro directamente y ver que el mensaje
  llega **sin** una llamada `swarm_message` del maestro.
- **G6**: lanzar un miembro largo y comprobar que `swarm_stop` lo detiene y que
  procesa la bandeja a continuación.
- **G7**: comprobar que `swarm_status` refleja `running` mientras un rol trabaja.
- **G8**: comprobar que un `swarm_message` a un destinatario desconectado
  devuelve `delivered:false` con motivo.

---

*Contacto en la app: sección «Swarms de agentes» (`src/features/swarm/`),
modelo y contrato en `src/lib/swarm.ts`.*
