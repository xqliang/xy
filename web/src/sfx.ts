// 音效：用 Web Audio API 实时合成短音效（程序化，无文件）。背景音乐：各地图/首页各一首真实音频循环
// （见 MAP_BGM / MENU_BGM_KEY），资源走 CDN——Web 端原生 fetch+decodeAudioData，微信小游戏端经 polyfill 的
// fetch→wx.request(arraybuffer) 拉取后同样 decodeAudioData 播放（真机需把 CDN 域名加入 request 合法域名）。
// Web 端注意：素材 CDN（TOS）未配 CORS，fetch 会被拦——解码失败自动退回 HTMLAudioElement 循环（见 startAudioElBgm）。
// 设计：引擎(battle)只发语义事件名，本模块把事件映射为合成声音；浏览器/小游戏均要求用户手势后才能出声。
// 静音状态持久化（跨平台存储）。
import { storeGet, storeSet } from './storage';
import { createAudioContext } from './platform';
import { ASSET_URLS } from '@asset-manifest';

const MUTE_KEY = 'dasheng.mute';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false; // 总静音（音效+音乐），默认关（即有声）
let musicEnabled = true;
let sfxEnabled = true;
let musicVolume = 0.7;
let sfxVolume = 0.8;
muted = storeGet(MUTE_KEY) === '1';

// 首个用户手势后调用：创建/恢复 AudioContext（浏览器自动播放策略要求）
export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = createAudioContext(); // 平台适配：Web=AudioContext，微信=wx.createWebAudioContext()
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : sfxEnabled ? 0.5 * sfxVolume : 0;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function isMuted(): boolean {
  return muted;
}
export function toggleMute(): boolean {
  muted = !muted;
  try { storeSet(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : sfxEnabled ? 0.5 * sfxVolume : 0, ctx.currentTime, 0.05);
  return muted;
}

// 背景音乐开关（由设置页持久化）
export function isMusicOn(): boolean {
  return musicEnabled;
}

type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

// 单个音符：振荡器 + 增益包络（可选频率滑动）
function tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; to?: number; delay?: number } = {}): void {
  if (!ctx || !master || sfxVolume <= 0) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
  const peak = Math.max(0.0001, (opts.gain ?? 0.25) * sfxVolume);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// 噪声爆发（命中/爆炸/挖掘）
function noise(dur: number, opts: { gain?: number; hp?: number; lp?: number; delay?: number } = {}): void {
  if (!ctx || !master || sfxVolume <= 0) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = (opts.gain ?? 0.2) * sfxVolume;
  let node: AudioNode = src;
  if (opts.hp != null) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; node.connect(f); node = f; }
  if (opts.lp != null) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; node.connect(f); node = f; }
  node.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

let lastAttack = 0; // 攻击音节流，避免密集刷屏

// 事件 → 声音映射
export function playSfx(name: string): void {
  if (muted || !sfxEnabled || sfxVolume <= 0 || !ctx) return;
  try {
  switch (name) {
    case 'click': tone(660, 0.06, { type: 'square', gain: 0.14 }); break;
    case 'summon': tone(320, 0.18, { type: 'sine', to: 760, gain: 0.22 }); tone(480, 0.14, { type: 'triangle', gain: 0.12, delay: 0.04 }); break;
    case 'place': tone(520, 0.05, { type: 'square', gain: 0.14 }); tone(196, 0.07, { type: 'sine', gain: 0.1, delay: 0.02 }); break;
    case 'merge': tone(660, 0.07, { type: 'triangle', gain: 0.18 }); tone(990, 0.1, { type: 'triangle', gain: 0.16, delay: 0.06 }); break;
    // 一铲落地：金属刮土 → 沙土翻起 → 铲背闷击（与击杀噪声区分开）
    case 'shovel':
      noise(0.04, { gain: 0.11, hp: 1200, lp: 5200 }); // 铲刃刮擦
      noise(0.1, { gain: 0.15, hp: 120, lp: 780, delay: 0.025 }); // 沙土颗粒
      tone(88, 0.09, { type: 'triangle', to: 42, gain: 0.13, delay: 0.035 }); // 入土闷击
      tone(48, 0.11, { type: 'sine', to: 32, gain: 0.09, delay: 0.045 });
      break;
    case 'attack': {
      const now = performance.now();
      if (now - lastAttack < 80) return; // 节流
      lastAttack = now;
      tone(820, 0.03, { type: 'triangle', gain: 0.06 });
      break;
    }
    case 'hit': // 火尖枪/大招命中妖怪：清脆金属穿刺 + 短促爆点（与普攻节流的 attack 区分）
      noise(0.05, { gain: 0.16, hp: 2400, lp: 7000 }); // 穿刺嘶响
      tone(1200, 0.06, { type: 'square', gain: 0.12, to: 620 }); // 命中高频下坠
      tone(240, 0.08, { type: 'triangle', gain: 0.13, delay: 0.02 }); // 爆点低频
      break;
    case 'kill': noise(0.14, { gain: 0.18, hp: 200, lp: 3000 }); break;
    case 'bosskill': noise(0.3, { gain: 0.26, lp: 1400 }); tone(120, 0.32, { type: 'sine', to: 60, gain: 0.24 }); break;
    case 'general': tone(523, 0.1, { type: 'triangle', gain: 0.2 }); tone(784, 0.14, { type: 'triangle', gain: 0.18, delay: 0.07 }); tone(1046, 0.16, { type: 'sine', gain: 0.14, delay: 0.14 }); break;
    case 'ult': tone(900, 0.5, { type: 'sawtooth', to: 120, gain: 0.24 }); noise(0.5, { gain: 0.2, lp: 2000 }); break;
    case 'palm': noise(0.4, { gain: 0.22, hp: 400, lp: 6000 }); break;
    case 'wave': tone(196, 0.22, { type: 'sawtooth', gain: 0.2 }); tone(294, 0.2, { type: 'sawtooth', gain: 0.14, delay: 0.05 }); break;
    case 'hurt': tone(180, 0.16, { type: 'square', to: 90, gain: 0.22 }); break;
    case 'item': tone(700, 0.09, { type: 'triangle', gain: 0.18 }); tone(1050, 0.12, { type: 'sine', gain: 0.14, delay: 0.07 }); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.2, delay: i * 0.12 })); break;
    case 'lose': [392, 311, 233].forEach((f, i) => tone(f, 0.26, { type: 'sawtooth', gain: 0.2, delay: i * 0.14 })); break;
    case 'danger': tone(880, 0.1, { type: 'square', gain: 0.14 }); tone(880, 0.1, { type: 'square', gain: 0.14, delay: 0.16 }); break;
  }
  } catch { /* 音频图异常不应阻断 UI */ }
}

// —— 背景音乐（每张地图各一首真实音频循环）——
// 程序化合成的氛围旋律已移除；各地图 BGM 一律走文件（见 MAP_BGM）。音效仍为实时合成（见上）。

// node 多数是 WebAudio 节点；Web 端 CORS 兜底时是 HTMLAudioElement（无 disconnect，stop 里已单独处理）
let ambientNodes: { stop?: () => void; node: AudioNode | HTMLAudioElement }[] = [];
let ambientTimers: number[] = [];
let ambientMap = '';

// 微信小游戏运行时不暴露 Web Audio 全局构造器（AudioNode / GainNode），用 `instanceof` 会抛
// ReferenceError: X is not defined（真机启用 BGM 后崩溃）。改用鸭子类型判断（类型名只出现在被擦除的
// 类型位置，不产生运行时全局引用）：WebAudio 节点跨端都有 disconnect；GainNode 独有 gain(AudioParam)。
// HTMLAudioElement 兜底节点二者皆无 → 与旧 instanceof 行为一致（Web 端不变）。
function isWebAudioNode(n: AudioNode | HTMLAudioElement): n is AudioNode {
  return typeof (n as { disconnect?: unknown }).disconnect === 'function';
}
function isGainNode(n: AudioNode | HTMLAudioElement): n is GainNode {
  return (n as { gain?: unknown }).gain != null;
}

// —— 文件 BGM（真实音频循环）——
// 指定地图 → 资源清单里的音频 key。这些地图用真实音频循环，替代程序化氛围旋律。
// 循环平滑：各 bgm 文件已在离线裁剪时烘焙淡入/淡出（结尾数秒渐弱），循环接缝不突兀。
const MAP_BGM: Record<string, string> = {
  huoyanshan: 'bgm-huoyanshan',
  liushahe: 'bgm-liushahe',
  baiguling: 'bgm-baiguling',
  pansidong: 'bgm-pansidong',
  huangfengling: 'bgm-huangfengling',
};
const MENU_BGM_KEY = 'bgm-menu'; // 首页背景音乐
const MENU_ID = '__menu'; // ambientMap 的首页占位 id（区别于地图 id）
const bgmBuffers: Record<string, AudioBuffer> = {}; // 已解码缓存，键为 URL
const bgmDecoding: Record<string, Promise<AudioBuffer | null>> = {}; // 解码中的去重

// 拉取并解码音频文件（web）。用回调式 decodeAudioData 以兼容旧 Safari；结果按 URL 缓存。
function decodeBgm(url: string): Promise<AudioBuffer | null> {
  if (bgmBuffers[url]) return Promise.resolve(bgmBuffers[url]!);
  if (url in bgmDecoding) return bgmDecoding[url]!;
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then(
      (ab) =>
        new Promise<AudioBuffer | null>((res) => {
          if (!ctx) { res(null); return; }
          ctx.decodeAudioData(ab, (b) => { bgmBuffers[url] = b; res(b); }, () => res(null));
        }),
    )
    .catch(() => null);
  bgmDecoding[url] = p;
  return p;
}

// 用已解码的 buffer 起一个循环源，接到给定增益节点（该节点已入 ambientNodes，随 stopAmbient 清理）。
export function applyAudioVolumes(
  music: number,
  sfx: number,
  opts?: { musicEnabled?: boolean; sfxEnabled?: boolean },
): void {
  musicVolume = Math.max(0, Math.min(1, music));
  sfxVolume = Math.max(0, Math.min(1, sfx));
  if (opts?.musicEnabled !== undefined) musicEnabled = opts.musicEnabled;
  if (opts?.sfxEnabled !== undefined) sfxEnabled = opts.sfxEnabled;
  if (master && ctx) {
    master.gain.setTargetAtTime(muted ? 0 : sfxEnabled ? 0.5 * sfxVolume : 0, ctx.currentTime, 0.05);
  }
  if (!ctx) return;
  const mg = musicEnabled && !muted && musicVolume > 0 ? 0.5 * musicVolume : 0;
  for (const a of ambientNodes) {
    if (isGainNode(a.node)) {
      a.node.gain.setTargetAtTime(mg, ctx.currentTime, 0.05);
    }
  }
  if (!musicEnabled || musicVolume <= 0) stopAmbient();
  else if (musicEnabled && ambientMap === MENU_ID) startMenuMusic();
}

export function getMusicVolume(): number { return musicVolume; }
export function getSfxVolume(): number { return sfxVolume; }

function startBgmLoop(buffer: AudioBuffer, out: GainNode): void {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(out);
  src.start();
  ambientNodes.push({ node: src, stop: () => { try { src.stop(); } catch { /* ignore */ } } });
}

// 文件 BGM 启动：先放占位增益节点（使 startAmbient 幂等守卫在异步解码期间命中，避免每帧重复触发），
// 解码完成后若仍停留在该地图且音乐未关，再挂上循环源。
// Web 端兜底：素材 CDN（TOS）未配 CORS，fetch+decodeAudioData 会被浏览器拦截（图片走 <img> 不受影响）。
// 解码失败时退回 HTMLAudioElement 循环播放——<audio> 不做 CORS 校验，能正常出声；音量用元素自身
// volume 控制（进不了 WebAudio 图，但 BGM 本来就只受音乐开关/音量影响，行为等价）。微信端走
// polyfill 的 wx.request（无 CORS 概念），解码恒成功，不会进兜底分支。
function startFileBgm(mapId: string, url: string): void {
  if (!ctx || !master) return;
  const g = ctx.createGain();
  g.gain.value = 0.5 * musicVolume;
  g.connect(master);
  ambientNodes.push({ node: g });
  const cached = bgmBuffers[url];
  if (cached) { startBgmLoop(cached, g); return; }
  void decodeBgm(url).then((buf) => {
    if (ambientMap !== mapId || !musicEnabled) return; // 已切走/关音乐：什么都不挂
    if (buf && ctx) startBgmLoop(buf, g);
    else startAudioElBgm(url);
  });
}

/** HTMLAudioElement 兜底循环（Web 端 CORS 拦截 fetch 时）。微信端无 Audio 构造器，不会走到这里。 */
function startAudioElBgm(url: string): void {
  if (typeof Audio === 'undefined') return; // 非浏览器环境（wx）直接放弃
  const el = new Audio(url);
  el.loop = true;
  el.volume = Math.max(0, Math.min(1, 0.5 * musicVolume));
  // 自动播放策略：无手势时 play() 被拒——挂一次性页面手势监听重试（与 initAudio 的手势恢复同思路）
  const tryPlay = () => { void el.play().catch(() => undefined); };
  tryPlay();
  const onGesture = () => { tryPlay(); };
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onGesture, { once: true });
    document.addEventListener('keydown', onGesture, { once: true });
  }
  ambientNodes.push({ node: el, stop: () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
    }
    try { el.pause(); el.src = ''; } catch { /* ignore */ }
  } });
}

export function stopAmbient(): void {
  for (const id of ambientTimers) clearInterval(id);
  ambientTimers = [];
  for (const a of ambientNodes) {
    try { a.stop?.(); } catch { /* ignore */ }
    if (isWebAudioNode(a.node)) a.node.disconnect(); // HTMLAudioElement 兜底节点无 disconnect
  }
  ambientNodes = [];
  ambientMap = '';
}

// 启动某地图的背景音乐（幂等：同图不重启）。各地图一首真实音频循环；资源走 CDN，
// Web 用原生 fetch、微信小游戏用 polyfill 的 fetch→wx.request(arraybuffer) 拉取后 decodeAudioData 播放。
export function startAmbient(mapId: string): void {
  if (!ctx || !master || !musicEnabled || musicVolume <= 0) return; // 背景音乐关闭时不播放（音效仍正常）
  if (ambientMap === mapId && ambientNodes.length) return;
  stopAmbient();
  ambientMap = mapId;
  const bgmKey = MAP_BGM[mapId];
  if (bgmKey && ASSET_URLS[bgmKey]) startFileBgm(mapId, ASSET_URLS[bgmKey]!);
}

// 首页背景音乐（真实音频循环）。幂等：同一 id 且已有节点时不重启。资源走 CDN（Web fetch / 微信 polyfill fetch→wx.request）。
// 循环音量渐变由文件烘焙的淡入/淡出保证。
export function startMenuMusic(): void {
  if (!ctx || !master || !musicEnabled || musicVolume <= 0) return;
  if (!ASSET_URLS[MENU_BGM_KEY]) return;
  if (ambientMap === MENU_ID && ambientNodes.length) return;
  stopAmbient();
  ambientMap = MENU_ID;
  startFileBgm(MENU_ID, ASSET_URLS[MENU_BGM_KEY]!);
}

/** 预载首页 BGM；需在 initAudio 之后调用 */
export function prefetchMenuBgm(): Promise<void> {
  if (!ASSET_URLS[MENU_BGM_KEY]) return Promise.resolve();
  initAudio();
  if (!ctx) return Promise.resolve();
  return decodeBgm(ASSET_URLS[MENU_BGM_KEY]!).then(() => undefined);
}

/** 启动时/回前台：恢复 AudioContext 并尝试播首页音乐（可能被浏览器策略拦截，首击仍会 resume） */
export async function bootstrapMenuMusic(): Promise<void> {
  if (!musicEnabled) return;
  initAudio();
  if (!ctx || !master) return;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* 无用户手势时保持 suspended，等首次点击 */ }
  }
  if (ctx.state === 'running') startMenuMusic();
}

/** 用户手势后：恢复音频并续播当前界面 BGM */
export function resumeAudioAfterGesture(screen: 'menu' | 'battle' | 'other', mapId?: string): void {
  initAudio();
  if (!ctx || ctx.state === 'suspended') {
    void ctx?.resume().then(() => {
      if (!musicEnabled || !ctx || ctx.state !== 'running') return;
      if (screen === 'menu') startMenuMusic();
      else if (screen === 'battle' && mapId) startAmbient(mapId);
    });
    return;
  }
  if (!musicEnabled) return;
  if (screen === 'menu') startMenuMusic();
  else if (screen === 'battle' && mapId) startAmbient(mapId);
}
