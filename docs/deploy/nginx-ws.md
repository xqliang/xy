# PvP WebSocket 部署配置（nginx 反代升级头）

在线 PvP 对局期用 WebSocket（`/api/versus/ws`）做快照中继。WS 走 HTTP Upgrade，
nginx 默认按普通 HTTP/1.0 短连接代理会掐断升级——必须在反代上显式透传 Upgrade 头。

## nginx 配置（`peiyin.seealso.cn/xy` 反代到 ECS:8082）

在现有 `/xy` 反代的 server 块里加一个更具体的 location（WS 专用）：

```nginx
location /xy/api/versus/ws {
    proxy_pass http://127.0.0.1:8082/api/versus/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    # 长连接读超时：服务端每 5s 发协议层 ping 保活（api_versus.py handle_versus_ws），
    # 正常流量下不会触发；给足裕量防中间层掐空闲长连接。
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

要点：
- **必须**放在通用 `/xy/api` 或 `/xy/` location **之前**（nginx 取最长前缀匹配，更具体的
  `/xy/api/versus/ws` 本身优先；若用的是正则 location 则注意顺序）。
- `proxy_http_version 1.1` + `Upgrade`/`Connection` 头三件套缺一不可，否则握手返回 200 而非 101，
  客户端 PvpSocket 会静默重连失败（表现为：匹配正常、进战斗后对手半场永远空白 + 6s 断线弹窗）。
- `proxy_read_timeout` 默认 60s 会在 ping 间隙误杀——服务端 ping 5s 一次本已覆盖，
  加大是双保险。

## 自查清单（部署后）

```bash
# 1. 升级头透传：应返回 HTTP/1.1 101 Switching Protocols（curl 会挂住等帧，Ctrl-C 即可）
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
  "https://peiyin.seealso.cn/xy/api/versus/ws?matchId=x&uid=y"

# 2. 页面内：真人对战进入战斗后顶部应显示「延迟 Nms」（应用层 ping/pong RTT），
#    且对手半场在 ~1.5s 后出怪。
```

## 本地开发（vite）

`web/vite.config.ts` 的 `/api` 代理已加 `ws: true`，`npx vite` 下
`XY_API_PROXY=http://127.0.0.1:8082` 即可本地联调 WS（无需直连端口）。
