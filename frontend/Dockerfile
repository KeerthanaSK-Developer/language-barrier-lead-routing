FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

ENV PORT=80
ENV API_URL=http://localhost:8000/api

# Disable default template processing; we write conf in our entrypoint
RUN rm -f /etc/nginx/conf.d/default.conf

COPY docker-entrypoint.sh /docker-entrypoint-custom.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint-custom.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint-custom.sh"]
