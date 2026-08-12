#!/usr/bin/env python3
# 【已退役】请改用仓库根目录 server/server.py（静态 + /api + /admin + MySQL）。
# 本文件仍可能被 Vite 拷进 dist，但 ECS systemd（xy-web）不再以它为入口。
# 静态站服务：在 SimpleHTTPRequestHandler 基础上补充缓存头。
# - /assets/* 都是带内容哈希的文件（Vite 指纹），内容不变→文件名不变，可永久缓存：
#     Cache-Control: public, max-age=31536000, immutable  → 浏览器命中缓存、零请求
# - 其它（index.html 等）用 no-cache：每次revalidate，保证部署后立刻拿到引用新哈希的入口。
# 用法：python3 server.py <port> <directory>
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path.startswith('/assets/'):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    handler = partial(Handler, directory=directory)
    with ThreadingHTTPServer(('0.0.0.0', port), handler) as httpd:
        print(f'serving {directory} on 0.0.0.0:{port}', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
