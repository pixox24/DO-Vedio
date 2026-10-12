import { describe, expect, it } from "vitest";
import { guardScreenContent } from "./screen-guard";

describe("屏幕朝向", () => {
  it("有人看手机时只见侧缘，并拿掉屏幕上的文字", () => {
    const text = guardScreenContent("她低头看手机，屏幕显示余额一万二");
    expect(text.startsWith("手机侧对镜头")).toBe(true);
    expect(text).toContain("只见屏幕侧缘");
    expect(text).toContain("屏幕是暗的");
    expect(text).toContain("半透明磨砂");
    expect(text).not.toContain("一万二");
    expect(text).not.toContain("屏幕显示");
    expect(text).not.toContain("摄像头");
    expect(text).not.toContain("背面朝向");
  });

  it("只是拿着手机时屏幕不亮，不凭空加浮层", () => {
    const text = guardScreenContent("她拿着手机走路");
    expect(text).toContain("屏幕背对镜头或朝下");
    expect(text).toContain("没有界面");
    expect(text).not.toContain("半透明磨砂");
    expect(text).not.toContain("摄像头");
  });

  it("已经写对朝向和浮层时不再重复", () => {
    const raw = "年轻女性坐在窗边低头看手机，手机侧对镜头，屏幕朝向眼睛，只见屏幕侧缘，屏幕是暗的。画面右侧一块半透明磨砂卡片，存钱罐图标和一条色条，没有文字";
    expect(guardScreenContent(raw)).toBe(raw);
    const guarded = guardScreenContent("她看着手机里的银行通知");
    expect(guarded).toContain("只见屏幕侧缘");
    expect(guarded).not.toContain("银行通知");
    expect(guardScreenContent(guarded)).toBe(guarded);
  });

  it("手指操作设置时屏幕朝向镜头，并删掉已经写上的背面", () => {
    const raw = "手指在手机设置界面操作，观众从侧后方看到手机背面，摄像头模组清晰，屏幕转向持机者，屏幕内容不可见。手指几下点按后停顿";
    const text = guardScreenContent(raw);
    expect(text.startsWith("屏幕在手指下方")).toBe(true);
    expect(text).toContain("略微朝向镜头");
    expect(text).toContain("抽象色块");
    expect(text).toContain("脸不入画");
    expect(text).toContain("点按后停顿");
    expect(text).not.toContain("摄像头");
    expect(text).not.toContain("背面");
    expect(text).not.toContain("屏幕内容不可见");
    expect(text).not.toContain("设置界面");
    expect(guardScreenContent(text)).toBe(text);
  });

  it("主观镜头看手机时屏幕朝向镜头，脸不入画", () => {
    const text = guardScreenContent("主观镜头，她看着手中的手机");
    expect(text).toContain("略微朝向镜头");
    expect(text).toContain("抽象色块");
    expect(text).toContain("脸不入画");
    expect(text).not.toContain("背面");
  });

  it("特写点按不让脸入画，中景点按仍可看见人", () => {
    expect(guardScreenContent("她点按手机", "extreme-close")).toContain("脸不入画");
    const medium = guardScreenContent("她点按手机", "medium");
    expect(medium).toContain("抽象色块");
    expect(medium).not.toContain("脸不入画");
  });

  it("把屏幕对着镜头给别人看，不再拧到背面", () => {
    const text = guardScreenContent("她把手机屏幕对着镜头，屏幕显示付款码");
    expect(text).toContain("屏幕朝向对方");
    expect(text).toContain("抽象色块");
    expect(text).toContain("半透明磨砂");
    expect(text).not.toContain("对着镜头");
    expect(text).not.toContain("付款码");
    expect(text).not.toContain("背面朝向");
  });

  it("手机平放被点时屏幕朝上", () => {
    const text = guardScreenContent("手指点按平放在桌上的手机");
    expect(text).toContain("屏幕朝上");
    expect(text).toContain("抽象色块");
    expect(text).toContain("脸不入画");
    expect(text).not.toContain("背面");
  });

  it("两人看同一台手机时屏幕在两人之间", () => {
    const text = guardScreenContent("两人一起看着手机");
    expect(text).toContain("屏幕在两人之间");
    expect(text).not.toContain("摄像头");
  });

  it("拍照和视频通话才写摄像头，并写清朝向", () => {
    const photo = guardScreenContent("她举起手机拍照");
    expect(photo).toContain("后置摄像头朝向被摄物");
    expect(photo).toContain("屏幕朝向拍摄者");
    expect(photo).not.toContain("摄像头模组");
    const call = guardScreenContent("他举着手机视频通话");
    expect(call).toContain("前置摄像头朝向人脸");
    expect(call).not.toContain("后置摄像头");
    expect(call).not.toContain("摄像头模组");
  });

  it("比喻、纸质笔记本、旁边放着的手机不动", () => {
    for (const raw of ["手机像一座牢笼", "木桌上的一杯咖啡和一本摊开的笔记本", "她看着窗外，桌上放着手机", "一台好看的手机", "一只手攥紧沙子"]) {
      expect(guardScreenContent(raw)).toBe(raw);
    }
  });

  it("电视不强制朝向，但屏幕上的字要拿掉", () => {
    const text = guardScreenContent("一家人看着电视，屏幕播放着新闻");
    expect(text).not.toContain("背面朝向");
    expect(text).not.toContain("侧对镜头");
    expect(text).not.toContain("新闻");
    expect(text).toContain("半透明磨砂");
  });

  it("笔记本、手表、车机不用手机的背面说法", () => {
    const typing = guardScreenContent("她在笔记本电脑上打字");
    expect(typing).toContain("屏幕朝向使用者");
    expect(typing).toContain("键盘在手前");
    expect(typing).toContain("不画外壳背面");
    expect(typing).not.toContain("摄像头");

    const watch = guardScreenContent("他低头看手表");
    expect(watch).toContain("表盘朝向眼睛");
    expect(watch).toContain("不画表壳背面");
    expect(watch).not.toContain("摄像头");
    expect(watch).not.toContain("侧对镜头");

    const car = guardScreenContent("司机看着车机，屏幕显示导航路线");
    expect(car).toContain("车机屏幕朝向驾驶者");
    expect(car).toContain("不画屏幕背面");
    expect(car).not.toContain("摄像头");
    expect(car).not.toContain("导航路线");
  });
});
