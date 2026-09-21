#!/bin/sh
set -e

API_URL="${API_URL:-http://localhost:8000/api}"
PORT="${PORT:-80}"

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { API_URL: "${API_URL}" };
EOF

# Write nginx config here so envsubst cannot break \$uri (SPA reload support)
cat > /etc/nginx/conf.d/default.conf <<EOF
server {
    listen ${PORT};
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

exec nginx -g "daemon off;"
