import { describe, expect, it } from "vitest";
import { assessLicense, attributionFor, isUsableTrack, musicManifestSchema, manifestTrackSchema } from "./music-library";

const legacy = {
  id: "old-track",
  file: "old.mp3",
  title: "旧曲目",
  moods: ["温暖"],
  loopable: true,
  license: "待确认",
  source: "",
};

describe("曲库 schema", () => {
  it("旧版 library.json 仍可读取，新字段按保守默认补全", () => {
    const parsed = musicManifestSchema.parse({ tracks: [legacy] });
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]).toMatchObject({
      id: "old-track",
      rightsStatus: "pending",
      commercialUse: null,
      author: "",
      licenseUrl: "",
      sha256: "",
      tags: [],
      disabledReason: "",
    });
    expect(isUsableTrack(parsed.tracks[0])).toBe(false);
  });

  it("其它旧字段（gainDb）保持兼容", () => {
    const parsed = manifestTrackSchema.parse({ ...legacy, gainDb: -3 });
    expect(parsed.gainDb).toBe(-3);
  });
});

describe("授权判定", () => {
  const base = {
    license: "",
    licenseUrl: "",
    commercialUse: null as boolean | null,
    rightsStatus: "pending" as const,
    disabledReason: "",
    evidence: undefined,
  };

  it("没有许可证或官方链接时判定 pending，不猜测", () => {
    expect(assessLicense({ ...base, rightsStatus: "verified", license: "CC BY 4.0" }).status).toBe("pending");
    expect(assessLicense({ ...base, license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", rightsStatus: "pending", commercialUse: true }).status).toBe("pending");
    expect(assessLicense({ ...base, license: "待确认（疑似 Pixabay）" }).status).toBe("pending");
  });

  it("CC BY / CC0 有证据且明确商用才 verified", () => {
    const verified = assessLicense({
      ...base,
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      commercialUse: true,
      rightsStatus: "verified",
      evidence: { url: "https://creativecommons.org/licenses/by/4.0/", fetchedAt: "2026-10-01", text: "You are free to share and adapt for any purpose, even commercially.", file: "", sha256: "" },
    });
    expect(verified.status).toBe("verified");
    expect(verified.commercialUse).toBe(true);
  });

  it("CC BY-NC / ND 等禁止商用的条款判定 rejected", () => {
    expect(assessLicense({ ...base, license: "CC BY-NC 4.0", commercialUse: true, rightsStatus: "verified" }).status).toBe("rejected");
    expect(assessLicense({ ...base, license: "CC BY-ND 4.0" }).status).toBe("rejected");
    expect(assessLicense({ ...base, license: "All Rights Reserved" }).status).toBe("rejected");
  });

  it("显式 rejected / quarantine 保持原状", () => {
    expect(assessLicense({ ...base, rightsStatus: "rejected" }).status).toBe("rejected");
    expect(assessLicense({ ...base, rightsStatus: "quarantine" }).status).toBe("quarantine");
  });

  it("无法归类的许可证保持 pending", () => {
    expect(
      assessLicense({
        ...base,
        license: "某网站自有授权",
        licenseUrl: "https://example.com/license",
        commercialUse: true,
        rightsStatus: "verified",
        evidence: { url: "https://example.com/license", fetchedAt: "2026-10-01", text: "free", file: "", sha256: "" },
      }).status,
    ).toBe("pending");
  });
});

describe("署名", () => {
  it("优先使用显式 attribution，否则按作者/许可组合", () => {
    expect(attributionFor(manifestTrackSchema.parse({ ...legacy, attribution: "Music by X" }))).toBe("Music by X");
    const composed = manifestTrackSchema.parse({ ...legacy, author: "X", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" });
    expect(attributionFor(composed)).toContain("X");
    expect(attributionFor(composed)).toContain("CC BY 4.0");
  });
});
