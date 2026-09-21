# 已发生过的失败（对照用）

## OTA / 真机仍是旧界面

| 当时以为 | 实际 |
| --- | --- |
| CSS 对比度不够、时间轴没渲染 | App 在拉 `github.io`，校园网失败，WebView 吃旧缓存。后来改成 APK 本地包 + OTA。 |
| 已经 push 了源码 | 没跑 `build:phone`，或没把 `docs/ota/` 推进 `main`。 |
| 点更新显示已是最新 | `localBuiltAt` 对壳/页面/缓存取了 max，一直等于 APK 打包点；或 `PLACEHOLDER` 没当成旧。 |
| 装了新 APK 日程没了 / 已删课又回来 | 曾把包内 `schedule.json` 当云端 merge。现已禁止：无网只用 localStorage；课表只来自 CLab 或 GitHub `docs/schedule.json`。 |
| 卸掉重装就能好 | 壳配置才需要重装；JS 应走 OTA。乱重装还会丢掉未同步的本机改动。 |

相关对话：[时间轴与 OTA](75bca2ec-7436-43a4-bee1-cc2104d31481)、[日程修复发布](e595cfc7-21a1-45f3-b43d-9628c1ed1b23)。

## 构建把数据盖掉

`npx vite build --outDir docs --emptyOutDir false` 仍可能改到 `docs/schedule.json`、`docs/refs/timetable.jpg`。处理：构建后 diff，意外则 `git checkout --`；日常用 `npm run build:pages`（`publish-docs.mjs` 白名单拷贝，保留 `schedule.json`）。

## Git 连接重置

校园网 `git pull --rebase` / `git push` 会被重置。WIP 用过 stash（曾把 `docs/schedule.json` 一并 stash，危险）。后来靠 GitHub API 把提交打上，Pages 才绿。

对策：Clash 系统代理 `127.0.0.1:7890`；失败改 MCP `create_or_update_file` / 脚本 PUT contents；推完用 `list_commits` 对 SHA。家里网 GitHub 一般可直连。

## 同步吞数据 / 条目复活

- 用「条数更多」选 Pages vs raw：已删除的课从旧 Pages 回来。
- 轮询在编辑时把云端套进输入框。
- 同一 `id` 两天或两条事项（如 9-16「1220上机」与「化安」）：删一条另一条用同一 id 回来。
- 空缓存或半量本机冲掉全量云端 → 现有「一半条数」拒绝推送。

## 网络文案

浏览器 `Failed to fetch` 在校园网极常见，对用户说「连不上（可开系统代理）」，不要只报英文 TypeError。

拉取顺序（顶栏选 CLab 则只校内）：口令 → Contents API；否则 raw 与 Pages 并行（采用 raw）。都失败则 `null`/抛错，继续用本机缓存，**不要**读包内 JSON。

## 不要和别的项目搅在一起

计概作业匣不是这套运行环境。日程：Pages + Capacitor；校内 CLab 跑 `campus_sync_server.py`，GitHub 是第二源。
