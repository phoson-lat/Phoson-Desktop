import type { TeamAgent } from "@/stores/teams";

/** Regla compartida con phoson_plugin_peers.storage.normalize_name. */
export const PEER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizePeerName(value: string): string {
  return value.trim().toLowerCase();
}

/** Instrucción inicial visible para el modelo, no un mensaje extra de la UI. */
export function agentRolePrompt(agent: TeamAgent, teamName: string, userText: string): string {
  const role = agent.role.trim();
  return [
    `You are the named agent "${agent.name}" on team "${teamName}".`,
    role ? `Your role in this team is: ${role}.` : "",
    "You can coordinate with teammates using peer_list, peer_send and peer_ask. Requests must be self-contained because other agents do not see this conversation.",
    "",
    userText,
  ]
    .filter(Boolean)
    .join("\n");
}

export function mentionsAgent(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?:\\s|$)`, "i").test(text);
}

export function peerMessagePrompt(recipient: string, userText: string): string {
  return [
    `Use the peer_ask tool to contact the agent "${recipient}" with the following self-contained request. Wait for its reply and summarize the result.`,
    "",
    userText,
  ].join("\n");
}
