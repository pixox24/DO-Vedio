import { loadFont } from "@remotion/fonts";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

/** 思源黑体（SIL OFL）。渲染时不依赖系统字体，横竖屏、各机器输出一致 */
export const FONT = "DOV Sans SC";

let started = false;
export function ensureFonts() {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("加载字体");
  Promise.all([
    ...(
      [
        ["NotoSansSC-Regular.otf", "400"],
        ["NotoSansSC-Bold.otf", "700"],
        ["NotoSansSC-Black.otf", "900"],
      ] as const
    ).map(([file, weight]) => loadFont({ family: FONT, url: staticFile(`fonts/${file}`), weight, format: "opentype" })),
    loadFont({ family: "DOV Song", url: staticFile("fonts/lemi-shigu-song.ttf"), weight: "400" }),
    loadFont({ family: "DOV Youth", url: staticFile("fonts/yaoxing-qingnian-hei.ttf"), weight: "400" }),
  ])
    .then(() => continueRender(handle))
    .catch((error: unknown) => cancelRender(error instanceof Error ? error : new Error(String(error))));
}
