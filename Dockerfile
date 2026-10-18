# Single-server deploy: build the web frontend, then run the API server which
# serves web/dist on the same port (no CORS / VITE_API_BASE needed).
# Use when one service should host everything (e.g. Railway with the repo root
# as service root). For the split deploy: web/ on Vercel + server/Dockerfile.

FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-slim
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["npm", "start"]
