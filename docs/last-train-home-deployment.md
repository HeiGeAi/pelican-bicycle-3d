# 《末班车：下班生还》站点接入

站点仓库：`hencter/pelican-bicycle-3d`。根页开场面板与骑行顶部均提供第三部入口，指向相对路径 `./last-train-home/`。同一路径在根域与 GitHub Pages 子路径下都可用。

游戏规则与可玩原型维护源位于 `/Users/blakexu/Documents/ChatGPT/游戏开发/last-train-home`。本仓库的 `public/last-train-home/` 是已提交的静态发布副本。更新维护源后执行：

```bash
cd "/Users/blakexu/Documents/ChatGPT/游戏开发/pelican-bicycle-3d"
node scripts/sync-last-train.mjs "/Users/blakexu/Documents/ChatGPT/游戏开发/last-train-home"
npm run build
```

入口封面是为本项目生成的原创无字像素画，见 `public/last-train-home/cover.webp`。内置 `image_gen` 提示词：

> 16:9 hand-authored-looking pixel art game cover. An improvised commuter railcar travels toward the viewer through a dusty abandoned city at dusk, a few survivors on board, distinct zombie silhouettes approaching from both sides. Warm ochre sunset, deep charcoal, rusty copper and restrained teal lights. Keep the upper third uncluttered for HTML text. Original vehicle and characters, no text, logo, watermark, UI or copied screenshot composition.

生成源是 PNG，发布副本以 WebP 质量 78 编码，约 184 KB。封面作为入口素材，不进入游戏 Canvas。

本仓库在推送 `main` 时运行 GitHub Pages 工作流。用户给出的 `pelican-riding-bike.tongtianlu.cn` 是 EdgeOne Pages 域名；发布后必须单独读取该域的根页和 `last-train-home/` 路由，不能把 GitHub Actions 成功等同于 EdgeOne 域名已更新。
