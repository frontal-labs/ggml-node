# syntax=docker/dockerfile:1
#
# Build from the repository root, after packing the SDK:
#   bun run build && bun pm pack
#   docker build -f examples/docker/Dockerfile -t node-slm-example .
#
# The model is pulled in its own layer, so code changes do not download it again.

FROM node:22-slim AS model
WORKDIR /models
COPY node-slm-*.tgz /tmp/node-slm/
RUN cd /tmp/node-slm && npm install --omit=dev --prefix /opt/node-slm ./node-slm-*.tgz \
 && /opt/node-slm/node_modules/.bin/node-slm pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS app
WORKDIR /app
COPY node-slm-*.tgz /tmp/node-slm/
RUN cd /tmp/node-slm && npm install --omit=dev --prefix /app ./node-slm-*.tgz \
 && rm -rf /tmp/node-slm
COPY examples/docker/src/server.mjs ./src/
COPY --from=model /models /models
ENV NODE_SLM_CACHE_DIR=/models \
    NODE_SLM_OFFLINE=1 \
    NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.mjs"]
