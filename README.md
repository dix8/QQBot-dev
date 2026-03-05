# QQBot Web Manager

QQ 机器人 Web 管理面板 — 通过反向 WebSocket 连接 [NapCat](https://github.com/NapNeko/NapCatQQ)，提供可视化配置、消息管理与插件扩展能力。

## 功能特性

- **反向 WebSocket 通信** — 作为 WebSocket 服务端接收 NapCat 连接，遵循 [OneBot V11](https://github.com/botuniverse/onebot-11) 协议
- **多 Bot 管理** — 支持同时管理多个 QQ Bot 实例，独立配置
- **Web 管理面板** — 响应式设计，支持 PC 与移动端访问
- **数据面板** — 消息收发统计、24 小时趋势图、活跃群组/用户 Top5
- **插件系统** — ZIP 格式热安装，支持生命周期钩子、权限控制、配置 UI 自动渲染、托管定时器自动清理
- **权限体系** — 三级权限（超级管理员 > 主人 > 所有人），QQ 指令权限精细控制
- **消息过滤** — 用户黑名单、群组黑白名单、在线时段限制、消息频率限制
- **自动审批** — 好友请求自动同意、入群邀请自动同意（系统级配置）
- **日志系统** — 连接日志、运行日志、插件日志，支持筛选搜索与自动刷新
- **登录鉴权** — 账号密码 + JWT 认证
- **Docker 部署** — 单容器一键部署，前端构建产物由后端静态托管

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Shadcn-vue + Tailwind CSS + Pinia |
| 后端 | Node.js + TypeScript + Fastify + ws |
| 数据库 | SQLite (better-sqlite3 + Drizzle ORM) |
| 部署 | Docker |

## 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 10

### 开发模式

```bash
# 克隆仓库
git clone https://github.com/dix8/QQBot-dev.git
cd QQBot-dev

# 安装依赖
cd server && pnpm install && cd ..
cd web && pnpm install && cd ..

# 启动后端（默认监听 3000 端口）
cd server
pnpm dev

# 启动前端（另一个终端，默认监听 5173 端口）
cd web
pnpm dev
```

首次启动后端时会自动创建 SQLite 数据库并运行迁移，同时安装预装示例插件。

### 生产部署（Docker）

推荐使用 Docker Compose 一键部署：

```bash
# 下载 docker-compose.yml
wget https://raw.githubusercontent.com/dix8/QQBot-dev/master/docker-compose.yml

# 启动
docker compose up -d

# 查看日志
docker logs -f qqbot

# 更新到最新版
docker compose pull && docker compose up -d
```

默认端口说明：

| 端口 | 用途 | 说明 |
|------|------|------|
| `3000` | Web 管理面板 | 必选 |
| `6199` | NapCat 反向 WebSocket | 可按需修改，需与 Web 面板中配置的 WS 端口一致 |

如需修改端口，编辑 `docker-compose.yml` 中的 `ports` 映射即可。

<details>
<summary>其他部署方式</summary>

**Docker Run：**

```bash
docker run -d --name qqbot -p 3000:3000 -p 6199:6199 -v qqbot-data:/app/data --restart always ghcr.io/dix8/qqbot-dev:latest
```

**从源码构建：**

```bash
git clone https://github.com/dix8/QQBot-dev.git
cd QQBot-dev
docker build -t qqbot-web .
docker run -d --name qqbot -p 3000:3000 -p 6199:6199 -v qqbot-data:/app/data --restart always qqbot-web
```

</details>

部署后访问 `http://your-server:3000` 即可使用 Web 管理面板。

### 连接 NapCat

1. 在 NapCat 配置中设置反向 WebSocket 地址为 `ws://your-server:3000/ws`
2. 配置 access token（如需要）
3. NapCat 启动后会自动连接，Web 面板中即可看到 Bot 上线

## 项目结构

```
QQBot/
├── server/                # 后端
│   ├── src/
│   │   ├── index.ts       # 入口
│   │   ├── ws/            # WebSocket 服务端
│   │   ├── routes/        # REST API 路由
│   │   ├── services/      # 业务逻辑层
│   │   ├── plugins/       # 插件管理
│   │   ├── db/            # 数据库 Schema 与迁移
│   │   └── types/         # 类型定义
│   └── package.json
├── web/                   # 前端
│   ├── src/
│   │   ├── views/         # 页面组件
│   │   ├── components/    # 通用组件
│   │   ├── stores/        # Pinia 状态管理
│   │   ├── router/        # 路由
│   │   ├── api/           # API 调用封装
│   │   └── types/         # 类型定义
│   └── package.json
├── docs/                  # 文档
│   └── plugin-development.md  # 插件开发指南
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 内置 QQ 指令

| 指令 | 说明 | 权限 |
|------|------|------|
| `/帮助` `/help` | 显示可用指令列表 | 所有人 |
| `/状态` `/status` | 查看系统运行状态 | 所有人 |
| `/关于` `/about` | 查看当前 Bot 信息 | 所有人 |
| `/昵称 [新昵称]` | 查看/设置 Bot 昵称 | 主人 |
| `/主人列表` | 列出所有主人 QQ | 主人 |
| `/超管列表` | 列出所有超级管理员 QQ | 超级管理员 |
| `/添加主人 <QQ号>` | 添加主人 | 超级管理员 |
| `/删除主人 <QQ号>` | 删除主人 | 超级管理员 |
| `/插件列表` | 查看已安装插件 | 超级管理员 |
| `/启用插件 <序号或ID>` | 启用插件 | 超级管理员 |
| `/禁用插件 <序号或ID>` | 禁用插件 | 超级管理员 |

### 预装示例插件指令

系统自带示例插件（首次启动自动安装，默认禁用），启用后提供 34 个指令，覆盖 OneBot V11 主要功能：

| 分类 | 指令示例 | 说明 |
|------|---------|------|
| 基础 | `/ping` `/echo` `/info` `/time` `/赞我` `/签到` | 在线检测、复读、Bot 信息、点赞、每日签到 |
| 查询 | `/查群员` `/查用户` `/群荣誉` `/群文件` `/群列表` `/好友列表` | 群成员/用户/荣誉/文件/好友信息查询 |
| 群管理 | `/禁言` `/解禁` `/踢` `/全员禁言` `/群名片` `/群公告` `/撤回` | 群管理操作（仅主人，需开启功能开关） |
| 功能管理 | `/菜单` `/功能列表` `/开启` `/关闭` | 动态菜单、14 个功能开关（支持序号切换） |

此外还包括：防撤回（消息缓存机制）、进群欢迎、退群通知、戳一戳回应、复读检测、定时消息等通知事件处理。

详见 [示例插件文档](server/src/plugins/preinstalled/example-plugin/README.md)。

## 插件开发

插件以 ZIP 包形式安装，包含 `manifest.json` 和入口 JS 文件。支持：

- 生命周期钩子（onLoad / onUnload / onMessage / onNotice / onRequest）
- PluginContext API（sendMessage / callApi / getConfig / setConfig / getBotConfig / logger / dataDir）
- 托管定时器（ctx.setTimeout / ctx.setInterval），卸载时系统自动清除
- manifest.json 声明指令与配置 Schema，Web 面板自动渲染配置表单
- 异常隔离，插件崩溃不影响核心系统

详见 [插件开发指南](docs/plugin-development.md)。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `JWT_SECRET` | JWT 密钥（生产环境建议设置） | 自动生成并持久化 |
| `NODE_ENV` | 运行环境 | `development` |

## License

AGPL-3.0
