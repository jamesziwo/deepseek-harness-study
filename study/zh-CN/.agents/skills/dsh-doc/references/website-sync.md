> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/references/website-sync.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/references/website-sync.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`6ab2dc43aa43c964350a800304f53d51fcc6280ee882aac2a3223dff3e52bdfc`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="website-publication"></a>
# 网站发布

<a id="summary"></a>
## 摘要

文档站是经过验证的仓库 Markdown 投影，不是副本。[website/docs.ts](../../../../../../website/docs.ts) 是显式公开允许列表，[project-doc-site.ts](../../../../../../scripts/project-doc-site.ts) 将映射来源重写到可丢弃 generated 树，由 VitePress 构建。构建还按同一 manifest 为每条路由生成原始 Markdown 版本及根 llms.txt 索引。本参考负责 manifest 字段、链接规则、预览验证和部署边界。

<a id="table-of-contents"></a>
## 目录

- [Manifest 所有权](#manifest-ownership)
- [变更分类](#classify-the-change)
- [DocsPage 字段](#docspage-fields)
- [保留链接行为](#preserve-link-behavior)
- [预览与验证](#preview-and-validate)
- [部署保持独立](#keep-deployment-separate)
- [开发备注](#dev-note)

<a id="manifest-ownership"></a>
## Manifest 所有权

修改前读 [docs/AGENTS.md](../../../../../../docs/AGENTS.md) 和 [website/docs.ts](../../../../../../website/docs.ts) 当前 DocsPage 类型及条目，不依赖记忆。新增章节、侧栏集合、语言或顶层导航前读 [VitePress 配置](../../../../../../website/.vitepress/config.ts)。双语来源编辑遵循[常规轻量流程](../../../../../../docs/AGENTS.md#writing-rules)及[配对契约](../../../../../../docs/i18n/README.md)，不自动调用扩展翻译技能。

不编辑或提交 generated/cache/dist；除 website/AGENTS.md 外不在 website/ 新增 Markdown，zh-CN/en/api 等路由目录不是合法来源布局。生成目录放 docs/ 并做新鲜度检查，再通过 manifest 发布。

<a id="classify-the-change"></a>
## 变更分类

- **编辑已发布页面：** 只改规范 Markdown；路由或导航元数据未变时不碰 manifest。
- **发布新页：** 在所属 docs 层创建，再加一个 manifest 条目。
- **重命名、移动、删除：** 原子更新规范文件、manifest 和入站链接；移除过期条目，docs:check 会拒绝缺失来源。
- **发布生成目录：** 映射生成 docs 文件，但修改生成器或来源元数据，不手改产物。
- **改变网站结构：** 普通页面改 manifest；现有侧栏、章节或语言模型无法表达时才改 VitePress。

保持 manifest 为显式公开允许列表。不要只因位于 docs/ 就发布 RFC、复盘、测试指南、AGENTS.md 或维护者工作流；仅用户明确扩大公开范围时加入内部资料。

<a id="docspage-fields"></a>
## DocsPage 字段

每个字段都应有意设置。规范字段及 DocsSidebar 联合类型在 [website/docs.ts](../../../../../../website/docs.ts)，直接读取，不复制字段集合进说明；章节由同文件 sections 记录负责，VitePress 不维护另一份排序。

- `source`：仓库相对规范 Markdown 路径。完整双语对通过 pairedPages() 添加英文 .md，自动派生中文文件、语言和对应别名。
- `route`：包含 .md 后缀的公开 VitePress 路径。
- `label`：侧栏标签，不必等于文档 H1。
- `sidebar`：优先复用已有 DocsSidebar，信息架构确有需要才新增。
- `section`：尽量复用，新建时也在 sections 记录定义。
- `order`：章节内稳定顺序。
- `sourceAliases`：投影链接时应解析到此页的额外仓库路径，不创建另一条公开路由。

只有有意让两语言路由都回退同一现有语言时用 mirroredPages()；补齐另一语言后改 pairedPages()。路由树与源码布局独立，foo.zh.md 投影到根路由，foo.md 到匹配 /en/ 路由。

<a id="preserve-link-behavior"></a>
## 保留链接行为

规范文档使用正常仓库相对 Markdown 链接，投影器执行以下规则：

- manifest 中的目标变为站内相对路由。
- manifest 外但存在的目标变为 GitHub 源码链接，保留支持的行号后缀。
- 图像例外：复制到生成树并从那里引用，不受仓库可见性影响；必须是仓库内普通文件。
- 外部 URL、站点绝对 URL、邮箱和纯片段链接保持不变。
- 仓库相对目标缺失时投影失败，不悄悄生成坏链接。
- 跨页片段以英文 GitHub 标题 ID 为规范；VitePress 生成不同 ID 时，在人工标题前放显式 `<a id="..."></a>`，生成别名由生成器负责。

不要只为适配 VitePress 在规范 Markdown 写站点专用路由；目录式仓库链接要映射到索引时使用 sourceAliases。

<a id="preview-and-validate"></a>
## 预览与验证

编辑时运行本地预览：

```sh
pnpm docs:dev
```

开发服务器监听映射来源并重投影；manifest 改后若未自动发现新来源则重启。

认定映射有效前运行定向网站检查：

```sh
pnpm docs:check
```

Markdown 链接检查通过但网站报缺片段时，按 verify-doc-site-fragments 的来源和目标路径排查，在人工 Markdown 或所属生成器添加英文 GitHub ID 显式别名。

提交文档站修改前运行：

```sh
pnpm run test:docs
pnpm run doc-sync
pnpm run lint
git diff --check
```

推送前使用 [dsh-pre-push-checks](../../dsh-pre-push-checks/SKILL.md)，报告规范文件变化、manifest 增删、公开路由影响及精确检查命令。

<a id="keep-deployment-separate"></a>
## 部署保持独立

内容同步到 VitePress 构建不等于发布互联网。除非用户明确要求部署并确认托管政策，不添加 GitHub Pages 权限、部署工作流、自定义域名或公开托管。

<a id="dev-note"></a>
## 开发备注

无。
