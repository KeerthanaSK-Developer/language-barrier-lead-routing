FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

ENV PORT=80
ENV API_URL=http://localhost:8000/api

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint-custom.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint-custom.sh

EXPOSE 80

# nginx image already runs envsubst on templates via its entrypoint;
# chain our script after that by replacing CMD only — call stock entrypoint first.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/docker-entrypoint-custom.sh"]
