import { defineStage } from "../stage";

/**
 * 配乐不再自动选曲。这个步骤只负责把升级前排过队的「情绪选曲」任务收掉，
 * 避免项目一直停在「配乐中」。用户选的曲子写在项目文档里。
 */
export const musicStage = defineStage<unknown, { cues: number }>({
  name: "music",
  async run() {
    return { cues: 0 };
  },
});
