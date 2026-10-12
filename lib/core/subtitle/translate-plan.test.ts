import { describe, expect, it } from "vitest";
import { primaryHash } from "./secondary";
import { subtitleTranslateUnits } from "./translate-plan";
import type { Line } from "../types";

const line = (id: string, text: string, extra: Partial<Line> = {}): Line => ({ id, segmentIndex: 0, text, spans: [], keywords: [], locked: false, ...extra });

describe("subtitleTranslateUnits", () => {
  it("只收集还没对上、且能判断语言的句子", () => {
    const fresh = line("a", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") });
    const missing = line("b", "第二句口播");
    const unknown = line("c", "12");
    expect(subtitleTranslateUnits([fresh, missing, unknown]).map((unit) => unit.id)).toEqual(["b"]);
  });
});
