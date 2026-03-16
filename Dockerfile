FROM node:20-alpine

# cache-bust: 2026-03-16
WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
