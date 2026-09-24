---
name: h2-schedule-ops
description: >-
  H2 Schedule 本仓命令与路径。改界面/同步/OTA/git/校服务器时先读个人 skill h2ops 与对应情况 skill，
  再用本文件跑构建。真机仍旧、误盖 schedule.json、校园网 push 失败时使用。
---

# H2 Schedule 本仓

经验原则在个人 skill **`h2ops`**（常更新、普适化）及 `app-dev-code` / `ui` / `network` / `release` / `sync`。这里只放**本仓命令与路径**。个例对照 [failures.md](failures.md)。

仓库：`D:\AI_Tools\Cursor\Cursor_Project\h2-schedule`。网页 GitHub Pages；Android Capacitor，`webDir: phone`；壳内「更新」走 OTA。即时日程与 OTA 以校内为准（用户选了 CLab 时）；GitHub 备份。换机只改根地址。

## 上线

```text
npm run build:phone    # phone/ + docs/ota/manifest.json + docs/ota/app.html
npm run build:pages    # 写入 docs/，并把 docs/schedule.json 单向同步到 public/
# commit/push main（含 docs/ota）
```

- 只用 `scripts/publish-docs.mjs`，禁止 `vite build --outDir docs --emptyOutDir`。
- 构建后立刻 `git diff --stat docs/schedule.json docs/refs/`。
- `phone/` gitignore，不提交。手机构建须去掉全量 `phone/schedule.json`。
- 壳改动才重装 APK；JS/CSS 走 OTA。网页/localhost 不要用 OTA 条当「有更新」。

## 数据与口令

- 课表只来自 CLab 或 GitHub `docs/schedule.json`。`pullCloud` 禁止 fetch 包内 JSON。
- `npm run check:schedule` 查能解析、id 不撞，并断言 `docs/`（权威）与 `public/`（派生）的 items 一致。
- 勿提交未点名的 `schedule.json`、Token、`unlock` 明文。stash 不要带用户日程。
- 校园网 git 重置：代理 `127.0.0.1:7890` 或 GitHub MCP。
- **不变量**：`docs/schedule.json` 是 App 唯一读写路径（Pages 站点根 + Contents API），也是**唯一权威**；`public/schedule.json` 是**派生镜像**（vite publicDir / 本地预览），不是编辑源。`build:pages` 由 `docs/` **单向**同步到 `public/`（绝不反向），`check:schedule` 守门。改数据只改 `docs/` 再跑 `build:pages`，不要手改 `public/`。两份 blob 应始终相同（`git hash-object`）。
- **镜像只在「本机自己写成功后」发生**：`pullCloud` 的读路径绝不写另一端（会把 CDN 旧缓存写进 CLab）。GitHub 镜像只在已知 sha 与远端一致时才写，拿不到/不匹配就放弃，不重取 sha 硬盖。
- `campus_sync_server.py` 的 PUT 必须带 `If-Match`（缺失 428、不匹配 409，无 `sig:` 后门）；读 sha→比较→备份→原子写全在锁内。
- 本机 ref 可能滞后：判断远端真值用 `git ls-remote` 或 raw URL，不要只信 `origin/main`。
- **用户明确授权改写历史时**才可 `git push --force-with-lease=main:<刚 fetch 到的 sha> origin main`，先 fetch 再取 sha 再推，lease 失败就重 fetch 重试；禁止裸 `--force`。
- 未点头不代建云主机。CLab：`scripts/campus_sync_server.py`，环境变量不进 Git。

收工若学到新不变量：改 **个人情况 skill**，不要在此追加补丁段。
