# Meridian — one image for Docker and Podman (amd64 and arm64). Everything it keeps lives in the /data volume.
#
#   podman build -t meridian .
#   podman run -d --name meridian -p 8443:8443 -v meridian-data:/data -e TLS_HOSTNAMES=meridian.company.com meridian
#   podman logs meridian        # the first Admin's password is printed once here
#
# HTTPS on 8443 by default: a self-signed certificate (kept in /data/tls) until you mount your own and set
# TLS_CERT_FILE + TLS_KEY_FILE (or TLS_PFX_FILE). HTTPS=off for plain http behind a reverse proxy that does HTTPS.
#
# Behind a company proxy that inspects TLS? Pass its CA certificate at build time:
#   docker build --secret id=ca,src=company-ca.pem -t meridian .

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
RUN apk upgrade --no-cache && apk add --no-cache nodejs tini tar && \
    addgroup -g 1000 -S node && adduser -u 1000 -S -G node -h /home/node node && \
    mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts/bundle.mjs ./scripts/bundle.mjs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8443 HTTPS=on CC_DATA_DIR=/data
USER node
VOLUME ["/data"]
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "src/healthcheck.js"]
ENTRYPOINT ["/sbin/tini", "--"]
# The launcher runs the version chosen in Settings → Update & recovery, and rolls back one that does not start.
CMD ["node", "src/launcher.js"]
