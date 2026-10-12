import { z } from "zod";

export const motionShelves = ["text", "camera", "transition", "number", "other"] as const;
export type MotionShelf = (typeof motionShelves)[number];
export const motionShelfLabels: Record<MotionShelf, string> = {
  text: "文字",
  camera: "运镜",
  transition: "转场",
  number: "数字",
  other: "其他",
};

export const motionNoteEnergies = ["low", "mid", "high"] as const;
export type MotionNoteEnergy = (typeof motionNoteEnergies)[number];
export const motionNoteEnergyLabels: Record<MotionNoteEnergy, string> = { low: "低", mid: "中", high: "高" };

export const motionNoteInputSchema = z.object({
  name: z.string().trim().min(1, "请填写名称").max(40, "名称请控制在 40 字以内"),
  summary: z.string().trim().min(1, "请写一句话").max(120, "一句话请控制在 120 字以内"),
  link: z.string().trim().max(500, "链接请控制在 500 字以内").default(""),
  shelf: z.enum(motionShelves),
  energy: z.enum(motionNoteEnergies),
});
export type MotionNoteInput = z.infer<typeof motionNoteInputSchema>;

export const motionNoteSchema = motionNoteInputSchema.extend({
  id: z.string().min(1),
  createdAt: z.number(),
});
export type MotionNote = z.infer<typeof motionNoteSchema>;
