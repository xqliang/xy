# 妖怪来袭

一款西游题材的「合成 + 对称塔防」网页原型：抽兵合成、凑字召唤武将，抵御一波波妖怪、守护唐僧走完取经路；下半场是你，上半场是对称的伪竞技 AI 对手。

> 玩法与数值参考了同类「合成塔防 IAA 小游戏」的公开框架（伤害=ATK 的单一乘区、POW 战力体系、馒头/蟠桃经济曲线、五阶合成、每日重置等），并做了西游披皮与原创美术/音效。

## 快速开始

```bash
./start.sh            # 启动开发服务器 → http://127.0.0.1:5180
./start.sh bg         # 后台启动（日志 web/vite.log）
./start.sh stop       # 停止后台/占用 5180 的服务器
./start.sh logs       # 查看后台日志（tail -f）
./start.sh build      # 生产构建（输出 web/dist）
./start.sh preview    # 预览构建产物
./start.sh test       # 运行数值单元测试（game-core）
./start.sh versus-agent [局数] [种子]  # 对战用户代理 headless 模拟（默认 20 局 @10×，见 docs/versus-user-agent.md）
./start.sh check      # 类型检查（game-core + web）
./start.sh deploy     # 一键部署到 ECS（零停机，见 memory/部署说明）
./start.sh rollback   # 回滚线上到上一个/指定发布
./start.sh wx         # 构建微信小游戏 bundle 到 wechat/（IAA；见 docs/wechat-adaptation.md）
```

> **微信小游戏（IAA）**：安装 `brew install --cask wechatwebdevtools`，`./start.sh wx` 构建后用
> 微信开发者工具打开 `wechat/` 联调与上传。完整安装/适配/部署发布见 **`docs/wechat-adaptation.md`** 与 **`wechat/README.md`**。

首次运行会自动 `npm install`（需 Node.js ≥ 18）。也可手动：

```bash
cd web && npm install && npm run dev
```

调试用 URL 参数：`?seed=7`（固定随机种子，便于复现）、`?map=huoyanshan|liushahe|baiguling|pansidong`（指定地图）。

## 玩法概览

- **征兵合成**：消耗蟠桃抽兵（棍猴/枪天兵/天马骑兵/神箭手），把候选区的兵拖到棋盘绿格；同型同级相邻或叠放合成升阶（1→5 阶）。
- **武将（双字）**：征兵有概率产出「字牌」。把同一武将的两个字**左右紧邻**摆放即激活武将（金框），产生输出与技能；中间隔空或被拆开则失效。激活时大招 CD 从满开始倒数，需等待首轮冷却；喂字/战斗升阶不重置 CD。武将靠输出/技能局内升级，「悟空」在场触发羁绊全队增伤。
- **英雄绝招**：战斗中蓄力，满后点「绝招」手动释放大范围爆发（金箍棒横扫）。
- **神兵（武器背包）**：对局随机掉落武将专属神兵，五级品质，重复升品质；局外装备（≤3 件）在开局注入加成。
- **道具**：波间三选一，主动≤2 / 被动≤6，含蟠桃园/招贤榜/摸金校尉/洛阳铲/陨石/淤泥等。
- **境界 / 功德商店**：胜负影响境界（军衔）与难度自适应；对局结算获得功德，可在「神秘商人」买断永久成长。
- **伪竞技 AI**：上半场是与你对称的 AI 对手，任一方唐僧被吃则对局结束。

## 目录结构

```
game-core/     # 引擎无关的纯 TS 数值内核（伤害/POW/合成/经济），含 vitest 单元测试
web/           # Vite + TS + Canvas 的可玩前端（通过 @core 别名复用 game-core）
  src/         # battle(状态机) / render(渲染) / generals / weapons / sfx / 各界面 …
  public/assets/  # Seedream 生成并抠成透明 PNG 的立绘 + 地图大背景
  tools/       # puppeteer 截图自测与数值基准脚本
docs/          # 设计与规划文档
```

## 技术要点

- **数值与表现分离**：`game-core` 是引擎无关的纯 TS 数值内核（可独立测试），`web` 只负责渲染与交互，通过 Vite alias `@core` 直接引用其 TS 源。
- **美术**：立绘与地图背景由火山方舟 Seedream 生成（`web/tools/seeddream/`），边缘 flood-fill 抠成透明 PNG。生成脚本需环境变量 `ARK_API_KEY`。
- **音效**：`web/src/sfx.ts` 用 Web Audio API **实时合成**（无任何外部/版权音频文件），含每张地图不同风格的背景氛围音；主菜单右上角可静音（状态存 localStorage）。
- **自测**：`web/tools/*.mjs` 用系统 Chrome（puppeteer-core）驱动 `window.__game` 钩子，做截图与数值基准回归。

## 数值系统（核对基准）

- 伤害 = ATK（单一乘区）；POW怪 = HP×移速，POW塔 = ATK×攻速×范围×目标数。
- 兵种逐阶成长系数 `[1.0, 1.5, 2.1, 2.73, 3.276]`；5 阶 POW 骑=枪=弓=80.4、刀(棍猴)=40.2。
- 经济：初始蟠桃 20、杀怪 +1、唐僧掉血 +10（卖血）、BOSS +10；每波怪数 10+n−1，后期另按战场输出抬总量与同批叠怪（移速固定 0.6 格/s，不随波次加速）。
- 目标胜率约 60%（由 AI skill / rubber-band 自适应长期收敛）。
- 对战压力比随波次升高（≤6 波 60% → 16+ 波 90%）；波次目标与代理说明见 `docs/versus-user-agent.md`。
- 武将普攻/大招范围与目标上限见 **`docs/hero-combat-reference.md`**。

详见 `game-core/src/`（`config/units.ts`、`domain/*.ts`）与其单元测试。
