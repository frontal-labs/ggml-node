# syntax=docker/dockerfile:1
# Multi-stage build. The model is pulled in its own layer, so code changes do not download it again.

FROM node:22-slim AS model
WORKDIR /models
RUN npx --yes inboard-sdk pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-slim AS app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mjs ./
COPY --from=model /models /models
ENV INBOARD_CACHE_DIR=/models \
    INBOARD_OFFLINE=1 \
    NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
