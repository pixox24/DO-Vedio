import type { Stage } from "../stage";
import { annotateStage } from "./annotate";
import { voiceDirectionStage } from "./voice-direction";
import { echoStage } from "./echo";
import { musicStage } from "./music";
import { renderStage } from "./render";
import { storyboardStage } from "./storyboard";
import { ttsStage } from "./tts";
import { ttsBlockStage } from "./tts-block";
import { shotGenerateStage } from "./shot-generate";
import { stylePreviewStage } from "./style-preview";
import { castStage } from "./cast";
import { characterSheetStage } from "./character-sheet";
import { subtitleTranslateStage } from "./subtitle-translate";
import { viralStage } from "../viral/dispatcher";

export const allStages = [echoStage, annotateStage, voiceDirectionStage, ttsStage, ttsBlockStage, storyboardStage, subtitleTranslateStage, musicStage, renderStage, shotGenerateStage, stylePreviewStage, castStage, characterSheetStage, viralStage] as Stage<never, unknown>[];
