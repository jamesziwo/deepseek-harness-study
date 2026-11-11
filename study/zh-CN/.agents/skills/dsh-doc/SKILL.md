> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-doc/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`f4c1072a5418b281d92342ebcab9700915db8f9d6ec63eb856ac87baec5d9e79`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-doc
description: Create, restructure, review, audit, or migrate DeepSeek Harness Markdown documentation, package READMEs, and the documentation website using audience-first hierarchy, kind-mapped YAML metadata, bilingual line alignment, summary/contents navigation, progressive user-to-developer detail, executed-operation fact-checking, and repository validation. Use for new or revised DSH docs, docs-tree organization, documentation-quality audits and budgets, website page publishing, and bilingual documentation structure changes.
---
```


<a id="deepseek-harness-documentation"></a>
# DeepSeek Harness 文档

<a id="summary"></a>
## 摘要

文档标准要求页面可检索、适合新人、对代理及维护者足够精确，并让文档站保持为已验证的仓库 Markdown 投影。先遵守 AGENTS.md 和实际检查，再按本流程处理 kind 元数据、递进细节、行对齐双语、资料审计及网站发布。每个事实只有一个所有者：源码、测试、生成目录、包 README、指南、Agent Notes、草稿各有职责。session-persistence-jsonl 的双语 README 是格式范例。

<a id="table-of-contents"></a>
## 目录

- [工作流](#workflow)
- [事实核验：测试，不猜测](#fact-check-procedure-test-do-not-assume)
- [Kind 系统与模板](#kind-system-and-templates)
- [表达规则](#voice-rules)
- [质量标准](#quality-criteria)
- [资料审计](#audit-the-corpus)
- [字数预算](#wordcount-budgets)
- [网站发布](#website-publication)
- [详细参考](#detailed-references)
- [验证](#validation)
- [开发备注](#dev-note)

<a id="workflow"></a>
## 工作流

在请求范围内逐项执行。常见阅读路径应简短，但不能只为省字删除失败、所有权、限制或其他必要契约。

1. 阅读根及更具体的 AGENTS.md、[文档标准](../../../../../docs/AGENTS.md)、目标页面、源码／测试、导航所有者及双语记录。
2. 根据主要职责和读者分类：产品快速开始、用户任务指南、贡献者教程、架构概览、包／子系统参考、生成参考、代理指令、决策记录或草稿。
3. 放在最近的责任归属处：包契约随代码，跨包学习、用户、开发者、架构、讨论及临时草稿使用 docs/。
4. 写细节前明确读者起点、可观察结果、可能失败、恢复方式和下一层阅读入口。
5. 添加／修改 YAML 元数据，分配与文档职责模板对应的 kind；类型允许时，按 Summary、Table of Contents、用户内容、开发者内容、可选 Further Exploration、最终 Dev Note 的顺序编写。
6. 同一轮更新双语版本，保持标题、列表、表格、代码、链接、frontmatter 布局和物理行数对齐。
7. 对照代码、测试、生成器、包元数据或当前决策来源核验声明，并按下面流程执行文中操作；先更新事实所有者，再更新派生产物。
8. 先运行定向检查，再运行 `pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run lint`、`git diff --check`；完整重读差异，先查正确性，再查简洁性和仓库适配。

<a id="fact-check-procedure-test-do-not-assume"></a>
## 事实核验：测试，不猜测

文档描述当前产品行为，对操作声明唯一可接受的证据是实际执行过。所有新文档，以及新增涉及操作、命令、默认、错误、平台差异的段落，都必须执行本流程。

1. **写安装指南前分类对象。** 看事实而非目录名：package.json 是否声明 dsh.bundle.patch，入口是 apply／默认服务导出的插件还是普通库。只有 bundle 用 `dsh plugin --profile <name> add <package>` 才激活配置层；普通插件通过 cordis.yml 挂载；库是依赖，没有独立安装路径。库与 bundle 用对应 README 模板，不套用不适用的插件安装说明。
2. **在当前检出版本执行每项操作声明。** 原样运行页面将展示的 CLI、配置、profile 和 patch 示例，只记录实际输出、警告和失败模式。依赖缺失密钥或网络时，说明并指明验证责任方，不直接断言行为。
3. **删除无法复现的声明。** 不从记忆、类比或邻包 README 搬运命令、字段、默认值或行为。无法复现时修正文档声明，而非修改测试迁就。
4. **对照最新 master 检查旧文档。** 修订前执行 `git fetch origin` 并与 origin/master 比较；sidecar 可恢复两边最后确认文本。master 上过时声明仍可能错误，应按代码修正，不按旧文字推断。
5. **每次编辑后重录配对。** 重新运行 `pnpm run verify-translation-pairing --write <pair>`，使 sidecar 跟踪确认过的版本。

<a id="kind-system-and-templates"></a>
## Kind 系统与模板

frontmatter 的 kind 恰好选择一种 README 模板。[元数据参考](references/metadata-links-i18n.md#the-kind-system)中的每种 kind 对应 [`templates/`](templates/) 中一个文件，每个模板也只属于一种 kind；检查器按同样事实推导预期类型。

- `package-group` → [package-group.md](templates/package-group.md)：包组地图（packages/README.md、packages/<group>/README.md），介绍家族、直接子包，链接包自身细节。
- `package-reference` → [package-reference.md](templates/package-reference.md)：Cordis 插件／服务，含挂载配置、配置表、折叠实现、检查器规定形式的 Model Experience 与 Known Limitations。
- `package-library` → [package-library.md](templates/package-library.md)：无插件接口的库，说明消费入口，不写 profile 安装或挂载配置。
- `package-bundle` → [package-bundle.md](templates/package-bundle.md)：声明 dsh.bundle.patch 的包，说明已验证 dsh plugin 安装、配置层语义和 patch 文档。

写作前打开模板并遵循结构和规则，它定义 kind、页面结构及各节核验义务。新增 kind 必须同时有独立模板、明确仓库位置或所有者，以及文档到类型的定向检查。

<a id="voice-rules"></a>
## 表达规则

这些规则决定章节能写什么，适用于所有面向人阅读的文档，尤其是包 README。

- **Summary 说明能做什么。** 开头和用户章节描述可执行能力、结果、收益、适用时机及主要代价，而非内部角色、类型或身份。包摘要中的“是什么”只指读者可见能力；除非读者直接在配置、命令、公开 API 使用，否则不写源码标识。“注册 ctx.x、追加 x/event”是身份叙述；“每条消息可保存备注，重启后仍存在”才是用途。
- **开发者章节解释，不枚举。** 折叠实现介绍整体设计、架构和概略数据流，精确细节链接源码；不放完整 API 目录、全字段清单、事件载荷枚举或 JSDoc 复述。
- **只有 Dev Note 可放未整理内容。** 局部想法、草稿、未定方向、测量产物及假设只放最后 Dev Note，明确非权威；其余章节都是整理过的当前状态文字。
- **只描述现状。** Dev Note 之外不写兼容补丁、迁移或“以前／现在／不再／改名”等历史，只讨论当前代码库。
- **使用受控技术英语。** 歧义可能改变行为时，每句明确主体和主要动作；同概念用同术语，优先直接动词，拆开叠加条件，保留义务强度及例外。遵循[文字风格参考](references/style.md#controlled-technical-english)中受 ASD-STE100 启发但未经认证的规则，不为短句牺牲精度。

<a id="quality-criteria"></a>
## 质量标准

评审使用以下定义；每节先给简短导读，再进入子节或完整细节。

- **简洁：** 常见路径只含达成结果所需事实，完整信息最多隔一个直接链接或细节层。
- **直观：** 前置知识先于依赖概念，下一步明显，标题使用读者会搜索的词。
- **友好：** 读者能辨认成功、行动前理解风险、从常见失败恢复，并决定是否深入。
- **准确：** 每项长期声明有唯一所有者，以及与风险相称的验证方式。
- **适合代理阅读：** 元数据、稳定标题、锚点、术语、所有权和当前／提议状态支持定向检索，无需加载全库。
- **新人完整性：** 无仓库背景的专业工程师能通过三到五个相连页面重建相关架构或功能。

不要对穷尽参考统一设字数上限。测量入口路径长度、单次查询需扫过的无关内容、最大章节、标题数量和页大小；检索成本高时按已有领域所有者拆分。

<a id="audit-the-corpus"></a>
## 资料审计

直接阅读而非重新总结所属约定：[docs/AGENTS.md](../../../../../docs/AGENTS.md) 管层级、教程／参考、分类、预算和冗余检查；[Agent Notes](../../../../../.agents/notes/README.md) 管生命周期；[双语规则](../../../../../docs/i18n/README.md) 管配对；[根 AGENTS.md](../../../../../AGENTS.md) 管常设规则。排除 `.agents/notes/archived/`，它是冻结历史。

对范围内面向人文档按标准顺序编写（不含 Agent Notes）：定位并确定主题和细节层，把更深说明移给所属子页并链接；按用途而非路径分类教程／参考；教程按前置知识及难度排序，混合内容较多则拆分。检查位置约束：每次配对编辑都更新另一语言并 --write 重录；生成目录不得手改；移动需原子修复全部入站链接。

结构检查后，从成本最低的检查开始清理冗余。用 [dsh-trim-cot-leakage](../dsh-trim-cot-leakage/SKILL.md) 查推理过程泄漏，用特征语句搜索重复规则，以权威来源替代手写目录和状态清单，移除 implemented 笔记中的迁移计划和未来时规格。用 `pnpm run verify-doc-budgets --list` 及字数扫描测异常值；删文若改变承诺行为而非说明，先按 [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md) 提议行为变更。保留承载约束的规则，尽量一至三行加理由链接；不要为了转移可删除的推理而创造新解释。

<a id="wordcount-budgets"></a>
## 字数预算

`pnpm run verify-doc-budgets` 按 [manifest](../../../../../scripts/doc-budgets.manifest.json) 检查常设文档上限；失败时按[字数政策](../../../../../docs/AGENTS.md#wordcount-budgets)依次迁移、压缩、提高上限。上限是保护线而非减字目标；目标以内保留至少 5% 余量，只有内容确需空间才提高，并在 PR 解释 manifest 差异。

<a id="website-publication"></a>
## 网站发布

网站是经过测试的投影，不是第二份内容。[website/docs.ts](../../../../../website/docs.ts) 显式允许规范 docs/ 来源进入路由树，[project-doc-site.ts](../../../../../scripts/project-doc-site.ts) 重写到可丢弃的 website/.generated/，再由 VitePress 构建。仓库 Markdown 是唯一可编辑来源；官方译文保持同目录 foo.md、foo.zh.md、foo.i18n.yaml 三件套，不放语言目录。已发布页面只改规范来源，新页面增加 manifest 条目，移动／删除时原子更新来源、manifest 和入站链接；不编辑 generated/cache/dist。逐项设置 DocsPage 并遵守投影链接规则，详见[网站同步](references/website-sync.md)。内容进入构建不等于部署，发布须另行明确请求。

<a id="detailed-references"></a>
## 详细参考

只加载当前任务所需参考，各文件都由此处直接链接，避免深引用链。

- [元数据、链接与双语配对](references/metadata-links-i18n.md)：README frontmatter、kind 推导、description 语义、仓库路径、行对齐和 sidecar。
- [页面结构和层级](references/structure-hierarchy.md)：章节顺序、节摘要、从用户到开发者的递进、docs 位置、小规则文件、Further Exploration 和 Dev Note。
- [页面风格](references/style.md)：短摘要、`-----` 分隔、折叠内容和强调规则。
- [评审标准](references/review.md)：新人测试、证据检查、包 README 评审、范例和验证命令。
- [网站发布](references/website-sync.md)：manifest 字段、投影链接规则、预览验证和独立部署。

[`templates/`](templates/) 的四个 README 模板对应四种 kind，写作前打开所选 kind 的模板。

句子级契约覆盖和编辑判断使用 [dsh-prose-standard](../dsh-prose-standard/SKILL.md)。session-persistence-jsonl 双语 README（[英文](../../../../../packages/session/session-persistence-jsonl/README.md)、[中文](../../../../../packages/session/session-persistence-jsonl/README.zh.md)）展示可检索 YAML、摘要和目录、用户到开发者递进、折叠开发细节、进一步阅读、规范 Model Experience／Known Limitations，以及最终 Dev Note。

<a id="validation"></a>
## 验证

验证受影响格式，不只验证 Markdown 语法。强保证需要一个有效定向 fixture 和一个能证明顶层检查确实失败的无效 fixture。

- README 元数据：解析 YAML，将 kind 映射到模板和标准；拒绝 name、audience、无治理 tags、README 局部 i18n，以及缺失或广告式 description。
- 双语页面：核对结构、精确行数、术语、链接对应及 sidecar。
- 教程：实际走通入口，或明确人工验证责任方。
- 生成参考：执行确定性新鲜度检查并报告检索规模指标。
- 包 README：运行 Summary 检查，英文摘要最多 100 个 wc -w 风格词，失败回到技能和 kind 模板；运行 model-experience 和限制检查，行为声明变化时再做包定向测试；合并操作声明前重跑 README 中每条命令。
- Skills：运行仓库技能调用元数据检查。

先运行 `pnpm run test:docs` 的快速综合检查（配对、换行、链接、README、预算、技能元数据、Agent Note），再运行完整 `pnpm run doc-sync`。

<a id="dev-note"></a>
## 开发备注

无。
