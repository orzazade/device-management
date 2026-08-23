FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api
COPY apps/api apps/api
RUN pnpm --filter api build && pnpm --filter api deploy --prod /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules node_modules
COPY --from=build /out/package.json .
COPY --from=build /repo/apps/api/dist dist
EXPOSE 8080
CMD ["node", "dist/main.js"]
