import { describe, expect, it } from "vitest";

import { sanitizeLogValue } from "./log";

describe("sanitizeLogValue", () => {
  it("redacta credenciales también dentro de los parámetros RPC", () => {
    expect(
      sanitizeLogValue({
        provider: "openai",
        secrets: { openai: "sk-live-secret" },
        nested: { authorization: "Bearer token", token: "oauth-token" },
      }),
    ).toEqual({
      provider: "openai",
      secrets: "[redacted]",
      nested: { authorization: "[redacted]", token: "[redacted]" },
    });
  });

  it("mantiene el diagnóstico no sensible y limita valores enormes", () => {
    expect(sanitizeLogValue({ method: "config.set", ok: true, text: "x".repeat(300) })).toEqual({
      method: "config.set",
      ok: true,
      text: `${"x".repeat(240)}…(+60)`,
    });
  });
});
