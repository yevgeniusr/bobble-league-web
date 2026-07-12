FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
CMD ["npm","start"]
