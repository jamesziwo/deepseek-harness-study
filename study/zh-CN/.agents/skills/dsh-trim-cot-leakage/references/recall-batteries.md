> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-trim-cot-leakage/references/recall-batteries.md` · [英文原文](../../../../../../.agents/skills/dsh-trim-cot-leakage/references/recall-batteries.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`449529dfba146c46b533b14855b2b0ca354f97e99de17cad979bd0106284d497`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="recall-batteries"></a>
# 召回探针集

用于[分类规则](../SKILL.md#taxonomy)的探针，校准于 2026-08 清理。每个命中都需语义判断：有意多匹配，也天然漏匹配，历次评审都发现探针没抓到的案例，因此应结合不带模式地阅读范围内密集文字。

<a id="invocation-rules"></a>
## 调用规则

- 加 `--hidden --glob '!.git/**'` 以搜索 .agents/；rg 默认跳过点目录，而 Agent Notes 是原清理最大漏检风险。
- 排除放最后，避免后续 include 重新纳入：`--glob '!vendor/**' --glob '!node_modules/**' --glob '!.agents/notes/archived/**' --glob '!.agents/skills/dsh-trim-cot-leakage/**'`，另排除范围内录制 fixture 和快照。技能自身引用泄漏文字作校准；[所属笔记](../../../../../../.agents/notes/implemented/process/2026-08-09-committed-artifact-citations.md)也会因引用证据命中，应视为证据而非实际用法。
- 自然语言模式用 -i 匹配句首大写；匹配代码模式的首行保持大小写敏感，否则 `\bT\d\b`、`\bP-I\b` 会产生噪声。
- 给完整短语加边界，`\bthis PR\b` 应匹配 this PR adds，不匹配 this project/process/provider。
- 零命中在验证已知正例前不证明任何事；噪声模式在排除近似反例前也不可信。相信全库结果前先校准两边。
- 工作语言探针针对相反语言：在英文 Markdown／代码注释查中文残留，在 *.zh.md 查中文变更叙述。中文里通用 ASCII 搜英文会被代码标识污染，应对照另一语言检查新增正文。

<a id="english-battery"></a>
## 英文探针

```sh
rg -n --hidden '\(decision \d|\(audit [A-Z]\d|design §|plan §|design ledger|\(B ruling|\bP-I\b|\bW\d\b|\bT\d\b' ...
rg -n --hidden -i '\bthis PR\b|\bthis branch\b|\bthis stack\b|\blater PRs?\b|\bprevious commits?\b|\bthis commit\b' ...
rg -n --hidden -i '\bused to\b|\bno longer\b|\bpreviously\b|\bthe old\b|\bwas renamed\b|\bwas moved\b' ...
rg -n --hidden -i '\bv1\b|this cut|\bcut \d|\btoday\b|\bfor now\b|roadmap' ...
rg -n --hidden -i 'rejected in review|review round|reviewer|as of v\d' ...
rg -n --hidden -i 'probably |should be enough|should suffice|it simply|is safe —|is safe --' ...
rg -n --hidden '§\d' ...
```

<a id="chinese-batteries"></a>
## 中文探针

```sh
# Change or review narration in Chinese counterparts.
rg -n --hidden '评审|上一?轮|旧版|老的|不再|以前|本版|遗留' --glob '*.zh.md' ...

# Chinese authoring-language slips in English Markdown.
rg -n --hidden '设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留|私有|(^|[^a-zA-Z])端([^a-zA-Z]|$)' --glob '*.md' --glob '!*.zh.md' ...

# Chinese authoring-language slips in English code comments and JSDoc.
rg -n --hidden '(^[[:space:]]*(//|/\*|\*)|//|/\*)[^\r\n]*(设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留|私有|端)' --glob '*.{ts,tsx,js,jsx,mjs,cjs,css}' ...
rg -n --hidden '#[^\r\n]*(设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留|私有|端)' --glob '*.py' ...
```

<a id="known-false-positive-families"></a>
## 已知误报类别

原清理已判断保留，预计还会出现：

- **工具意义 used to：**“the key used to sign requests”表示用途，不是过去；时间义前面有主体状态，如 colors used to come from。
- **运行时新旧：**旧连接排空后新连接接受，指交接对象，不指仓库状态。
- **流程文档中的 This PR：**关于 PR 工作流、模板、过程说明可以合法谈 PR；禁止的是文档从某个具体 PR 视角叙述代码。
- **协议或路径中的 v1：**/v1/chat 及传输格式名称是标识，不是版本戳。
- **有已提交所有者的 §N：**外部标准及自有编号的已提交文档可按章节引用。
- **对比 actually、名词 wait：**正常英语而非含糊保留；当前探针未搜，只在扩展宽泛模式时出现。
- **运行时 today 和录制时间戳：**询问当前日期使用自然时间，不是仓库版本；录制 CLI 输出保留语气。到达模型或用户的文字改动仍需行为证据。
- **中文“本版本”：**在版本化产物上下文可翻译 this release；禁止的是对应 this cut 的裸“本版”时间戳。
- **备选方案章节：**Agent Note 的 rejected 属于允许文体，不是评审过程叙述。
