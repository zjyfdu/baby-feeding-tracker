# 🥜 吃奶了吗

一个专为新手爸妈设计的宝宝喂养记录小工具，手机优先，打开即记。

线上地址：**https://ae9cadde40ca58b74.app.workbuddy.link**

## 功能

- **吃奶打卡** — 选择喂养类型（母乳 / 奶粉 / 自定义）、几分钟前、毫升数；支持直接指定时间补录
- **母乳时长** — 母乳记录可填持续时间，编辑时有「吃完了」快捷键，自动算出吃了几分钟
- **尿不湿打卡** — 记录每次换尿不湿，状态可选（💩多 / 💩少 / 无💩，可自定义）
- **统计面板** — 距离上次多久、今天已吃几顿、平均间隔（只算今天）、昨日同期，全部按开始时间计算
- **历史记录** — 按日期分组的标签页，默认今天；支持编辑、删除每条记录
- **选项可自定义** — 喂养类型、毫升预设、尿不湿状态都能增删，保存后永久生效
- **导出备份** — 一键导出全部记录为 CSV（Excel 可直接打开）
- **秒开体验** — 首屏使用本地缓存渲染，后台静默刷新；历史记录按天按需加载，数据再多也不变慢

## 技术栈

| 端 | 技术 |
|----|------|
| 前端 | React 19 + Vite 7 + Tailwind CSS v4 |
| 后端 | Express 4 + TypeScript + Zod |
| 数据库 | PostgreSQL |

## 本地运行

```bash
# 1. 准备数据库（任意 PostgreSQL 16+）
createdb baby_tracker

# 2. 后端
cd backend
cp .env.example .env        # 修改 DATABASE_URL 指向你的数据库
pnpm install
pnpm dev                    # 开发模式，监听 :3000

# 3. 前端（另开终端）
cd frontend
pnpm install
pnpm dev                    # 开发模式，监听 :5173，/api 自动代理到 :3000
```

生产部署：`pnpm build` 后，后端会直接托管 `frontend/dist`，单端口即可对外服务：

```bash
cd backend && pnpm build && cd ../frontend && pnpm build
cd backend && PORT=3000 node dist/index.js
```

## 数据说明

- 所有记录存在你自己的 PostgreSQL 里，应用本身不上传任何数据到第三方
- 数据库表结构（`events`、`feed_options`）在服务启动时自动创建和迁移，无需手动执行 SQL
- 建议定期使用应用内「导出备份」功能保存一份 CSV

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bootstrap` | 首屏数据：选项 + 近期记录 + 每日计数 |
| GET | `/api/events` | 记录列表，支持 `?kind=`、`?day=YYYY-MM-DD`（按天取数） |
| POST | `/api/events` | 新增记录 |
| PATCH | `/api/events/:id` | 编辑记录 |
| DELETE | `/api/events/:id` | 删除记录 |
| GET/PUT | `/api/options` | 读取 / 保存可自定义选项 |
| GET | `/api/export` | 导出全部记录 CSV |

## License

MIT
