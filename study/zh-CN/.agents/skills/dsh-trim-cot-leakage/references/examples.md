> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-trim-cot-leakage/references/examples.md` · [英文原文](../../../../../../.agents/skills/dsh-trim-cot-leakage/references/examples.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`b2e1dc11a783f80db6090bb444898362024b88d2d5987524f33824ffca80ac45`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="few-shot-leakage-examples"></a>
# 推理过程泄漏示例

由 2026-08 全库清理及评审提炼。用于识别原则，不作文字模板。本文件有意引用泄漏措辞作校准，[召回探针](recall-batteries.md)排除技能目录，不能据此允许别处同样写法。

<a id="dead-citations"></a>
## 失效引用

<a id="decision-ordinal-with-a-committed-owner"></a>
### 有已提交所有者的决策编号

**泄漏：**“斜杠输入根据可见目录解析（decision 21）。”

**修复：**“斜杠输入根据可见目录解析，即由 [Web 输入状态机说明](../../../../../../.agents/notes/archived/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)负责的纯文本引用决策。”

编号在 HEAD 无法解析，决策名和所属路径可以。每文件至少出现一次所属路径，支持链接时使用链接；后续可只用可搜索名称。

<a id="decision-ordinal-without-an-owner"></a>
### 没有所有者的决策编号

**泄漏：**“注册表拒绝重复名称（decision 7：名称平铺，无命名空间）。”

**修复：**“注册表拒绝重复名称；名称平铺，不设命名空间。”

没有已提交产物拥有 decision 7，因此删除引用，但平铺名称的事实须独立重述，不能一起删掉。

<a id="audit-item-codes"></a>
### 审计项代码

**泄漏：**“渲染是纯函数：相同快照得到相同字符串（audit R3）。”

**修复：**“渲染是纯函数：相同快照得到相同字符串。”

仓库没有该审计文档，代码只是无事实命题的会话速记。

<a id="section-numbers-of-uncommitted-drafts"></a>
### 未提交草稿章节号

**泄漏：**“分层遵循设计 v2 §3.2：`src/core/` 是纯核心。”

**修复：**“分层：`src/core/` 是纯核心。”

未提交草稿的 §N 无法解析；“按 RFC 9110 §10.1.5 转义”则保留，因为外部标准按设计在仓库外解析，已提交且自有章节编号的文档也可按节引用。

<a id="plan-phase-labels"></a>
### 计划阶段标签

**泄漏：**“`src/client/` 是外壳（T4）；P-I 迁移负责适配器。”

**修复：**“`src/client/` 是外壳；适配器位于 `src/client/adapters/`。”

阶段标签索引未提交计划，应替换为该阶段实际产物。

<a id="stack-and-pr-vantage"></a>
## 栈和 PR 视角

<a id="stack-position-in-durable-prose"></a>
### 长期文字中的栈位置

**泄漏：**“未来远程后端实现此接口，沙箱后端在本栈后续 PR。”

**修复：**“远程后端可实现该接口，无需改变渲染层。”

长期文字看不到栈；保留扩展点契约，待做工作属于 PR、TODO 或 issue。

<a id="this-pr-in-a-readme"></a>
### README 中的“本 PR”

**泄漏：**“本 PR 为会话列表加入游标分页。”

**修复：**“会话列表按游标分页。”

README 生命周期长于 PR，应以当前事实说明机制。

<a id="change-narration-and-version-stamps"></a>
## 变更叙述和版本戳

<a id="war-story-with-a-pr-number"></a>
### 带 PR 编号的历史故事

**泄漏：**“颜色以前来自未定义的 `--widget-*`，所以始终显示回退值；别名 token 修复了它（PR #88）。”

**修复：**“颜色来自别名 token；未定义 token 会显示回退值。”

当前机制和持续存在的失败行为都以现在时保留，缺陷经历归 PR 和笔记。

<a id="removal-narration"></a>
### 删除过程叙述

**泄漏：**“probe 字段随删除版本消失，徽章现在走通用投影对。”

**修复：**“徽章使用通用投影对。”

没见过 probe 的读者无法从其缺失获益；与已删过去对比的“现在”就是版本戳。

<a id="fixed-regression--counterfactual-present"></a>
### 已修回归转为现在时反事实

**泄漏：**“以前会对多字节标签重复编码。”

**修复：**“没有字节长度保护，多字节标签会重复编码。”

回归说明以现在时反事实保留并点名保护；“以前”只把它绑在仓库考古上。

<a id="indexical-version-stamps"></a>
### 指示性版本戳

**泄漏：**“此版批量渲染同步，异步路径在路线图。”

**修复：**“批量渲染是同步的。”延后内容放调用点 TODO(widget-batch)。

“此版／v1／今天”合并即可能过时；笔记历史节的“首版交付 X”可以，指示性形式不可以。

<a id="review-choreography"></a>
## 评审过程

<a id="review-verdicts-as-prose"></a>
### 把评审裁决写成正文

**泄漏：**“评审拒绝缓存已解析 spec，我们保留逐次解析。”

**修复（在笔记的备选方案节）：**“**缓存已解析 spec。** 拒绝：spec 依赖每次 cwd，按请求缓存会返回过期根目录。”

备选方案文体是允许的位置，评审者和轮次不是理由的一部分。

<a id="draft-ordinals"></a>
### 草稿序号

**泄漏：**“截至此笔记 v5，加载器也校验 manifest。”

**修复：**“加载器校验 manifest。”

implemented 笔记写交付事实，自身修订史留在 Git。

<a id="reviewer-addressed-justification"></a>
## 面向评审者的辩解

<a id="arguing-a-cast"></a>
### 为类型转换辩护

**泄漏：**“转换安全，SDK 构造了对象，只是可选字段声明不够严格。”

**修复：**“SDK 构造对象时填充所有可选字段；声明类型比运行时保证宽松。”

写维护者不能破坏的不变量。“它只是……”像在回答 HEAD 读者未提出的异议；代码已显示不变量则删注释。

<a id="appeal-to-review-authority"></a>
### 诉诸评审权威

**泄漏：**“这是正确的，因为评审者确认了包装顺序。”

**修复：**删除，包装顺序已在函数 @returns 中说明。

正确性依据不变量或测试，不依据某个人。

<a id="restatement-and-derivation"></a>
## 复述与推导

<a id="control-flow-narration"></a>
### 控制流叙述

**泄漏：**“先规范标签，再截断，再包装。”

**修复：**删除。

注释下方三行代码已表达同一内容。

<a id="test-walkthrough"></a>
### 测试步骤讲解

**泄漏：**“此测试创建会话、发两条消息、等第二条回复，然后断言日志四条。”

**修复：**“两次往返必须恰好产生四条日志，投影会去重共享前缀。”

只保留非显然断言理由，步骤讲解只是复述测试体。

<a id="hedges-and-planning-residue"></a>
## 含糊措辞和计划残留

<a id="unmarked-deferral"></a>
### 没有标记的延后

**泄漏：**“暂时提前渲染大概没问题。”

**修复：**删除，该延后已有 TODO(widget-batch) 标记。

无所有者的含糊话是计划残留；无标记则写 `TODO(name): coalesce per animation frame`，不保留模糊措辞。

<a id="vague-sizing"></a>
### 模糊容量判断

**泄漏：**“64 KiB 缓冲大多数情况应该够。”

**修复：**“64 KiB 可容纳观察到的最大 48 KiB 帧并留余量；更大帧在 decode 明确失败。”

用实际边界及超限失败行为替代含糊措辞。

<a id="authoring-language-slips"></a>
## 编写语言残留

**泄漏：**“The renderer runs on the client 端; see the 设计稿 for spacing. ---- 私有 ----”

**修复：**“渲染器在客户端运行；间距遵循 Figma 帧 widget-badges。”

工作语言片段和会话分隔符是转录残留；Figma 帧名保留，因为它按设计在仓库外可追溯。

<a id="authoring-language-slip-inside-a-paired-fence"></a>
### 双语代码围栏内的语言残留

**两份文件中的泄漏：**原样代码块内的 `// 更新这里 before returning`。

**两边共同修复为：**`// Update this before returning.`

修正代码块一次，逐字复制到两语言。中文版本单独翻译代码注释会破坏配对，即使各自流畅。

<a id="behavior-visible-candidates"></a>
## 行为可见候选

**可疑：**导出 JSDoc 写“暂时可用”，生成器将此句复制进模型目录。

**错误：**纯文字清理时只改来源句，或只手改生成目录。

**正确：**追踪生成扇出，改所有者、重建全部派生物并更新所属可执行快照；GUI 字符串补仓库行为证据。授权范围没有所属情景时，保持文字并报告延后。

<a id="keeps"></a>
## 保留项

<a id="issue-references-are-durable-on-every-surface"></a>
### Issue 引用在所有位置都可长期使用

**保留：**“上限应用到含包装的完整渲染值，后续由 issue #1470 负责。”

无指导清理曾因“issue 引用应在笔记”而误删。实际 issue 可从任何位置在 HEAD 解析，“#N 负责后续”是 README 合法待办归属；笔记和复盘额外允许引用已合并 PR 作为证据。

<a id="dead-name-drops-are-not-naming-the-owner"></a>
### 无法解析的点名不等于指明所有者

**删除：**“基于 widget 接口的徽章渲染器，参见 widget-rendering RFC。”

曾误以为这是按主题点名文档。判断依据是可解析而非形式；没有提交文件对应该 RFC，引用就失效。有所有者则改指向，否则删除。

<a id="suppression-justifications"></a>
### 抑制理由

**修正后保留：**`// oxlint-disable-next-line no-non-null-assertion -- the one-element literal guarantees index 0.`

理由是必需文字。原理由若错误，例如没有循环却说“上方循环保证帧存在”，应修正而非删除。

<a id="measured-bounds"></a>
### 实测边界

**保留：**“深度上限，实测 512 层同步约 0.15 秒，4096 层阻塞事件循环。”

测量约束无依据调参，“实测”是区分数据与猜测的来源标识。

<a id="runtime-oldnew-is-not-change-history"></a>
### 运行时新旧对象不是变更史

**保留：**“旧连接排空后新连接才接受。”

新旧指交接中的两个运行时对象，不是仓库状态；禁止变更叙述不等于禁止生命周期词汇。

<a id="runtime-natural-time-is-not-a-version-stamp"></a>
### 运行时自然时间不是版本戳

**保留：**“今天是什么日期？”

提示询问运行时时钟，today 不比较仓库状态；但文字到达模型，任何改写仍需所属行为证据。

<a id="overcorrection-traps"></a>
## 矫枉过正陷阱

以下问题都曾在原清理中出现并被评审发现；删减前先枚举命题。

<a id="flipping-an-obligation-into-an-endorsement"></a>
### 把义务变成认可

**原文：**“这些直接注册是等待迁移到 slots 的例外。”

**过度修正：**“这些直接注册是获准的例外。”

**正确：**“这些直接注册是等待迁移到 slots 的例外。”

等待迁移是一项义务，获准则认可现状；删短时反转了义务强度。

<a id="promoting-a-hypothetical-to-a-shipped-feature"></a>
### 把假设升格为已交付功能

**原文：**“未来基于 IPC 的 shell 继承执行器并重写 spawn。”

**过度修正：**“基于 IPC 的 shell 继承执行器并重写 spawn。”

**正确：**“假设中的 IPC shell（当前并不存在）会继承执行器并重写 spawn。”

只删未来标记会把设计示意变成已交付声明，应明确假设，而非仅取消未来时。

<a id="deleting-a-true-fact-with-the-transcript-around-it"></a>
### 删除过程叙述时连真实事实一起删除

**原文：**“检查提示叙述检查顺序，该提示文本也是 verify-doc-typecheck 编译的对象。”

**过度修正：**整句当作叙述删除。

**正确：**“提示文本是 verify-doc-typecheck 编译的对象。”

前半是叙述，后半是关键耦合；多个命题共同行时删子句，不整句删除。

<a id="dropping-provenance-while-keeping-the-number"></a>
### 保留数字却丢掉来源

**原文：**“4 MiB 上限来自实测，最大生成 py-types 模块为 3.1 MiB。”

**过度修正：**“上限 4 MiB，最大生成 py-types 模块为 3.1 MiB。”

**正确：**保留“实测”。

缺少实测后，3.1 MiB 像定义而非观察，后人提高上限前就不会重新测量。
