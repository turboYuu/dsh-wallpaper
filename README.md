# 背景图 · Wallpaper

> 为 DeepSeek Harness 设置自定义背景图的插件：在左侧栏打开面板，选择一张图片作为 DSH 的背景，并用滑块调节它的不透明度。语言自动跟随 DSH 的界面语言（中文 / English）。

**Wallpaper** is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that lets you set a custom background image for the app and tune its opacity with a slider. The UI language follows DSH's interface language.

- 包名：`dsh-wallpaper`
- 版本：`0.1.0`
- 许可：[MIT](LICENSE)
- 平台：Web（DSH Desktop 与 `dsh web` 都是 Web 外壳）

---

## 目录

- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [实现原理](#实现原理)
- [版本](#版本)
- [代码结构](#代码结构)
- [加入 DSH 插件生态](#加入-dsh-插件生态)
- [开发](#开发)
- [许可](#许可)

---

## 功能

- **左侧栏入口**：向 `sidebar.panellist` 插槽注册一个图标入口，点击后在主区域打开配置面板。
- **选择图片**：点击「选择图片」从本地挑选一张图片，自动缩放到合适尺寸后作为 DSH 的背景图。
- **滑块调节透明度**：用滑动按钮（`<input type="range">`）实时调节背景图的透明程度，0% 时回到纯色主题背景。
- **语言跟随 DSH 设置**：面板内所有文案通过 `ctx.locale` 注册，切换 DSH 界面语言时自动切换，无需重启。
- **持久化**：配置（是否启用、透明度、图片）写入 `$DSH_HOME/dsh-wallpaper.json`，浏览器侧保留轻量镜像，重启后自动恢复。

---

## 安装

### 方式一：用 DSH 插件管理器安装（推荐）

在 DSH 的插件管理页面（侧栏的「插件」页）点安装，填入仓库地址：

```
github:turboYuu/dsh-wallpaper
```

或者用命令行，这一步会同时安装依赖并把组合包启用（写入 `dsh.profile.bundles`）：

```bash
dsh plugin --profile desktop add github:turboYuu/dsh-wallpaper
```

> 如果你用 `dsh web` 启动，把 `--profile desktop` 换成 `--profile web`。

### 方式二：手动用 pnpm 安装

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:turboYuu/dsh-wallpaper
```

`pnpm add` 只把包写进 `dependencies`，不会自动启用组合包；你还需要在 profile 的 `package.json` 里把包名追加到 `dsh.profile.bundles` 列表末尾：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-wallpaper"
      ]
    }
  }
}
```

### 方式三：从本地目录链接安装

适合改代码的时候。把仓库克隆到任意位置，让 profile 以 `link:` 方式依赖它：

```bash
cd ~/.dsh/profiles/desktop
pnpm add link:/absolute/path/to/dsh-wallpaper
```

同样需要把 `dsh-wallpaper` 追加到 `dsh.profile.bundles`（见方式二）。`link:` 安装的包，改完源码需要重启 DSH 才会重新加载宿主半；浏览器半在下次刷新页面时生效。

### 方式四：从 npm 安装（发布后）

```bash
cd ~/.dsh/profiles/desktop
pnpm add dsh-wallpaper
```

同样需要把 `dsh-wallpaper` 追加到 `dsh.profile.bundles`。

### 装完之后

左上角侧栏会出现「背景图」入口；插件列表里这个包会显示中文名「背景图」和一句中文说明（来自包内的 `locale/zh.json`）。

---

## 使用

1. 打开左侧栏的「背景图」入口。
2. 打开「使用背景图」开关。
3. 点击「选择图片」挑选一张本地图片。
4. 拖动「不透明度」滑块，实时调整背景图的透明程度。
5. 想换一张就点「更换图片」；想恢复纯色背景就点「移除背景」或关闭开关。

配置会立即生效，无需重启。

---

## 实现原理

这里写清楚，因为「背景图」看起来简单，实际依赖 DSH 主题画布的组织方式。

### 主题画布

DSH 的 Web 外壳把「应用基础背景」定义为一个主题令牌 `--dsw-alias-bg-base`，由主题插件写到 `body` 上，外壳框架（frame）、中间列（center）、右侧栏、底栏都用它做背景。在 macOS 上框架本身是透明的，中间列则用 `--dsw-alias-bg-base` 铺底。

### 于是怎么做的

1. **把画布变透明**：当背景图启用时，给 `<html>` 打一个 `data-dsw-wallpaper="on"` 标记，用一条带标记的 CSS 规则把 `body` 的背景色和 `--dsw-alias-bg-base` 覆盖为透明。因为所有画布层都引用这个令牌，它们会一起变透明，而卡片的 `--dsw-alias-bg-layer-1/2` 等「抬升表面」不受影响，仍保持可读。
2. **把图片画到 `body::before`**：一个 `position: fixed; inset: 0; z-index: -1` 的伪元素承载图片，`background-size: cover` 铺满，`opacity` 由滑块控制。它位于 `<html>` 背景之上、应用内容之下。
3. **透明度的语义**：`<html>` 背景保持主题基色（在运行时读取 `getComputedStyle(body).backgroundColor` 缓存到 `--dsw-wallpaper-base`）。所以滑块为 0% 时图片完全透明，露出主题基色，视觉上退化成普通 DSH 外观。
4. **不依赖哈希类名**：透明化只通过 `data-dsw-wallpaper` 属性和主题令牌实现，不引用外壳的 CSS Module 哈希类名，外壳版本升级不会失效。

### 为什么必须覆盖令牌，而不是直接移动节点

外壳框架、中间列、右侧栏的类名是 CSS Module 的哈希，版本一变就失效。而 `--dsw-alias-bg-base` 是主题公开的稳定令牌，语义就是「应用基础背景」，覆盖它等于声明「画布交给插件」，这是最稳的做法。

### 失败时的行为

整段背景应用和写入都跑在 `try / catch` 或防抖里，出错只打日志，不向外抛。原因是 DSH 的 Web 外壳在某个插件 `apply` 抛异常时会中断整个启动流程，一个背景图插件不该有能力把 GUI 弄挂。

---

## 版本

| 版本 | 说明 |
| --- | --- |
| `0.1.0` | 首个版本：左侧栏入口、图片选择与缩放、透明度滑块、中英文跟随、宿主持久化。 |

---

## 代码结构

```
dsh-wallpaper/
├── index.js             宿主半：webServer 路由，读写配置文件
├── client.js            浏览器半：侧栏入口 + 面板 + 背景层 + 图片处理
├── cordis.patch.yml     bundle patch，把插件插进 profile 的插件树
├── package.json         包清单，声明 dsh.bundle 与 dsh.client
├── icon.svg             插件图标，同时用于插件列表与侧栏入口
├── locale/
│   ├── zh.json          插件列表里显示的中文名与说明
│   └── en.json          英文名与说明
├── LICENSE
└── README.md
```

两个半边通过 `package.json` 的 `exports` 分别暴露：`.` 是宿主入口，`./client` 是浏览器入口。`dsh.client.platform` 声明为 `web`。

### 宿主半（index.js）

挂在 DSH 的 `webServer` 上，提供三个方法两个路径：

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| `GET /api/dsh-wallpaper/config` | 无 | `{ "document": { ... } }` |
| `POST /api/dsh-wallpaper/config` | `{ "document": { ... } }` | `{ "ok": true }` |
| `GET /api/dsh-wallpaper/health` | 无 | `{ "ok": true, "path": "<配置文件绝对路径>" }` |

约束：只接受本机回环地址，其他来源一律 `403`；请求体上限 24 MiB；用「临时文件 + 原子 rename」写盘。

### 浏览器半（client.js）

- `window.__ModuleLoader__.load` 注册模块，`require` 拿到外壳注入的 `react` 等依赖，无需构建步骤。
- `ctx.slots.inject('sidebar.panellist', ...)` 注册侧栏图标入口。
- `ctx.slots.inject('main', ...)` 注册主面板。
- `ctx.locale.register(NS, { en, zh })` + `ctx.locale.bind(NS)` 实现语言跟随。
- 图片选择走 `<input type="file">` → `FileReader` → `canvas` 缩放 → data URL；透明度走 `body::before` 的 `opacity`。

---

## 加入 DSH 插件生态

本插件是一个标准的 DSH bundle：

- `package.json` 声明了 `dsh.bundle.patch` 与 `dsh.client`，安装后即出现在 profile 的插件树与左侧栏中。
- `keywords`、`repository`、`homepage`、`license`、`icon.svg`、`locale/*.json` 等元数据齐全，可供插件市场索引生成器读取。
- 发布到 npm 后，可提交到 [deepseekplugin.org](https://deepseekplugin.org)（社区精选目录）的「提交插件」入口，进入 DSH 插件市场。

---

## 开发

```bash
# 语法检查，两个文件都不需要构建步骤
node --check index.js
node --check client.js

# 宿主半接口
curl http://127.0.0.1:<dsh端口>/api/dsh-wallpaper/health
curl http://127.0.0.1:<dsh端口>/api/dsh-wallpaper/config
```

浏览器半的改动刷新页面即可看到；宿主半的改动需要重启 DSH。

### 样式约定

所有颜色、圆角、间距都走 DSH 的主题变量（`--dsw-alias-*`、`--dsw-radius-*`、`--dsw-focus-ring-width`），不写死颜色值，自动跟随 DSH 的浅色/深色主题。

---

## 许可

MIT，见 [LICENSE](LICENSE)。

Copyright (c) 2026 dsh-wallpaper contributors
