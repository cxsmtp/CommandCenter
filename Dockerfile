# CommandCenter — one image for Docker and Podman (amd64 and arm64). Everything it keeps lives in the /data volume.
#
#   docker build -t commandcenter .
#   docker run -d --name commandcenter -p 4310:4310 -v commandcenter-data:/data commandcenter
#   docker logs commandcenter        # the first Admin's password is printed once here
#
# Behind a company proxy that inspects TLS? Pass its CA certificate at build time:
#   docker build --secret id=ca,src=company-ca.pem -t commandcenter .

# ---- Dependencies: npm here, only node_modules moves on ----
FROM docker.io/library/alpine:3.22 AS deps
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then cat /run/secrets/ca >> /etc/ssl/certs/ca-certificates.crt; fi && \
    apk add --no-cache nodejs npm
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi && \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- Runtime: Node.js without a package manager, as an unprivileged user ----
FROM docker.io/library/alpine:3.22
RUN apk upgrade --no-cache && apk add --no-cache nodejs tini && \
    addgroup -g 1000 -S node && adduser -u 1000 -S -G node -h /home/node node && \
    mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 CC_DATA_DIR=/data
USER node
VOLUME ["/data"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4310/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
