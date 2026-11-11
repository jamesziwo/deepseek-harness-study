> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-find-simplifications/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-find-simplifications/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`03d56b6412abfaa770e406d680ee0bd3af2c8dd0499707aba3c0607279f22ff4`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-find-simplifications
description: 'Use when working in the deepseek-harness repo to find non-obvious simplification candidates, remove redundant comments or implementation-heavy documentation, write proposed Agent Notes or inline TODO/FIXME/XXX notes, audit or coalesce superseded Agent Notes, or fold worthwhile simplification ideas from another PR; especially for dead, duplicated, speculative, over-built, added-then-removed, or hand-rolled-where-a-dependency-exists surfaces.'
---
```


<a id="finding-deepseek-harness-simplifications"></a>
# 寻找 DeepSeek Harness 简化机会

把宽泛的“找可简化内容”转为有证据的 Agent Notes，移除或合并现有功能和接口。这是指导而非清单，应沿代码保持判断，宁要少量充分证明的候选，不堆薄弱猜测。

<a id="start-with-repo-context"></a>
## 从仓库上下文开始

- 阅读 AGENTS.md，尤其预稳定阶段立场及约定，包括测试和 Agent Notes 都不是绝对真理；再读[防御模式](../../../../../docs/defensive-patterns.md)和[测试策略](../../../../../docs/testing.md)。
- 判断 packages/ 前浏览[架构](../../../../../docs/architecture.md)；与服务地图或事件分类相冲突的简化需要额外证据。
- 用 Agent Note 树和[规则](../../../../../.agents/notes/README.md)理解有意架构。相关案例包括[移除可变会话摘要](../../../../../.agents/notes/archived/simplification/2026-06-19-drop-mutable-session-summary.md)、[基于句柄的持久化](../../../../../.agents/notes/implemented/architecture/2026-08-27-handle-based-session-persistence.md)、[仅 JSONL 第一方持久化](../../../../../.agents/notes/implemented/simplification/2026-08-30-jsonl-only-session-persistence.md)、[能力接口](../../../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)及双适配器笔记。
- 默认双 LLM 适配器是有意设计。会话持久化不同：JSONL 是唯一第一方提供方，但后端无关服务保留给外部提供方。未经用户明确覆盖约束，不把删除双适配器或持久化接口称为低成本简化；删除受保护接口内未用方法／钩子，只要不破坏设计仍可能有效。

<a id="what-counts-as-a-strong-candidate"></a>
## 什么是有力候选

有力简化确实移除、合并或降低某项机制的层级，并有清楚证据表明现有设计成本高于收益：

- 公开方法、事件、配置项、注册通知、辅助函数、包、持久事件或测试产物没有生产消费者。
- 只有测试／文档消费，且所固定的行为不承载必要约束。
- 两种表示镜像同一事实，尤其持久会话事件与临时 agent/* 事件之间。
- 接口要求每个实现支持某方法，却没有消费者使用。
- 独立包只容纳测试／演示／支持代码，却增加发布或依赖成本。
- 功能实现没有产品所有者的预设通用性，如多会话／加载、后台任务名单、实时注册失效、轮中引导、工具自有 UI。
- 不变量、回滚路径、预期输出或特例测试只保护未使用 API。
- 手写机制重复维护良好的依赖或最低 Node 版本已提供的功能，替换能删实现及专用测试，参见[依赖政策](../../../../../.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)。
- 简化后行为可能略有不同，但仍合理且更易解释。

修一个拼写、只跑一次 knip、移除明确保留后端／适配器，或无调用点证据地说“看起来复杂”，都不足以写 Agent Note。

<a id="audit-invariant-companions"></a>
### 审计不变量配套模块

只有比较独立产生且可能偏离的观察时，不变量配套才有价值。移除空安装器、仅检查服务存在／插件元数据／固定例子，或调用自身修改来验证自身的检查。省略时一并删除导出、构建入口、专用编译引用／依赖和测试，并在双语 README 写包特定理由。比较不同事件生产者、持久历史或独立可变数据的配套应保留，即使包已有同步输入校验。

<a id="survey-broadly"></a>
## 广泛调查

用户要求广度或多候选时使用并行子代理，为各代理分配领域，要求证据而非猜测。可选领域：

- 智能体循环和日志：turn/step、引导、取消、持久事件、重放、加载／恢复。
- ACP 自动化和人工 UI API：协议侧提示结算与释放，界面侧记录渲染和交互状态。
- LLM／工具／系统提示：流式／生成 API、组装器、注册表、schema 默认及呈现钩子。
- Bash 与工具执行：前台／后台划分、任务所有权、溢出输出文件和执行器方法。
- 包／示例／脚本／测试：包拆分、静态清单、冗余快照预期和支持包。

无子代理时自己覆盖同等广度，不要找到首个好候选就停止。

先看生产代码改动规模最大的区域。只停在显然未用符号，会漏掉重复生命周期和防御机制成本最高的文件。

<a id="simplify-prose-with-the-code"></a>
## 与代码一起简化文字

把注释和文档视为要维护的内容；涉及文字时应用 [dsh-prose-standard](../dsh-prose-standard/SKILL.md)。

- 删除复述代码或解释别处拥有行为的注释，保留必要本地契约。
- 文档保持在所属层，除非影响维护契约，否则省略实现细节和罕见情况。

<a id="audit-trust-and-lifecycle-boundaries"></a>
## 审计信任与生命周期边界

每个防御复制、冻结、验证器和回调捕获都要说明值来自哪里、下一任所有者是谁。同进程类型化服务通常只读借用；解析器、配置加载、队列、模型／工具 JSON、持久文件、worker、进程及传输解码器负责拥有或验证数据。恶意 getter、伪造类型对象、回调替换及同进程交接后修改的测试，可能提示臆测契约，不自动构成保留理由。

复杂异步代码画所有权图，将哨兵、就绪 Promise、取消路径、释放器和状态标志映射到独立所有者或转换。多机制镜像同一存活／结算事实时，提议统一事务或生命周期控制器；保护同步发布回滚、回调隔离、首个终止结果仲裁、进程所有权及完全释放的独立机制仍保留。

<a id="hand-rolled-code-versus-a-dependency"></a>
## 手写代码与依赖

引入依赖是合法简化，不是政策例外，[依赖政策](../../../../../.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)规定门槛。对协议解析、分帧、重试退避、glob、diff 等机制，检查维护良好的 npm 包或最低 Node 版本内建是否已覆盖。

按普通候选证明依赖替换，并补充：

- 阅读手写实现，明确依赖覆盖的精确范围；未覆盖语义计入替换成本并保留在笔记。
- 如实检查维护、采用量及传递依赖规模；最低 Node 版本已有功能时优先内建。
- 先看笔记树：schemastery、vendored Cordis、双适配器及已记录接口是已定设计；替换破坏它们时须胜过原理由，不能只引用政策。
- 衡量净删除：实现＋专用测试＋文档，减去残留胶水层。只搬迁同等复杂度的包装器没有收益。

<a id="prove-or-reject-each-candidate"></a>
## 证明或否决每个候选

每个符号或行为写提案前，先分类消费者：

- 生产：packages/*/src、examples/*/src、examples/**/*.yml、运行脚本及 Loader／配置路径。
- 非生产：测试、README／文档、Agent Notes、快照、生成预期和注释。
- 不明确：可能是产品冒烟入口的示例和脚本，先检查用途。

先用 rg 搜精确符号、事件、包名、配置键、`.name(` 与 `name(` 两种方法调用及传输字符串，再读调用点、公开接口、动态事件、测试、文档和 Cordis 加载路径。

以下情况拒绝或降低候选优先级：

- 存在生产调用方，变更属于功能决定而非清理。
- implemented 笔记或既有防御模式明确证明 API 必要，新证据未胜过原理由。
- 引发无关改动却不减少公开 API 或必需行为。
- 想法正确但太小，按[开发说明](../../../../../docs/development.md)紧急程度添加定向 TODO/FIXME/XXX 即可。

<a id="coalesce-superseded-agent-notes"></a>
## 合并被替代的 Agent Notes

用户要求缩减／合并笔记，或当前实现简化使所属笔记过时时才审计笔记树；不要把每次代码简化都扩成全仓库笔记审计。

用 [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md) 判断保留及归档。未来价值低的 implemented 作为冻结三件套移入 archived/{kind}；proposed 不归档；无法再防止诱人错误的 rejected 删除。简化当前文字或代码时不编辑归档笔记。

遵循 [Agent Note 删除规则](../../../../../.agents/notes/README.md#when-to-write-one)，不在此复制或削弱。每组候选链：

1. 从交付代码、配置、生成目录、包文档、新笔记和入站链接识别当前所有者；日期和标题只是线索。
2. 判断完整／部分替代。残存行为、当前契约、持久格式、兼容义务或仍有价值的被拒方案都使其为部分；可迁移到新所有者的理由本身不构成部分替代。
3. 完整替代时，将独特理由、替代方案、后果、已交付验证及具名覆盖缺口移入当前所有者；仅叙述已删除机制的清单不是决策事实。
4. 修复全部入站链接，再一起删除英文、中文及一致性记录。
5. 编辑后搜精确文件名、符号、配置键、事件名和传输字符串；部分替代保持交叉链接及当前状态。

先添加后删除的功能常是完整替代。只有生产代码、配置、schema、持久／传输格式、迁移、兼容均无该功能，当前文档不称可用，测试不视为支持行为时，才由删除笔记拥有历史。可保留删除理由和确保不存在的测试；保留原动机、为何不再成立、完整删除的替代方案、放弃能力、重新引入条件和删除完整性证据。仅验证旧行为的测试和机制不算当前证据。

若只删除某传输、默认、实现或呈现方式，持久数据／兼容仍在，或删除笔记理由不足以防止误加回来，则拒绝合并。实现已消失时，仍有效的否定设计决定也可有独立笔记。

<a id="write-the-agent-note"></a>
## 编写 Agent Note

每个长期提案在 `.agents/notes/<lifecycle>/<class>/yyyy-mm-dd-topic.md` 建一个文件，遵循 README 的生命周期及分类；段落单物理行，使用相对 Markdown 链接。

优先以下结构，按需要调整：

- `# Agent Note: <action-oriented title>`
- `Status: proposed`
- `## Problem`：指出当前 API、相关文件和消费者证据，生产调用与测试／文档分开。
- `## Proposal`：精确说明移除、合并、降级或迁移什么；适用时包括测试、文档、README、JSDoc、事件分类、快照及生成文件清理。
- `## Why not keep it?` 或 `## What we give up`：清楚呈现最强反对理由。
- `## Acceptance criteria`：可观察终态及检查。
- `## Risks`：公开 API、行为、未来产品需求，以及取舍为何仍合理。

具体到实施 PR 可循证推进，避免“简化这个包”式空泛笔记。与已有笔记重叠时，将有用细节合入所属笔记，不新建重复。

<a id="inline-todo-notes"></a>
## 行内 TODO

TODO/FIXME/XXX 只用于明确有用、小而局部、非长期设计决定的清理，保持简短可行动：

- 用稳定标签命名问题，如 `TODO(double-default)`、`XXX(unused-default)`。
- 说明为何可安全重审、采取什么动作能简化。
- 不为臆测抱怨或需要 Agent Note 级决策的行为加 TODO。

<a id="when-folding-another-pr-or-branch"></a>
## 合并其他 PR 或分支时

将兄弟分支与 origin/master 比较，而非当前 PR 分支，以看清独立贡献。逐项处理：

- 移植不重叠且达到质量标准的笔记／TODO。
- 重叠内容合入已有主题所有者。
- 不为保留数量移植重复或低置信提案。
- 更新 PR 正文，让评审者看到真实数量和范围。
- 只有用户要求或明确属于自己收尾职责时才关闭重复 PR。

<a id="validation-and-pr-hygiene"></a>
## 验证与 PR 整理

纯文档 Agent Note 至少运行 `pnpm run doc-sync`、`pnpm run lint`、`git diff --check`。代码注释或 skill 改动有专门验证器时也运行；其他证据按待推送差异选择，pre-push 只贡献类型检查。

创建／更新 PR 时总结：

- 新增、合并、作为部分替代保留或删除的 Agent Notes 和行内说明数量。
- 主要调查领域。
- 有意排除的内容。
- 已通过的检查。

每组合并说明旧／新所有者、完整替代证据及删除安全原因。扫描先增后删功能却无合格笔记时，如实报告并列代表性的部分保留案例。

调查仍扩展时使用草稿 PR；候选集合、评审回应和验证稳定后才标 ready。
