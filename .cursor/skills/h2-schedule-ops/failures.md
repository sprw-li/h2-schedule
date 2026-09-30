# 对照案例（原则在个人 app-dev-* skill）

执行以 `h2ops` 与情况 skill 为准。下表只说明「曾经怎样错」，便于对照，不要复制成新的 `if`。

## 发布 / OTA（`app-dev-release`）

| 当时以为 | 实际 |
| --- | --- |
| CSS 对比度不够 | 校园网拉不到 `github.io`，WebView 旧缓存。后改为 APK 本地包 + OTA。 |
| 已经 push 源码 | 没 `build:phone` 或没推 `docs/ota/`。 |
| GitHub OTA 已是新包，手机「最新」仍是旧日 | CLab `/ota/manifest.json` 未同步；选 CLab 的旧壳/校园网只看得到 CLab。应用 `push:ota:campus` 回读校验。 |
| 点更新显示已是最新 | 本机时间对壳/页面/缓存取了 max；`PLACEHOLDER` 没当成旧。 |
| 更新面板 `builtAt` 已新，真机仍压扁重叠 | `applied`/`meta` 先于 HTML 写入；QuotaExceeded 后留下孤儿时间戳，boot 不 `document.write`，壳仍跑旧 APK。修：先写 HTML 再标 applied；无包清孤儿；不可靠时重装 APK。 |
| 点更新成功后「本机」时间仍停在旧值 | 读路径优先 `applied`（可与 bundle 漂移）；覆盖大包时 WebView 配额/静默截断未 roundtrip。修：`localBuiltAt` 只认 `bundle.builtAt` 并回写对齐；`saveBundle` 先释放旧包 + read-after-write + 失败整组回滚。 |
| 卸掉重装就能好 | 壳才要重装；乱重装丢掉未同步本机改动。 |
| 网页也天天「有更新」 | OTA 只该给原生壳；浏览器已是当前页。 |

## 构建盖数据（`app-dev-release`）

`vite --outDir docs` 动过 `docs/schedule.json`、课表图。日常 `build:pages` 白名单拷贝。

## Git 重置（`app-dev-network`）

校园网 rebase/push 被重置。stash 曾带上 `docs/schedule.json`。对策：代理或 Contents API；推完对 SHA。

## 同步吞数据（`app-dev-sync`）

- 条数更多 → 旧 Pages 救活已删课。
- 包内 `schedule.json` 当云端 merge → 已删化安回来。
- 轮询写进编辑框；同一 `id` 两条；半量本机覆盖全量云端。
- 冲突后把 merge 结果存成远端快照 → 下次再救活。
- 同一时段两条不同事项被当成重复删掉（不应）。

## 网络文案与双源（`app-dev-network`）

`Failed to fetch` 改成「连不上」。顶栏明确选 CLab 或 GitHub。`http://校内IP` 上 `importKey` 失败是非安全上下文。

## UI（`app-dev-ui`）

日期头滑动条穿模；双源页面布局分叉；底栏按钮互压。应统一布局 + 视口排除区，而不是只给一个源加补丁。

## 勾选弹回（`app-dev-sync`）

以为点不动 / checkbox 坏了；实际是 flush 清空队列后立刻拉未 fold 的同 rev 快照，把 `done` 盖回。修：absorb flushed ops 进本机 baseline，同/旧 rev 拉取忽略。

相关对话：[时间轴与 OTA](75bca2ec-7436-43a4-bee1-cc2104d31481)、[日程修复发布](e595cfc7-21a1-45f3-b43d-9628c1ed1b23)、[化安第六周回家](726d1b2b-9acb-4ce5-b952-b8426d61ab8e)。
