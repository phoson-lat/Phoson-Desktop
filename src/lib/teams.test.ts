import { describe, expect, it } from "vitest";

import { agentRolePrompt, mentionsAgent, normalizePeerName, peerMessagePrompt, PEER_NAME_PATTERN } from "./teams";
import type { TeamAgent } from "@/stores/teams";

const agent: TeamAgent = {
  id: "1",
  teamId: "general",
  name: "backend",
  role: "Revisa el engine",
  workspace: "/workspace",
};

describe("Equipos", () => {
  it("usa nombres compatibles con el bus peers", () => {
    expect(normalizePeerName(" Backend-Agent ")).toBe("backend-agent");
    expect(PEER_NAME_PATTERN.test("backend-agent")).toBe(true);
    expect(PEER_NAME_PATTERN.test("agente con espacios")).toBe(false);
  });

  it("añade rol y protocolo solo al prompt del primer turno", () => {
    const prompt = agentRolePrompt(agent, "general", "Revisa este fallo");
    expect(prompt).toContain('agent "backend"');
    expect(prompt).toContain("Revisa el engine");
    expect(prompt).toContain("peer_ask");
    expect(prompt.endsWith("Revisa este fallo")).toBe(true);
  });

  it("detecta menciones literales, incluidos nombres con punto", () => {
    expect(mentionsAgent("@frontend.api revisa esto", "frontend.api")).toBe(true);
    expect(mentionsAgent("@frontendXapi revisa esto", "frontend.api")).toBe(false);
  });

  it("convierte una mención en una petición peer_ask autocontenida", () => {
    expect(peerMessagePrompt("frontend", "¿Puedes revisar la UI?")).toContain('peer_ask tool to contact the agent "frontend"');
  });
});
