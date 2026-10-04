/**
 * Conexión estilo Miro / Excalidraw.
 *
 * En vez de engancharse a un puerto fijo (arriba/abajo), la línea se ancla al
 * **lado del nodo más próximo al otro extremo** (la intersección de la recta
 * centro-a-centro con el borde del rectángulo) y sale con una curva suave. Así
 * las conexiones "abrazan" las cajas como en una pizarra.
 */

import {
  BaseEdge,
  getBezierPath,
  Position,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
  type XYPosition,
} from "@xyflow/react";

/** Punto del borde de `node` en la dirección hacia `towards`. */
function intersection(node: InternalNode, towards: InternalNode): XYPosition {
  // OJO: `w`/`h` son las **medias** dimensiones (como en el ejemplo de React
  // Flow). Usar las completas desplaza el punto y deja la línea suelta.
  const w = (node.measured.width ?? 0) / 2;
  const h = (node.measured.height ?? 0) / 2;
  const origin = node.internals.positionAbsolute;
  const other = towards.internals.positionAbsolute;
  if (!w || !h) return { x: origin.x + w, y: origin.y + h };

  const x2 = origin.x + w;
  const y2 = origin.y + h;
  const x1 = other.x + (towards.measured.width ?? 0) / 2;
  const y1 = other.y + (towards.measured.height ?? 0) / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

/** Lado por el que sale la línea, según dónde cae el punto de corte. */
function side(node: InternalNode, point: XYPosition): Position {
  const nx = Math.round(node.internals.positionAbsolute.x);
  const ny = Math.round(node.internals.positionAbsolute.y);
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (px <= nx + 1) return Position.Left;
  if (px >= nx + w - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + h - 1) return Position.Bottom;
  return Position.Top;
}

export function FloatingEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const sourcePoint = intersection(sourceNode, targetNode);
  const targetPoint = intersection(targetNode, sourceNode);

  const [path] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition: side(sourceNode, sourcePoint),
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition: side(targetNode, targetPoint),
    curvature: 0.35,
  });

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}
