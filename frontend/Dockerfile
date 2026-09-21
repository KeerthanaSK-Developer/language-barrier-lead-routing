FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve@14

ENV PORT=8080
ENV API_URL=http://localhost:8000/api

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh \
    && chown -R node:node /app

EXPOSE 8080

USER node
ENTRYPOINT ["/app/docker-entrypoint.sh"]
