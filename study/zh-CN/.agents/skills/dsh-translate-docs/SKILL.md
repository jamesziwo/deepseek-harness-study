> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-translate-docs/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-translate-docs/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`198f0edaed6322d86761255cedd0f9f572025174a226742a447b7bb11e1904e5`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-translate-docs
description: Manually run the extended DeepSeek Harness bilingual-document workflow, including generated briefings, delegated prose translation, whole-document translation, and scoped pairing verification.
disable-model-invocation: true
user-invocable: true
---
```


<a id="translating-deepseek-harness-docs"></a>
# 翻译 DeepSeek Harness 文档

<a id="invocation-boundary"></a>
## 调用边界

仅当用户明确点名 dsh-translate-docs 时运行此扩展流程。普通文档工作、其他技能或推断翻译需求都不得自动选择／加载；常规翻译遵循 [docs/AGENTS.md](../../../../../docs/AGENTS.md) 的一次性单轮规则。

<a id="what-this-skill-is"></a>
## 本技能的定位

**这是指导，不是翻译记忆库。** 它是保持 foo.md 与 foo.zh.md 一致且自然的流程地图。两语言同等权威，任一边可作为本次更新来源。执行者是译者，规则规定必须保持什么，不规定具体句式；措辞由你判断，术语不由你随意决定。

<a id="triage-by-change-type--this-decides-everything-else"></a>
## 按变更类型分流

- **更新：** 已有配对且一边编辑时，走[简报驱动更新](#the-update-path-briefing-driven)。刻意低成本，不读全套指导、不考古 Git，只最小修改另一边。绝不为更新重译全文，否则丢弃未变文字已有评审成果。
- **新配对：** 尚无另一语言时走[全文路径](#the-whole-document-path-new-pairs)。
- **删除／改名：** 同时删除／改名另一语言和 .i18n.yaml，否则检查会报配对不完整。

归档 Agent Notes 不属于翻译工作，其三件套已封存，归档后绝不更新、重录或修复任一语言。

<a id="the-update-path-briefing-driven"></a>
## 更新路径：简报驱动

简报路径以很小成本达到指导资料流程质量，基准证据见[归档说明](../../../../../.agents/notes/archived/process/2026-07-26-briefed-minimal-translation-updates.md)。

1. **生成简报：** `pnpm run gen-translation-brief <any file of the pair>`，无参数则覆盖全部不同步配对。以最窄安全对齐粒度映射变化：Markdown 单元（段落、表行、列表项、标题），其次整节，最后全文；包含自最后确认状态以来的来源差异，各单元最后确认来源／当前来源／当前另一语言及行号、相关术语、首次出现位置变化和绑定规则摘要。
2. **仅机械差异则 --apply。** 全部变化都在共享且字节相同的围栏内时，简报会说明；`pnpm run gen-translation-brief --apply <pair>` 拼接已改围栏，结构验证后写入，无需子代理或手改。
3. **文字差异交给子代理，并传简报或生成命令。** 简报就是完整工作集，含规则、术语和三方上下文，子代理不重读指导、不重算差异。仅遇具体决策确无法回答时，才升级到全文权威来源，例如周边无先例的未列术语，或两边都改／单元和章节均不对齐的全文简报；后者须按[翻译规则](../../../../../docs/i18n/translation-rules.md)人工协调。
4. **用覆盖差异的最小编辑。** 保留未受影响的已审措辞，逐子句对照变更：不增不漏、术语按表、代码片段原样。
5. **定向记录和验证：** 先 `pnpm run verify-translation-pairing --write <pair>`，再无 write 验证。write 必须点名已确认配对，拒绝裸运行，批量必须显式 --all。全库检查留给 doc-sync／CI，不每次更新都跑。

<a id="the-whole-document-path-new-pairs"></a>
## 全文路径：新配对

从零翻译时，编排代理不亲自翻译，而创建子代理执行。译者先读下列权威来源，再翻译全文；长文按节推进，边译边锁定结构，不等末尾修结构。

<a id="sources-of-truth-read-dont-re-summarize"></a>
### 权威来源：阅读，不重新总结

- **[配对契约](../../../../../docs/i18n/README.md)**：foo.md、foo.zh.md、foo.i18n.yaml 三件套、双方 blob 哈希、语言切换、范围及排除。
- **[翻译规则](../../../../../docs/i18n/translation-rules.md)**：忠实、结构、术语和排版的 MUST／SHOULD 要求。
- **[术语表](../../../../../docs/i18n/terminology.md)**：双向绑定。翻译前加载，不等不确定才查；没注意的术语最容易漂移。
- **[翻译提示模板](../../../../../docs/i18n/translation-prompt.md)**：自动流水线的校准模板。代理使用技能时不渲染它；自动渲染器只注入术语表，而本技能及 translation-rules 仍约束代理译文。
- **[文字标准](../dsh-prose-standard/SKILL.md)**：必要覆盖与编辑判断，两边都应用，但不增删来源命题。

<a id="translate"></a>
### 翻译

- **第一遍，重述而非字词转置。** 读语义单元，再以最接近[风格样本](../../../../../docs/i18n/style-samples.md)的母语技术作者方式重述；保持框架，不强迫逐句对应。
- **第二遍，逐子句对源验证。** 检查不增不漏、术语按表、代码原样；发现问题用自然句式重写，不补丁式塞词。
- **独立读译文。** 对照后离开原文单读，修正只有独立阅读才显露的生硬表达。
- 文件只写最终文本，不写草稿或备注。
- 术语表每项精确遵循。中文按中文及首次出现列；未列术语需可引用的中文开源／厂商先例，否则保留英文并列入“待定术语”。英文使用表中英文及成熟术语；歧义来源词保留并短注，列为待定，不能临时发明译法。
- 配对代码块包括注释都须字节一致。相对文档链接保持同语义目标及精确 query／fragment；活动双语范围中英文用 .md、中文用 .zh.md，缺少应有对应文档是错误；范围外保留原路径，语言切换是跨语言例外。
- 配对检查覆盖标题层级、围栏、表行列数、列表类型及起始编号／项数、链接语言和语义目标。第二遍人工核对列表／表顺序、非规范编号、行内代码、强调、含义、术语和语气。

<a id="find-the-work"></a>
## 找到待处理项

- `pnpm run verify-translation-pairing --list` 列全部范围文档为 missing／out-of-sync／ok；前两种违反契约，正常检查会拒绝。
- 无参数 `pnpm run gen-translation-brief` 为全部不同步配对输出简报。
- 修改配对文档的 PR，其差异本身就是清单；每个变动的一边都要同 PR 更新另一边并重录，遗漏会使检查失败。

<a id="finish-the-pair"></a>
## 完成配对

1. 中文 H1 后立即放 `[English](foo.md) | 中文`，英文 H1 后放 `English | [中文](foo.zh.md)`；新配对补齐两边。生成器拥有的英文来源例外，保持与生成输出字节一致且不加切换，但中文仍链接回英文。
2. `pnpm run verify-translation-pairing --write <pair>` 计算双方完整 blob 哈希写入 foo.i18n.yaml。PR 中此差异表示“已确认两边含义相同”，只有真正确认后才运行。
3. 普通文档无需 manifest 条目，范围内来源都要求配对。只有所属政策规定真实的生成、指令型或结构自带双语豁免时，才改 [manifest](../../../../../scripts/translation-pairing.manifest.json)。
4. PR 前触及配对的定向检查须通过；按 [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) 在 PR 级运行一次 doc-sync（含全库配对、换行、链接），不在每个翻译任务内重复。
5. PR 保持可评审，区分新配对与最小更新，显著列出“待定术语”。

<a id="how-to-respond-to-translation-review"></a>
## 回应翻译评审

遵循[评审报告指南](../dsh-code-review/SKILL.md#reporting-findings)，逐条按技术判断。术语表是契约，评审采纳的译法应写入[术语表](../../../../../docs/i18n/terminology.md)，不只修一份文件。
