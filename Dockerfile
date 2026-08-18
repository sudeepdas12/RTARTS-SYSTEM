# Stage 1: Build the application
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}

# Copy package definition
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Set Nitro target to standalone node-server
ENV NITRO_PRESET=node-server

# Build the production bundle
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Copy built output from build stage
COPY --from=build /app/.output /app/.output

ENV PORT=80
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 80

CMD ["node", ".output/server/index.mjs"]


