import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { ttsKey, type TtsResult } from "@/lib/core/keys";
import { mediaUrl, voiceSettingsSchema } from "@/lib/core/types";
import { dashscopeTts } from "@/lib/providers/tts/dashscope";
import { cacheGet, cachePut } from "@/lib/server/cache";
import { putBuffer } from "@/lib/server/media";

const body = z.object({ voice: voiceSettingsSchema, text: z.string().trim().min(1).max(1000).default("大家好，欢迎来到今天的节目。这是我的声音，你觉得怎么样？"), textType: z.enum(["PlainText", "SSML"]).optional() });

/** 音色试听：同步合成一小段，结果缓存 */
export async function POST(req: Request) {
  return handle(async () => {
    const { voice, text, textType } = await parseBody(req, body);
    const key = `preview:${ttsKey(text, voice, textType)}`;
    const hit = cacheGet<Pick<TtsResult, "assetId">>(key);
    if (hit) return Response.json({ src: mediaUrl(hit.assetId) });
    const r = await dashscopeTts().synthesize({ text, model: voice.model, voice: voice.voiceId, rate: voice.rate, pitch: voice.pitch, volume: voice.volume, instruction: textType === "SSML" ? undefined : voice.instruction || undefined, textType }, req.signal);
    const a = await putBuffer(r.audio, { ext: "wav", mime: "audio/wav", meta: { source: "voice-preview", voice: voice.voiceId } });
    cachePut(key, "preview", { assetId: a.hash });
    return Response.json({ src: mediaUrl(a.hash) });
  });
}
