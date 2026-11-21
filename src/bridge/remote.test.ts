import { describe, expect, it, vi } from "vitest";
import { RemoteBridge, type RemoteSocket } from "./remote";

class FakeSocket {
  readyState = 0;
  sent: any[] = [];
  events = new Map<string, Array<(event: any) => void>>();
  addEventListener(type: string, listener: (event: any) => void) { this.events.set(type, [...(this.events.get(type) ?? []), listener]); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.fire("close", {}); }
  fire(type: string, event: any) { for (const cb of this.events.get(type) ?? []) cb(event); }
  open() { this.readyState = 1; this.fire("open", {}); }
  reply(result: any) { const call = this.sent[this.sent.length - 1]; this.fire("message", { data: JSON.stringify({ jsonrpc: "2.0", id: call.id, result }) }); }
}

const setup = async (credentials: any = { code: "PAIR" }) => {
  const socket = new FakeSocket();
  const connecting = RemoteBridge.connect({ url: "ws://localhost:7337/v1", ...credentials, socketFactory: () => socket as unknown as RemoteSocket });
  socket.open();
  await Promise.resolve();
  socket.reply(credentials.code ? { deviceId: "d", token: "secret" } : { deviceId: "d" });
  await Promise.resolve();
  socket.reply({ workspace: "/work", protocol: 1, serverVersion: "1" });
  return { bridge: await connecting, socket };
};

describe("RemoteBridge", () => {
  it("autentica, abre workspace y rechaza otro workspace", async () => {
    const { bridge, socket } = await setup();
    expect(socket.sent.map((m) => m.method)).toEqual(["gateway.pair", "gateway.open"]);
    expect(bridge.metadata).toEqual({ workspace: "/work", protocol: 1 });
    expect(bridge.takeToken()).toBe("secret");
    expect(bridge.takeToken()).toBeUndefined();
    await expect(bridge.rpc("initialize", {}, "/other")).rejects.toMatchObject({ code: "REMOTE_WORKSPACE_MISMATCH" });
    bridge.close();
  });

  it("valida seguridad URL sin abrir el socket", async () => {
    await expect(RemoteBridge.connect({ url: "ws://example.com/v1", token: "x", socketFactory: () => { throw new Error(); } }))
      .rejects.toMatchObject({ code: "REMOTE_INSECURE_URL" });
  });

  it("autentica con token y no incluye credenciales en la URL", async () => {
    const { bridge, socket } = await setup({ token: "device-secret" });
    expect(socket.sent.map((m) => [m.method, m.params])).toEqual([
      ["gateway.auth", { token: "device-secret" }],
      ["gateway.open", {}],
    ]);
    expect(bridge.takeToken()).toBe("device-secret");
    bridge.close();
  });

  it("mantiene IDs monotónicos tras el handshake", async () => {
    const { bridge, socket } = await setup();
    const first = bridge.rpc("one");
    const second = bridge.rpc("two");
    expect(socket.sent.slice(2).map((m) => m.id)).toEqual([3, 4]);
    socket.fire("message", { data: JSON.stringify({ jsonrpc: "2.0", id: 3, result: null }) });
    socket.fire("message", { data: JSON.stringify({ jsonrpc: "2.0", id: 4, result: null }) });
    await Promise.all([first, second]);
    bridge.close();
  });

  it("reproduce notificaciones recibidas durante el handshake", async () => {
    const socket = new FakeSocket();
    const connecting = RemoteBridge.connect({ url: "ws://localhost:7337/v1", code: "PAIR", socketFactory: () => socket as unknown as RemoteSocket });
    socket.open();
    await Promise.resolve();
    socket.fire("message", { data: JSON.stringify({ jsonrpc: "2.0", method: "agent.event", params: { sessionId: "early" } }) });
    socket.reply({ deviceId: "d", token: "secret" });
    await Promise.resolve();
    socket.reply({ workspace: "/work", protocol: 1, serverVersion: "1" });
    const bridge = await connecting;
    const received: any[] = [];
    await bridge.onNotify((event) => received.push(event));
    expect(received).toEqual([{ method: "agent.event", params: { sessionId: "early" } }]);
    bridge.close();
  });

  it("rechaza turn.run pendiente al cerrar", async () => {
    const { bridge, socket } = await setup();
    const pending = bridge.rpc("turn.run", { prompt: "hello" });
    bridge.close();
    await expect(pending).rejects.toMatchObject({ code: "REMOTE_CLOSED" });
    expect(socket.readyState).toBe(3);
  });

  it("rechaza protocolos no compatibles", async () => {
    const socket = new FakeSocket();
    const connecting = RemoteBridge.connect({ url: "ws://localhost:7337/v1", code: "PAIR", socketFactory: () => socket as unknown as RemoteSocket });
    socket.open();
    await Promise.resolve();
    socket.reply({ deviceId: "d", token: "secret" });
    await Promise.resolve();
    socket.reply({ workspace: "/work", protocol: 2, serverVersion: "1" });
    await expect(connecting).rejects.toMatchObject({ code: "REMOTE_PROTOCOL" });
  });

  it("ignora frames malformados y aísla suscriptores que fallan", async () => {
    const { bridge, socket } = await setup();
    const received = vi.fn();
    await bridge.onNotify(() => { throw new Error("suscriptor"); });
    await bridge.onNotify(received);
    for (const data of ["null", "[]", "invalido", "42"]) {
      expect(() => socket.fire("message", { data })).not.toThrow();
    }
    socket.fire("message", { data: JSON.stringify({ method: "agent.event", params: { value: 1 } }) });
    expect(received).toHaveBeenCalledWith({ method: "agent.event", params: { value: 1 } });
    bridge.close();
  });

  it("limita RPC normales sin expirar turn.run", async () => {
    vi.useFakeTimers();
    const { bridge } = await setup();
    try {
      const normal = expect(bridge.rpc("fs.list")).rejects.toMatchObject({ code: "REMOTE_TIMEOUT" });
      const turnResult = vi.fn();
      const turn = bridge.rpc("turn.run").catch(turnResult);
      await vi.advanceTimersByTimeAsync(60001);
      await normal;
      expect(turnResult).not.toHaveBeenCalled();
      bridge.close();
      await turn;
      expect(turnResult).toHaveBeenCalledOnce();
    } finally { bridge.close(); vi.useRealTimers(); }
  });

  it("rechaza URL con credenciales en query sin abrir socket", async () => {
    const factory = vi.fn(() => new FakeSocket() as unknown as RemoteSocket);
    await expect(RemoteBridge.connect({ url: "wss://example.com/v1?token=secret", token: "x", socketFactory: factory }))
      .rejects.toMatchObject({ code: "REMOTE_INSECURE_URL" });
    expect(factory).not.toHaveBeenCalled();
  });
});
