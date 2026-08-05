// IAA 广告抽象层（纯广告变现）。
// 设计目标：对 Web 本地调试 / 服务器部署零影响——Web 或未配置广告位时，激励视频「模拟即时发奖」，
// 行为与现状完全一致；仅当运行在微信小游戏(wx 环境)且已配置广告位时，才真正拉起 wx 激励视频/插屏。
// 所有对 wx 的访问都在 `typeof wx !== 'undefined'` 守卫之后，保证 Web 端不会 ReferenceError。

// wx 为微信小游戏运行时注入的全局；Web 端不存在。用 declare 让 TS 通过，运行时靠 typeof 守卫。
declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// 是否运行在微信小游戏环境
export const isWeChat: boolean =
  typeof wx !== 'undefined' && typeof wx.createRewardedVideoAd === 'function';

// 广告位 ID：上线前在微信公众平台(小游戏)申请后填入。留空时即使在微信环境也走「模拟发奖」，
// 便于未接广告位前先行联调。可后续改为从 config 注入。
export const AD_UNITS = {
  rewarded: '', // 激励视频广告位 id（adUnitId）
  interstitial: '', // 插屏广告位 id
};

let rewardedAd: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
let interstitialAd: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

function getRewarded(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!isWeChat || !AD_UNITS.rewarded) return null;
  if (!rewardedAd) {
    rewardedAd = wx.createRewardedVideoAd({ adUnitId: AD_UNITS.rewarded });
    // 预加载失败不致命，show 时会再 load 一次
    rewardedAd.onError?.(() => { /* 忽略：show 时兜底重试 */ });
  }
  return rewardedAd;
}

/**
 * 播放激励视频。resolve(true) 表示「看完，应发放奖励」；resolve(false) 表示中途关闭/失败，不发奖。
 * Web / 未配置广告位：立即 resolve(true)（模拟发奖，保持现有体验不变）。
 */
export function showRewardedAd(_scene = 'default'): Promise<boolean> {
  const ad = getRewarded();
  if (!ad) return Promise.resolve(true); // Web/dev/未配置 → 模拟发奖
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      ad.offClose?.(onClose);
      resolve(ok);
    };
    const onClose = (res: { isEnded?: boolean } | undefined) => {
      // isEnded=true：完整观看，应发奖；否则中途退出不发奖
      finish(!!(res && res.isEnded));
    };
    ad.onClose(onClose);
    // 先直接 show；失败则 load 后重试一次
    ad.show().catch(() => {
      ad.load()
        .then(() => ad.show())
        .catch(() => finish(false));
    });
  });
}

/** 播放插屏广告（无奖励，纯曝光）。Web/未配置：no-op。失败静默。 */
export function showInterstitialAd(): void {
  if (!isWeChat || !AD_UNITS.interstitial) return;
  if (!interstitialAd) interstitialAd = wx.createInterstitialAd({ adUnitId: AD_UNITS.interstitial });
  interstitialAd.show?.().catch(() => { /* 静默 */ });
}
