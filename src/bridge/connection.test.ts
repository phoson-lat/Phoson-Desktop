import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, installBridge, resetBridge, isTauri, connect, close } = vi.hoisted(() => ({
  invoke: vi.fn(),
  installBridge: vi.fn(),
  resetBridge: vi.fn(),
  isTauri: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./client", () => ({ installBridge, resetBridge, isTauri, isRemoteMode: vi.fn() }));
vi.mock("./remote", () => ({
  validateRemoteUrl: (url: string) => {
    if (!url.startsWith("wss://")) throw new Error("REMOTE_INSECURE_URL");
    return url.endsWith("/") ? url : `${url}/`;
  },
  RemoteBridge: { connect },
}));

import { connectRemote, getRemoteProfile, useLocalMode } from "./connection";

const profile = { url: "wss://example.com", workspace: "workspace-1", deviceName: "Equipo" };
const bridge = { metadata: { workspace: "workspace-1" }, workspace: "workspace-1", connected: true, takeToken: vi.fn(() => "token-nuevo"), close };

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
};

beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  vi.clearAllMocks();
  isTauri.mockReturnValue(true);
  invoke.mockResolvedValue(null);
  bridge.takeToken.mockReturnValue("token-nuevo");
  connect.mockResolvedValue(bridge);
});

describe("conexión remota", () => {
  it("guarda el perfil sin token en Web Storage", () => {
    localStorage.setItem("phoson.remote.profile", JSON.stringify(profile));
    expect(getRemoteProfile()).toEqual(profile);
    expect(JSON.stringify(getRemoteProfile())).not.toContain("token");
  });

  it("valida la URL antes de consultar el llavero", async () => {
    await expect(connectRemote({ ...profile, url: "http://example.com", remember: true })).rejects.toThrow("REMOTE_INSECURE_URL");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("persiste el token recordado e instala el puente", async () => {
    invoke.mockResolvedValueOnce("token-existente").mockResolvedValueOnce(undefined);
    await connectRemote({ ...profile, remember: true });
    expect(invoke).toHaveBeenNthCalledWith(1, "remote_token_get", { server: "wss://example.com/" });
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_token_set", { server: "wss://example.com/", token: "token-nuevo" });
    expect(installBridge).toHaveBeenCalledWith(bridge, "workspace-1");
    expect(JSON.parse(localStorage.getItem("phoson.remote.profile")!)).toEqual({ url: "wss://example.com/", workspace: "workspace-1", deviceName: "Equipo" });
  });

  it("cierra el puente y no lo instala si falla la persistencia", async () => {
    invoke.mockResolvedValueOnce("token-existente").mockRejectedValueOnce(new Error("fallo"));
    await expect(connectRemote({ ...profile, remember: true })).rejects.toThrow("REMOTE_STORAGE_FAILED");
    expect(close).toHaveBeenCalled();
    expect(installBridge).not.toHaveBeenCalled();
  });

  it("elimina el token cuando no se recuerda", async () => {
    invoke.mockResolvedValueOnce("token-existente");
    await connectRemote({ ...profile, remember: false });
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_token_delete", { server: "wss://example.com/" });
    expect(installBridge).toHaveBeenCalled();
  });

  it("falla si no hay credenciales", async () => {
    await expect(connectRemote({ ...profile, remember: false })).rejects.toThrow("REMOTE_CREDENTIAL_REQUIRED");
    expect(connect).not.toHaveBeenCalled();
  });

  it("cierra la conexión local, reinicia el puente y elimina el perfil", async () => {
    localStorage.setItem("phoson.remote.profile", JSON.stringify(profile));
    sessionStorage.setItem("phoson.chooseConnection", "1");
    useLocalMode();
    expect(resetBridge).toHaveBeenCalledOnce();
    expect(localStorage.getItem("phoson.remote.profile")).toBeNull();
    expect(sessionStorage.getItem("phoson.chooseConnection")).toBeNull();
  });
});
