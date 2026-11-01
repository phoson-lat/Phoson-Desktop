import { describe, expect, it, vi } from "vitest";

import { remapRecordKeys, withBackoff } from "./recovery";

describe("withBackoff", () => {
  it("reintenta con esperas exponenciales hasta recuperar la conexión", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("ready");

    await expect(withBackoff(operation, { sleep, baseDelayMs: 500 })).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it("propaga el último error y no espera después del último intento", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new Error("still down"));

    await expect(withBackoff(operation, { attempts: 3, sleep })).rejects.toThrow("still down");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("remapRecordKeys", () => {
  it("conserva los borradores al cambiar los ids efímeros del sidecar", () => {
    const drafts = { old: "seguir aquí", untouched: "otro" };
    expect(remapRecordKeys(drafts, { old: "new" })).toEqual({
      new: "seguir aquí",
      untouched: "otro",
    });
    expect(drafts.old).toBe("seguir aquí");
  });
});
