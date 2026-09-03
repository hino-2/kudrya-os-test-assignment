FROM node:22-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/supplier-stub/package.json apps/supplier-stub/package.json
COPY tools/package.json tools/package.json
RUN npm ci

FROM deps AS build
WORKDIR /workspace
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/supplier-stub/package.json apps/supplier-stub/package.json
COPY tools/package.json tools/package.json
RUN npm ci --omit=dev
COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/apps/supplier-stub/dist apps/supplier-stub/dist
COPY apps/api/docker-entrypoint.sh /workspace/apps/api/docker-entrypoint.sh
RUN chmod +x /workspace/apps/api/docker-entrypoint.sh
RUN addgroup -S app && adduser -S app -G app
USER app
CMD ["node", "apps/api/dist/main.js"]
