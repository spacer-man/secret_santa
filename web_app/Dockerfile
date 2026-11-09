# --- build ---
FROM node:22-alpine AS build
RUN npm install -g bun@1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN npx ng build --configuration production

# --- runtime ---
FROM caddy:2-alpine
COPY --from=build /app/dist/secret_santa_web_app_frontend/browser /srv
COPY Caddyfile /etc/caddy/Caddyfile
