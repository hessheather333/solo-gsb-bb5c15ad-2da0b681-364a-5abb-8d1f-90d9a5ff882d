FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用镜像层缓存；sql.js 为纯 JS/WASM，无需原生编译）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 再拷贝源码
COPY server.js scheduler.js db.js ./
COPY public ./public

ENV PORT=3000
# 数据库文件位置（可用卷挂载持久化）
ENV DB_PATH=/app/data/scheduler.db

EXPOSE 3000

# 启动时自动初始化数据库（CREATE TABLE IF NOT EXISTS）
CMD ["node", "server.js"]
