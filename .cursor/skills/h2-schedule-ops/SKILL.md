---
name: h2-schedule-ops
description: >-
  H2 Schedule 发布、OTA、git 与校园网踩坑。改界面/同步、点「更新」打不上、手机仍是旧包、
  git push 重置、误盖 docs/schedule.json、或迁校服务器时使用。
---

# H2 Schedule 操作经验

仓库：`D:\AI_Tools\Cursor\Cursor_Project\h2-schedule`。网页 GitHub Pages；Android 是 Capacitor 套 **打进 APK 的本地包**（`webDir: phone`）。壳内点「更新」拉 OTA。配了校服务器后，**即时日程与 OTA 以校内为准**；GitHub 是每次改动的备份。CLab 会用数年，换机只改根地址，不要写死主机名。

详细案例见 [failures.md](failures.md)。

## 手机没变，先当发布问题

不要先改 CSS 猜「真机看不见」。顺序：

1. 同仓库有没有别的会话在抢 `App.tsx` / `docs/`（`SearchConversations`）
2. 是否 **构建 + 推送** 了 `docs/ota/` 与网页产物
3. 手机是否在 **校园网**（常打不开 `github.io` / `api.github.com`）
4. 壳改动（`AndroidManifest`、`capacitor.config.ts`）只能 **重装 APK**；JS/CSS 走 OTA

电脑网页默认可走 GitHub Pages。手机 APK 顶栏 **明确选 CLab 或 GitHub**，不自动跳源。任一入口读写成功后尽量把同一份日程推到另一边。未点头不要代建云主机。

## 发布清单

改完界面要上线：

```text
npm run build:phone    # phone/ + docs/ota/manifest.json + docs/ota/app.html
npm run build:pages    # 写入 docs/，保留 schedule.json
# 再 commit/push main（含 docs/ota，不含被构建误改的 schedule.json）
```

- **禁止** `vite build --outDir docs --emptyOutDir`：会冲掉或弄脏 `docs/schedule.json`、课表图。只用 `scripts/publish-docs.mjs`。
- 构建后立刻 `git diff --stat docs/schedule.json docs/refs/`；有意外 diff 就 `git checkout --` 还原。
- `phone/` 在 `.gitignore`，不要当发布物提交。要提交的是 `docs/`（网页 + OTA）。
- 推完核对：远端 `docs/ota/manifest.json` 的 `builtAt` 比手机「当前安装包」新；校园网用 raw / 校服务器，不要只打开 github.io 宣布成功。

## OTA 不变量

- 本机版本 **只认已装配的 OTA**（`h2.ota.applied-built-at` / bundle），不要对壳时间、页面 meta、缓存取 `max`。取 max 会导致「再查一次」跳回 APK 打包点。
- `PLACEHOLDER`、`本机打包` 视为比任何远端旧。
- 含 `update-scrim` 的 HTML 是坏包，丢掉。不要用壳时间戳清掉已装更新。
- 拉包：有校地址先校内 manifest，没有或连不上再 GitHub（raw / Pages / API）。HTML 校验 sha256。
- 口令解开的 Token 只进该设备 `localStorage`，不进 Git。不要读/复述 PAT。

## Git（校园网易失败）

- `git push` / `git pull --rebase` 被 connection reset：先代理 `127.0.0.1:7890`，再不行用 **GitHub MCP / Contents API** 推文件。不要假设命令成功。
- 有未提交 WIP 才 rebase：stash **不要包含** 用户日程 `docs/schedule.json`（除非用户要你改数据）。
- 禁止 force push `main`。禁止把 Token、`unlock` 明文、未点名的 `schedule.json` 推进去。
- 本仓代码修复验证后可按个人规则 `git-fix-autopush` 推；**数据文件仍要用户点名**。
- 推完看 `git status`、远端 SHA、必要时 Actions；中断过的 rebase 先看 `AUTO_MERGE` / stash 还在不在。

## 日程数据

- 云端课表只来自 CLab 或 GitHub `docs/schedule.json`。无网只用 localStorage 本机缓存。禁止把 APK / `public/schedule.json` 当 remote 再 merge（会把已删化安等加回来）。`pullCloud` 不得 fetch 包内 JSON；CLab/GitHub/raw/Pages 都失败时返回 `null` 或抛错。手机构建须删掉 `phone/schedule.json`（或写成空 `{"items":[]}`），勿动 `docs/schedule.json` 业务条目。无口令也要尝试 raw（优先）再 Pages。
- **不要用条数多少当新旧**：旧 Pages 条数多会把已删条目救活。
- 推送：本机空、或不到云端快照一半，拒绝覆盖。
- 用户点「改」/删除就是最终结果。禁止按「化安第几周」「像不像原课表」自动改回。
- 条目身份：`date + id`（再加标题防历史脏数据）。同一天两条共用一个 id，删改会弹回来。
- `npm run check:schedule` 只查能解析、id 不撞，不改业务。

## App 交互（已踩过）

- 编辑中：停轮询、推迟推送、不要把云端结果写回正在编的框；弹层用 portal + `visualViewport`。
- 手机 CSV：分享或「复制全部」；导入选所有文件或粘贴。不要假设 WebView 能下载文件。
- 图片 JPG/PNG；HEIC 直接拒绝。布局用 `100%` + safe-area inset，不要 `100vw` 把右边顶出屏幕。
