# syntax=docker/dockerfile:1
#
# Build from the repository root, after packing the SDK:
#   bun run build && bun pm pack
#   docker build -f examples/docker/Dockerfile -t inboard-example .
#
# The model is pulled in its own layer, so code changes do not download it again.

FROM node:22-slim AS model
WORKDIR /models
COPY inboard-sdk-*.tgz /tmp/inboard/
RUN cd /tmp/inboard && npm install --omit=dev --prefix /opt/inboard ./inboard-sdk-*.tgz \
 && /opt/inboard/node_modules/.bin/inboard pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS app
WORKDIR /app
COPY inboard-sdk-*.tgz /tmp/inboard/
RUN cd /tmp/inboard && npm install --omit=dev --prefix /app ./inboard-sdk-*.tgz \
 && rm -rf /tmp/inboard
COPY examples/docker/src/server.mjs ./src/
COPY --from=model /models /models
ENV INBOARD_CACHE_DIR=/models \
    INBOARD_OFFLINE=1 \
    NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.mjs"]
