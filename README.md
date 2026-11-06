# craft-lite

**把一个网页观测成证据，再给你的复刻打分。零依赖，Node 在哪它就在哪。**

A clean-room rebuild loop in one small tool: `study` a page into measurable evidence, `check` your rebuild against it, `serve` the result.
Inspired by [craft-anything](https://github.com/storytold/craft-anything)'s Study → Build → Check → Ready loop, cut down to what one file of static analysis can honestly do.

```sh
npx craft-lite study https://example.com/page projects/example   # Study
#   … 写你的复刻到 projects/example/app/index.html …            # Build
npx craft-lite check projects/example projects/example/app/index.html   # Check
npx craft-lite serve projects/example/app 8787                   # Ready
```

## 为什么有它

看懂一个页面和做出一个页面之间，差的是「证据 → 成品 → 比对」这条流水线。
`craft-lite` 只做两端最容易糊弄的事：**先把能量的量出来**（设计令牌、调色板、结构骨架、行为特征、文案指纹），
**再把成品和原作逐项比一遍并打分**。中间那步（写代码）留给你或者你的 agent——它本来就不该由工具代劳。

不需要浏览器、不需要截图、不需要 GPU：只读 HTML/CSS/JS 的静态证据。所以它在手机上、在 CI 里、在容器里都能跑。

## 安装

```sh
npm i -g craft-lite          # 或 npx craft-lite <command>
```
需要 Node ≥ 18（用到全局 `fetch`）。**没有任何运行时依赖。**

## 命令

| 命令 | 作用 |
|---|---|
| `craft-lite study <url\|file> <projectDir>` | 抓目标 → 写 `capture/{raw.html,report.json,summary.md}` + `craft.json` |
| `craft-lite check <projectDir> <built.html>` | 与 `capture/` 比对 → 打分 + `checks/<时间戳>.{json,md}` |
| `craft-lite serve <dir> [port]` | 本地托管（`.wasm` 回 `application/wasm`，浏览器才肯流式编译） |
| `craft-lite help \| version` | |

选项：`--json`（机器可读）、`--min <分数>`（低于就 exit 1，可接 CI）、`--port/--host`、`--quiet`。

### 外部样式表

真实站点的令牌大多在独立的 `.css` 里，不在 `<style>` 里。所以 `study` / `check` 会顺着
`<link rel="stylesheet">` 把样式表抓下来（**本地文件读相对路径，URL 走 HTTP**），再跟一层 `@import`，
上限 8 个文件 / 1 MB。抓失败不致命：报告里记 `ok: false` 和原因，其余证据照常产出。

```sh
npx craft-lite study https://tailwind-site.example/ projects/tw
#   capture/summary.md 的 "## Stylesheets" 一节写清楚读了哪几个文件、各多少字节
```


```sh
# CI 里当回归闸：复刻掉到 90 分以下就红
craft-lite check projects/p projects/p/app/index.html --min 90
```

## 打分口径（满分 100）

| 维度 | 权重 | 怎么算 |
|---|---|---|
| palette 调色板 | 20 | 颜色集合 Jaccard（多一个少一个都扣） |
| tokens 设计令牌 | 15 | CSS 变量名 Jaccard ×0.5 + 同名同值比例 ×0.5（主题变量按「取到的所有值」比，不是只看最后一个） |
| headings 标题层级 | 15 | 原作 h1–h6 文本在成品中的命中率 |
| structure 结构骨架 | 15 | 标签直方图余弦相似度 |
| behaviour 行为特征 | 20 | 原作有的特征成品是否都有：CSS 变量 / 深色模式 / grid / flex / 媒体查询 / 内联 JS / `classList` 切换 / `dataset` 过滤 / 过渡 / `:hover` |
| copy 文案指纹 | 10 | 中英文二元组指纹 Jaccard |
| size 体积接近 | 5 | HTML 字节比 |

`check` 除了分数还会列出**还差在哪**：缺哪个颜色、哪个令牌、哪个标题、哪条行为、哪个元素数量对不上。

> **文案指纹低不是 bug。** 净室复刻的成品本就该用自己的话写文案，这一项掉到 40–50% 是预期内的代价。
> 反过来，如果 `copy` 接近 100%，大概率是直接把原文搬过来了——那不是复刻，是抄。

## 项目目录（和 craft-anything 同一套约定）

```
projects/example/
  craft.json         目标、状态、每一步的历史
  capture/           观测到的：raw.html、report.json、summary.md
  app/               你的复刻
  checks/            每次比对：<时间戳>.json + .md
```

## 实测

拿一个 5 KB 的静态站做净室复刻（只读量出来的令牌，不复制原 CSS）：

| 轮次 | 分数 | 还差在哪 |
|---|---|---|
| 第 1 版 | 89.8 | 少了行为 `classToggle` |
| 修正后 | 94.3 | 调色板 / 令牌 / 标题 / 骨架 / 行为 全 100% |

剩下的 5.7 分全在 `copy`：成品用了自写文案。

## 自测

```sh
node test/selftest.mjs     # 45 项断言，全部离线（fixtures 自带，不联网）
```

覆盖：抽取（令牌／颜色／骨架／行为／文案指纹）、打分（满分、降级、缺颜色／缺令牌／缺标题都必须被点名）、
study→check 端到端、外部样式表（本地与 HTTP、`@import`、抓失败不致命）、`--min` 闸门、静态服务与 404。
CI 在 node 18/20/22 上跑同一套。

## 局限（先说清楚）

- **只做静态证据**：不执行 JS，SPA 只能拿到首屏 HTML；运行时才出现的 DOM、canvas、三种屏宽的截图它都没有。
  要看真实渲染，用真浏览器或 craft-anything 的桌面版。
- 外部样式表只跟一层 `@import`，最多 8 个文件 / 1 MB；JS 动态注入的样式看不到。
- 正则抽取，不是完整 CSS/DOM 解析器：极端写法（嵌套 `@layer`、`@container`）可能抽不全。
- 打分是**相似度**，不是「对不对」。分数高不等于好用，只是「量出来的东西对上了」。

## 负责任地使用

- 只用在你**拥有或有授权检查**的软件上。别人的站点，请先拿到许可。
- 复刻重建的是**布局、样式、行为**；logo、照片、文案不要去抄。
- 不绕过 DRM、登录、反爬、反作弊。
- 工具是中性的，红线在使用者。

## 一个真实的例子

[demo 页](https://verchiel666.github.io/craft-lite/) 是上面那次 94.3 分的报告，页面样式放在独立的
`docs/demo.css` 里——正好是「外部样式表」这条能力的一次真实用例。

## License

MIT © 2026 Verchiel666
