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
npm run build:pages    # 写入 docs/，并把 public/schedule.json 同步到 docs/
npm run build:phone    # 单文件 HTML + OTA；phone/ 不带全量课表
npm run build:apk      # Capacitor debug APK
npm run check:schedule # 检查日程 JSON，并断言 public/ 与 docs/ 一致
```

改完界面：`npm run build:phone` 与 `npm run build:pages`，推 `main`。不要把构建产物盖掉 `docs/schedule.json`。

**日程数据的不变量（改数据前必读）。** `docs/schedule.json` 是 App 的**唯一**读写路径（Pages 站点根 + Contents API 路径），**不要**改这个路径；`public/schedule.json` 是**唯一**编辑源。`npm run build:pages` 每次无条件把 `public/schedule.json` 逐字节同步到 `docs/schedule.json`，`npm run check:schedule` 断言两者 `items` 逐条一致。所以**改数据只改 `public/`**，然后跑 `npm run build:pages` 同步到 `docs/`，不要再手动维护两份。

### 界面布局与叠层（改 UI 前必读）

详情与踩坑见 `.cursor/rules/h2-ui-layout.mdc` 指向的本文档小节。改 `src/**/*.css` / `src/**/*.tsx` 前先读个人 skill `app-dev-ui` 与 `h2ops`。

**谁是滚动容器。** 当日清单的滚动容器是 `.day-panel .sheet-scroll.list`；月历是 `.calendar-panel .sheet-scroll`。只有它们带 `overflow-y: auto`。外层 `.app` / `.layout` / `.panel` 一律 `overflow: hidden`，只负责分配高度，**不要**再给它们开滚动轴（否则出现嵌套滚动，手指滑动会被里层吃掉）。

**叠层结构与排除区。** 当日面板是三行 grid：

| 行 | 元素 | 定位 | 说明 |
| --- | --- | --- | --- |
| `auto` | `.day-chrome` | 流内，`z-index: 4` | 日期头 + 时间轴。**在流内占位**，不是浮层，所以不需要给列表留排除区 |
| `minmax(0,1fr)` | `.sheet-scroll.list` | 流内，`z-index: 0` | 唯一滚动轴 |
| `auto` | `.day-footer` | 流内，`z-index: 4` | 撤销条 + 「新事项」 |

三行都在文档流里，靠 grid 分配高度——**没有 `position: fixed/sticky` 的叠层压在列表上**，所以列表不需要 `padding-bottom` 之类的排除区。给 `z-index` 是为了在圆角裁剪（`overflow: clip` + `isolation: isolate`）下保证边缘不被内容穿出，**不是**用来遮丑的。

`.toast` / `.app-dock` 在 `.layout` 之外的 `.app` 列方向流里，同样不覆盖列表。

**布局契约（必须遵守）。**

1. **列表项不得被压缩。** `.list` 是列方向 flex，其直接子项默认 `flex-shrink: 1`；事项卡又带 `overflow: hidden`，会让 `min-height: auto` 解析成 `0`。结果整列被压进容器高度、内容被裁掉，而且 `scrollHeight === clientHeight`，滚动条根本不出现。因此 `.day-panel .sheet-scroll.list > *` 固定 `flex-shrink: 0`。**新增列表类容器时同样要显式设 `flex-shrink: 0`**（或给子项 `min-height: max-content`），别依赖默认值。
2. **出现/消失的提示条不得改变内容流高度。** `.day-footer` 固定为「单行两列」`grid-template-columns: minmax(0, 1fr) auto`：左列弹性放 `.undo-bar`（超长省略号截断），右列按内容宽放 `.composer-open`。撤销条出现/消失时 footer 高度、滚动容器高度、主按钮宽度都必须**不变**。不要用 `auto` 当第一列（长撤销文案会把主按钮压成窄缝），也不要用 `:has()` 切换列模板（两态跳变）。
3. 要在 footer 里加第三个动作时，**先把列模板想清楚**，不要靠 `position: absolute` 堆在同一点。

**手机壳 vs 网页。** 两套壳共用同一份 CSS，靠 `html[data-shell]` 分流：`main.tsx` 与 `index.html` 的内联脚本用 `isNativeApp()`（Capacitor `isNativeAppPlatform()`）把 `data-shell` 设成 `native` 或 `web`。约定：

- `html[data-shell='web']` → 一律双栏完整 UI，`!important` 强制显示 `.desk-tabs`、隐藏 `.mobile-tabs`。**电脑浏览器（Pages / CLab）不要套窄屏规则。**
- `@media (max-width: 860px)` + `html[data-shell='native']` → 单栏、`.mobile-tabs`、收窄内边距、`position: fixed` 锁视口。
- 尺寸一律 `100%` + `env(safe-area-inset-*)`，**不用 `100vw`**（滚动条会把右侧顶出屏）。

加分支时沿用这个机制，**不要**为「CLab 页 / GitHub 页」或「某个源」另抄一套 CSS。

**改 UI 后的自检清单。**

- [ ] 手机视口 `390x844` 与更矮的 `360x640` 都看过；当日清单能滚到底，最后一项完整可见（不被 footer 永久遮住）。
- [ ] 新建/删除触发撤销条，**逐条对比**出现前后：滚动容器 `getBoundingClientRect().height`、主按钮宽度、列表项高度都不变。
- [ ] `document.elementFromPoint()` 在列表项中心命中的是该项自身（不是 chrome / footer / toast）。
- [ ] 桌面视口 `1280x800`（`data-shell='web'`）双栏未退化。
- [ ] 手动确认 `.sheet-scroll` 的 `scrollHeight > clientHeight`（相等 = 内容被压扁，滚动条不会出现）。
- [ ] `npm run check:schedule` 与 `npm run lint` 通过（lint 既有 warning 属正常，不要新增 error）。

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
