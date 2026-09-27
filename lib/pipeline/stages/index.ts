import type { Stage } from "../stage";
import { annotateStage } from "./annotate";
import { echoStage } from "./echo";
import { musicStage } from "./music";
import { renderStage } from "./render";
import { storyboardStage } from "./storyboard";
import { ttsStage } from "./tts";
import { shotGenerateStage } from "./shot-generate";
import { stylePreviewStage } from "./style-preview";
import { castStage } from "./cast";
import { characterSheetStage } from "./character-sheet";

export const allStages = [echoStage, annotateStage, ttsStage, storyboardStage, musicStage, renderStage, shotGenerateStage, stylePreviewStage, castStage, characterSheetStage] as Stage<never, unknown>[];
