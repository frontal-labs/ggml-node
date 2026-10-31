# syntax=docker/dockerfile:1
#
# Build from the repository root, after packing the SDK:
#   bun run build && bun pm pack
#   docker build -f examples/docker/Dockerfile -t ggml-node-example .
#
# The model is pulled in its own layer, so code changes do not download it again.

FROM node:22-slim AS model
WORKDIR /models
COPY ggml-node-*.tgz /tmp/ggml-node/
RUN cd /tmp/ggml-node && npm install --omit=dev --prefix /opt/ggml-node ./ggml-node-*.tgz \
 && /opt/ggml-node/node_modules/.bin/ggml-node pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS app
WORKDIR /app
COPY ggml-node-*.tgz /tmp/ggml-node/
RUN cd /tmp/ggml-node && npm install --omit=dev --prefix /app ./ggml-node-*.tgz \
 && rm -rf /tmp/ggml-node
COPY examples/docker/src/server.mjs ./src/
COPY --from=model /models /models
ENV GGML_NODE_CACHE_DIR=/models \
    GGML_NODE_OFFLINE=1 \
    NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.mjs"]
