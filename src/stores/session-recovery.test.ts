import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  health: vi.fn(),
  openSession: vi.fn(),
  newSession: vi.fn(),
  attachmentAdd: vi.fn(),
}));

vi.mock("@/bridge/client", () => ({
  phoson: api,
  bindSessionWorkspace: vi.fn(),
  unbindSessionWorkspace: vi.fn(),
  setCurrentWorkspace: vi.fn(),
  getCurrentWorkspace: vi.fn(() => "/workspace"),
}));

import { useSession, type SessionView } from "./session";

const view = (key: string): SessionView => ({
  key,
  title: "Persistida",
  engineId: "engine-1",
  messages: [
    { id: "user-old", role: "user", text: "antes", parts: [], status: "done" },
    { id: "assistant-old", role: "assistant", text: "", parts: [], status: "streaming" },
  ],
  metrics: null,
  confirmations: [],
  notifications: [],
  attachments: [{ path: "/tmp/image.png", name: "image.png", kind: "image" }],
  sending: true,
  workspace: "/workspace",
  subagents: [],
  pluginBlocks: {},
  uploads: [],
});

describe("recoverWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.health.mockResolvedValue({ ok: true, pid: 42, uptimeSec: 0 });
    api.attachmentAdd.mockResolvedValue({ ok: true });
    useSession.setState({
      activeKey: "old",
      order: ["old"],
      sessions: { old: view("old") },
    });
  });

  it("rehidrata el historial, remapea el id y restaura los adjuntos", async () => {
    api.openSession.mockImplementation(async () => {
      // `session.history` llega antes de que la RPC openSession responda.
      useSession.setState((state) => ({
        sessions: {
          ...state.sessions,
          new: {
            ...view("new"),
            messages: [
              { id: "history", role: "user", text: "desde JSONL", parts: [], status: "done" },
            ],
          },
        },
      }));
      return { sessionId: "new", cwd: "/workspace", metrics: null };
    });

    await expect(useSession.getState().recoverWorkspace("/workspace")).resolves.toEqual({ old: "new" });

    const state = useSession.getState();
    expect(state.activeKey).toBe("new");
    expect(state.order).toEqual(["new"]);
    expect(state.sessions.old).toBeUndefined();
    expect(state.sessions.new.messages[0].text).toBe("desde JSONL");
    expect(state.sessions.new.title).toBe("Persistida");
    expect(state.sessions.new.sending).toBe(false);
    expect(state.sessions.new.attachments).toHaveLength(1);
    expect(api.openSession).toHaveBeenCalledWith("engine-1", "/workspace", undefined);
    expect(api.attachmentAdd).toHaveBeenCalledWith("new", "/tmp/image.png");
  });

  it("conserva el texto visible de una sesión que aún no estaba persistida", async () => {
    const unsaved = { ...view("old"), engineId: undefined, attachments: [] };
    useSession.setState({ sessions: { old: unsaved } });
    api.newSession.mockResolvedValue({ sessionId: "new", cwd: "/workspace", metrics: null });

    await useSession.getState().recoverWorkspace("/workspace");

    expect(useSession.getState().sessions.new.messages[0].text).toBe("antes");
    expect(useSession.getState().sessions.new.messages[1].status).toBe("error");
    expect(api.newSession).toHaveBeenCalledWith("/workspace", undefined);
  });
});
