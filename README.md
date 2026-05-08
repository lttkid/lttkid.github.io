# HTML Vault Reader

一个私人 HTML 阅读管理站点：前端部署到 GitHub Pages，登录、数据库、私密 HTML Storage 和 AI 代理接口由 Supabase 承担。前端不会保存 service role key 或 AI API key。

## 功能

- Supabase Auth 邮箱密码登录，无注册入口
- 私密 HTML 文件库、分类、搜索、收藏、按导入/修改时间排序
- 同步时提取私密全文索引，资料库可搜索 HTML 正文并只显示命中片段
- 沙盒 iframe 阅读 HTML，默认移除原始脚本并支持选中文字
- 阅读页浮动功能面板：AI 解释、摘要、高亮、模型和虚拟人物选择
- AI 配置中心：脱敏展示模型配置、真实轻量健康检查、调用统计和失败诊断
- 笔记中心：跨文档查看、筛选、编辑和删除高亮笔记，并跳回来源文档
- 资料归档与恢复，不做危险硬删除
- 部署中心：检查 Demo Mode、Supabase、登录、Storage、Edge Functions 状态
- 阅读统计：时长、最近阅读、分类分布、未读数量、AI 调用次数
- GitHub Actions 同步 `html/` 文件到 Supabase Storage，支持 dry-run 和同步摘要
- GitHub Pages 自动部署静态前端

## 本地开发

```bash
npm install
cp .env.example .env.local
npm run dev
```

如果还没有配置 Supabase，可以临时把 `.env.local` 中的 `VITE_DEMO_MODE` 改成 `true` 预览界面。生产环境不要启用 Demo Mode。

## Supabase 设置

1. 创建 Supabase 项目。
2. 在 Auth 设置中关闭公开注册，只保留手动创建用户。
3. 在 SQL Editor 运行 `supabase/migrations/001_initial_schema.sql`。
4. 手动创建你的登录用户，并复制该用户的 UUID，作为同步脚本的 `SUPABASE_OWNER_USER_ID`。

也可以在填好真实 Supabase 变量后直接运行：

```bash
npm run supabase:live:init
```

该命令会对真实项目执行初始化/验证：应用 SQL migration，确认 Auth 用户 UUID，检查 RLS 和 Storage policy，创建临时用户做越权读写拦截测试，并验证 `html-docs` 私有上传/下载。
5. 部署 Edge Functions：

```bash
supabase functions deploy ai-profiles
supabase functions deploy ai-health
supabase functions deploy ai-explain
supabase functions deploy ai-summarize
```

6. 设置 Edge Function Secrets：

```bash
supabase secrets set AI_PROVIDER=openai-compatible
supabase secrets set AI_PROFILE_LABEL="Default Model"
supabase secrets set AI_MODEL="your-model-name"
supabase secrets set AI_BASE_URL="https://api.openai.com/v1"
supabase secrets set AI_API_KEY="your-provider-api-key"
```

多个模型可以用 `AI_PROFILES_JSON` 配置，前端只会看到服务端允许的模型信息，不会看到 API key。

推荐手动把 AI key 配置为 Supabase Edge Function Secrets，不要写进前端环境变量或数据库。部署后可以在“部署中心”的 AI 配置中心点击“测试 AI 连接”，它会通过 `ai-health` 对每个启用模型发起一次极短真实调用，并把成功或失败写入 `ai_requests`。

也可以在公开前端仓库中配置后端部署 workflow 所需的 GitHub Secrets：

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`（仅在 workflow 中勾选 apply migrations 时使用）

然后手动运行 `.github/workflows/deploy-supabase.yml`，选择是否执行 migration 和 Edge Functions 部署。

## GitHub Pages 部署

在前端公开仓库中添加 GitHub Secrets：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

然后启用 GitHub Pages，使用 `.github/workflows/deploy-pages.yml` 部署 `dist`。

更完整的上线清单见 `docs/DEPLOYMENT.md`。

## HTML 自动同步

真实 HTML 内容建议放在单独的私有内容仓库。可以用模板生成：

```bash
npm run prepare:content-repo -- ../html-vault-content
```

生成后把 `../html-vault-content` 初始化为私有 GitHub 仓库，HTML 文件放在 `html/` 目录。

私有内容仓库需要配置 Secrets：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_OWNER_USER_ID`

同步脚本会：

- 递归扫描 `html/**/*.html`
- 按第一级文件夹创建分类
- 提取 `<title>`、hash、修改时间、阅读预计时间和纯文本索引
- 上传文件到私密 bucket `html-docs`
- upsert `documents`
- 默认把同步源中消失的文件标记为 archived
- 支持 dry-run：`npm run sync:html -- --dry-run`
- 在 GitHub Actions 中写入同步摘要：scanned、indexed、uploaded、unchanged、archived、failed

全文索引会写入 `documents.content_text`，默认最多保留每个 HTML 的前 200,000 字符，并记录 `word_count` 与 `indexed_at`。这些字段受 Supabase RLS 保护，只对登录用户可见；前端搜索结果只展示短命中片段，不展示整篇正文。

当前仓库的 `.gitignore` 会忽略 `html/**/*.html`，避免把私人 HTML 意外推到公开 Pages 仓库。

## 验证

```bash
npm run preflight
npm run verify:deployment
npm run prepare:content-repo -- ../html-vault-content --force
npm run build
npm run test:smoke
npm run test:live
npm run sync:html -- --dry-run
```

`preflight` 在缺少真实密钥时会报告失败项，这是正常的上线前提醒。`test:smoke` 会在 Demo Mode 下自动检查桌面和移动端主流程。

`test:live` 会强制关闭 Demo Mode，并用真实 Supabase 数据验证登录、文件库、`html-docs` Storage 下载和阅读页 iframe 渲染。运行前在 `.env.local` 或 shell 中设置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`LIVE_TEST_EMAIL`、`LIVE_TEST_PASSWORD`；如果未设置 `LIVE_TEST_*`，脚本会退回使用 `SUPABASE_OWNER_EMAIL` 和 `SUPABASE_OWNER_PASSWORD`。
