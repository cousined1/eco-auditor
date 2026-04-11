FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Create volume mount point for video assets
# Railway will mount the persistent volume here
RUN mkdir -p /app/videos

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.cjs"]