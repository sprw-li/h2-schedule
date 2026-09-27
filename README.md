# H2 Schedule

个人日程：Vite + React 网页，GitHub Pages 托管；Android 用 Capacitor 套同一套页面，壳内可 OTA 拉新包，不必每次重装 APK。

**网页：** https://sprw-li.github.io/h2-schedule/

电脑网页默认仍走 GitHub Pages（https://sprw-li.github.io/h2-schedule/）。手机 APK 打进两个源：校园网优先 CLab，连不上再走 GitHub。换 CLab 只改根地址，不要写死主机名。

## 日常使用

- 左边月历、右边当日清单。绿 / 灰 / 红点表示假日、事项、截止；某颜色当天全部勾完才不亮点。
- 点「改」或删除就是最终结果。应用**不会**按「化安第几周」「像不像原课表」自动改回或删掉你的调整。
- 手机：资料页点开课表/校历可放大；更换图片要口令，请用 JPG/PNG（不要 HEIC）。
- **CSV / ICS**：顶栏「其他功能」。ICS 给系统日历；CSV 给表格互拷。手机导出走系统分享或复制文本。
  - 表头：`date,kind,title,done,start,end,allDay,id`。也认中文表头和旧的 `time` 列。示例：[`docs/sample.csv`](docs/sample.csv)。

## 同步

首次在某台设备上**改**日程：底部口令框填同一句口令（解开写令牌，存在该设备，不进 Git）。

- **顶栏选 CLab**：读写校内。成功后尽量再写入 GitHub `docs/schedule.json`。
- **顶栏选 GitHub**：读写仓库（API / raw / Pages）。成功后尽量再写入 CLab。电脑 github.io 默认这一路。

课表只来自 CLab 或 GitHub `docs/schedule.json`。无网只用本机 localStorage，**不会**读 APK / `public/schedule.json` 当云端（那会把已删条目加回来）。

推送前若本机条数不到云端快照的一半，会拒绝覆盖。

App 点「更新」：有校地址只拉校内 OTA；否则 raw → Pages →（有口令）API。

## 开发

```bash
npm install
npm run dev
```

```bash
npm run build          # 网页
npm run build:pages    # 写入 docs/，并把 docs/schedule.json 单向同步到 public/
npm run build:phone    # 单文件 HTML + OTA；校内可达时自动同步 CLab /ota
npm run build:apk      # Capacitor debug APK
npm run check:schedule # 检查日程 JSON，并断言 docs/ 与 public/ 一致
```

改完界面：`npm run build:phone` 与 `npm run build:pages`，推 `main`。校外构建后回校再跑 `npm run push:ota:campus`。不要把构建产物盖掉 `docs/schedule.json`。

**日程数据的不变量（改数据前必读）。** `docs/schedule.json` 是 App 的**唯一**读写路径（Pages 站点根 + Contents API 路径），也是**唯一权威**，**不要**改这个路径。`public/schedule.json` 是**派生镜像**（给 vite 的 publicDir / 本地预览用），**不是**编辑源。`npm run build:pages` 每次由 `docs/` **单向**同步到 `public/`，`npm run check:schedule` 断言两者 `items` 逐条一致。所以**改数据只改 `docs/`**，然后跑 `npm run build:pages` 更新 `public/` 镜像；**不要**手改 `public/`（会被下次构建覆盖，且不是权威）。

### 界面布局与叠层（改 UI 前必读）

详情见 `.cursor/rules/h2-ui-layout.mdc`。改 `src/**/*.css` / `src/**/*.tsx` 前先读个人 skill `app-dev-ui` 与 `h2ops`。

**滚动模型（回退基准：`dedbfbc`）。** 当日面板随内容长高，由**文档外层**滚动；`.day-panel .sheet-scroll.list` 不再是定高滚动口。月历 / 天气 / 资料若内容过长，同样走外层滚（或各自面板自然长高）。**禁止**再把 `html`/`body`/`#root`/`.app` 锁成 `100dvh` + `overflow: hidden`（或窄屏 `position: fixed`），再给 `.day-panel` 上 `minmax(0,1fr)` 列 flex 压子项——那条路径会把事项卡压扁且无法滑动。坏了就回这一模型，不要再发明块级流 / `flex-shrink` 第三套补丁。

**当日结构（文档流）。** `.day-chrome`（日期头）→ 清单 → `.day-footer`（撤销 + 「新事项」）。footer 始终挂载；列模板固定 `minmax(0,1fr) auto`。列表 React `key` 只跟日期 / 编辑锁走。

**手机壳 vs 网页。** 共用一份 CSS，靠 `html[data-shell]`：`web` 双栏完整 UI；窄屏 `native` 单栏 + `.mobile-tabs`，**不再**锁死视口。尺寸用 `100%` + `safe-area-inset`，不用 `100vw`。

**改 UI 后自检：** 窄屏 `360x640` / `390x844` 事项正常高度且页面可滚到底；撤销条出现前后主按钮宽度与项高不跳；桌面 `1280x800` 双栏未退化；`npm run lint` 无新增 error。

## 校服务器（CLab，即时真相源）

「其他功能」填根地址（存在本机）。换机只改这个 URL。

```bash
export H2_USER='…'
export H2_PASS='…'          # 只放虚拟机环境变量，不进 Git
python scripts/campus_sync_server.py --data-dir ~/h2-data --port 8765
# 拷 docs/ota/* 与 docs/schedule.json 到 data-dir
npm run test:campus         # 本机探活，不碰真实 CLab
```

协议：`GET /` 日程页；`GET /health` 公开；`GET/PUT /schedule.json` 要 Basic 或 Bearer；OTA GET 公开。If-Match 防冲突。未点头不要代建云主机。APK 用 `.env.phone` 的 `VITE_CAMPUS_ORIGIN`。
