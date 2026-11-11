> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/references/style.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/references/style.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`62600401bc7d771e17aaefd93748432153def0502cbc38b9176cdc15cc6167af`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="page-style"></a>
# 页面风格

<a id="summary"></a>
## 摘要

让 DSH 页面便于扫描、不易误读的风格：短摘要、受控技术英语、主要部分间的 `-----`、标题可见的 details 折叠，以及克制强调。模板为 session-persistence-jsonl 双语 README。

<a id="table-of-contents"></a>
## 目录

- [简短摘要](#short-summary)
- [受控技术英语](#controlled-technical-english)
- [章节分隔](#section-separators)
- [可折叠内容](#foldable-content-sections)
- [强调规范](#emphasis-discipline)
- [开发备注](#dev-note)

<a id="short-summary"></a>
## 简短摘要

人工页面以三至五句、单段 Summary 开头，说明可做／可观察内容、价值、工作方式及关键边界。目录和正文承载细节，位置顺序见 [structure-hierarchy.md](structure-hierarchy.md)。英文包摘要还受 verify-package-readme-summaries 的 100 个 wc -w 风格词限制。

<a id="controlled-technical-english"></a>
## 受控技术英语

对代理、译者或非母语者需解析的英文，用受 [ASD-STE100](https://www.asd-ste100.org/) 启发的标准复查。这是清晰表达规范，不是认证合规；仓库不复制或校验该标准词典。

- 明确主体和动作，主体重要时优先主动语态。
- 每个概念使用稳定术语，不为多样性轮换近义词。
- 优先直接动词，有精确动词时替换名词化及歧义短语动词。
- 每句一个指令，三步或三个条件以上使用列表。
- 拆分分号和长从句链，每段一个主题。
- 移除无依据质量形容词和叠加保留措辞，保留来源全部事实及不确定程度。

指令 20 词、描述 25 词只是评审提醒，不是机械门槛。拆句会隐藏条件或关系时保留长句；绝不为长度删除或强化 must、may、never、时机、例外、数值等契约词。[文字标准](../../dsh-prose-standard/SKILL.md)负责完整命题规则。

<a id="section-separators"></a>
## 章节分隔

主要部分用独占一行、前后空行的 `-----` 分隔。紧接段落会解析为 Setext 标题；放在包 README 最后两个 H2 内会破坏 Model Experience 检查。模板顺序为头部→用法→折叠开发内容→进一步阅读→Model Experience。

<a id="foldable-content-sections"></a>
## 可折叠内容

开发细节和最终 Dev Note 用 GitHub 原生 details/summary 折叠。H2/H3 标题及其 a id 锚点保持可见，只折叠下方正文。summary 后留空行，Markdown 从第 0 列开始（缩进会成为代码块），关闭 details 前也留空行。内部标题、列表、表格、链接正常解析并保留锚点；参考 README 展示实现和 Dev Note 两种折叠。

包 README 最后两个 H2 保持 Model Experience、Known Limitations and Deferred Work。限制锚点紧跟 H2，避免进入前节正文；Dev Note 是限制节内带锚点 H3。明确豁免限制节的包可用 H2 Dev Note。

<a id="emphasis-discipline"></a>
## 强调规范

粗体留给改变行为的条款或重要比较。基准表按范例加粗列标题及每行最佳值。

<a id="dev-note"></a>
## 开发备注

无。
