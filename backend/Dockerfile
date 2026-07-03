ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS builder
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry ${NPM_REGISTRY}

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev


FROM ${NODE_IMAGE} AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY sql ./sql

RUN mkdir -p /app/storage /app/logs && chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
