# Evolus Red — API server. Node 24 runs the TypeScript sources directly and
# ships node:sqlite, so no build step is needed.
FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite lives on a mounted volume (Railway: mount one at /data).
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8787
CMD ["npm", "start"]
