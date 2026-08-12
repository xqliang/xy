#!/usr/bin/env bash
# 幂等：建库 xy_game + 用户 + 写 .db_password / 写 config.yaml（纯 bash，不依赖 PyYAML）
set -euo pipefail

REMOTE_DIR="${1:-/opt/xy/server}"
DB_NAME="${DB_NAME:-xy_game}"
DB_USER="${DB_USER:-xy_game}"
SECRET_FILE="$REMOTE_DIR/.db_password"
CONFIG="$REMOTE_DIR/config.yaml"

mkdir -p "$REMOTE_DIR"
if [[ ! -f "$SECRET_FILE" ]]; then
  PW="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  echo -n "$PW" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "generated new DB password → $SECRET_FILE"
else
  PW="$(cat "$SECRET_FILE")"
  echo "reusing existing DB password"
fi

mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$PW';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$PW';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

# 已有完整 config 且密码不是占位符 → 只确保 DSN 字段同步（用 python 若 venv 可用，否则跳过）
need_write=1
if [[ -f "$CONFIG" ]] && ! grep -q 'CHANGE_ME' "$CONFIG" 2>/dev/null; then
  if grep -q "password: \"$PW\"" "$CONFIG" 2>/dev/null || grep -q "password: '$PW'" "$CONFIG" 2>/dev/null || grep -q "password: $PW" "$CONFIG" 2>/dev/null; then
    need_write=0
    echo "config.yaml already has DB password; skip rewrite"
  fi
fi

if [[ "$need_write" -eq 1 ]]; then
  ADMIN_USER="admin"
  if [[ -f "$CONFIG" ]] && grep -q 'password:' "$CONFIG" && ! grep -q 'CHANGE_ME' "$CONFIG"; then
    # 保留已有 admin 密码
    ADMIN_PASS="$(awk '/^admin:/{f=1;next} f && /password:/{gsub(/["'\'']/,""); print $2; exit}' "$CONFIG" || true)"
  fi
  if [[ -z "${ADMIN_PASS:-}" || "$ADMIN_PASS" == "CHANGE_ME" ]]; then
    ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)"
    echo "admin password: $ADMIN_PASS"
  else
    echo "reusing existing admin password"
  fi

  # YAML 里密码用单引号包裹，内部单引号加倍
  yaml_quote() {
    local s="$1"
    s="${s//\'/\'\'}"
    printf "'%s'" "$s"
  }

  cat > "$CONFIG" <<EOF
addr: "0.0.0.0:8082"
static_dir: "/opt/xy/html"
timezone: "Asia/Shanghai"
db:
  host: "127.0.0.1"
  port: 3306
  user: $(yaml_quote "$DB_USER")
  password: $(yaml_quote "$PW")
  database: $(yaml_quote "$DB_NAME")
admin:
  username: $(yaml_quote "$ADMIN_USER")
  password: $(yaml_quote "$ADMIN_PASS")
tos:
  endpoint: ""
  region: ""
  bucket: ""
  access_key: ""
  secret_key: ""
EOF
  chmod 600 "$CONFIG"
  echo "wrote $CONFIG"
fi
