# memv2-lite in a container (backend B, and the fact half of backend A). Built from this package's own files:
#   docker compose up -d --build      (from backend/memv2/ or backend/full/)
FROM node:24-alpine
WORKDIR /app
COPY package.json memv2-lite.js local-store.js ./
RUN mkdir -p /data && chown node:node /data
ENV MEMV2_LITE_DB=/data/memv2-lite.sqlite MEMV2_LITE_HOST=0.0.0.0 MEMV2_LITE_PORT=8766
VOLUME /data
EXPOSE 8766
USER node
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -q -O - http://127.0.0.1:8766/health || exit 1
CMD ["node", "memv2-lite.js", "serve"]
