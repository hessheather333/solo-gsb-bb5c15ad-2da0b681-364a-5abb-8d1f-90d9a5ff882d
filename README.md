# 小剧场走台排程

录入演出提示点（Cue）的时长、最早开始时间、前置提示点与最晚完成时间，系统按依赖关系自动推算每项的最早开始 / 完成时间；修改任一项后自动重新排程，检出环依赖时指出涉及的提示点，并标出超过最晚完成时间的项目。提供按开始时间排序的走台单与打印视图。

技术栈：Node.js + Express + SQLite（sql.js，SQLite 官方源码的 WebAssembly 构建，生成标准 SQLite 数据库文件，无需原生编译）+ 原生 HTML/CSS/JS（无前端构建）。

## 启动（一条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:3000**

容器启动时会自动安装依赖并初始化 SQLite 数据库（`CREATE TABLE IF NOT EXISTS`），数据通过命名卷 `cue-data` 持久化。

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 容器 / 进程内 Web 服务端口 |
| `DB_PATH` | `/app/data/scheduler.db` | SQLite 数据库文件路径 |

- 改网页访问端口：编辑 `docker-compose.yml` 的 `ports`，如 `"8080:3000"` 后访问 http://localhost:8080。
- 本地运行（非 Docker）时可直接 `PORT=8080 npm start`。

## 本地开发（不用 Docker）

```bash
npm install
npm start          # 访问 http://localhost:3000
npm test           # 运行排程逻辑单元测试
```

## 使用说明

1. **新增提示点**：填写名称、时长（分钟）、最早开始时间、最晚完成时间（可空），并勾选前置提示点（须先完成的项）。
2. **自动排程**：每项的计算开始时间 = max（最早开始， 所有前置项的计算完成时间)；计算完成时间 = 开始 + 时长。任何新增 / 修改 / 删除都会触发整体重新排程。
3. **环依赖检测**：若前置关系构成环（如 A→B→C→A），页面顶部横幅会列出环上涉及的提示点，相关行标记为「环依赖」，其下游标记为「无法排程」。
4. **超时标记**：计算完成时间晚于最晚完成时间的项，在列表与走台单中以红色标出，并显示超出的分钟数。
5. **走台单**：按计算开始时间升序排列，含序号、开始 / 完成时间、时长、前置与备注。
6. **打印视图**：点击「打印视图」进入屏幕预览，点击「打印」输出仅含走台单的打印页面。
7. 「载入示例数据」可一键生成一组示例提示点，便于体验。

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 全部提示点 + 计算后的排程结果（含 `cycles` 环信息） |
| POST | `/api/cues` | 新增提示点 |
| PUT | `/api/cues/:id` | 修改提示点（前置列表整体替换） |
| DELETE | `/api/cues/:id` | 删除提示点（依赖关系级联清理） |

时间字段（`earliestStart` / `latestFinish` / `start` / `finish`）均为当天零点起的分钟数（0–2879，支持跨零点），时长单位为分钟。

## 项目结构

```
server.js          Express 服务 + 建表初始化 + REST API
scheduler.js       排程核心：拓扑排序 + CPM 正推 + Tarjan 环检测（纯函数）
db.js              SQLite 数据访问层（sql.js），写事务提交后自动落盘
public/            原生前端（index.html / styles.css / app.js）
test/              排程逻辑单元测试（node:test）
Dockerfile         单阶段镜像，启动即初始化数据库
docker-compose.yml 一键编排，含数据卷
```
