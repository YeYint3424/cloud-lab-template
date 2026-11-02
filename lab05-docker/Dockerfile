# syntax=docker/dockerfile:1.7

###########################  STAGE 1: builder  ###########################
FROM node:20-alpine AS builder
WORKDIR /app

# Layer-cache optimization: manifests first, source last.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

###########################  STAGE 2: runner  ############################
FROM alpine:3.20 AS runner

ARG STUDENT_ID=UNSET
ARG SOURCE_URL=
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      vlsc.student="${STUDENT_ID}"

# Minimal runtime: the C++ runtime library + a non-root user.
RUN apk add --no-cache libstdc++ \
 && addgroup -S app \
 && adduser -S -G app -H -s /sbin/nologin app

# Copy ONLY the node binary, production node_modules, and compiled output.
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
