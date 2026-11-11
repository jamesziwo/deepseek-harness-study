> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-code-review/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-code-review/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`6c862b17bca7d15f13665cfbc7dce9b6456570e42941563178034d69393072a2`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-code-review
description: Use when reviewing a pull request in the deepseek-harness repo — orients the reviewer to this codebase's standards (AGENTS.md conventions, defensive patterns, ADRs, quality gates) and the review-specific checks that code alone can't show
---
```


<a id="reviewing-a-deepseek-harness-pr"></a>
# 评审 DeepSeek Harness PR

**本技能是指导，不是完整检查表。** 核对并获取 PR 当前基线和精确头提交，先运行 `pnpm --silent run change-scope --base <verified-base-ref> --head <verified-head-ref>`，再读差异及足够周边代码。范围报告识别路径和未提交层，不能代替语义评审；重新定向或合并后重核基线并重跑。正确性、生命周期、安全和必需行为优先于风格；一条证据充分的阻塞项胜过一串细枝末节。

<a id="sources-of-truth"></a>
## 权威来源

- [AGENTS.md](../../../../../AGENTS.md) 与 [packages/AGENTS.md](../../../../../packages/AGENTS.md)：仓库及包的常设编写规则。
- [docs/defensive-patterns.md](../../../../../docs/defensive-patterns.md)：子进程、回调、异步状态和释放缺陷类别。
- [docs/AGENTS.md](../../../../../docs/AGENTS.md)：文档位置和文字规范。
- [dsh-prose-standard](../dsh-prose-standard/SKILL.md)：注释、文档、提示词及可见字符串的必要覆盖和编辑判断。
- [dsh-ci-test-reliability](../dsh-ci-test-reliability/SKILL.md)：资源、异步或偶发测试／fixture 的隔离及回归证明规则。
- [docs/testing.md](../../../../../docs/testing.md) 与[质量检查说明](../../../../../.agents/notes/implemented/process/2026-06-11-quality-gates.md)：测试分层和必需检查。
- [Agent Notes](../../../../../.agents/notes/README.md)：设计理由；与笔记不一致应作为设计讨论，不自动否决。
- 双语变更需读 [translation-rules.md](../../../../../docs/i18n/translation-rules.md) 和 [terminology.md](../../../../../docs/i18n/terminology.md)；扩展翻译技能不属于自动评审，仅在用户明确调用时运行。

<a id="blocking-requirements"></a>
## 阻塞性要求

1. **新增文字必须语义评审。** 用 [dsh-prose-standard](../dsh-prose-standard/SKILL.md) 审查新增／修改的 Markdown、JSDoc、注释、提示词、描述、诊断和可见字符串。对照所属代码或行为检查完整性、准确性、位置和编辑质量；自动检查不能证明这些性质。
2. **文档与代码一致。** 配置、默认值、错误、传输字段、事件和公开行为变化，须同差异更新包 README 和 JSDoc。注释说明非显然契约；实现叙述、测试过程、评审历史及重复理由应删除或链接唯一来源。
3. **核心类型文档一致。** 核心或能力接口概念变化须更新对应[子系统](../../../../../docs/subsystems/README.md)页面及 type-equiv 条目；内部类型无需目录条目。
4. **注册能够清理。** 每项新注册贡献都须通过 [packages/AGENTS.md](../../../../../packages/AGENTS.md) 要求的释放测试。
5. **不变量配套模块具有语义。** 修改 ./invariant 时，须存在该包可观察且拥有的事件流／可变数据关系，并有独立观察。服务或方法存在性、插件元数据/effect、固定纯示例、调用同操作来“验证自身”的探测，应属于加载、行为或单测。没有合理关系时应省略配套模块及发布配置，并在 README 记录包特定原因。拒绝空安装器和臆造检查，见[仓库规则](../../../../../AGENTS.md#conventions)及[包规则](../../../../../packages/AGENTS.md)。
6. **必要证据存在。** 核对作者运行了与差异相关的[本地检查](../../../../../AGENTS.md#run-relevant-checks-locally)，CI 覆盖完整矩阵，并评审两者都检测不到的语义缺口。
7. **客户端文案由语言层负责。** 拒绝 JSX、模板、辅助函数返回、无障碍属性或基础组件默认值中的硬编码产品文案；要求类型化词典键、标准 t 入口或显式本地化属性、verify-client-ui-i18n 及各受影响语言的行为证据；用户／模型／传输数据和代码标记原样保留。

<a id="manual-checks"></a>
## 人工检查

- **意图和接口契约：** 追踪每个变更接口的两端，核对实现与 PR、Agent Note 一致，包括错误、取消、所有权及释放。
- **生命周期与并发：** 异步准备、回调、进程及释放遵循[防御模式](../../../../../docs/defensive-patterns.md)。检查发布前竞态、等待中取消、独立报错、回调隔离、重入前所有权、完整 detach 及等待工作结束的释放。
- **能力与消费者适配：** 追踪当前消费者，按[包规则](../../../../../packages/AGENTS.md)指出消费者特有行为泄入接口；也检查反向问题：通用服务新增公开方法却只有单一内部消费者，属于不必要 API 扩大，应在构造时传递私有能力闭包。
- **范围、所有权与必要性：** 为每个抽象、状态机、选项、防御复制、兼容路径找到当前契约、生产消费者和所属插件／服务。质疑无关功能及臆测通用性，并对照[根规则](../../../../../AGENTS.md#conventions)。
- **配置与公开选择：** 每个默认值、公开操作集合、格式或引入外部概念须有当前消费者证据或既有实践；缺失时要求显式选择或延后。
- **模型视角：** 检查各受影响模式实际发送的提示、工具 schema、结果和诊断，指出任务之外概念；稳定文字逐字核验，动态行为通过快照或端到端覆盖验证。
- **实际执行约束：** 沿每条拒绝路径找到执行操作，测试可绕过 schema、提示、门面、包装器或监听器顺序的直接和替代调用方。
- **借用与派生状态：** 按包契约确认保留值是借用还是自有，将通知、缓存、提示、界面回显、重放和查询视图追踪到规定成功点及权威来源。
- **限制覆盖最终操作：** 找到包含包装和元数据的完整输出／保留结果所有者；测试极小、精确上限、超大单块及多字节文本的字节限制。
- **真实入口：** 相关测试要经过交付的 Loader、bin、worker、ACP 桥或子进程。手工挂插件无法发现无效 Loader 导出；函数插件必须具名导出命名空间，不得有默认导出。
- **测试力度：** 断言应能捕获预期回归，验证外部状态、日志、事件或释放，而非复述实现或信任代理自报。覆盖率必要，但不证明情景正确。
- **测试可靠性：** 资源型、异步、平台敏感或偶发测试，用 [dsh-ci-test-reliability](../dsh-ci-test-reliability/SKILL.md) 检查真实 worker／任务拓扑、分配、全局恢复、同步、超时预算和完全释放。
- **不变量生命周期及反例：** 尽可能在发布前拒绝候选无效观察；会话检查须在迟加载／热重载后重建持久历史；故意无效情形须通过真实 runner 按预期规则失败。
- **Implemented 笔记符合交付现实：** PR 实现 proposed 笔记时，同一差异移动并改写为现在时的已交付状态，核对路径、名称和机制。
- **对话记录变化：** 编辑器或模型可见变化须更新快照，或说明为何不适用；把预期输出差异视为行为变化，不是格式噪声。
- **双语变化：** 比较两边含义和术语；配对哈希通过不代表翻译质量。

<a id="reporting-findings"></a>
## 报告发现

说明缺陷、位置、影响和证据。局部缺陷放最小相关差异行内，跨模块架构、范围或总体结论放 PR 级评论。区分阻塞项与建议，省略已被通过检查强制保证的问题。回复沿用已有评审线程；收到评审时逐项核验并依据技术修复或反驳，不做表演式赞同。
