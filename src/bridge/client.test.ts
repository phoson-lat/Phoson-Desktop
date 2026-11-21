import { describe, expect, it, vi } from "vitest";

import { bridge, installBridge, isRemoteMode, normalizeAttachment, openPath, resetBridge } from "./client";

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

describe("aislamiento remoto", () => {
  it("bloquea operaciones nativas y administrativas sin enviarlas al servidor", async () => {
    const rpc = vi.fn().mockResolvedValue({ ok: true });
    installBridge({ rpc, onNotify: async () => () => {} }, "/servidor");
    try {
      expect(isRemoteMode()).toBe(true);
      for (const method of ["stt.start", "auth.login", "auth.logout", "config.set", "plugins.install", "plugins.set", "mcp.save", "mcp.remove", "fs.setCwd"]) {
        await expect(bridge.rpc(method)).rejects.toThrow();
      }
      await expect(openPath("/servidor/archivo.txt")).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
      await expect(bridge.rpc("fs.read", { path: "/servidor/archivo.txt" }, "/servidor")).resolves.toEqual({ ok: true });
      expect(rpc).toHaveBeenCalledOnce();
    } finally {
      resetBridge();
    }
    expect(isRemoteMode()).toBe(false);
    await expect(bridge.rpc("session.close", { sessionId: "demo" })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledOnce();
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
