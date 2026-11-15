FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 3000
USER node
CMD ["npx", "tsx", "src/index.ts"]
