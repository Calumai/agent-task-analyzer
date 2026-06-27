FROM node:20-alpine

WORKDIR /app

# 安裝 better-sqlite3 需要的 build tools
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# 建立資料目錄
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
