import { describe, expect, it } from "vitest";

import { bridge, normalizeAttachment } from "./client";

describe("mock bridge RPC contract", () => {
  it("devuelve candidatos vacíos para una sesión sin historial", async () => {
    await expect(bridge.rpc("session.jumpCandidates", { sessionId: "demo" }))
      .resolves.toEqual({ candidates: [] });
  });

  it("devuelve un plan no aplicable para una sesión sin historial", async () => {
    await expect(bridge.rpc("session.planCompact", { sessionId: "demo" }))
      .resolves.toMatchObject({
        type: "CompactPlan", ok: false, total_messages: 0,
        summarize_messages: 0, keep_messages: 0, estimated_tokens: 0, profile: "balanced",
      });
  });

  it("permite cerrar una sesión", async () => {
    await expect(bridge.rpc("session.close", { sessionId: "demo" }))
      .resolves.toMatchObject({ ok: true });
  });
});

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
