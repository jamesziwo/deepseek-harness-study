> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-trim-cot-leakage/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-trim-cot-leakage/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`d81b60699eec7413183b4fbb7a26a940bedde2f816dba0eccbfa453549292dcc`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-trim-cot-leakage
description: Use when auditing or fixing prose that reads like a leaked reasoning transcript — dead design-session citations such as (decision N), audit item codes, or §N of uncommitted drafts; change narration such as "used to", "no longer", "this cut"; stack or review vantage ("a later PR in this stack", "rejected in review"); reviewer-addressed justifications; control-flow narration; or hedged planning residue in comments, JSDoc, docs, or Agent Notes.
---
```


<a id="trimming-chain-of-thought-leakage"></a>
# 清理推理过程泄漏

推理过程泄漏指文字站在编写会话而非仓库视角：引用仅会话可见产物、叙述变更而非状态，或与已离开的评审者争论。段落有事实时不能只删，应将每项改写为 HEAD 可独立成立的事实，再删周围过程；不含事实的审计码或控制流叙述直接删除。**必读背景：**[文字标准](../dsh-prose-standard/SKILL.md)规定完整命题，[提交产物引用说明](../../../../../.agents/notes/implemented/process/2026-08-09-committed-artifact-citations.md)规定引用理由。本技能是指导，不是脚本。

<a id="the-one-test"></a>
## 唯一判断问题

问：**HEAD 的读者不访问会话记录、PR 线程或未提交草稿，能否解析所有引用并核验全部声明？** 不能则从仓库视角重述仍有效事实，删除其余。能则不属于泄漏，即使听起来历史化；但可解析只通过本技能标准，README／docs／JSDoc 的可解析变更故事仍是历史叙述，应按第 3 类移到允许位置。

<a id="taxonomy"></a>
## 分类

1. **失效设计会话引用：** decision 7、audit C2、design §4.7、plan §1.4、T4/W3/P-I、“设计台账”“B 裁决”等。有已提交所有者则引用名称及路径，否则删引用并独立重述事实。
2. **栈／PR 视角：**“本栈后续 PR”“本 PR 添加”“上个提交”。改写交付机制或扩展点，待办移到 TODO 或 issue。
3. **变更叙述及版本戳：**“以前”“不再”“旧 X”，以及与过去对比的 v1、此版、今天、现在。写当前行为，已修回归改为现在时反事实“没有 X 就会 Y”，不写仓库历史“过去会 Y”。
4. **评审过程：**“评审拒绝”“评审者确认”、草稿序号和轮次归因。保留决定及理由为普通事实，删谁何时说。
5. **面向评审者的辩解：**“类型转换安全，因为它只是……”“这是正确的因为……”。维护者需要安全不变量，而不是自辩；代码已表达时删注释。
6. **复述与推导：**“先 X 后 Y”的控制流叙述、测试步骤、显然分支证明。删除，只保留非显然契约／不变量。
7. **保留措辞和计划残留：**“暂时大概没问题”“应该足够”、无标记延后。提升为 TODO/FIXME 或实际限制，删含糊措辞。
8. **写作语言残留：**英文中未翻译的“端”“设计稿”“---- 私有 ----”等工作语言片段，或中文中的反向情况，翻译或删除。

<a id="what-is-not-leakage"></a>
## 哪些不算泄漏

缺少指导的引用清理既会误删长期引用，也会保留失效引用。严格按以下保留规则，[示例](references/examples.md)逐项校准：

- **Issue 引用：**#1470、TODO(name)、由 issue #N 负责后续，在 HEAD 可解析；所有位置包括 README 都保留，不移到 Agent Notes。
- **笔记／复盘中的已合并 PR 和 issue：** 属于[文档标准](../../../../../docs/AGENTS.md)允许的历史证据。
- **抑制理由：**oxlint-disable 原因、coverage-ignore 原因、空 catch 说明属于必需文字；错误则修正，不删除。
- **现在时反事实回归说明：**“没有 X 会 Y”“简单做 X 会……”属于有效约束。
- **实测边界：**用于校准常量的“measured: 512 nests ≈ 0.15s”，“实测”来源词承载意义。
- **运行时新旧状态：**“旧连接排空后新连接才接受”是生命周期，不是变更史。
- **笔记历史节的阶段名：**“首版交付 X”在历史节安全，但“此版”指示性版本戳到处都禁止。
- **按设计在仓库外解析的引用：**RFC 9110 §10.1.5、Figma 帧名；§ 禁用针对未提交内部稿，不针对外部标准或拥有章节编号的已提交文档。
- **项目口吻与文体：**项目立场的“我们”，以及笔记 Alternatives considered 章节。

<a id="workflow"></a>
## 工作流

1. 按[文字标准](../dsh-prose-standard/SKILL.md)明确 scope，绝不触碰 vendor/ 和归档笔记。录制 fixture／快照是派生物，不是文字目标；仅获授权行为变更需要新证据时，改所有者并重生成。
2. 先只读审计，运行[召回探针](references/recall-batteries.md)，加 --hidden 搜 .agents/；先用已知正例和近似反例校准，再逐项语义判断。探针不是定义，原清理每轮评审都发现漏检，因此也要不依赖模式直接读范围内最密集的模块 JSDoc、README 和笔记。
3. 按位置先改所有者：生成目录先追消费者、改 JSDoc／模板再重建；type-equiv 先改源码，再重贴双语围栏；双语文字按[轻量流程](../../../../../docs/AGENTS.md#writing-rules)最小同步并重录；双语代码围栏按 [dsh-doc](../dsh-doc/SKILL.md)逐字复制修正块再重录；模型／用户可见字符串依[文字标准](../dsh-prose-standard/SKILL.md)，仅有所属行为证据才改，否则保留并报告延后。
4. 删除前列出命题，并检查[矫枉过正陷阱](references/examples.md#overcorrection-traps)：不能把义务变背书、假设变已交付功能、删真实事实或丢来源。
5. 重跑探针，预期只剩允许保留、技能自身及所属笔记引用证据；确认剩余引用均能在 HEAD 解析；运行受影响检查，文档 doc-sync、类型等价和翻译配对。
