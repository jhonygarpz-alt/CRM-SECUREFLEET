FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Dependencias del servidor. better-sqlite3 es un módulo nativo: si no hay binario
# precompilado disponible se compila aquí, por eso se instalan python3/make/g++.
FROM node:22-slim AS server-deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production TZ=America/Mexico_City DB_PATH=/data/crm.db PORT=4000
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
VOLUME /data
EXPOSE 4000
CMD ["node", "src/index.js"]
