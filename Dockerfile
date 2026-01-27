FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG APP_VERSION

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
ENV APP_VERSION=$APP_VERSION
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
RUN mkdir -p /app/db

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
