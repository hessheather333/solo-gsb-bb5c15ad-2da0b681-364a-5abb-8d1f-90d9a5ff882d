# 走台排程 · 小剧场提示点调度 Web 应用

录入每个**提示点（Cue）**的时长、最早开始时间、前置提示点和最晚完成时间，系统按依赖
关系自动计算每项的**最早开始 / 最早结束时间**；修改任一项后立即重新排程。发现**环依赖**
时指出涉及的提示点与环路，并自动标出**超过最晚完成时间**的项目。提供按开始时间排序的
**走台单**和专用**打印视图**（可直接打印或另存为 PDF）。

技术栈：Node.js + Express + SQLite（better-sqlite3）+ 原生 HTML/CSS/JavaScript（无前端构建）。

---

## 一条命令启动

```bash
docker compose up -d --build
```

容器启动时会自动执行 `npm install` 安装依赖，并在首次启动时初始化数据库、建表
（空库时写入 5 条示例提示点，可用环境变量关闭，见下）。

启动后打开：

- 排程页面（录入 / 编辑 / 重排）：<http://localhost:3000>
- 走台单 / 打印视图：<http://localhost:3000/print>

停止：`docker compose down`（数据保留在命名卷 `cue-data` 中；加 `-v` 可同时删除数据）。

> 本机 3000 端口被占用时：`PORT=8080 docker compose up -d --build`，
> 然后访问 <http://localhost:8080>。

## 不用 Docker 的本地启动

需要 Node.js 20+：

```bash
npm install
npm start
```

同样访问 <http://localhost:3000>。

---

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_PATH` | `data/app.db` | SQLite 数据库文件路径（容器内为 `/app/data/app.db`，已挂载命名卷） |
| `SEED_SAMPLE` | `true` | 首次启动且数据库为空时写入示例数据；设为 `false` 可得到空库 |

Compose 下修改示例数据开关：在 `docker-compose.yml` 的 environment 中改 `SEED_SAMPLE`，
或复制后自行调整。

---

## 使用说明

### 时间格式（所有时间均以开排零点 `00:00:00` 起算的相对时间）

- **时长**：纯数字按**分钟**（如 `10` = 10 分钟）；也支持 `MM:SS`（`1:30`）与 `H:MM:SS`（`1:02:30`）。
- **最早开始 / 最晚完成**：`HH:MM:SS`（如 `30:00` = 开排后 30 分钟）、`MM:SS` 或纯秒。
- 最早开始留空按 `00:00:00`；最晚完成留空表示不限。

### 排程规则

- 一项提示点的最早开始时间 = max(自己录入的最早开始时间, 所有前置提示点的最早结束时间)。
- 最早结束时间 = 最早开始时间 + 时长。
- 表格始终按**计算出的最早开始时间**升序排列，即走台执行顺序；“浮动”为最晚完成 − 最早结束
  （负值显示为超时）。
- 修改任意提示点（时长 / 最早开始 / 前置 / 最晚完成）后，保存即对所有项目重新排程。
- **环依赖**：环上项目标红并显示徽标“⚠ 环依赖”，页面顶部红色横幅列出涉及的全部提示点及
  一条具体环路（如 `Q2 → Q3 → Q2`）；依赖链上被环卡住的项目标记为“环阻塞”，二者在解除
  环前不参与排程。
- **超时**：最早结束时间晚于最晚完成时间时，整行高亮、结束时间标红并显示“⚠ 超过最晚完成”。

### 打印视图

<http://localhost:3000/print> 提供干净的 A4 走台单（含日期 / 场地 / 舞台监督签名栏与逐项
状态栏），点击“🖨 打印 / 另存为 PDF”即可。环依赖与超时标记会保留在打印结果中。

---

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/cues` | 提示点列表（原始录入） |
| `GET` | `/api/cues/:id` | 单个提示点 |
| `GET` | `/api/schedule` | 完整排程结果（含计算时间、超时 / 环标记与环路） |
| `POST` | `/api/cues` | 新增提示点 |
| `PUT` | `/api/cues/:id` | 修改提示点（前置列表全量替换，保存后自动重排） |
| `DELETE` | `/api/cues/:id` | 删除提示点（相关依赖一并删除） |

新增 / 修改请求体示例：

```json
{
  "ref": "Q6",
  "title": "第二场灯光转换",
  "duration": "5:30",
  "minStart": "30:00",
  "maxFinish": "55:00",
  "prerequisites": [2, 5]
}
```

`duration` 也可传整数秒；`minStart` / `maxFinish` 同样接受整数秒。

## 项目结构

```
.
├── Dockerfile
├── docker-compose.yml
├── docker-entrypoint.sh   # 启动时 npm install 并启动服务
├── package.json
├── src
│   ├── server.js          # Express 路由与参数校验
│   ├── db.js              # SQLite 建表、CRUD、事务、示例数据
│   ├── scheduler.js       # 拓扑排程、Tarjan 环检测、超时判定
│   └── timeutil.js        # 时间解析与格式化
└── public
    ├── index.html         # 排程主页面
    ├── print.html         # 走台单打印视图
    ├── css/style.css
    └── js/{common,app,print}.js
```
