import { createHash, randomBytes } from "node:crypto";

/**
 * Edge 朗读接口的 `Sec-MS-GEC` 访问令牌（微软 DRM，v2）。
 *
 * 这不是标准 SHA-256，也不是公开文档里的算法：微软在 2025 年把令牌从「纯 SHA-256」
 * 换成了 CS64 + 定制 SHA-256 的变体（下称 v2）。旧的纯 SHA-256 令牌现在会被握手直接
 * 拒绝（HTTP 403）。本文件是 rany2/edge-tts 的 drm.py 的忠实移植，
 * `edge.test.ts` 里用参考实现产出的向量做对拍。
 *
 * ⚠️ 微软改协议时，全站配音会挂——恢复点只有这一个文件。改动时请保持算法逐行对应上游，
 * 不要「顺手优化」，上游的算式是有意混淆过的，任何重写都可能悄悄算错。
 */

const WIN_EPOCH = 11644473600;
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/** 令牌按 5 分钟取整，同一窗口内所有请求共用 */
const TOKEN_WINDOW_SECONDS = 300;

const u32 = (value: number) => value >>> 0;
/** 无符号 32 位加法：JS 的 `+` 会变成浮点，大数必须显式回绕 */
const add32 = (...values: number[]) => {
  let sum = 0;
  for (const value of values) sum += u32(value);
  return u32(sum % 4294967296);
};
/** 32 位乘法：用 Math.imul，普通 `*` 会丢精度（这是移植时踩过的坑） */
const mul32 = (a: number, b: number) => Math.imul(a, b) >>> 0;
const rol16 = (value: number) => u32((u32(value) << 16) | (u32(value) >>> 16));
/** 32 位循环右移；等价于上游 `(x * 0x100000001) >> k` 的高 32 位 */
const rotr = (value: number, bits: number) => u32((u32(value) >>> bits) | (u32(value) << (32 - bits)));

const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
/** 定制初值：标准 SHA-256 的初值在最终加法里用到，中间状态被替换过 */
const SHA256_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA256_SCHEDULE = [0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
/** 第 14 轮的常量被换成了 SHA256_ADJUSTMENT */
const SHA256_BLOCK_CONSTANTS = [...SHA256_ROUND_CONSTANTS.slice(0, 14), SHA256_ADJUSTMENT, ...SHA256_ROUND_CONSTANTS.slice(15)];
const SIGMA0_ADJUSTMENT = 0x059c0b80;
const SIGMA1_ADJUSTMENT = 0x000b92c0;
const CS64_COEFFICIENTS: readonly (readonly [number, number])[] = [
  [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c], [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464], [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const sigma0 = (value: number) => u32((value >>> 7) ^ (value << 25) ^ (value >>> 18) ^ (value << 14) ^ (value >>> 3));
const sigma1 = (value: number) => u32((value >>> 17) ^ (value << 15) ^ (value >>> 19) ^ (value << 13) ^ (value >>> 10));

function sha256Rounds(state: readonly number[], words: readonly number[], firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let index = firstRound; index < 64; index += 1) {
    const t1 = add32(h, rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), g ^ (e & (f ^ g)), constants[index], words[index]);
    const t2 = add32(rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), (a & b) | (c & (a | b)));
    // 上游这一行把 8 个工作寄存器整体左移一格，只有 a 和 e 是新值
    [a, b, c, d, e, f, g, h] = [add32(t1, t2), a, b, c, add32(d, t1), e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words: number[], firstWord = 16) {
  for (let index = firstWord; index < 64; index += 1) {
    words.push(add32(sigma1(words[index - 2]), words[index - 7], sigma0(words[index - 15]), words[index - 16]));
  }
}

/** 定制 SHA-256 的初值状态：前 7 字节 + 第 14/15 字直接取自输入 */
function sha256Init(data: Buffer) {
  const words = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, data.readUIntBE(0, 3), data.readUInt32BE(3)];
  for (let index = 16; index < 30; index += 1) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) value = add32(value, index === 16 ? u32(sigma1(words[index - 2]) ^ SIGMA1_ADJUSTMENT) : sigma1(words[index - 2]));
    if (index - 7 >= 14) value = add32(value, words[index - 7]);
    if (index - 15 >= 14) value = add32(value, index === 29 ? u32(sigma0(words[index - 15]) ^ SIGMA0_ADJUSTMENT) : sigma0(words[index - 15]));
    words.push(u32(value));
  }
  words.push(u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]));
  expandSchedule(words, 31);
  return sha256Rounds(SHA256_STATE, words, 14).map((value, index) => add32(value, SHA256_INITIAL[index]));
}

/** 前 7 字节只当作初值，实际摘要从第 8 字节开始按标准 SHA-256 填充规则处理 */
export function edgeTokenDigest(data: Buffer) {
  if (data.length < 7) throw new Error("Edge 令牌数据至少需要 7 字节");
  const length = 57 + data.length;
  const tail = Buffer.alloc(8);
  tail.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc((((55 - length) % 64) + 64) % 64), tail]);
  let state = sha256Init(data);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let index = 0; index < 16; index += 1) words.push(padded.readUInt32BE(offset + index * 4));
    expandSchedule(words);
    state = sha256Rounds(state, words).map((value, index) => add32(value, state[index]));
  }
  const out = Buffer.alloc(32);
  state.forEach((value, index) => out.writeUInt32BE(value, index * 4));
  return out;
}

/** CS64：令牌的第二半，流程与上游逐行对应 */
export function edgeTokenCs64(data: Buffer, digest: Buffer) {
  const keyA = digest.readUInt32LE(0) | 1;
  const keyB = digest.readUInt32LE(4) | 1;
  const factors = [mul32(keyA, CS64_FACTOR), mul32(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], index) => mul32(coefficient, factors[index % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => u32(offset));
  const padded = Buffer.concat([Buffer.from([0]), data, Buffer.alloc((4 - ((data.length + 1) % 4)) % 4)]);
  const words: number[] = [];
  for (let index = 0; index < padded.length; index += 4) words.push(padded.readUInt32LE(index));
  if (words.length % 2) words.push(0);
  for (const [index, word] of words.entries()) {
    let term = mul32(word, index % 2 === 0 ? keyA : keyB);
    let offset = mul32(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term = add32(term, mul32(CS64_ADJUSTMENT0, factors[0]));
      offset = add32(offset, CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  }
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];
    let t = rol16(add32(offsets[index], x));
    let q = mul32(t, 0x76f50f34);
    swapAcc += add32(mul32(rol16(q), 0xc3efea97), q);
    t = rol16(add32(offsets[index + 1], y));
    q = mul32(t, 0x1881ce3c);
    swapLast = add32(mul32(rol16(q), 0x35bd1ec9), q);
    swapAcc = add32(swapAcc, swapLast);

    state = add32(mul32(state, keyA), x);
    state = mul32(rol16(state), 0xcf98b111);
    state = mul32(rol16(state), 0x87085b9f);
    state = mul32(rol16(state), 0x12ceb96d);
    state = mul32(rol16(state), 0x257e1d83);
    acc = add32(acc, state);
    t = add32(mul32(state, keyB), y);
    t = mul32(rol16(t), 0xa27416f5);
    t = mul32(rol16(t), 0xd38396ff);
    state = mul32(rol16(mul32(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = add32(acc, state);
  }
  const out = Buffer.alloc(8);
  out.writeUInt32LE(u32(swapLast ^ state), 0);
  out.writeUInt32LE(u32(swapAcc ^ acc), 4);
  return out;
}

/** `<16 位 CS64>-<64 位定制 SHA-256>`，直接放进查询串 */
export function generateSecMsGec(unixSeconds = Date.now() / 1000, trustedToken = TRUSTED_CLIENT_TOKEN) {
  let ticks = unixSeconds + WIN_EPOCH;
  ticks -= ticks % TOKEN_WINDOW_SECONDS;
  ticks *= 1e9 / 100;
  // 上游是 f"{ticks:.0f}"，等价于 toFixed(0)；两者都在 2^53 内精确
  const data = Buffer.from(`${ticks.toFixed(0)}${trustedToken}`, "ascii");
  const digest = edgeTokenDigest(data);
  return `${edgeTokenCs64(data, digest).toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}

/** 连接使用的随机 MUID；官方 Edge 客户端每个连接都带 */
export const edgeMuid = () => randomBytes(16).toString("hex").toUpperCase();

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * 带缓存的令牌：5 分钟窗口内复用同一个值，避免每个分句都重算一次定制哈希。
 * 403 时调用方应先用 `invalidateSecMsGec()` 丢掉缓存，再用服务端时间重试。
 */
export function secMsGec(now = Date.now()) {
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;
  const value = generateSecMsGec(now / 1000);
  const windowStart = Math.floor(now / 1000 / TOKEN_WINDOW_SECONDS) * TOKEN_WINDOW_SECONDS;
  cachedToken = { value, expiresAt: (windowStart + TOKEN_WINDOW_SECONDS) * 1000 };
  return value;
}

export function invalidateSecMsGec() {
  cachedToken = null;
}

/** 仅供诊断：确认移植没被改坏（标准 SHA-256 会算出别的值） */
export const edgeTokenSelfCheck = () => createHash("sha256").update("edge").digest("hex").slice(0, 8);
