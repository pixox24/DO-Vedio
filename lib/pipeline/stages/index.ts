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
import { sceneReferenceStage } from "./scene-reference";
import { characterSheetStage } from "./character-sheet";
import { subtitleTranslateStage } from "./subtitle-translate";
import { viralStage } from "../viral/dispatcher";

import { shotReferenceStage } from "./shot-reference";

export const allStages = [echoStage, annotateStage, voiceDirectionStage, ttsStage, ttsBlockStage, storyboardStage, subtitleTranslateStage, musicStage, renderStage, shotGenerateStage, shotReferenceStage, stylePreviewStage, castStage, characterSheetStage, sceneReferenceStage, viralStage] as Stage<never, unknown>[];
