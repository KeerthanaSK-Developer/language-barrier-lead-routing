#!/bin/sh
set -e

# Browser-callable API base URL (not an internal Docker hostname)
API_URL="${API_URL:-http://localhost:8000/api}"

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { API_URL: "${API_URL}" };
EOF

exec nginx -g "daemon off;"
