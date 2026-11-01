import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDrafts, saveDrafts } from "./drafts";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
};

describe("borradores persistentes", () => {
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", storage);
  });

  it("guarda solo borradores con contenido y los recupera por sesión", () => {
    saveDrafts({ one: "borrador", empty: "" });
    expect(loadDrafts()).toEqual({ one: "borrador" });
  });

  it("tolera JSON corrupto o una forma inesperada", () => {
    values.set("phoson.drafts", "not json");
    expect(loadDrafts()).toEqual({});
    values.set("phoson.drafts", JSON.stringify({ one: 42, two: "ok" }));
    expect(loadDrafts()).toEqual({ two: "ok" });
  });
});
