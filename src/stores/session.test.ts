import { describe, expect, it } from "vitest";

import { mergeTextParts, type MessagePart } from "./session";

describe("mergeTextParts", () => {
  it("fusiona texto adyacente sin cruzar herramientas", () => {
    const parts: MessagePart[] = [
      { kind: "text", text: "antes " },
      { kind: "text", text: "de la tool" },
      {
        kind: "tool",
        tool: { id: "call-1", name: "read_file", status: "done" },
      },
      { kind: "text", text: "después" },
    ];

    expect(mergeTextParts(parts)).toEqual([
      { kind: "text", text: "antes de la tool" },
      parts[2],
      { kind: "text", text: "después" },
    ]);
  });

  it("no muta el stream recibido", () => {
    const parts: MessagePart[] = [{ kind: "text", text: "a" }, { kind: "text", text: "b" }];
    mergeTextParts(parts);
    expect(parts).toEqual([{ kind: "text", text: "a" }, { kind: "text", text: "b" }]);
  });
});
