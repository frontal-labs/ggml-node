# syntax=docker/dockerfile:1
#
# Build from the repository root, after packing the SDK:
#   bun run build && bun pm pack
#   docker build -f examples/docker/Dockerfile -t tiny-llm-example .
#
# The model is pulled in its own layer, so code changes do not download it again.

FROM node:22-slim AS model
WORKDIR /models
COPY tiny-llm-*.tgz /tmp/tiny-llm/
RUN cd /tmp/tiny-llm && npm install --omit=dev --prefix /opt/tiny-llm ./tiny-llm-*.tgz \
 && /opt/tiny-llm/node_modules/.bin/tiny-llm pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS app
WORKDIR /app
COPY tiny-llm-*.tgz /tmp/tiny-llm/
RUN cd /tmp/tiny-llm && npm install --omit=dev --prefix /app ./tiny-llm-*.tgz \
 && rm -rf /tmp/tiny-llm
COPY examples/docker/src/server.mjs ./src/
COPY --from=model /models /models
ENV TINY_LLM_CACHE_DIR=/models \
    TINY_LLM_OFFLINE=1 \
    NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.mjs"]
