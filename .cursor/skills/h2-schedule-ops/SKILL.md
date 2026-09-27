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

- **数据权威（P1 已落地）**：私有仓 [`sprw-li/h2-data`](https://github.com/sprw-li/h2-data) 的 `ops/**` 是日程改动的正本（append-only op 日志）。客户端 `commit()` 差分生成 op → 本地队列 → `flushOps()` PUT 到 `ops/<deviceId>/<YYYY-MM>.jsonl`。`snapshot/schedule.json` 由 `scripts/reduce.mjs`（GitHub Action）fold 产出。
- **公开面**：本仓 `docs/schedule.json` 是 reducer 物化快照（只读派生）；可选由 h2-data Action secret `H2_SCHEDULE_PUSH_TOKEN` 覆盖。`public/schedule.json` 仍可作种子。`check:schedule` 在本地有 `../h2-data/snapshot` 时断言 docs ≡ snapshot；不再要求 docs≡public 逐条一致。
- **禁止**：客户端整表 PUT `docs/schedule.json`（`pushCloud` 已拒绝）；禁止 25s 轮询拉云（改为启动 / visibilitychange / online / focus / 本地提交后）。
- **令牌**：fine-grained PAT 只授权 `h2-data` Contents；经 `unlock.json` 下发。勿把数据仓 PAT 授权到本代码仓。
- `npm run check:ops` 验 fold/diff/无轮询；`check:logic` 仍覆盖旧 merge 回归对照。
- 勿提交未点名的 Token、`unlock` 明文。stash 不要带用户日程。
- 校园网 git 重置：代理 `127.0.0.1:7890` + `http.sslBackend=schannel`，或 Contents API。
- 本机 ref 可能滞后：判断远端真值用 `git ls-remote` 或 API，不要只信 `origin/main`。
- 未点头不代建云主机。CLab 为可选副本，非正本。

收工若学到新不变量：改 **个人情况 skill**，不要在此追加补丁段。
