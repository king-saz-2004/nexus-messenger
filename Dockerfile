ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS frontend-builder
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry ${NPM_REGISTRY}

WORKDIR /frontend

COPY package*.json ./
RUN npm ci

COPY App.tsx ./
COPY index.tsx ./
COPY index.html ./
COPY index.css ./
COPY metadata.json ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY tsconfig.json ./
COPY types.ts ./
COPY vite.config.ts ./
COPY vite-env.d.ts ./
COPY components ./components
COPY hooks ./hooks
COPY public ./public
COPY services ./services
COPY features ./features
COPY shared ./shared

ARG VITE_API_BASE=
ENV VITE_API_BASE=${VITE_API_BASE}

RUN npm run build


FROM ${NODE_IMAGE} AS backend-builder
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry ${NPM_REGISTRY}

WORKDIR /backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src

RUN npm run build
RUN npm prune --omit=dev


FROM ${NODE_IMAGE} AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=backend-builder /backend/node_modules ./node_modules
COPY --from=backend-builder /backend/dist ./dist
COPY --from=backend-builder /backend/package.json ./package.json
COPY --from=frontend-builder /frontend/dist ./public
COPY backend/sql ./sql

RUN mkdir -p /app/storage /app/logs && chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
