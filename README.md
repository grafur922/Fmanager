# FileHub Console

FileHub Console 是一个面向个人服务器和小团队内网的私有文件管理控制台，基于 **Vue 3 + TypeScript + Element Plus + NestJS + TypeORM + PostgreSQL** 构建。

项目已经从简单文件上传工具演进为具备可靠传输、文件管理、预览、回收站、内容去重和受控公开分享能力的控制台。界面采用接近阿里云控制台的高信息密度布局，后续阶段将继续建设多用户、RBAC、持久化审计和存储适配层。

- 重构路线：[TODO.md](./TODO.md)
- 架构与失败模型：[ARCHITECTURE.md](./ARCHITECTURE.md)

## 当前能力

### 可靠上传

- 固定 5 MiB 分片上传；
- 实时进度、上传速度和任务总进度；
- 队列、并发数、自动开始和分片重试设置；
- 暂停、继续、取消、失败重试和断点续传；
- 上传会话持久化到磁盘，后端重启后仍可恢复；
- 网络中断后只补传缺失分片；
- 文件名、空文件、超限、重名和分片缺失等边界校验。

### 文件管理

- 服务端分页、关键字搜索、名称/大小/时间/类型排序；
- 文件下载、重命名、移动和软删除；
- 批量移动、批量删除和逐项执行结果；
- 图片、文本、PDF、音频和视频预览；
- PDF、音频和视频 Range 请求；
- 持久化回收站、恢复、永久删除和清空；
- 仪表盘容量、文件数、目录数、分享数和最近文件统计。

### 内容哈希与秒传

- 浏览器对小文件计算标准 SHA-256；
- 服务端在分片合并时重新计算 SHA-256；
- 持久化内容索引和重复文件检测；
- 命中后尝试 `COPYFILE_FICLONE` 写时复制，不支持时自动退回服务端普通复制；
- 索引源大小或修改时间变化后自动失效并退回普通上传。

### 公开分享

- 有效期、访问密码、启用/停用和下载次数上限；
- bcrypt 密码哈希；
- 独立公开分享页 `/share/:id`；
- POST 验证密码后签发短时、单次下载票据；
- PostgreSQL 行锁保证并发请求不会突破下载配额；
- 下载计数和访问日志在同一事务提交；
- API 使用专用 DTO，不返回分享密码哈希或关联用户凭证。

### 安全与可观测性

- JWT 全局认证守卫，公开接口显式标记；
- 文件系统根目录约束和符号链接限制；
- 统一异常响应和 `X-Request-Id`；
- 单行 JSON 请求日志；
- URL 中的下载 `token` 在日志和异常响应中自动脱敏；
- JWT 密钥、管理员凭证和数据库凭证环境变量化。

## 本次重构变更

### 前端变更

- 使用 Vue Router、Pinia 和领域 API/type 分层替换页面内散落状态；
- 新增阿里云控制台风格应用外壳、仪表盘、文件管理、回收站、分享和传输设置页面；
- 新增上传任务中心和真实 XHR 上传进度；
- 新增图片缩放、文本、PDF、音视频预览抽屉；
- 新增公开分享访问页和密码输入流程；
- 新增响应式布局、键盘焦点和 reduced-motion 支持；
- 修复中文编码和错误信息乱码。

### 后端变更

- NestJS 文件模块承担路径校验、文件列表、预览、回收站和上传会话编排；
- 上传会话由内存状态改为 `UPLOAD_TEMP_DIR` 下的持久化 manifest 和分片文件；
- 完成文件时采用临时文件写入、同步和重命名，最终文件不会提前暴露；
- 新增 SHA-256 内容索引及文件移动、重命名、删除、恢复时的索引维护；
- 预览 JWT 改为短时不透明能力令牌，JWT 不再进入媒体 URL；
- 分享实体改用安全 DTO，新增密码、配额、状态和一次性下载票据；
- 新增统一异常过滤器、请求日志拦截器和敏感查询参数脱敏；
- 新增 TypeORM migration 数据源和可回滚 migration。

### 数据库变更

| Migration                          | 作用                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `InitialSchema1783958400000`       | 幂等创建 `users`、`shares`、`share_logs`、索引和外键                                                                         |
| `ShareAccessControls1784044800000` | 为分享增加 `passwordHash`、`isEnabled`、`maxDownloads`、`downloadCount`，增加约束/索引，并根据历史 `share_logs` 回填下载次数 |

### 升级影响

- 生产数据库必须运行 TypeORM migration，不能依赖 `synchronize`；
- 新增持久化路径 `TRASH_DIR` 和 `CONTENT_INDEX_PATH`，备份策略需要覆盖它们；
- 新复制的分享链接改为前端路由 `/share/<id>`，Nginx 必须配置 SPA fallback；
- 旧的无密码 `/api/shares/download/:id` 直链继续可用；受密码保护的旧直链会跳转到公开分享页；
- 升级前已有文件不会自动进入内容索引，需要后续索引重建任务；
- 前端哈希阈值是 Vite 构建时变量，修改后必须重新构建前端；
- 分享下载票据、密码失败计数和预览令牌目前保存在单个后端进程内，多实例部署需要粘性路由或 Redis。

## 技术栈

| 层   | 技术                                                       |
| ---- | ---------------------------------------------------------- |
| Web  | Vue 3、TypeScript、Vite 8、Vue Router、Pinia、Element Plus |
| API  | NestJS 11、Express、JWT、Multer                            |
| 数据 | PostgreSQL、TypeORM、TypeORM migration                     |
| 文件 | Node.js `fs`、本地磁盘、SHA-256 内容索引                   |
| 测试 | Jest、ts-jest、vue-tsc、ESLint、Prettier                   |

## 目录结构

```text
fileUpload/
  backend/
    src/auth/                   # 登录、JWT 与全局守卫
    src/common/                 # 异常、日志和通用工具
    src/database/migrations/    # TypeORM migration
    src/file/                   # 文件、上传、预览和回收站
    src/share/                  # 分享、密码、配额和下载日志
    src/user/                   # 用户实体与服务
    .env.example
  frontend/
    src/api/                    # 领域 API
    src/components/             # 通用、文件和上传组件
    src/layouts/                # 控制台应用壳
    src/router/                 # 管理端与公开分享路由
    src/stores/                 # 上传任务等跨页面状态
    src/types/                  # 领域类型
    src/views/                  # 页面
    .env.example
  data/
    upload_sessions/            # 默认上传临时目录
    trash/                      # 默认回收站目录
    content-index.json          # 默认内容索引
  public_files/                 # 默认文件存储根目录
  README.md
  ARCHITECTURE.md
  TODO.md
```

## 运行要求

- Node.js `^20.19.0` 或 `>=22.12.0`；
- npm 10 或更高版本；
- PostgreSQL 14 或更高版本；
- 足够的文件存储、上传临时目录和回收站磁盘空间；
- 生产环境建议使用 Nginx/Caddy 等反向代理并启用 HTTPS。

> Vite 8 不支持较老的 Node.js 18。可以使用 `node --version` 和 `npm --version` 检查当前版本。

## 本地开发

### 1. 创建 PostgreSQL 数据库

以下 SQL 仅为示例，请替换密码：

```sql
CREATE ROLE filehub LOGIN PASSWORD 'replace-with-a-strong-db-password';
CREATE DATABASE filehub OWNER filehub ENCODING 'UTF8';
```

Migration 会执行 `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`。如果数据库账号没有创建扩展的权限，需要由 PostgreSQL 管理员提前安装该扩展。

### 2. 配置后端

从 `backend/.env.example` 创建 `backend/.env`。

PowerShell：

```powershell
Copy-Item backend/.env.example backend/.env
```

Linux/macOS：

```bash
cp backend/.env.example backend/.env
```

最小开发配置示例：

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USER=filehub
DB_PASS=replace-with-a-strong-db-password
DB_NAME=filehub
DB_SSL=false
DB_SYNC=true

JWT_SECRET=development-only-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password

FILE_STORAGE_DIR=../public_files
UPLOAD_TEMP_DIR=../data/upload_sessions
TRASH_DIR=../data/trash
CONTENT_INDEX_PATH=../data/content-index.json
```

开发环境有两种数据库策略，只选择一种：

1. 快速开发：`NODE_ENV=development`、`DB_SYNC=true`，TypeORM 根据实体自动同步表结构。
2. 对齐生产：`DB_SYNC=false`，启动后端前先执行 `npm run migration:run`。

不要在生产环境使用 `DB_SYNC=true`。代码在 `NODE_ENV=production` 时也会强制关闭 `synchronize`。

### 3. 安装并启动后端

```powershell
cd backend
npm install
npm run start:dev
```

后端默认监听 `http://localhost:3000`。启动时会：

1. 连接 PostgreSQL；
2. 创建并检查存储、上传临时、回收站和内容索引父目录；
3. 清理过期上传会话；
4. 在用户不存在时创建初始管理员。

### 4. 配置并启动前端

可选：从 `frontend/.env.example` 创建 `frontend/.env`。

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

前端默认监听 `http://localhost:5173`。开发服务器会把 `/api` 代理到 `http://localhost:3000`。

### 5. 登录

使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。

注意：

- 开发环境没有配置 `ADMIN_PASSWORD` 时会使用默认密码 `123456` 创建管理员，只能用于本地开发；
- 生产环境没有配置 `ADMIN_PASSWORD` 时不会创建管理员；
- `ADMIN_PASSWORD` 仅在用户不存在时用于首次创建，修改环境变量不会重置已经存在用户的密码。

## 后端配置参考

后端通过 `backend/.env` 读取配置。相对路径按后端进程的当前工作目录解析，因此推荐从 `backend/` 启动，生产环境则推荐使用绝对路径。

### 数据库

| 变量      | 示例/默认值      | 说明                                    | 生产建议                                                             |
| --------- | ---------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `DB_HOST` | `localhost`      | PostgreSQL 主机                         | 使用数据库私网地址                                                   |
| `DB_PORT` | `5432`           | PostgreSQL 端口                         | 按实例配置                                                           |
| `DB_USER` | `postgres`       | 数据库用户                              | 使用项目专用、最小权限账号                                           |
| `DB_PASS` | 无安全默认值     | 数据库密码；代码缺失时回退为 `postgres` | 必须显式设置强密码                                                   |
| `DB_NAME` | `fManage`        | 数据库名称                              | 建议使用独立数据库，例如 `filehub`                                   |
| `DB_SSL`  | `false`          | `true` 时启用 PostgreSQL TLS            | 当前实现为 `rejectUnauthorized: false`，不应通过不可信网络连接数据库 |
| `DB_SYNC` | 开发环境默认开启 | 非生产环境是否由 TypeORM 自动同步实体   | 生产必须为 `false` 并使用 migration                                  |

### 运行时与认证

| 变量               | 示例/默认值          | 说明                                                           | 生产建议                                    |
| ------------------ | -------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `NODE_ENV`         | `development`        | 运行模式；`production` 会关闭数据库自动同步并隐藏 500 错误细节 | 生产必须设为 `production`                   |
| `PORT`             | `3000`               | 后端监听端口，监听地址为 `0.0.0.0`                             | 仅向本机或可信内网开放，由反向代理访问      |
| `JWT_SECRET`       | 开发环境有临时回退值 | JWT 签名密钥；令牌有效期当前固定为 7 天                        | 至少 32 字节随机值；生产缺失时拒绝启动      |
| `ADMIN_USERNAME`   | `admin`              | 首次启动时创建的管理员用户名                                   | 使用非默认用户名                            |
| `ADMIN_PASSWORD`   | 开发默认 `123456`    | 仅在管理员不存在时用于创建账号                                 | 使用强密码；生产缺失时不创建账号            |
| `TRUST_PROXY_HOPS` | `0`                  | Express 信任的反向代理跳数，允许 `request.ip` 使用可信转发头   | 单层 Nginx 设为 `1`；后端直接暴露时保持 `0` |

生成 JWT 密钥示例：

```bash
openssl rand -hex 32
```

### 公开分享

| 变量                               |   默认值 | 单位 | 说明                                      |
| ---------------------------------- | -------: | ---- | ----------------------------------------- |
| `SHARE_DOWNLOAD_TOKEN_TTL_MS`      | `120000` | 毫秒 | 一次性下载票据有效期，默认 2 分钟         |
| `SHARE_MAX_PENDING_DOWNLOADS`      |  `10000` | 个   | 单进程内最多保留的待消费下载票据          |
| `SHARE_PASSWORD_MAX_ATTEMPTS`      |      `5` | 次   | 同一“分享 + IP”在窗口内允许的密码失败次数 |
| `SHARE_PASSWORD_ATTEMPT_WINDOW_MS` | `900000` | 毫秒 | 密码失败统计窗口，默认 15 分钟            |

这些状态目前保存在后端进程内存中。修改配置后需要重启后端。多实例部署时必须使用粘性路由，或把下载票据和失败计数迁移到 Redis。

### 文件与上传

| 变量                    | 默认值                       | 单位     | 说明                                                                |
| ----------------------- | ---------------------------- | -------- | ------------------------------------------------------------------- |
| `FILE_STORAGE_DIR`      | `../public_files`            | 路径     | 文件存储根目录，所有虚拟路径都约束在此目录下                        |
| `UPLOAD_TEMP_DIR`       | `../data/upload_sessions`    | 路径     | 上传会话 manifest 和临时分片目录                                    |
| `TRASH_DIR`             | `../data/trash`              | 路径     | 回收站内容和 `manifest.json` 目录；不能位于 `FILE_STORAGE_DIR` 内部 |
| `CONTENT_INDEX_PATH`    | `../data/content-index.json` | 文件路径 | SHA-256 内容索引；父目录会自动创建                                  |
| `MAX_UPLOAD_BYTES`      | `5368709120`                 | 字节     | 单个文件逻辑大小上限，默认 5 GiB                                    |
| `UPLOAD_SESSION_TTL_MS` | `86400000`                   | 毫秒     | 上传会话保留时间，默认 24 小时                                      |
| `PREVIEW_TOKEN_TTL_MS`  | `900000`                     | 毫秒     | 预览能力令牌有效期，默认 15 分钟                                    |
| `STORAGE_LIMIT_BYTES`   | `107374182400`               | 字节     | 仪表盘容量基准，默认 100 GiB；当前不执行硬配额拦截                  |

路径配置要求：

- 生产环境优先使用绝对路径；
- 运行后端的系统用户必须拥有读写权限；
- `TRASH_DIR` 必须位于 `FILE_STORAGE_DIR` 外部，否则后端拒绝启动；
- `CONTENT_INDEX_PATH` 不应放在 Web 静态目录中；
- 文件存储、回收站和内容索引应位于持久化磁盘；
- 上传临时目录需要容纳所有进行中的分片会话。

## 前端配置参考

前端只读取以 `VITE_` 开头的变量。该变量会在开发服务器启动或生产构建时注入，不是后端运行时配置。

| 变量                         |     默认值 | 单位 | 说明                                                         |
| ---------------------------- | ---------: | ---- | ------------------------------------------------------------ |
| `VITE_CLIENT_HASH_MAX_BYTES` | `67108864` | 字节 | 浏览器直接读入内存并计算 SHA-256 的最大文件大小，默认 64 MiB |

行为说明：

- 小于等于阈值的文件使用 Web Crypto 计算 SHA-256；
- 大文件不会整体读入浏览器内存；首次普通上传完成后会缓存服务端返回的哈希；
- 计算失败不会阻断上传，而是退回普通分片上传；
- 设置为 `0` 会停止对非空文件执行新的浏览器哈希；
- 修改后必须重启 Vite 开发服务器或重新执行 `npm run build`。

开发环境 API 代理当前固定为 `http://localhost:3000`，配置位于 `frontend/vite.config.ts`。生产环境应由同域反向代理转发 `/api`，无需在浏览器中配置后端绝对地址。

## 数据库同步与 Migration

### 开发环境

`NODE_ENV` 不是 `production` 且 `DB_SYNC` 不是字符串 `false` 时，TypeORM 会开启 `synchronize`。这适合快速开发，但不会形成可审计的升级历史。

需要模拟生产升级流程时：

```env
NODE_ENV=development
DB_SYNC=false
```

然后执行：

```powershell
cd backend
npm run migration:show
npm run migration:run
```

### 生产环境

生产配置必须包含：

```env
NODE_ENV=production
DB_SYNC=false
```

即使错误地把 `DB_SYNC` 设置为 `true`，当前代码在 `NODE_ENV=production` 时也不会启用 `synchronize`。

部署新版本的推荐步骤：

1. 停止写入或进入维护窗口；
2. 备份 PostgreSQL、文件存储、回收站和内容索引；
3. 部署新代码并执行 `npm install` 或 `npm ci`；
4. 检查 `backend/.env` 指向正确数据库；
5. 执行 `npm run migration:show`；
6. 执行 `npm run migration:run`；
7. 构建并重启后端；
8. 验证登录、文件列表、上传、回收站和公开分享。

命令：

```powershell
cd backend
npm run migration:show
npm run migration:run
```

回滚最近一次 migration：

```powershell
npm run migration:revert
```

`migration:revert` 可能删除新字段和数据，只应在已有数据库备份并理解回滚 SQL 的情况下执行。

### 从旧数据库升级

两个 migration 都采用幂等建表/加字段逻辑，可以接管之前由 `synchronize` 创建的基础表。`ShareAccessControls` 会：

1. 增加分享密码、启停、上限和计数字段；
2. 从已有 `share_logs` 按分享聚合并回填 `downloadCount`；
3. 增加下载上限和非负计数约束；
4. 增加分享可用性索引。

Migration 不会移动实际文件，也不会为历史文件建立 SHA-256 内容索引。

## 生产部署

以下示例假设：

- 应用目录：`/opt/filehub`；
- 运行用户：`filehub`；
- 持久化目录：`/srv/filehub`；
- 后端端口：`3000`；
- Nginx 与后端位于同一台服务器。

### 1. 创建 Linux 服务用户

systemd 示例使用独立的 `filehub` 系统用户运行后端。该用户禁止交互登录，也不需要创建 Home 目录：

```bash
sudo useradd \
  --system \
  --user-group \
  --home-dir /opt/filehub \
  --no-create-home \
  --shell /usr/sbin/nologin \
  filehub

id filehub
```

如果 `id filehub` 已经能够返回用户信息，则不需要重复执行 `useradd`。

这里的 `filehub` 是 **Linux 系统服务用户**，用于限制后端进程的文件权限；PostgreSQL 中的 `filehub` 是 **数据库角色**，需要单独创建。两者可以同名，但互不关联。

应用代码可以继续由 `root` 或部署账号持有，只需要确保服务用户能够读取后端构建产物：

```bash
sudo chown -R root:filehub /opt/filehub
sudo chmod -R g+rX /opt/filehub
```

### 2. 创建持久化目录

```bash
sudo install -d -m 0750 -o filehub -g filehub /srv/filehub/files
sudo install -d -m 0750 -o filehub -g filehub /srv/filehub/upload_sessions
sudo install -d -m 0750 -o filehub -g filehub /srv/filehub/trash
sudo install -d -m 0750 -o filehub -g filehub /srv/filehub/data
```

### 3. 生产环境变量

`/opt/filehub/backend/.env` 示例：

```env
NODE_ENV=production
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=filehub
DB_PASS=replace-with-a-strong-db-password
DB_NAME=filehub
DB_SSL=false
DB_SYNC=false

JWT_SECRET=replace-with-at-least-32-random-bytes
ADMIN_USERNAME=filehub-admin
ADMIN_PASSWORD=replace-with-a-strong-initial-password
TRUST_PROXY_HOPS=1

SHARE_DOWNLOAD_TOKEN_TTL_MS=120000
SHARE_MAX_PENDING_DOWNLOADS=10000
SHARE_PASSWORD_MAX_ATTEMPTS=5
SHARE_PASSWORD_ATTEMPT_WINDOW_MS=900000

FILE_STORAGE_DIR=/srv/filehub/files
UPLOAD_TEMP_DIR=/srv/filehub/upload_sessions
TRASH_DIR=/srv/filehub/trash
CONTENT_INDEX_PATH=/srv/filehub/data/content-index.json
MAX_UPLOAD_BYTES=5368709120
UPLOAD_SESSION_TTL_MS=86400000
PREVIEW_TOKEN_TTL_MS=900000
STORAGE_LIMIT_BYTES=107374182400
```

限制该文件权限：

```bash
sudo chown filehub:filehub /opt/filehub/backend/.env
sudo chmod 600 /opt/filehub/backend/.env
```

不要把 `.env`、数据库备份、内容索引或用户文件提交到代码仓库或放入前端静态目录。

### 4. 安装、迁移和构建

```bash
cd /opt/filehub/backend
npm ci
npm run migration:show
npm run migration:run
npm run build

cd /opt/filehub/frontend
npm ci
npm run build
```

前端构建产物位于 `frontend/dist`，后端构建产物位于 `backend/dist`。

### 5. systemd 示例

`/etc/systemd/system/filehub.service`：

```ini
[Unit]
Description=FileHub Console API
After=network.target postgresql.service

[Service]
Type=simple
User=filehub
Group=filehub
WorkingDirectory=/opt/filehub/backend
ExecStart=/usr/bin/node /opt/filehub/backend/dist/main.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now filehub
sudo systemctl status filehub
```

应用会在 `WorkingDirectory` 中读取 `backend/.env`。

### 6. Nginx 示例

```nginx
server {
    listen 80;
    server_name files.example.com;

    root /opt/filehub/frontend/dist;
    index index.html;

    # 主上传协议每片 5 MiB，8 MiB 为 multipart 留出余量。
    client_max_body_size 8m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

生产环境还应配置 HTTPS。前后端使用同一域名时不需要额外 CORS 配置。

配置说明：

- `client_max_body_size` 限制的是单个 HTTP 请求，不是整个文件；分片为 5 MiB；
- `try_files` 是 `/share/:id` 等 Vue history 路由直接访问不返回 404 的必要配置；
- 不要删除 `Range` 请求头，否则 PDF、音视频拖动定位会失效；
- `TRUST_PROXY_HOPS=1` 只适用于后端前方恰好一层可信代理；
- 后端端口不应同时直接暴露到公网，否则客户端可绕过 Nginx 和代理信任边界。

## 关键运行机制

### 断点续传

浏览器不会允许网页在刷新后自动重新读取本地文件：

- 短暂断网或手动暂停后，可直接继续或重试；
- 页面刷新后需要重新选择同一文件；
- 系统根据用户、目标路径、文件名、大小和修改时间恢复服务端会话；
- 只上传服务端缺失的分片；
- 超过 `UPLOAD_SESSION_TTL_MS` 的会话和分片会被清理。

浏览器 `localStorage` 只保存指纹、`uploadId`、传输设置和内容哈希缓存，不保存文件内容。

### SHA-256 与秒传

浏览器哈希是上传初始化优化，服务端在普通上传完成时仍会重新计算 SHA-256。内容索引记录哈希、大小、虚拟路径和 `mtimeMs`。

秒传命中前会验证：

1. 哈希存在；
2. 文件大小一致；
3. 索引路径仍是普通文件；
4. 修改时间与索引一致。

“秒传”表示不再从浏览器发送文件内容。底层文件系统不支持 reflink 时会执行普通服务器磁盘复制，因此不保证零额外磁盘占用。

### 文件预览

- 登录用户先申请短时不透明预览令牌；
- JWT 不进入媒体 URL；
- PDF、音频和视频支持 Range；
- Range 请求会滑动刷新预览令牌有效期；
- HTML 作为纯文本预览，不执行其中脚本；
- 未知格式只提供下载。

### 回收站

软删除会把对象移动到 `TRASH_DIR/<uuid>/payload`，并在同级写入 `manifest.json`。恢复时会重建父目录，原路径已存在同名对象时自动增加 `(1)`、`(2)` 后缀。

永久删除和清空回收站不可恢复。备份必须同时覆盖文件目录和回收站。

### 公开分享

公开分享下载流程：

```text
访问 /share/:id
  -> 获取不含内部路径的公开元数据
  -> POST 提交可选密码
  -> 获取短时、单次下载票据
  -> GET 使用票据进行原生流式下载
  -> 数据库行锁检查状态/有效期/配额
  -> 同一事务增加下载计数并写访问日志
```

下载计数表示服务端接受并开始处理的下载。客户端在响应开始后断开连接不会退还次数。

### 请求追踪

每个请求都会返回：

```text
X-Request-Id: <uuid>
```

异常响应也包含相同 `requestId`。日志记录方法、脱敏路径、状态码、耗时、IP 和 User-Agent。下载票据对应的 `token` 查询参数会显示为 `redacted`。

## 验证与质量检查

后端：

```powershell
cd backend
npm run format
npm test -- --runInBand
npm run build
npx eslint "{src,test}/**/*.ts"
```

前端：

```powershell
cd frontend
npm run build
```

当前测试覆盖文件路径安全、上传恢复和完成、内容索引与秒传、失效索引、预览、回收站、分享 DTO 隔离、一次性票据、下载配额事务和请求 URL 脱敏。

## 备份与恢复

### 必须备份

- PostgreSQL 数据库；
- `FILE_STORAGE_DIR`；
- `TRASH_DIR`；
- `CONTENT_INDEX_PATH`。

### 可选备份

- `UPLOAD_TEMP_DIR`：需要保留进行中的断点续传任务时备份；
- Nginx、systemd 和 `.env`：应进入受控的加密配置备份，不应进入公开代码仓库。

PostgreSQL 示例：

```bash
pg_dump -Fc -h 127.0.0.1 -U filehub -d filehub -f filehub-$(date +%F).dump
```

文件示例：

```bash
tar -czf filehub-files-$(date +%F).tar.gz \
  /srv/filehub/files \
  /srv/filehub/trash \
  /srv/filehub/data/content-index.json
```

恢复时应保持数据库、文件目录和回收站来自同一备份时间点。内容索引丢失不会删除实际文件，但现阶段没有历史文件索引重建命令，秒传命中率会下降。

## 常见问题

### 后端反复提示数据库连接失败

检查 PostgreSQL 是否运行，以及 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASS`、`DB_NAME` 和防火墙。后端默认重试 5 次，每次间隔 2 秒。

### 生产环境没有创建管理员

确认首次启动前设置了 `ADMIN_PASSWORD`。生产环境缺失时不会创建默认管理员。若同名用户已经存在，修改环境变量不会重置其密码。

### 上传返回 HTTP 413

提高 Nginx `client_max_body_size`。主分片为 5 MiB，建议至少设置 8 MiB。`MAX_UPLOAD_BYTES` 控制整个文件逻辑大小，二者不是同一个限制。

### 后端提示 `TRASH_DIR` 不能位于 `FILE_STORAGE_DIR` 内部

把回收站配置到文件存储根目录之外，例如 `/srv/filehub/trash`。

### 文件或内容索引写入失败

检查后端运行用户对 `FILE_STORAGE_DIR`、`UPLOAD_TEMP_DIR`、`TRASH_DIR` 和 `CONTENT_INDEX_PATH` 父目录的权限与剩余磁盘空间。

### 直接打开 `/share/<id>` 返回 Nginx 404

为前端静态站点配置 `try_files $uri $uri/ /index.html`。

### 分享密码正确但下载票据无效

单实例部署先确认票据未超过 `SHARE_DOWNLOAD_TOKEN_TTL_MS`。多实例部署需要粘性路由或共享票据存储，否则授权和下载请求可能落到不同进程。

### 秒传没有命中

只有新完成的分片上传和从回收站恢复的文件会进入内容索引。旧文件、外部直接写入的文件、大小/修改时间发生变化的文件不会命中；此时会安全退回普通分片上传。

### PDF 或视频无法拖动进度

确认反向代理没有删除 `Range` 请求头，并允许后端返回 `206 Partial Content` 和 `Content-Range`。

## 已知限制

- 当前文件系统命名空间仍是全局可见，RBAC 尚未实现；
- 本地文件系统尚未抽象为 S3/OSS `StorageAdapter`；
- 内容索引是单进程 JSON 快照，不支持多个后端同时写入；
- 预览令牌、分享票据和密码失败次数保存在进程内存；
- 超大目录分页前仍需完整 `readdir`，尚未使用元数据索引或游标；
- `STORAGE_LIMIT_BYTES` 当前只用于仪表盘展示，不执行硬配额；
- 页面刷新后浏览器无法自动恢复本地 `File` 对象；
- 历史文件索引重建、病毒扫描、限速、健康检查、Docker Compose 和 CI/CD 尚未完成。

下一阶段见 [TODO.md](./TODO.md)：多用户、角色、目录级权限、持久化审计、登录会话和安全告警。
