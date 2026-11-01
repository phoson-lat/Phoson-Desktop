import { describe, expect, it } from "vitest";

import { normalizeAttachment } from "./client";

describe("normalizeAttachment", () => {
  it("deduce tipo y nombre del bloque nativo del engine", () => {
    expect(normalizeAttachment({ path: "/tmp/imagen.png", block: { type: "ImageBlock" } })).toEqual({
      path: "/tmp/imagen.png",
      name: "imagen.png",
      kind: "image",
    });
  });

  it("respeta la normalización que ya hizo el sidecar", () => {
    expect(normalizeAttachment({ path: "/tmp/doc.pdf", name: "doc.pdf", kind: "file" })).toEqual({
      path: "/tmp/doc.pdf",
      name: "doc.pdf",
      kind: "file",
    });
  });
});
