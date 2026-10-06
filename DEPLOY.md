# 部署指南

两种方式任选其一，都是「数据库 + 应用」两件套。

---

## 方式一：Docker 自部署（推荐有自己的服务器时用）

适合：腾讯云 / 阿里云轻量服务器、家里 NAS、任何能装 Docker 的机器。

```bash
git clone https://github.com/zjyfdu/baby-feeding-tracker.git
cd baby-feeding-tracker
docker compose up -d --build
```

完成后访问 `http://服务器IP:3000` 即可。数据存在 compose 创建的 `dbdata` 卷里，容器重启不丢。

加 HTTPS（可选）：装 Caddy，配置文件两行即可：

```
你的域名.com {
    reverse_proxy localhost:3000
}
```

---

## 方式二：Render + Neon（没有服务器，全程免费）

1. **建数据库**：打开 [neon.tech](https://neon.tech)，注册后新建项目，复制连接串（形如 `postgresql://user:pass@xxx.neon.tech/neondb?sslmode=require`）
2. **部署应用**：打开这个一键部署链接：

   **https://render.com/deploy?repo=https://github.com/zjyfdu/baby-feeding-tracker**

   页面会让你登录 GitHub 并确认，把上一步的连接串粘贴到 `DATABASE_URL` 输入框，点创建
3. 等几分钟构建完成，得到一个 `https://xxx.onrender.com` 的地址

注意：Render 免费档会在闲置 15 分钟后休眠，下次打开要等 30~60 秒唤醒；数据库和代码都在你自己的账号里。

---

## 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `PORT` | 否 | 监听端口，默认 3000 |
| `API_PREFIX` | 否 | 接口前缀，默认 /api |
| `CORS_ORIGIN` | 否 | 跨域来源，默认 * |

数据库表结构在应用启动时自动创建，无需手动执行 SQL。

## 备份

- Docker 方式：`docker exec <db容器> pg_dump -U postgres baby_tracker > backup.sql`
- 任何方式：应用内「选项设置 → 导出备份」随时导出 CSV
