# =============================================================================
# Frontend — production image
# Stage 1 builds the static bundle with Vite (needs Node + devDependencies).
# Stage 2 serves ONLY the built static files via Nginx — the final image
# has no Node runtime, no source code, no node_modules at all, which
# keeps it small (~25MB vs. several hundred MB for a Node-based image)
# and reduces attack surface since there's no JS runtime to exploit in
# the production container.
# =============================================================================

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
