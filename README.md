# H2 Schedule

个人日程：Vite + React 网页，GitHub Pages 托管；Android 用 Capacitor 套同一套页面，壳内可 OTA 拉新包，不必每次重装 APK。

**网页：** https://sprw-li.github.io/h2-schedule/

电脑网页默认仍走 GitHub Pages。配了校服务器后，**即时状态以校内为准**（即刻 OTA + 联网读写）；GitHub 只做每次改动的同步备份。换 CLab（预计 3～7 年）只改根地址，不要写死主机。

## 日常使用

- 左边月历、右边当日清单。绿 / 灰 / 红点表示假日、事项、截止；某颜色当天全部勾完才不亮点。
- 点「改」或删除就是最终结果。应用**不会**按「化安第几周」「像不像原课表」自动改回或删掉你的调整。
- 手机：资料页点开课表/校历可放大；更换图片要口令，请用 JPG/PNG（不要 HEIC）。
- **CSV / ICS**：顶栏「其他功能」。ICS 给系统日历；CSV 给表格互拷。手机导出走系统分享或复制文本。
  - 表头：`date,kind,title,done,start,end,allDay,id`。也认中文表头和旧的 `time` 列。示例：[`docs/sample.csv`](docs/sample.csv)。

## 同步

首次在某台设备上**改**日程：底部口令框填同一句口令（解开写令牌，存在该设备，不进 Git）。

- **未填校服务器**：读写 GitHub `docs/schedule.json`（API / raw / Pages）。
- **填了校服务器**：读写只走校内。GitHub 在写入成功后后台备份；校内读不到时**不会**改用 GitHub，以免旧备份盖掉即时状态。

推送前若本机条数不到云端快照的一半，会拒绝覆盖。

App 点「更新」：有校地址只拉校内 OTA；否则 raw → Pages →（有口令）API。

## 开发

```bash
npm install
npm run dev
```

```bash
npm run build          # 网页
npm run build:pages    # 写入 docs/（不覆盖 schedule.json）
npm run build:phone    # 单文件 HTML + OTA manifest
npm run build:apk      # Capacitor debug APK
npm run check:schedule # 检查日程 JSON
```

改完界面：`npm run build:phone` 与 `npm run build:pages`，推 `main`。不要把构建产物盖掉 `docs/schedule.json`。

## 校服务器（CLab，即时真相源）

「其他功能」填根地址（存在本机）。换机只改这个 URL。

```bash
export H2_WRITE_TOKEN='…'   # 与口令解开后的写令牌相同，或校内另发一枚
python scripts/campus_sync_server.py --data-dir ~/h2-data --port 8765
# 拷 docs/ota/* 与 docs/schedule.json 到 data-dir；或 PUT /ota/*、/schedule.json
npm run test:campus         # 本机探活，不碰真实 CLab
```

协议：`GET /health`；`GET/PUT /schedule.json`（PUT 要 Bearer，If-Match 防冲突）；`GET/PUT /ota/manifest.json`、`GET/PUT /ota/app.html`。未点头不要代建云主机。打 APK 可设 `VITE_CAMPUS_ORIGIN`。
