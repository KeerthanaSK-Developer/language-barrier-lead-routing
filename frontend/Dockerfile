FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

ENV PORT=8080
ENV API_URL=http://localhost:8000/api
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY server.js ./server.js

EXPOSE 8080

CMD ["node", "server.js"]
