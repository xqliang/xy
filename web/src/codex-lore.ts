// 图鉴风味文案（背景故事）：与玩法数值分离，集中存放便于统一润色。
// 只做展示：不参与任何战斗逻辑，故不放进 game-core / battle.ts（后者常有并行改动）。
// 键名严格对应各数据源 id：英雄 GeneralDef.id、兵器 UnitType、主动 ACTIVE_SKILLS.id、
// 被动 PASSIVE_SKILLS.id、小Boss MiniBossKind、妖王按地图 id、妖怪类型按 codex 内部 key。
// 文案控制在 ~12 字内，图鉴卡片单行可容纳。

/** 英雄背景（key = GeneralDef.id，含满5主将与满3同门过渡将） */
export const HERO_LORE: Record<string, string> = {
  dasheng: '花果山美猴王，大闹天宫',
  damang: '深山蟒精，借威闯荡',
  erlang: '灌江口显圣真君，额生天眼',
  niulang: '牵牛凡郎，习得薄技',
  nezha: '陈塘关三太子，莲花化身',
  jinzha: '哪吒长兄，持戈护体',
  honghaier: '圣婴大王，三昧真火',
  hongpao: '火云洞小妖，略通火法',
  bajie: '天蓬元帅谪世，九齿钉耙',
  baxian: '八位散仙，凑趣助拳',
  niumowang: '平天大圣，力可开山',
  qingniu: '老君坐骑，窃琢称王',
  tieshan: '罗刹铁扇公主，一扇生风',
  tiebei: '山中铁背苍狼，皮坚',
  shaseng: '卷帘大将谪世，降妖宝杖',
  liusha: '流沙河水怪，随沙僧',
  bailong: '西海三太子，化作龙马',
  taibai: '太白金星，长庚星君，拂尘点化',
  guanyin: '南海观世音，甘露普度',
  fanyin: '潮音侍者，颂经浅愈',
  laojun: '太上老君，炉炼仙丹',
  danjun: '兜率炼丹童，火候初成',
  wenshu: '文殊菩萨，智剑破痴',
  huishu: '五台行者，参习慧法',
};

/** 兵器背景（key = UnitType） */
export const UNIT_LORE: Record<string, string> = {
  dao: '花果山猴兵持刀，近身收割',
  spear: '天兵列枪成阵，隔位穿刺',
  cavalry: '天马踏云冲阵，践踏成群',
  archer: '神箭手远眺，箭无虚发',
};

/** 主动技能背景（key = ACTIVE_SKILLS.id） */
export const ACTIVE_LORE: Record<string, string> = {
  act_palm: '五指化五岳，佛法退群妖',
  act_meteor: '天火坠石，当头砸落',
  act_atk: '老君金丹，服之力增',
  act_frq: '踏轮生风，出手如飞',
  act_freeze: '寒气弥漫，万妖凝滞',
  act_jinggu: '紧箍咒起，痛彻妖群',
  act_bomb: '雷符埋路，踏之轰然',
};

/** 被动技能背景（key = PASSIVE_SKILLS.id） */
export const PASSIVE_LORE: Record<string, string> = {
  pas_pantao: '瑶池蟠桃，自生自熟',
  xiandan: '丹符护体，攻力常增',
  fenghuolun: '轮符加身，出手更疾',
  fabaofu: '法宝加持，起手不凡',
  zhaoxian: '张榜招贤，良将来投',
  mojin: '摸金探穴，掘地生财',
  luoyangchan: '洛阳神铲，探穴如探囊',
  yunshi: '候敌近前，飞石当头',
  yuni: '淤泥没径，妖行迟滞',
  xianyuan: '仙缘引渡，招募省力',
  jubaopen: '聚宝生财，取之不竭',
  hushen: '金光护身，唐僧添寿',
  zhuwang: '蛛网横路，绊妖难行',
  tongxin: '同心护法，唐僧添寿',
  dinghai: '定海神针，即开一阵',
};

/** 妖怪类型背景（key = codex 类型卡内部标识） */
export const MONSTER_TYPE_LORE: Record<string, string> = {
  minion: '山野杂兵，成群沿路来犯',
  elite: '妖群头目，身负本图邪术',
  cavalry: '乘兽疾行的快怪，转眼逼近',
  miniboss: '跨地图游荡的头目，各带邪法光环',
  boss: '一方妖界之主，血厚势沉率众压境',
};

/** 小 Boss 背景（key = MiniBossKind） */
export const MINIBOSS_LORE: Record<string, string> = {
  frost: '周身寒霜，冻缓近旁兵器',
  blight: '毒瘴蚀甲，削弱近旁兵器',
  quake: '跺地成震，掀翻近旁兵器',
  gale: '呼风助阵，催快同伙',
  blood: '血泉汩汩，为同伙续命',
  lion: '九头狮孙，卷走阵中一物就跑',
};

/** 妖王背景（key = 地图 id） */
export const BOSS_LORE: Record<string, string> = {
  huoyanshan: '火焰山妖王，烈焰灼身、兵器攻力大减',
  liushahe: '流沙河妖王，流沙裹足、兵器出手变慢',
  baiguling: '白骨岭妖王，白骨魅惑、兵器无法出手',
  pansidong: '盘丝洞妖王，蛛丝黏缚、兵器攻程骤减',
  huangfengling: '黄风岭妖王，三昧神风裹足、兵器出手变慢',
};
