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
npm run build:pages    # 写入 docs/（不覆盖 schedule.json）
npm run build:phone    # 单文件 HTML + OTA；phone/ 不带全量课表
npm run build:apk      # Capacitor debug APK
npm run check:schedule # 检查日程 JSON
```

改完界面：`npm run build:phone` 与 `npm run build:pages`，推 `main`。不要把构建产物盖掉 `docs/schedule.json`。

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
