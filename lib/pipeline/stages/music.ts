import { layoutLines } from "../../core/timeline";
import { NoEligibleMusicError, pickMusic } from "../../core/music";
import { mutateProject, getProject } from "../../server/projects";
import { listTracks, listUsableTracks } from "../../server/music";
import { loadArtifacts } from "../artifacts";
import { defineStage, PermanentError } from "../stage";

/** 配乐：按情绪曲线选曲。纯规则，不调用大模型，只使用已核实授权的曲目 */
export const musicStage = defineStage<{ projectId: string }, { cues: number }>({
  name: "music",
  async run(input, ctx) {
    const p = getProject(input.projectId);
    if (!p) throw new PermanentError("项目不存在");
    const tracks = listUsableTracks();
    if (tracks.length === 0) {
      const total = listTracks().length;
      throw new PermanentError(
        total === 0
          ? "曲库为空：请在 bgm/ 放入音乐并填写 bgm/library.json，然后运行 npm run library:ingest"
          : `曲库中没有已核实授权的可用曲目（共 ${total} 首待核实或已禁用）：请用 npm run library:fetch 导入许可明确的音乐`,
      );
    }
    let n = 0;
    try {
      mutateProject(input.projectId, (doc) => {
        if (!ctx.current()) return null;
        const laid = layoutLines(doc.lines, loadArtifacts(doc, input.projectId));
        const durations = laid.lines.map((l, k) => (laid.lines[k + 1]?.startMs ?? laid.endMs) - l.startMs);
        const cues = pickMusic(doc.lines, durations, tracks, doc.music);
        n = cues.length;
        return { ...doc, music: cues };
      });
    } catch (e) {
      if (e instanceof NoEligibleMusicError) throw new PermanentError(e.message);
      throw e;
    }
    return { cues: n };
  },
});
