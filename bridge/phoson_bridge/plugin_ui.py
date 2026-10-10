"""``GuiPluginUiService`` — los ``UiBlock`` de plugins llegan a la GUI como JSON.

El engine expone un ``PluginUiService`` (``phoson_agent.cli_extensions``) y su
implementación para hosts, ``SinkPluginUiService``, **renderiza los bloques a
Rich** antes de pasarlos al sink: pensado para los front-ends de terminal. La
GUI no quiere un renderizado de terminal, sino el bloque **neutro** (la
dataclass ``NoticeBlock``/``KeyValueBlock``/``TodoListBlock``/``ProgressBlock``)
para pintarlo como componente nativo.

Por eso esta subclase publica sin renderizar: delega en los hooks
``publish_plugin_block``/``replace_plugin_block``/``remove_plugin_block`` del
sink (el mismo duck-typing que hace el engine), que serializan el bloque a JSON
y lo emiten como ``plugin.block`` / ``plugin.block.remove``. El resto de
métodos interactivos (``ask``/``select``/``form``/``confirm``) son los heredados,
que ya delegan en ``GuiConfirmation``.

OJO con ``SessionController._rebuild_engine``: en cada reconstrucción crea un
``SinkPluginUiService`` nuevo y lo inyecta en ``engine.context.extra``. Por eso
``install()`` se llama siempre que el bridge entrega un repl (ver
``SessionManager.get``): antes de cualquier turno, el servicio vuelve a ser este.
"""

from __future__ import annotations

from typing import Any

from phoson_cli.plugin_ui import SinkPluginUiService


class GuiPluginUiService(SinkPluginUiService):
    """``SinkPluginUiService`` sin la capa Rich: bloques neutros para la GUI."""

    def publish(self, block: Any) -> None:
        publish = getattr(self._sink, "publish_plugin_block", None)
        if publish is not None:
            publish(block.id, block)
            return
        super().publish(block)

    def replace(self, block_id: str, block: Any) -> None:
        replace = getattr(self._sink, "replace_plugin_block", None)
        if replace is not None:
            replace(block_id, block)
            return
        super().replace(block_id, block)

    def remove(self, block_id: str) -> None:
        remove = getattr(self._sink, "remove_plugin_block", None)
        if remove is not None:
            remove(block_id)
            return
        super().remove(block_id)


def install(repl: Any) -> None:
    """Asegura que el repl use ``GuiPluginUiService`` (idempotente y barato).

    ``_rebuild_engine`` inyecta un ``SinkPluginUiService`` nuevo (p. ej. tras un
    cambio de modelo), con lo que los bloques volverían a llegar como Rich
    renderizado. Se llama cada vez que el bridge entrega un repl, de modo que
    ningún turno puede publicar bloques con el servicio viejo.
    """
    controller = getattr(repl, "_controller", None)
    if controller is None:
        return
    current = getattr(controller, "plugin_ui", None)
    if isinstance(current, GuiPluginUiService):
        return
    # El servicio actual ya tiene el sink/confirmation/thema correctos: nos
    # quedamos con sus entrañas y solo cambiamos el tipo de servicio.
    sink = getattr(current, "_sink", None) or getattr(controller, "sink", None)
    confirmation = getattr(current, "_confirmation", None) or getattr(
        controller, "confirmation", None
    )
    service = GuiPluginUiService(
        sink,
        getattr(current, "theme", None),
        confirmation=confirmation,
    )
    controller.plugin_ui = service
    engine = getattr(controller, "engine", None)
    context = getattr(engine, "context", None) if engine is not None else None
    if context is not None:
        context.extra["plugin_ui"] = service


__all__ = ["GuiPluginUiService", "install"]
