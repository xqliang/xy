#!/usr/bin/env python3
"""绿幕残渍洪泛清理:chroma 软抠后,从画布四边洪泛所有「绿系残留」连通域并置全透明。

背景必然与画布边缘连通,角色内部即使有绿色(如小妖皮肤)也不会被误清。
判定绿系残留:g 通道对 r/b 均有明显优势,或(半透明且偏绿不含蓝)——
覆盖 橄榄绿(170,183,0) 这类模型没画纯荧光绿时留下的脏底。

用法: python3 defringe-floodfill.py <png> [<png> ...]
"""
import sys
from collections import deque
from PIL import Image


def is_bgish(r: int, g: int, b: int, a: int) -> bool:
    """背景候选(从边缘洪泛):只认绿系残留。

    教训:曾加过「极暗像素也算背景」的规则,结果把贴边的黑色角色部件误吃
    (二郎神的黑狗、哪吒的黑色发髻)——墨色背景改由生成提示词禁止,抠图端不再碰暗色。
    """
    if a <= 0:
        return False
    if a < 20:
        return True  # 已透明,可通行
    # 通道优势度:绿比红和蓝都高出一截(容忍橄榄绿 g-r≈13 的小优势)
    if g - max(r, b) >= 8 and b < 120:
        return True
    # 半透明的黄绿渍(chroma 只降到部分 alpha 的边缘残留)
    if a < 235 and (g - max(r, b)) >= 4 and b < 90 and g > 120:
        return True
    return False


def clean(path: str) -> None:
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    px = im.load()
    seen = [[False] * W for _ in range(H)]
    dq = deque()
    # 从四边的绿系像素入队
    for x in range(W):
        for y in (0, H - 1):
            r, g, b, a = px[x, y]
            if not seen[y][x] and (is_bgish(r, g, b, a) or a < 20):
                seen[y][x] = True
                dq.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            r, g, b, a = px[x, y]
            if not seen[y][x] and (is_bgish(r, g, b, a) or a < 20):
                seen[y][x] = True
                dq.append((x, y))
    removed = 0
    while dq:
        x, y = dq.popleft()
        r, g, b, a = px[x, y]
        if a > 0:
            px[x, y] = (r, g, b, 0)
            removed += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx]:
                nr, ng, nb, na = px[nx, ny]
                if is_bgish(nr, ng, nb, na) or na < 20:
                    seen[ny][nx] = True
                    dq.append((nx, ny))
    im.save(path)
    print(f"  洪泛清理 {path}: 移除 {removed} px")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        clean(p)
