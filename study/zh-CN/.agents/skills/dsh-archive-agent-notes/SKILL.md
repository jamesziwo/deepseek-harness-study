> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-archive-agent-notes/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-archive-agent-notes/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`5500e960a645be6f842fc8506817c3ef4132182edd79804fc5595f68fddba314`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-archive-agent-notes
description: Use when adding, auditing, pruning, archiving, restoring, or reviewing Agent Notes in deepseek-harness; checks every new note for superseded active records, classifies implemented notes by future decision value, deletes rejected notes that no longer prevent a tempting fallacy, and applies the frozen archived/{kind} triplet and manifest rules.
---
```


<a id="archive-deepseek-harness-agent-notes"></a>
# 归档 DeepSeek Harness Agent Notes

缩减活动决策资料，同时保留仍能指导工作的历史。逐条按语义判断，字数和年龄只是发现线索，绝不是归档标准。

<a id="read-the-contracts"></a>
## 阅读约定

分类前阅读 [Agent Note 规则](../../../../../.agents/notes/README.md)、[归档说明](../../../../../.agents/notes/archived/AGENTS.md)及适用的活动生命周期说明。结合当前代码、配置、包文档、生成目录、新笔记和入站链接，判断理由是否仍拥有或约束某项决策。

<a id="check-supersession-when-adding-a-note"></a>
## 新增笔记时检查替代关系

每篇新 Agent Note 都要定向审计覆盖相同决策、机制或被拒方案的活动笔记。写新笔记时分类完整／部分替代：同一 PR 归档符合条件的 implemented 三件套；保留并交叉链接部分替代或仍独立有价值的理由；拒绝过时提案；删除已无法防止合理错误的 rejected 笔记。新所有者吸收全部独特命题时应用合并规则，不把已知匹配延后到全库审计。

<a id="classify-by-future-value"></a>
## 按未来价值分类

按生命周期采用以下结果：

- **Implemented，保持活动：** 理由、替代方案、禁止性保证、持久／传输语义、所有权边界、安全规则或重新引入条件仍可能指导后续修改时保留，长度不重要。
- **Implemented，归档：** 已交付决策完成，正文不太可能指导后续工作时归档，例如一次性小界面行为、窄适配器、已解决小缺陷、被替代实现细节，或当前行为已由别处明确表达的过程历史。
- **Proposed，绝不归档：** 有效提案保持活动；不再值得推进时，以诚实理由拒绝并满足 rejected 格式。
- **Rejected，仅作为防错说明保留：** 只有失败方案仍是诱人且有意义的错误、笔记解释了为何不选它时保留。
- **Rejected，删除：** 被拒想法过时、被替代、不再合理或无法防止重复争论时删除整套三文件，并修复或删除入站链接。

不要为达到配额而归档。检查范围内每篇笔记，按同一原则分类相似组，临界情况运用判断，并记录真正有争议的决定供交接。

<a id="calibrated-examples"></a>
## 判定示例

以下示例校准标准，字数用于说明大小不是判断依据。

可归档的 implemented 示例：

- 折叠侧栏控制条，533 词：已结束的小界面行为。
- Commander 参数适配器，1,498 词：实现细节很多，但对未来设计帮助有限。
- 文档图谱，920 词：文档机制已完成，当前生成器才是权威来源。

应保留的 implemented 示例：

- 事件溯源会话，248 词：基础权威来源及持久化边界。
- 唯一 Harness-home 解析器，596 词：跨产品所有权规则。
- 项目会话目录，628 词：持久存储及身份策略。
- 并行 pre-push 检查，400 词：临界情况，但仍指导调度和资源调优。
- 丢弃图像内容块，334 词：在多模态支持完成前保留，因为说明了协调重新引入的条件。

对于 rejected 笔记：

- 保留“合并压缩包拆分”，426 词：合并包仍是值得防止的诱惑。
- 删除“通过工具调用流式传递工作流进度”，972 词：其 ACP／UI 前提已过时。
- 删除“移除 ACP 终端元数据”，362 词：后来的仅自动化 ACP 决策已解决问题。

<a id="archive-one-implemented-triplet"></a>
## 归档一套 implemented 文件

1. 将完整 `foo.md`、`foo.zh.md`、`foo.i18n.yaml` 从 `implemented/<kind>/` 移到 `archived/<kind>/`，归档路径刻意不带 implemented。
2. 不改正文，只在两种语言的 `Status: implemented` 下立即插入相同归档日期 `Archived: YYYY-MM-DD`。
3. 仅针对这两处元数据改动机械更新 sidecar 哈希；不翻译、重排、更新事实或修复笔记内链接。
4. 搜索活动文字的入站链接，改向当前权威文档；只有有意引用历史快照时才指向归档路径，否则删除。绝不校验或修复归档笔记的出站链接。
5. 运行 `pnpm run verify-archived-agent-notes --write`。只追加模式先确认已有封存一致，再添加新三件套哈希；随后运行常规验证器。

封存后绝不编辑、移动、翻译、格式化或删除该三件套。归档笔记可作为入站链接目标，但只是历史快照，不是当前行为权威。

<a id="validate-and-report"></a>
## 验证与报告

运行归档验证器的定向测试、`pnpm run verify-archived-agent-notes`、`pnpm run doc-sync`、`pnpm run lint`、`git diff --check`；按 [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) 选择补充证据。

报告保留／归档的 implemented、保留／删除的 rejected、被拒的 proposed，以及真正临界案例的字数和决定。不声称归档出站链接有效，因为验证器刻意不检查它们。
