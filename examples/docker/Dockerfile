# syntax=docker/dockerfile:1
#
# Build from the repository root, after packing the SDK:
#   bun run build && bun pm pack
#   docker build -f examples/docker/Dockerfile -t local-llm-example .
#
# The model is pulled in its own layer, so code changes do not download it again.

FROM node:22-slim AS model
WORKDIR /models
COPY local-llm-*.tgz /tmp/local-llm/
RUN cd /tmp/local-llm && npm install --omit=dev --prefix /opt/local-llm ./local-llm-*.tgz \
 && /opt/local-llm/node_modules/.bin/local-llm pull qwen2.5-0.5b --dir /models

FROM node:22-slim AS app
WORKDIR /app
COPY local-llm-*.tgz /tmp/local-llm/
RUN cd /tmp/local-llm && npm install --omit=dev --prefix /app ./local-llm-*.tgz \
 && rm -rf /tmp/local-llm
COPY examples/docker/src/server.mjs ./src/
COPY --from=model /models /models
ENV LOCAL_LLM_CACHE_DIR=/models \
    LOCAL_LLM_OFFLINE=1 \
    NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.mjs"]
