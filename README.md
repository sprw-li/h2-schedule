# H2 Schedule

个人日程：Vite + React 网页，GitHub Pages 托管；Android 用 Capacitor 套同一套页面，壳内可 OTA 拉新包，不必每次重装 APK。

**网页：** https://sprw-li.github.io/h2-schedule/

这不是 CLab / xlab 云主机上的服务。电脑和手机看的是仓库里的公开 `docs/schedule.json`（经 GitHub raw / Pages / Contents API 拉取）。

## 日常使用

- 左边月历、右边当日清单。绿 / 灰 / 红点表示假日、事项、截止；某颜色当天全部勾完才不亮点。
- 点「改」或删除就是最终结果。应用**不会**按「化安第几周」「像不像原课表」自动改回或删掉你的调整。
- 手机：资料页点开课表/校历可放大；更换图片要口令，请用 JPG/PNG（不要 HEIC）。
- **CSV（手机电脑互拷）**
  - 电脑：导出为文件；导入选 `.csv`。
  - 手机 WebView 往往不能真正「下载文件」。导出时会走系统分享，或弹出文本框「复制全部」。导入可用「导入文件」（不要只找 `.csv` 过滤器，选「所有文件」），或「粘贴导入」。
  - 表头：`date,kind,title,done,start,end,allDay,id`。也认中文表头和旧的 `time` 列。示例：[`docs/sample.csv`](docs/sample.csv)。

## 同步

首次在某台设备上**改**日程：底部口令框填同一句口令（解密出只含本仓库 Contents 权限的 GitHub Token，存在该设备，不进 Git）。之后改动会写回 `docs/schedule.json`。

拉取顺序：

1. 已有口令 → GitHub Contents API（带 sha，刚提交立刻能读）
2. 否则 **raw.githubusercontent.com** 与 **GitHub Pages** 并行（raw 通常比 Pages 新；校园网打不开 `api.github.com` 时仍能读）
3. 再不行用壳/网页打包的 `schedule.json`

推送前若本机条数不到云端快照的一半，会拒绝覆盖，避免空缓存冲掉全量。

App 点「更新」：manifest / 整包 HTML 同样走 raw → Pages →（有口令）API，校验 sha256 后写入本地。

## 开发

```bash
npm install
npm run dev
```

```bash
npm run build          # 网页
npm run build:phone    # 单文件 HTML + OTA manifest
npm run build:apk      # Capacitor debug APK
npm run check:schedule # 检查日程 JSON
```

GitHub Pages 发布源是仓库 `docs/`（构建产物与 `schedule.json`、OTA 包都在这里）。改完界面要让网页和手机 OTA 生效，需要构建后把 `docs/` 推到 `main`。
