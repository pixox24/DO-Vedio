import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { loadFont } from "@remotion/fonts";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { FONT, ensureFonts } from "../fonts";

// 第二批静态评审，编号承接第一批；不替换生产模板。
const INK = "#101211";
const WHITE = "#f0f0e8";
const GRAY = "#919a93";
const RED = "#d77c70";
const BLUE = "#8bacc3";
const YELLOW = "#dfc47c";
const GREEN = "#a5bfae";
const LILAC = "#aca0bd";
const SANS = '"Helvetica Neue", Arial, sans-serif';
const SONG = '"Songti SC", serif';
const YOUTH = "SwissYouth";

export const SWISS_TYPOGRAPHY_STUDIES = [
  { id: "SwissTypography09", title: "十字与秩序", detail: "非对称网格 / 砖红十字 / 雾蓝空心圆" },
  { id: "SwissTypography10", title: "菱形与错位", detail: "错位字组 / 芥末黄菱形 / 雾蓝方块" },
  { id: "SwissTypography11", title: "药丸与减法", detail: "横向字组 / 鼠尾草绿药丸 / 细线分割" },
  { id: "SwissTypography12", title: "数字与三点", detail: "大数字 / 三点三角形 / 砖红与雾蓝" },
  { id: "SwissTypography13", title: "阶梯与节奏", detail: "阶梯网格 / 运算符号 / 实心与空心" },
  { id: "SwissTypography14", title: "四点与视角", detail: "偏心构图 / 四点四边形 / 淡紫灰与暖黄" },
  { id: "SwissTypography15", title: "交叉与留白", detail: "疏密对比 / 雾蓝交叉 / 珊瑚空心圆" },
  { id: "SwissTypography16", title: "编号与转折", detail: "编号分栏 / 错位方块 / 青绿与暖黄" },
  { id: "SwissTypography17", title: "宋黑与穿插", detail: "宋黑对比 / 砖红交叉 / 空心菱形" },
  { id: "SwissTypography18", title: "圆点与聚焦", detail: "轮廓蒙版 / 圆点主次 / 雾蓝与芥末黄" },
] as const;

function useSwissFonts() {
  const [handle] = useState(() => delayRender("加载瑞士排版评审字体"));
  useEffect(() => {
    ensureFonts();
    loadFont({ family: YOUTH, url: staticFile("fonts/yaoxing-qingnian-hei.ttf"), weight: "400" })
      .then(() => continueRender(handle))
      .catch((error: unknown) => cancelRender(error instanceof Error ? error : new Error(String(error))));
  }, [handle]);
}

function Text({ children, x, y, size, weight = 400, family = FONT, color = WHITE, style }: {
  children: ReactNode; x: number; y: number; size: number; weight?: number; family?: string; color?: string; style?: CSSProperties;
}) {
  return <div style={{ position: "absolute", left: x, top: y, color, fontFamily: family, fontSize: size, fontWeight: weight, lineHeight: 1.13, whiteSpace: "nowrap", ...style }}>{children}</div>;
}

function Rule({ x, y, length, vertical = false, color = "#47504a" }: { x: number; y: number; length: number; vertical?: boolean; color?: string }) {
  return <div style={{ position: "absolute", left: x, top: y, width: vertical ? 1 : length, height: vertical ? length : 1, background: color }} />;
}

type SymbolKind = "plus" | "cross" | "square" | "diamond" | "circle" | "pill" | "triangle-dots" | "four-dots";

function Symbol({ kind, x, y, size, color, hollow = false, rotate = 0 }: {
  kind: SymbolKind; x: number; y: number; size: number; color: string; hollow?: boolean; rotate?: number;
}) {
  const stroke = hollow ? Math.max(2, size * .018) : 0;
  const fill = hollow ? "transparent" : color;
  if (kind === "triangle-dots" || kind === "four-dots") {
    const dotSize = size * .22;
    const points = kind === "triangle-dots" ? [[.39, 0], [0, .68], [.78, .68]] : [[0, 0], [.76, .1], [.66, .76], [.06, .68]];
    return <div style={{ position: "absolute", left: x, top: y, width: size, height: size, transform: `rotate(${rotate}deg)` }}>
      {points.map(([left, top], i) => <span key={i} style={{ position: "absolute", left: left * size, top: top * size, width: dotSize, height: dotSize, boxSizing: "border-box", background: fill, border: hollow ? `${stroke}px solid ${color}` : undefined, borderRadius: "50%" }} />)}
    </div>;
  }
  if (kind === "plus" || kind === "cross") {
    const thickness = size * .14;
    return <div style={{ position: "absolute", left: x, top: y, width: size, height: size, transform: `rotate(${rotate + (kind === "cross" ? 45 : 0)}deg)` }}>
      <span style={{ position: "absolute", left: 0, top: (size - thickness) / 2, width: size, height: thickness, background: color }} />
      <span style={{ position: "absolute", left: (size - thickness) / 2, top: 0, width: thickness, height: size, background: color }} />
    </div>;
  }
  return <div style={{ position: "absolute", left: x, top: y, width: kind === "pill" ? size * 2.3 : size, height: kind === "pill" ? size * .69 : size, boxSizing: "border-box", background: fill, border: hollow ? `${stroke}px solid ${color}` : undefined, borderRadius: kind === "pill" || kind === "circle" ? 999 : 0, transform: `rotate(${rotate + (kind === "diamond" ? 45 : 0)}deg)` }} />;
}

function Canvas({ children, panel = false, dotField = false }: { children: ReactNode; panel?: boolean; dotField?: boolean }) {
  return <AbsoluteFill style={{ background: INK, color: WHITE, fontFamily: FONT, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: "linear-gradient(128deg, #f0f0e804, transparent 45%, #f0f0e802)" }} />
    {panel && <div style={{ position: "absolute", left: 1094, top: 0, width: 826, height: 1080, background: "#ffffff03" }} />}
    {dotField && <div style={{ position: "absolute", right: 196, top: 178, width: 180, height: 96, backgroundImage: "radial-gradient(#78877b50 1px, transparent 1px)", backgroundSize: "18px 18px", maskImage: "linear-gradient(90deg, transparent, black)" }} />}
    {children}
  </AbsoluteFill>;
}

function Order() {
  return <Canvas panel>
    <Rule x={275} y={216} length={1370} />
    <Text x={278} y={252} size={24} family={SANS} color={GRAY} style={{ letterSpacing: 5 }}>ORDER / FREEDOM</Text>
    <Text x={265} y={342} size={226} weight={900} style={{ letterSpacing: -8 }}>秩序</Text>
    <Text x={279} y={640} size={83} weight={400} style={{ letterSpacing: 4 }}>让灵感自由</Text>
    <Symbol kind="plus" x={1288} y={364} size={157} color={RED} />
    <Symbol kind="circle" x={1497} y={614} size={90} color={BLUE} hollow />
    <Rule x={1104} y={342} length={419} vertical />
    <Text x={1148} y={641} size={29}>边界清楚</Text>
    <Text x={1148} y={691} size={29} color={GRAY}>表达自由</Text>
    <Text x={279} y={802} size={23} color={GRAY} style={{ letterSpacing: 4 }}>先有秩序再有自由</Text>
  </Canvas>;
}

function Diamond() {
  return <Canvas>
    <Text x={301} y={228} size={26} family={SANS} color={GRAY} style={{ letterSpacing: 4 }}>LOOK AGAIN</Text>
    <Text x={289} y={295} size={180} weight={700} style={{ letterSpacing: -4 }}>看见</Text>
    <Text x={725} y={471} size={225} weight={900} style={{ letterSpacing: -7 }}>不同</Text>
    <Symbol kind="diamond" x={1172} y={350} size={96} color={YELLOW} />
    <Symbol kind="square" x={1347} y={470} size={48} color={BLUE} />
    <Rule x={304} y={653} length={282} />
    <Text x={307} y={694} size={29}>换个角度</Text>
    <Text x={307} y={746} size={29} color={GRAY}>重看日常</Text>
    <Text x={745} y={794} size={24} family={SANS} color={GRAY} style={{ letterSpacing: 7 }}>A DIFFERENT POINT OF VIEW</Text>
    <Symbol kind="diamond" x={1558} y={752} size={30} color={YELLOW} hollow />
  </Canvas>;
}

function Pill() {
  return <Canvas panel>
    <Text x={302} y={263} size={24} family={SANS} color={GRAY} style={{ letterSpacing: 4 }}>TURN DOWN THE NOISE</Text>
    <Text x={296} y={333} size={83} weight={400}>把噪声</Text>
    <Text x={285} y={435} size={215} weight={900} style={{ letterSpacing: -9 }}>调低</Text>
    <Symbol kind="pill" x={1048} y={439} size={124} color={GREEN} rotate={-18} />
    <div style={{ position: "absolute", left: 1145, top: 478, width: 94, height: 7, background: INK, transform: "rotate(-18deg)" }} />
    <Symbol kind="pill" x={1385} y={644} size={65} color={YELLOW} hollow rotate={-18} />
    <Rule x={306} y={748} length={918} />
    <Text x={306} y={790} size={29} color={GRAY} style={{ letterSpacing: 4 }}>重要之声浮现</Text>
    <Text x={1518} y={283} size={26} color={GRAY} style={{ writingMode: "vertical-rl", letterSpacing: 6 }}>少一点干扰</Text>
  </Canvas>;
}

function ThreeDots() {
  return <Canvas>
    <Text x={289} y={259} size={30} style={{ letterSpacing: 5 }}>用户留存</Text>
    <Text x={269} y={358} size={390} family={SANS} weight={700} style={{ letterSpacing: -24 }}>85</Text>
    <Text x={737} y={556} size={139} family={SANS} weight={300} color={BLUE}>%</Text>
    <Rule x={1004} y={301} length={502} vertical />
    <Symbol kind="triangle-dots" x={1155} y={345} size={147} color={RED} rotate={-6} />
    <Symbol kind="circle" x={1439} y={513} size={64} color={BLUE} hollow />
    <Text x={1128} y={621} size={34} weight={700}>留下来的理由</Text>
    <Text x={1131} y={689} size={26} color={GRAY}>更清楚，更直接</Text>
    <Text x={288} y={803} size={25} family={SANS} color={GRAY} style={{ letterSpacing: 4 }}>RETENTION / 85%</Text>
  </Canvas>;
}

function Steps() {
  const rows = [{ x: 401, y: 238, label: "观察", sub: "发现问题", kind: "plus" as const, color: GREEN }, { x: 666, y: 429, label: "删减", sub: "移除冗余", kind: "cross" as const, color: RED }, { x: 931, y: 620, label: "重组", sub: "建立秩序", kind: "square" as const, color: GREEN }];
  return <Canvas dotField>
    <Text x={295} y={270} size={23} color={GRAY} style={{ writingMode: "vertical-rl", letterSpacing: 7 }}>三个转折</Text>
    {rows.map((row, i) => <div key={row.label}>
      <Text x={row.x - 68} y={row.y + 18} size={23} family={SANS} color={GRAY}>0{i + 1}</Text>
      <Text x={row.x} y={row.y} size={117} weight={700} style={{ letterSpacing: -3 }}>{row.label}</Text>
      <Symbol kind={row.kind} x={row.x + 295} y={row.y + 37} size={56} color={row.color} hollow={i === 2} />
      <Text x={row.x + 387} y={row.y + 47} size={28} color={GRAY}>{row.sub}</Text>
      <Rule x={row.x} y={row.y + 165} length={566} color="#37413a" />
    </div>)}
    <Text x={340} y={863} size={23} family={SANS} color={GRAY} style={{ letterSpacing: 4 }}>OBSERVE. EDIT. REBUILD.</Text>
  </Canvas>;
}

function FourDots() {
  return <Canvas>
    <Symbol kind="four-dots" x={350} y={351} size={148} color={LILAC} rotate={-8} />
    <Text x={646} y={289} size={226} weight={700} style={{ letterSpacing: 6 }}>视角</Text>
    <Text x={646} y={578} size={81} weight={400} style={{ letterSpacing: 5 }}>由此改变</Text>
    <Symbol kind="square" x={1281} y={606} size={104} color={YELLOW} hollow rotate={8} />
    <Rule x={654} y={752} length={763} />
    <Text x={654} y={792} size={27} color={GRAY}>位置改变理解改变</Text>
    <Text x={277} y={696} size={21} family={SANS} color={GRAY} style={{ writingMode: "vertical-rl", letterSpacing: 5 }}>SHIFT THE VIEW</Text>
    <Rule x={327} y={289} length={532} vertical color="#333e36" />
  </Canvas>;
}

function CrossSpace() {
  return <Canvas>
    <Text x={301} y={225} size={24} family={SANS} color={GRAY} style={{ letterSpacing: 4 }}>SILENCE HAS A VOICE</Text>
    <Text x={286} y={294} size={207} weight={400} style={{ letterSpacing: 6 }}>留白</Text>
    <Text x={824} y={519} size={201} weight={900} style={{ letterSpacing: -8 }}>有声</Text>
    <Symbol kind="cross" x={1177} y={299} size={124} color={BLUE} />
    <Symbol kind="circle" x={354} y={666} size={92} color={RED} hollow />
    <Text x={494} y={641} size={28}>不必填满</Text>
    <Text x={494} y={692} size={28} color={GRAY}>重点自然浮现</Text>
    <Rule x={835} y={781} length={586} />
    <Text x={835} y={821} size={24} family={SANS} color={GRAY} style={{ letterSpacing: 4 }}>LET THE IMPORTANT THINGS SPEAK</Text>
  </Canvas>;
}

function Chapter() {
  return <Canvas panel>
    <Text x={277} y={279} size={231} family={SANS} weight={300} color={GRAY} style={{ letterSpacing: -10 }}>01</Text>
    <Text x={685} y={277} size={168} weight={700}>关键</Text>
    <Text x={864} y={492} size={168} weight={900}>转折</Text>
    <Rule x={588} y={278} length={519} vertical />
    <Symbol kind="square" x={1350} y={343} size={84} color={GREEN} />
    <Symbol kind="square" x={1421} y={414} size={84} color={YELLOW} hollow />
    <Text x={291} y={686} size={25}>一次选择</Text>
    <Text x={291} y={735} size={25} color={GRAY}>一个转向</Text>
    <Rule x={689} y={787} length={753} />
    <Text x={690} y={823} size={23} family={SANS} color={GRAY} style={{ letterSpacing: 5 }}>THE TURNING POINT</Text>
  </Canvas>;
}

function SerifContrast() {
  return <Canvas>
    <Text x={321} y={255} size={23} family={SANS} color={GRAY} style={{ letterSpacing: 5 }}>TAKE A CLOSER LOOK</Text>
    <Text x={308} y={324} size={181} family={SONG} style={{ letterSpacing: 22 }}>认真</Text>
    <Text x={738} y={509} size={199} weight={900} style={{ letterSpacing: -7 }}>看见</Text>
    <Symbol kind="cross" x={1263} y={369} size={94} color={RED} />
    <Symbol kind="diamond" x={1453} y={569} size={55} color={GREEN} hollow />
    <Rule x={327} y={624} length={247} />
    <Text x={328} y={664} size={29}>慢一点</Text>
    <Text x={328} y={715} size={29} color={GRAY}>细节更清楚</Text>
    <Text x={660} y={790} size={23} family={SANS} color={GRAY} style={{ letterSpacing: 5 }}>ATTENTION IS A FORM OF CARE</Text>
  </Canvas>;
}

function Focus() {
  return <Canvas dotField>
    <div style={{ position: "absolute", left: 319, top: 239, width: 765, height: 129, overflow: "hidden", maskImage: "linear-gradient(90deg, black, #0006)" }}>
      <Text x={0} y={-36} size={207} family={SANS} weight={700} color="transparent" style={{ WebkitTextStroke: "1px #647268", letterSpacing: 9 }}>FOCUS</Text>
    </div>
    <Text x={313} y={408} size={210} family={YOUTH} style={{ letterSpacing: -8 }}>聚焦</Text>
    <Symbol kind="circle" x={949} y={453} size={72} color={YELLOW} />
    <Symbol kind="circle" x={1040} y={474} size={34} color={BLUE} />
    <Symbol kind="circle" x={1009} y={569} size={57} color={BLUE} hollow />
    <Rule x={1144} y={410} length={292} vertical />
    <Text x={1190} y={463} size={46} weight={700}>重要之事</Text>
    <Text x={1193} y={550} size={28} color={GRAY}>减少干扰</Text>
    <Text x={1193} y={599} size={28} color={GRAY}>集中注意</Text>
    <Rule x={329} y={786} length={1034} />
    <Text x={330} y={826} size={23} family={SANS} color={GRAY} style={{ letterSpacing: 5 }}>ONE THING AT A TIME</Text>
  </Canvas>;
}

const studies = [Order, Diamond, Pill, ThreeDots, Steps, FourDots, CrossSpace, Chapter, SerifContrast, Focus];

export function SwissTypographyStill({ study }: { study: number }) {
  useSwissFonts();
  const Study = studies[study] ?? studies[0];
  return <Study />;
}
