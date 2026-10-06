# Una sola imagen para todo el monorepo; cada servicio cambia solo el comando de arranque.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/event-bus/package.json packages/event-bus/
COPY services/orders/package.json services/orders/
COPY services/payments/package.json services/payments/
COPY services/inventory/package.json services/inventory/
COPY services/notifications/package.json services/notifications/
COPY services/analytics/package.json services/analytics/
COPY services/dashboard/package.json services/dashboard/
RUN npm ci --omit=dev --no-audit --no-fund

COPY packages packages
COPY services services

USER node
