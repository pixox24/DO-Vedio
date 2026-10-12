import { HomeComposer } from "@/components/home-composer";

/**
 * 首页只有输入区：一个输入框承载三种入口，默认那一种是完整可用的「输入标题」。
 * 项目列表整体迁到 /projects（见 components/project-list.tsx）。
 */
export default function Home() {
  return <HomeComposer />;
}
