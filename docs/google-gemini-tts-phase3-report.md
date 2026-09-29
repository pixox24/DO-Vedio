# Gemini TTS Phase 3 灰度报告

日期：2026-09-28  
音色：`Kore`  采样率：24 kHz，单声道，PCM WAV  
模型目录通过 Gemini `v1beta/models` 实际确认：`gemini-3.8-flash-tts`、`gemini-3.8-flash-lite-tts`。

## 自动探针结果

| 模型 | 样本 | 成功 | 失败 | 成功率 | 成功样本 p95 | 429 / quota | 尾句 | 长稿 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Flash | 12 | 5 | 7 | 41.7% | 9.46 s | 7 | 未完成 | 未完成 |
| Flash-Lite | 12 | 11 | 1 | 91.7% | 39.17 s（含长稿） | 1 | 成功 | 成功 |

Flash 单独基线：1/1，5.60 s。Flash-Lite 单独基线：1/1，4.10 s。两者均返回 HTTP 200、24 kHz 单声道音频，适配器输出为有效 RIFF/WAVE PCM；未返回字级时间戳，因此对齐来源为 `estimated`。

Flash-Lite 的短样本（不含长稿）成功样本 p95 约 9.02 s，仍高于 8 秒目标。成功响应的 usage 为 `output-tokens`，本次没有核实价格，成本估算保持 `unknown`，不能据此宣称成本偏差为零。

探针目录：

- `/private/tmp/gemini-tts-phase3-flash/report.json`
- `/private/tmp/gemini-tts-phase3-flash-lite/report.json`
- `/private/tmp/gemini-tts-phase3-flash-extended-v2/report.json`
- `/private/tmp/gemini-tts-phase3-flash-lite-extended/report.json`

## 协议发现

实际 `SpeechConfig` schema 不包含 `stylePrompt` 字段。早期适配器把表达指令编译进用户 prompt；四种风格样本虽然返回有效音频，但 2026-09-29 的真实项目人工试听发现模型把“表达指令”及其内容也读了出来。因此这些样本**不能算正文完整性通过**。当前生产适配器只发送朗读正文，Gemini 的表达指令已暂时停用，旧 Gemini 配音缓存通过专属版本失效。

## 发布结论

本阶段不满足默认生产门槛：真实项目发现表达指令增读，模型配额在扩展探针中触发多次 429，短句 p95 超过 8 秒，尾句和跨段人工评分尚未完成，费用价格也未核实。保持 Google 默认不选；DashScope 路径不受影响。重新灰度前需要用纯正文重录受影响句子，补齐两模型连续段落样本并填写 `ratings.json` 人工评分。

人工评分文件由探针生成，当前仍待试听填写：`ratings.json`。
