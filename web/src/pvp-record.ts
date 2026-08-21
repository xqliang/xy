// 玩家输入 → PvpAction 命令映射（不含 t，t 由 PvpSync.record 补）。只记命令+位置，不记结果：
// 对手同 seed 重放命令即忠实复现，故不记结果（具体伤害/击杀等由各自 Battle 决定）。
import type { PvpAction } from './api/pvp-client';

type Kind = PvpAction['op'];
type Cmd = Omit<PvpAction, 't'>;

/**
 * 把一次「成功的玩家操作」映射成 PvpAction 命令体（Omit<t>）。
 * @param kind 操作类型（= PvpAction.op）
 * @param p 各字段松散入参（来自 main.ts 各输入点现场变量），必填字段缺失时用兜底值保证类型成立。
 *   说明：place.token 在命令式里常取不到（托盘 index 已能标识），故用 '' 兜底；反作弊/健壮性可后续补。
 *
 * 类型注记：返回类型是 union，TS 不会据 switch(kind) 收窄返回的上下文类型，故各分支显式 `as Cmd`
 * 绕过 union 的多余属性检查（入参 p 本就是 Record<string,unknown>，本就无静态约束）。
 */
export function toPvpAction(kind: Kind, p: Record<string, unknown>): Cmd {
  switch (kind) {
    case 'summon': return { op: 'summon' } as Cmd;
    case 'autoplace': return { op: 'autoplace' } as Cmd;
    case 'startWave': return { op: 'startWave' } as Cmd;
    case 'place': return { op: 'place', index: p.index as number, cell: p.cell as string, token: (p.token as string) ?? '' } as Cmd;
    case 'move': return { op: 'move', from: p.from as string, to: p.to as string } as Cmd;
    case 'merge': return { op: 'merge', from: p.from as number, to: p.to as number } as Cmd;
    case 'recall': return { op: 'recall', from: p.from as string, slot: p.slot as number } as Cmd;
    case 'shovel': return { op: 'shovel', cell: p.cell as string } as Cmd;
    case 'active': return { op: 'active', slot: p.slot as number, id: p.id as string, ...(p.cell ? { cell: p.cell as string } : {}) } as Cmd;
    case 'claimDrop': return { op: 'claimDrop', id: p.id as string } as Cmd;
  }
}
