/**
 * 生图模型会把界面画在朝向镜头的那一面，也会把摄像头模组当成被注视的物体。
 * 编译提示词前按镜头在干什么改写朝向：操作看屏幕，反应只见侧缘，道具不亮界面。
 * 可读文字不留在玻璃上，改成身侧的磨砂面板。
 */

import type { ShotSize } from "./types";

const PHONE = /手机|平板|iPhone|iPad/i;
const POV = /主观镜头|主观视角|镜头就是眼睛|镜头即眼睛|过肩|肩后|第一人称|\bPOV\b/i;
const ALREADY_AR = /半透明磨砂/;
const LOOKING_INSIDE = /(看着|盯着|刷着)(手机|平板|笔记本电脑|手提电脑|电脑|手表)(?:里|上|中)的[^，,。；;、]*/g;
const UI_ON_SCREEN = /[，,]?(?:手机|平板|电脑|手表|屏幕)(?:(?:上|里|中)(?:显示|出现|亮着|写着|展示着|播放着|是|有)|(?:显示|出现|亮着|写着|展示着|播放着))[^，,。；;、]*/g;

const PHONE_OP = "屏幕在手指下方，略微朝向镜头，屏幕上只有抽象色块和图标，没有文字和数字";
const PHONE_FACE = "以手和屏幕为主，脸不入画";
const PHONE_FLAT = "手机平放，屏幕朝上，屏幕上只有抽象色块和图标，没有文字和数字";
const PHONE_REACTION = "手机侧对镜头，屏幕朝向眼睛，只见屏幕侧缘，屏幕是暗的";
const PHONE_PROP = "屏幕背对镜头或朝下，没有界面";
const PHONE_SHOW = "屏幕朝向对方，略微侧转，屏幕上只有抽象色块和图标，没有可读文字";
const PHONE_TOGETHER = "屏幕在两人之间，侧对镜头，屏幕上没有可读文字";
const PHONE_SELFIE = "前置摄像头朝向人脸，屏幕朝向人脸，屏幕上没有可读文字";
const PHONE_PHOTO = "后置摄像头朝向被摄物，屏幕朝向拍摄者，屏幕上没有可读文字";
const WATCH_CLAUSE = "表盘朝向眼睛，不画表壳背面，表盘上没有可读数字";
const CAR_LOOK = "车机屏幕朝向驾驶者，屏幕是暗的，不画屏幕背面";
const CAR_OP = "车机屏幕朝向驾驶者，屏幕上只有抽象色块和图标，没有文字和数字，不画屏幕背面";
const PC_POV = "从肩后看到一块暗的屏幕，屏幕朝向使用者，不画外壳背面";
const PC_TYPE = "屏幕朝向使用者，键盘在手前，不画外壳背面，屏幕上没有可读文字";
const PC_LOOK = "屏幕朝向使用者，只见屏幕侧缘，屏幕是暗的，不画外壳背面";
const AR = "人物身侧悬浮一块半透明磨砂面板，只有图标和抽象色条，没有可读文字，不挡脸";

/** 旧规则写进描述里的朝向。摄像头只在拍照和视频通话里保留。 */
const BAD_FACING = /[，,。；;、]?(?:观众从侧后方看到(?:手机|设备)背面|从侧后方看到(?:手机|设备)背面|观众看到(?:手机|设备)背面|看到(?:手机|设备)背面|设备背面朝向镜头|手机背面朝向镜头|背面朝向镜头|摄像头模组可见|摄像头模组清晰|摄像头模组|摄像头清晰|屏幕转向持机者|屏幕朝向人物面部|屏幕朝向人物|屏幕朝向她(?!的眼睛)|屏幕朝向他(?!的眼睛)|屏幕内容不可见|(?<!略微)屏幕(?:对着|朝向|面向)(?:镜头|观众|相机))/g;

function collapse(text: string): string {
  return text
    .replace(/[，,]{2,}/g, "，")
    .replace(/，。|。[，,]+/g, "。")
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, "")
    .trim();
}

function withoutTabletComputer(text: string): string {
  return text.replace(/平板电脑/g, "平板");
}

function hasPhone(text: string): boolean {
  return PHONE.test(text);
}

function operatesPhone(text: string): boolean {
  if (!hasPhone(text)) return false;
  return text.split(/[，,。；;]/).some((clause) => {
    if (!PHONE.test(clause)) return false;
    if (/手指|指尖/.test(clause) && /点|滑|按|解锁|捏|输入|打字|操作|设置|屏幕/.test(clause)) return true;
    if (/设置界面|设置页|操作界面|刷手机|滑手机/.test(clause)) return true;
    return /(?:点按|滑动|解锁|捏合|点击|点开|划动|输入|打字|回复).{0,10}(?:手机|平板|屏幕)|(?:手机|平板|iPhone|iPad).{0,12}(?:点按|滑动|解锁|捏合|点击|点开|划动|输入|打字|回复|设置)/i.test(clause);
  });
}

function looksAtPhone(text: string): boolean {
  return text.split(/[，,。；;]/).some((clause) => (
    PHONE.test(clause) && /(?:看着|看向|盯着|注视|望向|望着|低头看|低头看着|阅读|在看|看了|刷着|刷).{0,8}(?:手机|平板|iPhone|iPad)|看(?:着|向|了)?(?:一眼)?(?:手机|平板)/i.test(clause)
  ));
}

function holdsPhone(text: string): boolean {
  return /拿着(?:手机|平板)|握着(?:手机|平板)|举着(?:手机|平板)|捧着(?:手机|平板)|手里(?:的)?(?:手机|平板)|手持(?:手机|平板)|(?:手机|平板)拿在/i.test(text);
}

type PhoneMode = "selfie" | "photo" | "op" | "flat" | "show" | "together" | "reaction" | "prop";

function phoneMode(text: string): PhoneMode | null {
  if (!hasPhone(text)) return null;
  if (/自拍|视频通话|视频电话|前置摄像头/.test(text)) return "selfie";
  if (/(?:用|举[起着]?|拿着?)(?:手机|平板).{0,6}(?:拍照|拍摄|录像)|(?:手机|平板).{0,4}(?:拍照|拍摄|录像)|后置摄像头/i.test(text)) return "photo";
  if (POV.test(text)) return "op";
  if (/把(?:手机|平板)?屏幕(?:对着|朝向|面向)|给(?:别人|对方|人)看(?:手机|屏幕)|出示(?:手机|屏幕)|把(?:手机|平板)递给/.test(text)) return "show";
  if (operatesPhone(text)) {
    const flat = text.split(/[，,。；;]/).some((clause) => PHONE.test(clause) && /平放|躺在桌|放在桌上|屏幕朝上/.test(clause));
    return flat ? "flat" : "op";
  }
  if (/两人(?:一起)?看|两个人看|一起看(?:着|向)?(?:手机|平板)|同时看(?:着)?(?:手机|平板)/.test(text)) return "together";
  if (looksAtPhone(text)) return "reaction";
  if (holdsPhone(text)) return "prop";
  return null;
}

function hideFace(text: string, shotSize: ShotSize | undefined, mode: PhoneMode): boolean {
  if (mode !== "op" && mode !== "flat") return false;
  if (/主观|过肩|肩后|镜头就是眼睛|镜头即眼睛|第一人称|\bPOV\b/i.test(text)) return true;
  if (/手指|指尖/.test(text)) return true;
  return shotSize === "extreme-close";
}

function phoneClause(text: string, shotSize: ShotSize | undefined): string | null {
  const mode = phoneMode(text);
  if (!mode) return null;
  if (mode === "selfie") return PHONE_SELFIE;
  if (mode === "photo") return PHONE_PHOTO;
  if (mode === "show") return PHONE_SHOW;
  if (mode === "together") return PHONE_TOGETHER;
  if (mode === "reaction") return PHONE_REACTION;
  if (mode === "prop") return PHONE_PROP;
  const base = mode === "flat" ? PHONE_FLAT : PHONE_OP;
  return hideFace(text, shotSize, mode) ? `${base}，${PHONE_FACE}` : base;
}

type ComputerMode = "car-op" | "car" | "pov" | "type" | "look";

function operatesCar(text: string): boolean {
  return /(?:点按|点击|滑动|手指|输入).{0,8}车机|车机.{0,12}(?:点按|点击|滑动|输入|设置)/.test(text);
}

function computerMode(text: string): ComputerMode | null {
  const body = withoutTabletComputer(text);
  const car = /车机/.test(body);
  const pc = /笔记本电脑|手提电脑|显示器|显示屏|(?:电脑)(?!包|桌)/.test(body);
  if (!car && !pc) return null;
  if (car) {
    if (operatesCar(text)) return "car-op";
    if (/看|盯|瞥|驾驶|司机|导航/.test(text)) return "car";
    return null;
  }
  if (POV.test(text)) return "pov";
  if (/打字|敲键盘|键入/.test(text)) return "type";
  if (/(?:看着|看向|盯着|注视|望向|望着|低头看|在看)(?:笔记本电脑|手提电脑|显示器|电脑|屏幕)|(?:笔记本|手提)?电脑前|显示器前/.test(text)) return "look";
  return null;
}

function computerClause(mode: ComputerMode): string {
  if (mode === "car-op") return CAR_OP;
  if (mode === "car") return CAR_LOOK;
  if (mode === "pov") return PC_POV;
  if (mode === "type") return PC_TYPE;
  return PC_LOOK;
}

function mentionsWatch(text: string): boolean {
  return /(?:看(?:着|向|了|一眼)?|瞥|抬腕|核对|盯着)(?:智能)?手表/.test(text);
}

function addClause(text: string, clause: string | null): string {
  if (!clause || text.includes(clause)) return text;
  return collapse(`${clause}，${text}`);
}

/** 按朝向改写画面描述。shotSize 为特写时，手机操作镜头不让脸入画。 */
export function guardScreenContent(text: string, shotSize?: ShotSize): string {
  const raw = text.trim();
  if (!raw) return raw;

  LOOKING_INSIDE.lastIndex = 0;
  UI_ON_SCREEN.lastIndex = 0;
  BAD_FACING.lastIndex = 0;
  let stripped = false;
  let next = raw.replace(LOOKING_INSIDE, (_match, verb: string, device: string) => {
    stripped = true;
    return `${verb}${device}`;
  });
  next = next.replace(UI_ON_SCREEN, () => {
    stripped = true;
    return "";
  });
  next = collapse(next.replace(BAD_FACING, ""));
  if (/设置界面|设置页|操作界面/.test(raw) && operatesPhone(raw)) next = next.replace(/设置界面|设置页|操作界面/g, "屏幕");

  const phone = phoneClause(raw, shotSize);
  const computer = computerMode(raw);
  const watch = mentionsWatch(raw);
  if (!phone && !computer && !watch && !stripped) return raw;

  if (stripped && !ALREADY_AR.test(next)) next = addClause(next, AR);
  if (watch) next = addClause(next, WATCH_CLAUSE);
  if (computer) next = addClause(next, computerClause(computer));
  next = addClause(next, phone);
  return collapse(next) || raw;
}
