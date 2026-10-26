# TV WebOS server + built client in one image.
#   docker build -t tv-webos .
#   docker run -p 8686:8686 -v $PWD/media:/data/media -v $PWD/data:/data/state tv-webos

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8686 \
    DATA_DIR=/data/state \
    MEDIA_DIR=/data/media
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/catalog server/catalog
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data/state /data/media && chown -R node:node /data
USER node
EXPOSE 8686
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8686/api/health || exit 1
CMD ["node", "server/dist/index.js"]
