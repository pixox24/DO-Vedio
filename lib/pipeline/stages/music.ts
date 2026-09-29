import { layoutLines } from "../../core/timeline";
import { pickMusic } from "../../core/music";
import { mutateProject, getProject } from "../../server/projects";
import { listTracks } from "../../server/music";
import { loadArtifacts } from "../artifacts";
import { defineStage, PermanentError } from "../stage";

/** 配乐：按情绪曲线选曲。纯规则，不调用大模型 */
export const musicStage = defineStage<{ projectId: string }, { cues: number }>({
  name: "music",
  async run(input, ctx) {
    const p = getProject(input.projectId);
    if (!p) throw new PermanentError("项目不存在");
    const tracks = listTracks();
    if (tracks.length === 0) throw new PermanentError("曲库为空：请在 bgm/ 放入音乐并填写 bgm/library.json，然后重启 Worker");
    let n = 0;
    mutateProject(input.projectId, (doc) => {
      if (!ctx.current()) return null;
      const laid = layoutLines(doc.lines, loadArtifacts(doc, input.projectId));
      const durations = laid.lines.map((l, k) => (laid.lines[k + 1]?.startMs ?? laid.endMs) - l.startMs);
      const cues = pickMusic(doc.lines, durations, tracks, doc.music);
      n = cues.length;
      return { ...doc, music: cues };
    });
    return { cues: n };
  },
});
