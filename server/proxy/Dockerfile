# Intelli-Learn AI proxy: one file, no dependencies, runs as a non-root user.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8788

WORKDIR /app
COPY --chown=node:node package.json server.mjs ./

USER node
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8788) + '/ai-proxy/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.mjs"]
