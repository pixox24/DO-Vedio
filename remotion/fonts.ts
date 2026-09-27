import { loadFont } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

/** 思源黑体（SIL OFL）。渲染时不依赖系统字体，横竖屏、各机器输出一致 */
export const FONT = "DOV Sans SC";

let started = false;
export function ensureFonts() {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("加载字体");
  Promise.all(
    (
      [
        ["NotoSansSC-Regular.otf", "400"],
        ["NotoSansSC-Bold.otf", "700"],
        ["NotoSansSC-Black.otf", "900"],
      ] as const
    ).map(([file, weight]) => loadFont({ family: FONT, url: staticFile(`fonts/${file}`), weight, format: "opentype" })),
  )
    .catch((e) => console.error("字体加载失败", e))
    .finally(() => continueRender(handle));
}
