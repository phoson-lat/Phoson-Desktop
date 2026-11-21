import type { Bridge } from "./client";
import type { Envelope, Json } from "./protocol";

type RpcFrame = { jsonrpc?: string; id?: number; method?: string; params?: any; result?: any; error?: { code?: number; message?: string; data?: unknown } };
export interface RemoteSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
}
export interface RemoteOptions { url: string; code?: string; token?: string; workspace?: string; deviceName?: string; socketFactory?: (url: string) => RemoteSocket }
export class RemoteError extends Error { constructor(public readonly code: string, message = "Remote connection failed") { super(message); this.name = "RemoteError"; } }
const connectTimeout = 15000;
const requestTimeout = 60000;
const maxBuffered = 500;
export function validateRemoteUrl(value: string): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new RemoteError("REMOTE_INSECURE_URL", "Invalid remote URL"); }
  const loopback = u.hostname === "localhost" || u.hostname === "::1" || u.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(u.hostname);
  if (!(u.protocol === "wss:" || (u.protocol === "ws:" && loopback)) || u.username || u.password || u.hash || u.search) throw new RemoteError("REMOTE_INSECURE_URL", "Remote URL must use secure transport");
  return u.toString();
}
export class RemoteBridge implements Bridge {
  readonly url: string;
  private storedToken?: string;
  private currentWorkspace: string;
  get workspace(): string { return this.currentWorkspace; }
  private socket: RemoteSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(e: Envelope) => void>();
  private buffered: Envelope[] = [];
  private ended = false;
  private constructor(url: string, socket: RemoteSocket, workspace: string, token?: string) { this.url = url; this.socket = socket; this.currentWorkspace = workspace; this.storedToken = token; socket.addEventListener("message", e => this.message(e.data)); socket.addEventListener("close", () => this.end()); socket.addEventListener("error", () => this.end()); }
  takeToken(): string | undefined { const token = this.storedToken; this.storedToken = undefined; return token; }
  static async connect(options: RemoteOptions): Promise<RemoteBridge> {
    const url = validateRemoteUrl(options.url);
    if (!!options.code === !!options.token || (options.token !== undefined && !options.token.trim())) throw new RemoteError("REMOTE_CREDENTIALS", "Provide pairing code or device token");
    let socket: RemoteSocket;
    try { socket = (options.socketFactory ?? ((u) => new WebSocket(u) as unknown as RemoteSocket))(url); } catch { throw new RemoteError("REMOTE_CONNECT", "Could not connect"); }
    const bridge = new RemoteBridge(url, socket, "");
    const waitOpen = new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(t); socket.removeEventListener?.("open", onOpen); socket.removeEventListener?.("error", onError); socket.removeEventListener?.("close", onClose); };
      const onOpen = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new RemoteError("REMOTE_CONNECT")); };
      const onClose = () => { cleanup(); reject(new RemoteError("REMOTE_CLOSED")); };
      const t = setTimeout(() => { cleanup(); reject(new RemoteError("REMOTE_TIMEOUT")); }, connectTimeout);
      socket.addEventListener("open", onOpen); socket.addEventListener("error", onError); socket.addEventListener("close", onClose);
      if (socket.readyState === 1) onOpen();
    });
    try {
      await waitOpen;
      const auth = options.code ? await bridge.rpc<any>("gateway.pair", { code: options.code, deviceName: options.deviceName ?? "Phoson Desktop" }) : await bridge.rpc<any>("gateway.auth", { token: options.token });
      const token = options.code ? auth?.token : options.token;
      if (typeof token !== "string" || !token.trim()) throw new RemoteError("REMOTE_CREDENTIALS");
      const opened = await bridge.rpc<any>("gateway.open", options.workspace ? { workspace: options.workspace } : {});
      if (!opened || opened.protocol !== 1 || typeof opened.workspace !== "string" || !opened.workspace.trim()) throw new RemoteError("REMOTE_PROTOCOL", "Unsupported remote protocol");
      bridge.currentWorkspace = opened.workspace;
      bridge.storedToken = token;
      return bridge;
    } catch (error) { socket.close(); throw error instanceof RemoteError ? error : new RemoteError("REMOTE_HANDSHAKE"); }
  }
  get connected(): boolean { return !this.ended && this.socket.readyState === 1; }
  get metadata(): { workspace: string; protocol: 1 } { return { workspace: this.workspace, protocol: 1 }; }
  rpc<T = Json>(method: string, params: Json = {}, workspace?: string | null): Promise<T> {
    if (workspace && this.workspace && workspace !== this.workspace) return Promise.reject(new RemoteError("REMOTE_WORKSPACE_MISMATCH"));
    if (this.ended) return Promise.reject(new RemoteError("REMOTE_CLOSED"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const control = method.startsWith("gateway.") || method === "initialize";
      const duration = control ? connectTimeout : requestTimeout;
      const timer = method === "turn.run" ? undefined : setTimeout(() => { this.pending.delete(id); reject(new RemoteError("REMOTE_TIMEOUT")); }, duration);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); } catch { clearTimeout(timer); this.pending.delete(id); reject(new RemoteError("REMOTE_SEND")); }
    });
  }
  async onNotify(handler: (envelope: Envelope) => void): Promise<() => void> { this.listeners.add(handler); for (const event of this.buffered.splice(0)) this.deliver(handler, event); return () => this.listeners.delete(handler); }
  private deliver(handler: (envelope: Envelope) => void, event: Envelope): void { try { handler(event); } catch { /* Un suscriptor no debe interrumpir el transporte. */ } }
  close(): void { if (!this.ended) { this.ended = true; this.socket.close(); this.rejectPending(); } }
  private message(raw: unknown): void {
    let msg: RpcFrame;
    try { msg = JSON.parse(typeof raw === "string" ? raw : ""); } catch { return; }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    if (typeof msg.id === "number") { const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(new RemoteError(`REMOTE_RPC_${msg.error.code ?? "ERROR"}`, "Remote request failed")) : p.resolve(msg.result); return; }
    if (typeof msg.method === "string") { const event: Envelope = { method: msg.method, params: msg.params ?? {} }; if (this.listeners.size) this.listeners.forEach(fn => this.deliver(fn, event)); else { if (this.buffered.length === maxBuffered) this.buffered.shift(); this.buffered.push(event); } }
  }
  private end(): void { if (this.ended) return; this.ended = true; this.rejectPending(); }
  private rejectPending(): void { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new RemoteError("REMOTE_CLOSED")); } this.pending.clear(); }
}
