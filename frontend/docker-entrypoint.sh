#!/bin/sh
set -e

API_URL="${API_URL:-http://localhost:8000/api}"
# Railway injects PORT; default 80 for local Docker
PORT="${PORT:-80}"

echo "Starting frontend nginx on port ${PORT}"
echo "API_URL=${API_URL}"

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { API_URL: "${API_URL}" };
EOF

cat > /etc/nginx/conf.d/default.conf <<EOF
server {
    listen ${PORT};
    listen [::]:${PORT};
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

# Remove default server that may bind only to 80
rm -f /etc/nginx/conf.d/default.conf.bak 2>/dev/null || true

nginx -t
exec nginx -g "daemon off;"
