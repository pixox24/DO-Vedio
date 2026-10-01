import { describe, expect, it } from "vitest";
import { listAixStyles, getAixDetail, getAixVisualStyle } from "./catalog";
import { visualStyleSchema } from "../core/types";
import { aixFixture } from "./test-fixture";

describe("Aix catalog", () => {
  it("contains the complete 160-style active catalog", async () => {
    const items = await listAixStyles();
    expect(items).toHaveLength(160);
    expect(new Set(items.map((item) => item.id)).size).toBe(160);
    expect(items.every((item) => item.status === "active" && /^[a-f0-9]{64}$/.test(item.contentHash))).toBe(true);
  });

  it("produces versioned snapshots with full source metadata", async () => {
    const detail = await getAixDetail("Aix0001");
    expect(detail).toBeDefined();
    const snapshot = await getAixVisualStyle("Aix0001");
    expect(snapshot?.source).toMatchObject({ kind: "aix", aixId: "Aix0001", libraryVersion: "0.6.0", styleVersion: detail?.style.version, contentHash: detail?.contentHash });
    expect(() => visualStyleSchema.parse(snapshot)).not.toThrow();
  });

  it("keeps legacy project snapshots readable without source metadata", () => {
    const legacy = { ...aixFixture(), source: undefined, themeSource: undefined };
    expect(() => visualStyleSchema.parse(legacy)).not.toThrow();
  });
});
