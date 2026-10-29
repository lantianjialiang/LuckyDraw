FROM node:22-slim

WORKDIR /app

# 先只拷贝清单，利用镜像层缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/server/data
EXPOSE 4000
VOLUME ["/app/server/data"]

# seed 是幂等的：已存在的账号/活动会跳过
CMD ["sh", "-c", "npm run seed && npm start"]
