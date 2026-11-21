import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ newSession: vi.fn() }));
const routing = vi.hoisted(() => ({
  setCurrentWorkspace: vi.fn(),
  getCurrentWorkspace: vi.fn(() => "/current"),
}));

vi.mock("@/bridge/client", () => ({
  phoson: api,
  bindSessionWorkspace: vi.fn(),
  unbindSessionWorkspace: vi.fn(),
  setCurrentWorkspace: routing.setCurrentWorkspace,
  getCurrentWorkspace: routing.getCurrentWorkspace,
}));
vi.mock("../bridge/connection", () => ({
  isRemoteMode: vi.fn(() => false),
  remoteWorkspace: vi.fn(() => null),
}));

import { useSession, type SessionView } from "./session";

const view = (key: string, workspace: string, overrides: Partial<SessionView> = {}): SessionView => ({
  key,
  title: key,
  messages: [],
  metrics: null,
  confirmations: [],
  notifications: [],
  attachments: [],
  sending: false,
  workspace,
  subagents: [],
  pluginBlocks: {},
  uploads: [],
  ...overrides,
});

const reset = (sessions: Record<string, SessionView>, order: string[], activeKey: string) => {
  useSession.setState({ sessions, order, activeKey, cwd: "/old" });
};

describe("session project switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset({ old: view("old", "/old", { sending: true }), target: view("target", "/project") }, ["old", "target"], "old");
  });

  it("reuses an existing non-peer session without canceling another workspace's sending session", async () => {
    await expect(useSession.getState().setWorkspace("/project")).resolves.toBe("/project");
    expect(api.newSession).not.toHaveBeenCalled();
    expect(useSession.getState().activeKey).toBe("target");
    expect(useSession.getState().sessions.old.sending).toBe(true);
    expect(routing.setCurrentWorkspace).toHaveBeenCalledWith("/project");
  });

  it("creates a session for a missing workspace and updates cwd", async () => {
    api.newSession.mockResolvedValue({ sessionId: "created", cwd: "/new-project" });
    await expect(useSession.getState().setWorkspace("/new-project")).resolves.toBe("/new-project");
    expect(api.newSession).toHaveBeenCalledWith("/new-project", undefined);
    expect(useSession.getState().cwd).toBe("/new-project");
  });

  it("leaves active session, cwd, and routing unchanged if creating a session rejects", async () => {
    api.newSession.mockRejectedValue(new Error("failed"));
    await expect(useSession.getState().setWorkspace("/missing")).rejects.toThrow("failed");
    expect(useSession.getState().activeKey).toBe("old");
    expect(useSession.getState().cwd).toBe("/old");
    expect(routing.setCurrentWorkspace).not.toHaveBeenCalled();
  });

  it("setActive updates the current workspace", () => {
    useSession.getState().setActive("target");
    expect(useSession.getState().activeKey).toBe("target");
    expect(useSession.getState().cwd).toBe("/project");
    expect(routing.setCurrentWorkspace).toHaveBeenCalledWith("/project");
  });

  it("does not reuse a peer session for normal project chat", async () => {
    reset({ old: view("old", "/old"), peer: view("peer", "/project", { peer: { name: "peer-1", team: "team-1" } }) }, ["old", "peer"], "old");
    api.newSession.mockResolvedValue({ sessionId: "normal", cwd: "/project" });
    await useSession.getState().setWorkspace("/project");
    expect(api.newSession).toHaveBeenCalledWith("/project", undefined);
    expect(useSession.getState().activeKey).toBe("normal");
  });
});
