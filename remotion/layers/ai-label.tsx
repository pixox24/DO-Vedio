import { AbsoluteFill } from "remotion";
import { FONT } from "../fonts";
import { useLayout } from "../layout";

/** 《人工智能生成合成内容标识办法》要求的显式标识 */
export function AiLabel({ position }: { position: "top-left" | "top-right" }) {
  const { u, portrait } = useLayout();
  const inset = portrait ? u * 6 : u * 3.2;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: portrait ? u * 14 : inset,
          [position === "top-left" ? "left" : "right"]: inset,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: u * 2.3,
          color: "rgba(255,255,255,0.78)",
          background: "rgba(0,0,0,0.32)",
          border: "1px solid rgba(255,255,255,0.22)",
          borderRadius: u * 0.8,
          padding: `${u * 0.5}px ${u * 1.2}px`,
          letterSpacing: "0.08em",
        }}
      >
        AI生成
      </div>
    </AbsoluteFill>
  );
}
