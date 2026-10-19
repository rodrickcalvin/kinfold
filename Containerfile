# Stage 1: build. Has the full toolchain and is thrown away afterwards.
FROM registry.access.redhat.com/ubi9/nodejs-20 AS build
USER 0
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 \
    AUTH_SECRET=build-only-not-a-real-secret-0000000000 \
    KINFOLD_PEPPER=build-only-not-a-real-pepper-000000000 \
    npm run build
# Stage 2: runtime. Small, non-root, OpenShift-ready.
FROM registry.access.redhat.com/ubi9/nodejs-20-minimal
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 HOSTNAME=0.0.0.0 KINFOLD_DATA_DIR=/data
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
USER 0
RUN mkdir -p /data && chgrp -R 0 /data .next && chmod -R g=u /data .next
USER 1001
EXPOSE 8080
CMD ["node", "server.js"]
