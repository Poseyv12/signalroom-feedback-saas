FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --create-home --uid 10001 signalroom && mkdir -p /data && chown signalroom:signalroom /data
COPY --from=build --chown=signalroom:signalroom /app/package.json /app/package-lock.json ./
COPY --from=build --chown=signalroom:signalroom /app/node_modules ./node_modules
COPY --from=build --chown=signalroom:signalroom /app/dist ./dist
COPY --from=build --chown=signalroom:signalroom /app/dist-server ./dist-server
COPY --from=build --chown=signalroom:signalroom /app/migrations ./migrations
USER signalroom
EXPOSE 4174
VOLUME ["/data"]
ENV PORT=4174
ENV DATABASE_PATH=/data/signalroom.db
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4174/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
