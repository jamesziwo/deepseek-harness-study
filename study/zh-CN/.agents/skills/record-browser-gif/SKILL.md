> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/record-browser-gif/SKILL.md` · [英文原文](../../../../../.agents/skills/record-browser-gif/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`de9fba80b397eef89000a8916de13107feef59aa302186b2e15f2feeb294756e`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: record-browser-gif
description: Record browser or Web UI interaction demos as optimized GIFs using the available browser-control workflow, optional Playwright Videos for higher capture frame rates, and deterministic encoding, then attach the GIF to a pull request with `gh --attach`, falling back to a dedicated assets branch where attach cannot apply. Use when asked to make, record, or generate a GIF that demonstrates a browser workflow, and for every pull request that changes product-user-visible GUI behavior, which MUST include a GIF recorded from the pull request's real server and model flow.
---
```


<a id="record-browser-gif"></a>
# 录制浏览器 GIF

生成短而真实的本地 UI 演示 GIF；只有任务包含附到 PR 时，才执行末尾发布流程。优先使用现有浏览器控制工作流；支持高帧率连续捕获时用 [Playwright 视频](https://playwright.dev/docs/videos)，随附编码器负责裁剪、速度、末帧停留、尺寸和大小。

[证据链决策](../../../../../.agents/notes/implemented/process/2026-08-08-browser-gif-evidence-chain.md)解释为何一个分镜来自一次隔离运行，以及发布时为何复核产物和演示的 PR 头。

<a id="every-gui-pull-request-includes-a-gif"></a>
## 每个 GUI PR 都包含 GIF

修改产品用户可见 GUI 行为的 PR 必须按本技能录演示 GIF，并通过[附加流程](#publish-the-gif)嵌入正文。

录制本身是证据：使用 PR 分支构建的真实服务、真实 API key 和真实模型轮次。除非用户明确要求 fixture 录制，不替换为测试查询、mock 传输、合成事件或测试钩子。嵌入旁记录精确 SHA、提供服务的工作树和 origin、模式标志／浏览器状态例外、是否跑真实模型，让评审明确证据边界。

<a id="keep-recording-separate-from-publication"></a>
## 录制与发布分开

- 录制只产生本地视频／截图及 GIF，不修改远端。
- 通过 gh --attach 附到 PR，或不可用时推资产分支并嵌 URL，都是单独最终步骤，只有任务包含此要求才做；不碰 PR 自身分支。
- 保留要求的录制条件。真实服务／API 演示不能换 fixture、mock、合成事件或测试钩子；缺凭据／服务时报告限制，不偷换。
- 不读取或暴露凭据值，使用应用正常配置和无害演示提示。

<a id="stage-the-application"></a>
## 准备应用

特定 PR 的 GIF 必须演示该 PR 工作树，逐 PR 准备：

1. 要求干净 worktree，用 git rev-parse HEAD 记录精确提交，再构建该树：`pnpm run build && pnpm run build:web`。录其他提交的构建会错误归因。
2. 每端口从该树启动一个服务，使用新的临时 DSH_HOME、DSH_AGENTS_HOME、工作区和会话状态。浏览器用隔离上下文／profile；无法创建时导航前清该 origin 的 Cookie 和站点存储，避免旧状态影响证据。按应用正常路径读取根 .env，绝不回显 key。
3. 一个分镜是一份证据运行，全部发布帧必须来自同服务、状态根、工作区、会话及模型情景。自动捕获失败则丢弃帧，从新状态重跑，不拼接不同运行。
4. 切换 PR 时按 PID 或精确命令行匹配停止旧服务；宽泛 pkill -f 可能杀掉启动 shell，包括自己。

<a id="record-the-flow"></a>
## 录制流程

遵循可用浏览器控制工作流的准备、交互和清理。支持 recordVideo 时在同一受控上下文启用以捕获中间帧；否则用该工作流的[截图捕获](#screenshot-capture)。视频是否可用不决定采用哪个控制工作流；既有用户浏览器状态必须作为来源例外注明。

只有浏览器控制不可用时，才在隔离无头浏览器使用仓库声明的 Playwright，并注明回退。本仓库从 apps/web/package.json 解析，不安装另一驱动或打开用户浏览器。

录制前明确 origin、构建／开发服务器、传输和模式覆盖。默认原生界面无法自动化时，通过正常配置选择官方支持浏览器操作的生产后端，并说明覆盖。

脚本、原视频、计时说明、QA 帧和 GIF 放 Git 忽略的 .playwright-mcp/，先创建本轮目录。

<a id="capture-video"></a>
### 捕获视频

显式匹配 viewport 和 recordVideo.size，否则 Playwright 缩到 800×800 内，可能使文字不清。

通过选定控制工作流配置视频，独立 Playwright 回退示例：

```js
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('playwright')
const browser = await chromium.launch()
const size = { width: 1440, height: 900 }
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: join(runDir, 'videos'), size },
})
try {
  const page = await context.newPage()
  const video = page.video()
  // Navigate and exercise the real application here.
  await context.close()
  await video.saveAs(join(runDir, 'demo.webm'))
} finally {
  await context.close()
  await browser.close()
}
```

从 node:module 导入 createRequire、node:path 导入 join；repo 和新 runDir 使用绝对路径。关闭页面前保留 video 句柄；saveAs／编码前等待 context.close()，只关 browser 不保证刷写。每页独立视频，明确选演示页，不连接无关页面／运行。失败运行仅作诊断。

选择三到六个有意义状态的短故事。动作前等唯一语义定位器，名称匹配用 exact:true，完成谓词须精确且不能匹配提示回显。固定等待只用于已验证状态后的阅读停留，不证明就绪；视频保留动画和滚动。

演示工具调用、拒绝或恢复时打开详情／轨迹，显示工具身份、状态或稳定错误码及下游结果。瞬时运行状态重要时让模型做慢前台操作，观察具体 DOM 标记，连续视频捕中间帧；给模型简短最终哨兵确认完成。目标状态可见后停止无必要的长真实 API 运行。

不录秘密、个人数据、无关标签或通知。浏览器视频只含页面不含浏览器外壳；应用中避免显示带凭据 URL。审查完整所选区间包括中间态，全程同视口。

<a id="encode-the-gif"></a>
## 编码 GIF

需要 python3、ffmpeg、ffprobe。缺媒体程序时报告依赖，不在未授权时安装。GIF_SKILL_DIR 必须先独立 export，同行临时赋值无法影响同命令参数展开。

```sh
export GIF_SKILL_DIR=/absolute/path/to/this/skill
python3 "$GIF_SKILL_DIR/scripts/encode_gif.py" \
  /absolute/path/to/demo.webm \
  /absolute/path/to/demo.gif \
  --start 2 --end 32 --speed 2 --final-hold 3 \
  --fps 10 --max-width 1200 --colors 128
```

start/end 按秒选连续源区间；默认全视频、1 倍速、末帧停两秒。speed 改播放速度，旁注倍率和区间，避免暗示实测延迟。使用视频观察时间，不猜墙钟偏移，保留完整因果和结果。末帧停留重复最后帧；提高 fps 无法恢复未捕获动作。保留 WebM 供 QA，不拼多次运行或合成缺失状态。

编码器探测 WebM 时长，先裁剪／变速再调色，检查编码时长、动画、宽度和字节数。拒绝空／越界区间、少于两输出帧、模式不适用参数和误覆盖。文件大时先减 max-width，再减 colors/fps，保证文字可读；确认精确输出路径后才用 force。

<a id="screenshot-capture"></a>
### 截图捕获

无连续视频或用户要求分镜时，按现有控制工作流，从一次隔离运行捕获三至六个已核实状态。图片字节直接存同一目录，命名 00-initial.png、01-typed.png 等，尺寸裁剪一致；瞬态在同一次浏览器脚本中轮询 DOM 标记并截图。

```sh
python3 "$GIF_SKILL_DIR/scripts/encode_gif.py" \
  /absolute/path/to/frames /absolute/path/to/demo.gif \
  --durations 1.5,1.5,1.5,3.5 --fps 10 --max-width 1200 --colors 128
```

单一 duration 应用到全部截图，否则每帧提供一个正时长，最终稳定状态停留最长。目录输入拒绝少于两帧、尺寸不一或时长数量不匹配。视频计时参数只用于视频，durations/pattern 只用于截图目录。

<a id="verify-the-artifact"></a>
## 核验产物

1. 读编码器 JSON，确认输出路径、源区间／速度或截图数量、帧数、尺寸、时长及字节数。
2. 目视检查编码 GIF，不只看源帧；转换可读、末态停留足够、无敏感内容。查看器只显示首帧时，用 ffmpeg 从编码 GIF 解代表帧检查；编码前截图不证明成品顺序、调色和停留。
3. git status --short 确认原视频、QA 帧和产物仅在忽略路径。
4. 返回绝对 GIF 路径，客户端支持时渲染，并说明真实 API、fixture 或其他传输。任务不含附 PR 时到此结束。

维护编码器时，在媒体依赖齐全后运行 `python3 -m unittest discover -s "$GIF_SKILL_DIR/scripts" -p 'test_*.py' -v`；这些本地媒体测试不在仓库 CI 中运行。

<a id="publish-the-gif"></a>
## 发布 GIF

只有任务包含将 GIF 附到 PR 时才执行。

绝不将 GIF 提交到 PR 自身或会合入长期分支的分支，二进制历史会拖累未来每次克隆。优先 gh --attach，一条命令上传并重写正文引用，不让分支承载媒体。

<a id="attach-with-gh"></a>
### 使用 gh 附加

gh --attach 要求 gh≥2.99.0、github.com 仓库（不支持 Enterprise Server）、仓库写权限及不超过 10 MB 的 GIF。确认已验证产物符合；超限先 max-width，再 colors/fps 缩小。

正文文件用普通本地路径引用 GIF，路径与 --attach 一致；gh 原地改为上传 URL，保留位置和 alt 文本：

```markdown
![<alt text>](<path/to/demo.gif>)
```

通常演示 PR 就是发布目标；工具类 PR 可嵌另一个 PR 的明确标注示例，点名来源并在后续检查使用其 live head，不把示例归于工具分支。

附加前即时重读演示 PR live head，新 PR 则读已推送分支头，与 GIF 旁记录提交比较；变化则停止重录，然后附加：

```sh
gh pr create --body-file <body.md> --attach <path/to/demo.gif>     # new pull request
gh pr edit <pr> --body-file <body.md> --attach <path/to/demo.gif>  # existing pull request
```

attach 可重复但拒绝同文件两次。正文未引用的 GIF 追加末尾，使用 flag 的 alt；已重写引用保留正文 alt。附加后重查演示头仍一致，重读正文确认 URL，调用 GitHub Markdown API 验证 img，并获取上传 URL 一次确认 200 和 image/gif。

<a id="fall-back-to-an-assets-branch"></a>
### 回退到资产分支

只有 attach 不适用时使用：GIF 仍超 10 MB、gh 太旧或非 github.com。GIF 放专用无父提交、只含媒体的孤儿资产分支；一系列 PR 共用 `<series>-assets`，已有分支用 `git ls-remote --heads origin '*assets*'` 列出。

下述两种方式推送前，都确认资产分支只含媒体，暂存 GIF 校验和与已核实本地产物一致。

已有资产分支时，在浅克隆单分支临时目录工作，避免触碰当前工作树：

```sh
git clone --branch <assets-branch> --single-branch --depth 1 <repo-url> /tmp/assets-checkout
cp /absolute/path/to/demo.gif /tmp/assets-checkout/<name>.gif
cd /tmp/assets-checkout
git add <name>.gif
git commit -m "assets: <what it shows> gif (#<pr>)"
git push origin <assets-branch>
```

新系列建立临时浅克隆 `git clone --depth 1 <repo-url> /tmp/assets-checkout`，用 `git switch --orphan <assets-branch>` 创建孤儿分支，再同样添加、提交、推送 GIF。

推送后用已认证 API／raw 请求核对远端路径、字节数、校验和、200 和 image/gif。匿名 404 不能否定私有仓库资产，应认证验证；这证明成员评审路径，不证明公开可用。

编辑 PR 正文前即时重查演示头并与记录比较，变化则重录；编辑后再查仍一致，另用 GitHub Markdown API 渲染正文确认预期 img。

正文使用 raw blob URL，必须带 ?raw=true，否则普通 blob URL 显示 GitHub 文件页而非图片：

```markdown
![<alt text>](https://github.com/<owner>/<repo>/blob/<assets-branch>/<name>.gif?raw=true)
```

绝不删除、重写或强推资产分支，已合并 PR 永久引用其 URL；只允许追加提交。
