# Intelli-Learn web app.
#
#   docker build -t intelli-learn-web .
#   docker run --rm -p 8080:8080 intelli-learn-web
#
# Stage 1 builds the static site, stage 2 serves it with nginx as a non-root
# user on port 8080. Nothing from the build tools ends up in the final image.

FROM node:22-alpine AS build
WORKDIR /app
ENV CI=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first so this layer is reused until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build


FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

# The base image already runs as the "nginx" user (uid 101); stated here so it is obvious.
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
