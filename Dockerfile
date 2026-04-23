# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Repo uses bun.lock (new text format), not the legacy binary bun.lockb
COPY package.json bun.lock ./
RUN npm install -g bun && bun install --frozen-lockfile

COPY . .

# Vite env vars are baked into the bundle at build time — pass as build args
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

RUN bun run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
