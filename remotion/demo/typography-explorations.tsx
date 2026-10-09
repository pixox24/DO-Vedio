import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { loadFont } from "@remotion/fonts";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { FONT, ensureFonts } from "../fonts";

// 独立静态评审稿，选定方向后再接入正式信息卡。
const INK = "#0e100f";
const PAPER = "#eeeee6";
const MUTED = "#8e9590";
const ORANGE = "#dbaa7c";
const MINT = "#98b8a7";
const SONG = "StudySong";
const YOUTH = "StudyYouth";
const HAND = "StudyHand";
const FREE = "StudyFree";
const MONO = '"Courier New", monospace';
const LIGHT_SONG = '"Songti SC", "StudySong", serif';
const LATIN_SERIF = '"Times New Roman", serif';

export const TYPOGRAPHY_STUDIES = [
  { id: "Typography01", title: "大小字嵌入", font: "摇醒青年黑 × 思源黑体", reference: "reference (1).jpg / reference (4).jpg" },
  { id: "Typography02", title: "数字与留白", font: "思源黑体 × 等宽西文", reference: "reference (6).jpg" },
  { id: "Typography03", title: "切片与蒙版", font: "摇醒青年黑 × 思源黑体", reference: "reference (7).jpg / 凛冬将至" },
  { id: "Typography04", title: "竖排与圆弧", font: "系统宋体 × 思源黑体", reference: "reference (3).jpg / reference (4).jpg" },
  { id: "Typography05", title: "错位与渐隐", font: "思源黑体常规 × 粗体", reference: "reference (7).jpg" },
  { id: "Typography06", title: "时间与刻度", font: "西文衬线 × 思源黑体", reference: "reference (5).jpg / reference (6).jpg" },
  { id: "Typography07", title: "倾斜与竖排", font: "武汉英雄体 × 卓特自由体 × 思源黑体", reference: "reference (5).jpg" },
  { id: "Typography08", title: "虚实与对照", font: "思源黑体 × 摇醒青年黑", reference: "reference (4).jpg / reference (6).jpg" },
] as const;

function useStudyFonts() {
  const [handle] = useState(() => delayRender("加载静态排版字体"));
  useEffect(() => {
    ensureFonts();
    Promise.all([
      [SONG, "lemi-shigu-song.ttf"],
      [YOUTH, "yaoxing-qingnian-hei.ttf"],
      [HAND, "wuhan-yingxiong.ttf"],
      [FREE, "zhuote-ziyou.ttf"],
    ].map(([family, file]) => loadFont({ family, url: staticFile(`fonts/${file}`), weight: "400" })))
      .then(() => continueRender(handle))
      .catch((error: unknown) => cancelRender(error instanceof Error ? error : new Error(String(error))));
  }, [handle]);
}

function Type({ children, x, y, size, family = FONT, weight = 400, color = PAPER, style }: {
  children: ReactNode; x: number; y: number; size: number; family?: string; weight?: number; color?: string; style?: CSSProperties;
}) {
  return <div style={{ position: "absolute", left: x, top: y, fontSize: size, fontFamily: family, fontWeight: weight, color, lineHeight: 1.15, whiteSpace: "nowrap", ...style }}>{children}</div>;
}

function Line({ x, y, width, color = "#555d57", rotate = 0 }: { x: number; y: number; width: number; color?: string; rotate?: number }) {
  return <div style={{ position: "absolute", left: x, top: y, width, height: 1, background: color, transform: `rotate(${rotate}deg)`, transformOrigin: "left center" }} />;
}

function Plus({ x, y, color = MUTED }: { x: number; y: number; color?: string }) {
  return <Type x={x} y={y} size={26} family={MONO} color={color}>+</Type>;
}

function Ground({ children, variant = 0 }: { children: ReactNode; variant?: number }) {
  return <AbsoluteFill style={{ background: INK, color: PAPER, fontFamily: FONT, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: variant % 2 === 0 ? "linear-gradient(120deg, #ffffff03, transparent 46%, #ffffff02)" : "linear-gradient(170deg, transparent 52%, #ffffff03)", pointerEvents: "none" }} />
    {variant === 1 && <div style={{ position: "absolute", left: 1280, top: 0, width: 640, height: 1080, background: "#ffffff02" }} />}
    {variant === 2 && <div style={{ position: "absolute", right: 150, top: 155, width: 200, height: 120, backgroundImage: "radial-gradient(#a3aaa230 1.4px, transparent 1.4px)", backgroundSize: "22px 22px", maskImage: "linear-gradient(90deg, transparent, black)" }} />}
    {children}
  </AbsoluteFill>;
}

function EmbeddedType() {
  return <Ground variant={2}>
    <Type x={375} y={258} size={24} family={MONO} color={MUTED} style={{ letterSpacing: 3 }}>LESS, BUT BETTER</Type>
    <Type x={360} y={323} size={88} weight={400} style={{ letterSpacing: 6 }}>把复杂</Type>
    <Type x={357} y={421} size={190} family={YOUTH} style={{ letterSpacing: -8 }}>变简单</Type>
    <div style={{ position: "absolute", left: 1128, top: 469, width: 88, height: 88, background: ORANGE, borderRadius: "50%", opacity: .9 }} />
    <Type x={1257} y={467} size={31} weight={700}>删去冗余</Type>
    <Type x={1257} y={514} size={31} color={MUTED}>留下重点</Type>
    <Line x={380} y={718} width={808} />
    <Type x={381} y={755} size={25} color={MUTED} style={{ letterSpacing: 7 }}>观察 / 删减 / 重组</Type>
    <Plus x={1208} y={702} color={ORANGE} />
  </Ground>;
}

function NumberType() {
  return <Ground variant={1}>
    <Type x={370} y={217} size={28} style={{ letterSpacing: 5 }}>用户留存</Type>
    <Type x={367} y={269} size={452} weight={700} style={{ letterSpacing: -30, lineHeight: 1 }}>85</Type>
    <Type x={937} y={508} size={124} color={MINT} weight={400}>%</Type>
    <Line x={384} y={787} width={655} />
    <Type x={385} y={824} size={29} color={MUTED} style={{ letterSpacing: 3 }}>看得见的增长</Type>
    <div style={{ position: "absolute", left: 1190, top: 356, width: 320, height: 320, border: "1px solid #5b6a60", borderRadius: "50%" }} />
    <div style={{ position: "absolute", left: 1206, top: 372, width: 288, height: 288, border: "2px dashed #536258", borderRadius: "50%", opacity: .6 }} />
    <div style={{ position: "absolute", left: 1340, top: 345, width: 22, height: 22, background: MINT, borderRadius: "50%" }} />
    <Type x={1283} y={455} size={44} family={MONO}>0→85</Type>
    <Type x={1294} y={526} size={21} color={MUTED} style={{ letterSpacing: 5 }}>留存提升</Type>
  </Ground>;
}

function MaskType() {
  return <Ground>
    <Type x={290} y={184} size={218} family={MONO} color="transparent" style={{ WebkitTextStroke: "1px #323a35", letterSpacing: -10 }}>NEW PERSPECTIVE</Type>
    <div style={{ position: "absolute", left: 292, top: 328, width: 1338, height: 122, overflow: "hidden" }}>
      <Type x={0} y={-64} size={218} family={MONO} color="transparent" style={{ WebkitTextStroke: "1px #323a35", letterSpacing: -10 }}>NEW PERSPECTIVE</Type>
    </div>
    <Type x={315} y={420} size={74} color={ORANGE} style={{ letterSpacing: 8 }}>新的</Type>
    <Type x={305} y={511} size={165} family={YOUTH} style={{ letterSpacing: -4 }}>观看方式</Type>
    <div style={{ position: "absolute", left: 307, top: 650, width: 842, height: 9, background: INK, transform: "rotate(-1deg)" }} />
    <div style={{ position: "absolute", left: 1270, top: 470, width: 190, height: 208, borderTop: "1px solid #505850", borderBottom: "1px solid #505850", background: "linear-gradient(90deg, #ffffff10, transparent)" }} />
    <Type x={1280} y={498} size={26} color={MUTED}>跳出惯性</Type>
    <Type x={1280} y={542} size={26}>重看日常</Type>
    <Type x={1280} y={607} size={39} color={ORANGE}>↗</Type>
    <Line x={315} y={778} width={850} color="#2d352f" />
    <Type x={318} y={815} size={22} family={MONO} color={MUTED} style={{ letterSpacing: 4 }}>A CHANGE IN PERSPECTIVE</Type>
  </Ground>;
}

function VerticalType() {
  return <Ground>
    <div style={{ position: "absolute", left: 549, top: 177, width: 485, height: 670, border: "1px solid #556158", borderRadius: "50%", transform: "rotate(29deg)" }} />
    <Type x={680} y={258} size={187} family={LIGHT_SONG} style={{ writingMode: "vertical-rl", letterSpacing: 50 }}>留白</Type>
    <Type x={465} y={350} size={26} color={MUTED} style={{ writingMode: "vertical-rl", letterSpacing: 14 }}>让信息拥有呼吸</Type>
    <div style={{ position: "absolute", left: 970, top: 342, width: 15, height: 15, borderRadius: "50%", background: ORANGE }} />
    <Type x={1084} y={440} size={46} weight={400}>不是空无</Type>
    <Type x={1084} y={518} size={46} weight={400}>是恰到好处</Type>
    <Line x={1086} y={615} width={293} />
    <Type x={1087} y={649} size={20} family={MONO} color={MUTED} style={{ letterSpacing: 5 }}>SPACE TO BREATHE</Type>
    <Plus x={370} y={750} color={ORANGE} />
  </Ground>;
}

function OffsetType() {
  return <Ground variant={2}>
    <Type x={358} y={263} size={23} family={MONO} color={MUTED} style={{ letterSpacing: 6 }}>FOCUS ON WHAT MATTERS</Type>
    <div style={{ position: "absolute", left: 360, top: 381, width: 917, height: 165, background: "linear-gradient(100deg, #ffffff18, #ffffff03 56%, transparent)", borderTop: "1px solid #9da79a60", borderLeft: "1px solid #9da79a60" }} />
    <Type x={399} y={401} size={107} weight={400} style={{ letterSpacing: 6, maskImage: "linear-gradient(90deg, black 80%, #0007)" }}>保留重点</Type>
    <div style={{ position: "absolute", left: 670, top: 566, width: 870, height: 165, background: "linear-gradient(270deg, #98b8a726, #98b8a706 56%, transparent)", borderBottom: "1px solid #98b8a765", borderRight: "1px solid #98b8a765" }} />
    <Type x={783} y={588} size={107} weight={700} style={{ letterSpacing: 6, maskImage: "linear-gradient(90deg, #0008, black 25%)" }}>删去噪声</Type>
    <Plus x={339} y={360} color={MINT} />
    <Plus x={1532} y={732} color={MINT} />
    <Type x={391} y={612} size={46} color={MINT}>↘</Type>
    <Type x={398} y={685} size={22} color={MUTED} style={{ letterSpacing: 3 }}>先做减法</Type>
  </Ground>;
}

function TimelineType() {
  return <Ground variant={1}>
    <Type x={367} y={240} size={44} weight={700}>每一步都算数</Type>
    <Type x={370} y={309} size={22} family={MONO} color={MUTED} style={{ letterSpacing: 5 }}>EVERY STEP COUNTS</Type>
    <Line x={369} y={680} width={1195} color="#59625a" />
    {[{ x: 370, year: "2020", label: "启动" }, { x: 810, year: "2022", label: "发布" }, { x: 1250, year: "2024", label: "更新" }].map((item, index) => <div key={item.year}>
      <Type x={item.x} y={473} size={150} family={LATIN_SERIF} style={{ letterSpacing: -4, width: 304, textAlign: "center" }}>{item.year}</Type>
      <div style={{ position: "absolute", left: item.x + 143, top: 671, width: 17, height: 17, border: `1px solid ${index === 2 ? MINT : "#9ca298"}`, background: index === 2 ? MINT : INK, borderRadius: "50%" }} />
      <Type x={item.x} y={723} size={38} weight={400} color={index === 2 ? MINT : PAPER} style={{ letterSpacing: 9, width: 304, textAlign: "center", paddingLeft: 9 }}>{item.label}</Type>
      <Type x={item.x} y={407} size={20} family={MONO} color={MUTED} style={{ width: 304, textAlign: "center" }}>{String(index + 1).padStart(2, "0")}</Type>
    </div>)}
    <Type x={1517} y={291} size={48} color={MINT}>↗</Type>
  </Ground>;
}

function HandwrittenType() {
  return <Ground>
    <Type x={409} y={207} size={22} family={MONO} color={MUTED} style={{ letterSpacing: 5 }}>THE PERSON BEHIND THE IDEA</Type>
    <Type x={416} y={353} size={288} family={HAND} style={{ transform: "rotate(-5deg)", letterSpacing: 13 }}>张伟</Type>
    <Type x={861} y={699} size={48} family={FREE} color={ORANGE} style={{ transform: "rotate(-9deg)" }}>看见不同</Type>
    <Line x={441} y={802} width={700} color="#505b53" />
    <Line x={1203} y={330} width={417} color="#505b53" rotate={90} />
    <Type x={1253} y={350} size={42} weight={400} style={{ writingMode: "vertical-rl", letterSpacing: 10 }}>首席设计师</Type>
    <Type x={1370} y={353} size={27} color={MUTED} style={{ writingMode: "vertical-rl", letterSpacing: 10 }}>研究观看体验</Type>
    <div style={{ position: "absolute", left: 1298, top: 739, width: 47, height: 47, border: "1px solid #dbaa7c80", transform: "rotate(-9deg)" }} />
    <Type x={1306} y={747} size={24} family={SONG} color={ORANGE}>见</Type>
    <Plus x={378} y={784} />
  </Ground>;
}

function ContrastType() {
  return <Ground variant={2}>
    <Type x={365} y={240} size={22} family={MONO} color={MUTED} style={{ letterSpacing: 5 }}>THE ART OF SUBTRACTION</Type>
    <Type x={345} y={393} size={293} weight={900} color="transparent" style={{ WebkitTextStroke: "1.6px #c1c7bd", letterSpacing: -8 }}>少</Type>
    <Line x={740} y={405} width={263} color="#586458" rotate={90} />
    <Type x={805} y={414} size={62} color={MUTED} style={{ letterSpacing: 4 }}>即是</Type>
    <Type x={800} y={486} size={194} family={YOUTH}>多</Type>
    <div style={{ position: "absolute", left: 1133, top: 515, width: 58, height: 58, borderRadius: "50%", background: ORANGE }} />
    <Type x={1272} y={445} size={30} weight={700}>减少堆叠</Type>
    <Type x={1272} y={498} size={30} color={MUTED}>增加留白</Type>
    <Type x={1272} y={581} size={24} family={MONO} color={MUTED} style={{ letterSpacing: 3 }}>LESS = MORE</Type>
    <Line x={377} y={770} width={1139} />
    <Type x={376} y={810} size={23} color={MUTED} style={{ letterSpacing: 5 }}>让重点更清楚</Type>
    <Type x={1446} y={810} size={29} color={ORANGE}>→</Type>
  </Ground>;
}

const studies = [EmbeddedType, NumberType, MaskType, VerticalType, OffsetType, TimelineType, HandwrittenType, ContrastType];

export function TypographyExploration({ study }: { study: number }) {
  useStudyFonts();
  const Study = studies[study] ?? studies[0];
  return <Study />;
}
