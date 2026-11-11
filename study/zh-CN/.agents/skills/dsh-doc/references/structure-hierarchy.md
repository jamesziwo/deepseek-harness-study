> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/references/structure-hierarchy.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/references/structure-hierarchy.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`869ae393be457951c89175ed9a6f02957d013b7b4b9b44785efbbcfead40ca8e`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="page-structure-and-hierarchy"></a>
# 页面结构与层级

<a id="summary"></a>
## 摘要

每页先给新人一个简短入口，再展开操作或实现细节。跨包学习和工程资料放在规划过的 docs/ 层级，包契约随代码。小规则文件各拥有一个可独立搜索的要求，但不追求任意碎片化。最后的 Dev Note 将活动工作上下文与上方稳定说明隔离。

<a id="table-of-contents"></a>
## 目录

- [页面顺序](#page-order)
- [章节递进](#section-progression)
- [文档层级](#documentation-hierarchy)
- [小规则文件](#small-rule-files)
- [进一步阅读](#further-exploration)
- [开发备注归属](#dev-note-ownership)
- [开发备注](#dev-note)

<a id="page-order"></a>
## 页面顺序

格式所有者允许时，人工编写页面采用以下顺序。生成产物可生成相同入口章节；Agent Notes 和事故复盘保留仓库规定结构。

1. YAML 元数据。
2. H1 标题。
3. 双语页语言切换链接。
4. `## Summary`：三至五句，说明读者能做／观察什么、价值、主要工作方式和关键边界。英文包 README 摘要遵守检查器的 100 词限制。
5. `## Table of Contents`：链接 H2 章节，只做导航，不重复描述。
6. 稳定正文，从用户用法递进到开发者设计及操作细节。
7. 可选 `## Further Exploration`，提供面向新人的相邻主题链接。
8. 最终 `## Dev Note`，保存非权威活动工作上下文。

不要给微小机器生成文件、生成片段或解析器规定了其他头部的格式强套摘要／目录；例外应写在格式所有者处，不能生成无效输出。包 README 最后两个 H2 必须是 Model Experience 和 Known Limitations and Deferred Work，因此 Further Exploration 放其前，Dev Note 作为限制节内最终 H3。

<a id="section-progression"></a>
## 章节递进

每个实质 H2 在表格、代码或 H3 前先给简短导读，解释主题和影响决策的重点，不重述全部内容。

按读者深度排列：

1. 基本使用：选择时机、必需输入、最短安全示例、成功信号及常见恢复。
2. 高级使用：配置选择、限制、运维及集成行为。
3. 开发细节：所有权、生命周期、数据模型、失败、性能、安全和值得维护的扩展点。

较重的开发细节和最终 Dev Note 放在 details 折叠块中，标题保持可见，机制见 [style.md](style.md)。

折叠开发细节必须停留在概念层：整体设计、主要组件架构、概略数据流，以及源码地图和精确代码链接。不变成全 API、字段、载荷目录或 JSDoc 复述。仅 Dev Note 可放局部想法、草稿及未定方向，其余包括折叠内容都须是整理过的当前事实。

完整生成类型、schema 和目录前放紧凑导读及稳定索引；单次查找需扫描无关组时，按已有领域所有者拆分。

<a id="documentation-hierarchy"></a>
## 文档层级

包契约放代码旁的 README。跨包 Markdown 按受众和学习意图组织，不把无关页面平铺在 docs/。

```text
docs/
  learn/
    overview/
    cordis/
    practices/
  user/
  developer/
    discussion/
  scratch/
  subsystems/
```

这只是目标地图，不是随手大搬迁的授权。每次移动一个完整主题，原子修复入站链接及网站映射，保留公开路由或别名；subsystems/ 页面逻辑并列，保持平铺。

docs/scratch/ 保存需跨交接、受 Git 跟踪且有期限的讨论，每页标明所有者、创建时间、过期时间和转正目标。本地可丢弃笔记保持忽略且不提交。

<a id="small-rule-files"></a>
## 小规则文件

可独立搜索的规则、实践、示例族或决策，有独立所有者、变化节奏、入站链接或验证时，给它小文件；相关文件放在 docs/developer/code-quality/ 等明确层级。拆分会迫使读者打开多个文件才能理解一项义务时，紧耦合规则仍放一起。

索引用三至五句说明目录，并按用途链接直接子页，不复述子页规则。

<a id="further-exploration"></a>
## 进一步阅读

为读完本页、希望理解邻近概念的新人提供可选章节。链接三至七个直接相关页面，从最近前置知识到深入探索排序，每个用短语说明增量价值，不做全站目录。

<a id="dev-note-ownership"></a>
## 开发备注归属

人工页面最后放 Dev Note，并明确非权威。可放活动假设、兼容顾虑、粗略方案、进度链接和未解问题；稳定行为、必需限制和已接受理由归常规所有者。

Dev Note 可镜像或链接任务进度，但不能成为第二个可写任务队列。工作结束后提升长期结论，可复用理由放 Agent Note，事故过程放复盘，删除已解决闲谈；旧迭代由 Git 历史保存。

<a id="dev-note"></a>
## 开发备注

这个必需的最终章节刻意允许较少打磨，但仍有生命周期规范。空白时写 None.，不堆占位文字；生成或解析器拥有的格式可通过具名例外省略。
