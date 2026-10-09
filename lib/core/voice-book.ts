/** 百炼 voice 参数。系统音色一般较短；128 覆盖复刻接口返回的 voice_id。 */
export const VOICE_PARAM_MAX = 128;
export const VOICE_NAME_MAX = 40;

const voiceParamPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function voiceParamError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "请填写音色参数";
  if (value.length > VOICE_PARAM_MAX) return `音色参数最长 ${VOICE_PARAM_MAX} 个字符`;
  if (!voiceParamPattern.test(value)) return "音色参数只能包含字母、数字、下划线、连字符和点";
  return null;
}

export function voiceNameError(raw: string): string | null {
  const value = raw.trim();
  if (value.length > VOICE_NAME_MAX) return `显示名最长 ${VOICE_NAME_MAX} 个字符`;
  if (/[<>\u0000-\u001f\u007f]/.test(value)) return "显示名不能包含控制字符";
  return null;
}

/**
 * 切换模型时保留音色参数，仅当新模型的音色册里已经有它。
 * 否则清空，让用户自己重选，避免把另一个模型的音色悄悄换成名单第一项。
 */
export function voiceIdAfterModelChange(currentVoiceId: string, nextVoiceIds: readonly string[]): string {
  return nextVoiceIds.includes(currentVoiceId) ? currentVoiceId : "";
}
