import { describe, expect, it } from "vitest";
import { blankShot } from "@/lib/core/shots";
import type { Job, JobStatus } from "@/lib/core/types";
import { SHOT_TILE_MIN_WIDTH, chunk, columnCount, shotRows, shotState, shotTime } from "@/components/studio/shot-view";

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", projectId: "p1", stage: "shot-generate", key: "k", target: "镜头 s1",
  status: "queued" satisfies JobStatus, progress: 0, message: "", attempts: 0, maxAttempts: 3, priority: 0,
  runAfter: 0, costEstimate: 0, costActual: 0, error: null, input: null, result: null, createdAt: 0, updatedAt: 0,
  ...over,
});

const server = (over: Partial<Parameters<typeof shotState>[0]["serverStatus"] & object> = {}) => ({
  status: "running", progress: 0.4, message: "", error: null, total: 4, done: 1, failed: 0, running: 1, ...over,
});

describe("分镜时间码", () => {
  it("按 mm:ss 显示，秒不进位到分钟", () => {
    expect(shotTime(0)).toBe("00:00");
    expect(shotTime(34_000)).toBe("00:34");
    expect(shotTime(41_999)).toBe("00:41");
    expect(shotTime(59_999)).toBe("00:59");
    expect(shotTime(60_000)).toBe("01:00");
  });

  it("超过一小时按分钟累计，不截断也不进位成小时", () => {
    expect(shotTime(3_600_000)).toBe("60:00");
    expect(shotTime(4_500_000)).toBe("75:00");
  });
});

describe("分镜板列数", () => {
  it("按容器宽度排满，同时保底一张、上限三张", () => {
    expect(columnCount(830, false)).toBe(3);
    expect(columnCount(440, false)).toBe(1);
    expect(columnCount(232, false)).toBe(1);
    expect(columnCount(1920, false)).toBe(3);
  });

  it("全宽模式放宽上限，但窄容器仍然只排得下几张就排几张", () => {
    expect(columnCount(1920, true)).toBe(5);
    expect(columnCount(1080, true)).toBe(4);
    expect(columnCount(830, true)).toBe(3);
    expect(columnCount(452, true)).toBe(2);
  });

  it("容器还没量出宽度时退化成单列，不返回 0 或负数", () => {
    // ResizeObserver 第一次回调前 clientWidth 可能是 0；列数是 0 会让 grid-template 直接失效。
    expect(columnCount(0, false)).toBe(1);
    expect(columnCount(0, true)).toBe(1);
  });

  it("恰好放得下一张卡时算一列，差 1px 也不算", () => {
    // 两列的临界宽度是「两张卡 + 一条间距」= 220 × 2 + 12，少 1px 就退回一列
    expect(columnCount(SHOT_TILE_MIN_WIDTH, false)).toBe(1);
    expect(columnCount(SHOT_TILE_MIN_WIDTH * 2 + 12, false)).toBe(2);
    expect(columnCount(SHOT_TILE_MIN_WIDTH * 2 + 11, false)).toBe(1);
  });
});

describe("分镜分组", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("按列数切行，最后一行允许不满", () => {
    expect(chunk(items, 3).map((row) => row.map((x) => x.id))).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(chunk(items, 5).map((row) => row.map((x) => x.id))).toEqual([["a", "b", "c", "d", "e"]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("展开区认领它所在的那一行，行内位置不改变", () => {
    const rows = shotRows(items, 3, "b");
    expect(rows[0].expandedInRow?.id).toBe("b");
    expect(rows[1].expandedInRow).toBeUndefined();
    // 关键：b 仍然留在第一行，展开区插在第一行之后，而不是把 b 挤到下一行
    expect(rows[0].row.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("展开行末的卡片时后面几行不重排", () => {
    const rows = shotRows(items, 3, "c");
    expect(rows[0].expandedInRow?.id).toBe("c");
    expect(rows[1].row.map((x) => x.id)).toEqual(["d", "e"]);
  });

  it("展开最后一行里的镜头同样能定位到展开区", () => {
    expect(shotRows(items, 3, "e")[1].expandedInRow?.id).toBe("e");
  });

  it("没有展开、或展开的镜头已被搜索筛选掉时不报错", () => {
    // 筛选条件变化后 expanded 可能指向一个不在列表里的镜头，这时应当什么都不展开。
    expect(shotRows(items, 3, null).every(({ expandedInRow }) => expandedInRow === undefined)).toBe(true);
    expect(shotRows(items, 3, "已删除的镜头").every(({ expandedInRow }) => expandedInRow === undefined)).toBe(true);
  });

  it("列数变化时分组跟着变，展开区跟着被展开的镜头走", () => {
    for (const columns of [1, 2, 3, 4, 5]) {
      const rows = shotRows(items, columns, "d");
      const owner = rows.find(({ row }) => row.some((x) => x.id === "d"));
      expect(owner?.expandedInRow?.id).toBe("d");
      expect(rows.flatMap(({ row }) => row.map((x) => x.id))).toEqual(["a", "b", "c", "d", "e"]);
    }
  });
});

describe("镜头状态裁决", () => {
  it("没有任务时按有没有图片区分「待生成」和「已有图片」", () => {
    expect(shotState({ shot: blankShot("s1", "l1") })).toMatchObject({ status: "idle", label: "待生成", hasImage: false, running: false });
    expect(shotState({ shot: { ...blankShot("s1", "l1"), assetId: "a1" } })).toMatchObject({ status: "idle", label: "已有图片", hasImage: true });
  });

  it("排队与生成中分开，生成中带百分比", () => {
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "queued" }) })).toMatchObject({ status: "queued", running: true, label: "排队中" });
    const running = shotState({ shot: blankShot("s1", "l1"), job: job({ status: "running", progress: 0.5 }) });
    expect(running).toMatchObject({ status: "running", running: true, progress: 0.5, label: "生成中 · 50%" });
  });

  it("成功且素材已经回到文档才算完成", () => {
    const withImage = { ...blankShot("s1", "l1"), assetId: "a1" };
    expect(shotState({ shot: withImage, job: job({ status: "succeeded" }) })).toMatchObject({ status: "done", label: "已完成", running: false });
    // 素材还没同步回来时画面上仍是占位图，不能显示「已完成」
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "succeeded" }) })).toMatchObject({ status: "idle", label: "待生成" });
  });

  it("失败和取消都是终态，不再显示进行中", () => {
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "failed", error: "服务商 500" }) })).toMatchObject({ status: "failed", label: "生成失败", running: false, error: "服务商 500" });
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "canceled" }) })).toMatchObject({ status: "canceled", label: "已取消", running: false });
  });

  it("服务端裁决优先于本地 job", () => {
    // 本地这份 job 只是重试时用来拿 id，状态以服务端为准
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "queued" }), serverStatus: server({ status: "running" }) })).toMatchObject({ status: "running" });
    // 服务端已取消，本地 job 还停在排队——不能继续显示「排队中」
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "queued" }), serverStatus: server({ status: "canceled" }) })).toMatchObject({ status: "canceled", running: false });
    // 服务端还在跑，本地 job 已经失败了——也不能显示失败
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "failed" }), serverStatus: server({ status: "running" }) })).toMatchObject({ status: "running", running: true });
  });

  it("进度优先取服务端批次进度，没有才退回本地 job", () => {
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "running", progress: 0.9 }), serverStatus: server({ progress: 0.25 }) })).toMatchObject({ progress: 0.25, label: "生成中 · 25%" });
    // total 为 0 说明服务端还没排出批次，这时服务端给的 progress 没有意义
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "running", progress: 0.9 }), serverStatus: server({ total: 0, progress: 0 }) })).toMatchObject({ progress: 0.9 });
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ status: "running" }) })).toMatchObject({ progress: 0 });
  });

  it("错误与说明文字以服务端为先，服务端没给才退回本地 job", () => {
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ error: "旧错误" }), serverStatus: server({ error: "新错误" }) })).toMatchObject({ error: "新错误" });
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ message: "等待空闲并发" }), serverStatus: server({ message: "出图中" }) })).toMatchObject({ message: "出图中" });
    // 服务端这一轮没报错（error 为 null）时仍要看本地 job：它的失败原因才是有用的那条
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ error: "重试前那次失败的原因" }), serverStatus: server({ error: null }) })).toMatchObject({ error: "重试前那次失败的原因" });
    expect(shotState({ shot: blankShot("s1", "l1"), job: job({ error: null }), serverStatus: server({ error: null }) })).toMatchObject({ error: null });
  });
});
