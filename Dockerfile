FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
EXPOSE 4001
CMD ["node", "apps/api/dist/server.js"]

