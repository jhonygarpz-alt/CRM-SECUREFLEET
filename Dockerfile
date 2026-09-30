FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production TZ=America/Mexico_City DB_PATH=/data/crm.db PORT=4000
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
VOLUME /data
EXPOSE 4000
CMD ["node", "src/index.js"]
