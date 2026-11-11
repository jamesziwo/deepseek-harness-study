> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/references/review.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/references/review.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`81f5bb876ad13bd2e550953d7c4ff9962d47b5f73d57219932e968029a89a216`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="review-criteria"></a>
# 评审标准

<a id="summary"></a>
## 摘要

以读者能否达成结果评审文档，而非模板标题是否齐全。对照代码和测试核验文字，保留精确契约，让包 README 对消费者有用，同时给维护者足够实现背景。运行当前仓库检查；session-persistence-jsonl 双语 README 是格式范例。

<a id="table-of-contents"></a>
## 目录

- [新人测试](#newcomer-test)
- [证据评审](#evidence-review)
- [包 README 评审](#package-readme-review)
- [参考范例](#reference-example)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="newcomer-test"></a>
## 新人测试

无仓库背景的专业工程师在阅读三到五个相连页面后，应能回答产品／功能做什么、怎样安全使用、状态在哪里、谁负责、如何失败、在哪里修改。若仅为了发现公开流程就必须读源码，应补说明；若必须吸收无关内部细节，则把细节放深一层。

<a id="evidence-review"></a>
## 证据评审

每项重要声明对照最强所有者：包元数据管名称和入口，公开类型／JSDoc 管 API，运行时代码管行为，测试管已执行失败路径，生成目录管完整清单，活动 Agent Note 管理由。旧 README、讨论或报告不得强于当前代码和测试。

CLI、配置片段、默认值、错误和平台差异等操作声明，证据是执行而非阅读。页面陈述行为前，在当前版本运行精确命令／配置，只引用实际输出和失败。缺密钥或网络则指明验证责任方，不断言行为；旧页面对照最新 origin/master，再按代码复核过时文字。

先分类包再评审安装说明：package.json 的 dsh.bundle.patch 表示 bundle，是 dsh plugin 命令唯一会激活为层的形态；apply／默认服务导出是通过 cordis.yml 行挂载的插件；普通模块 API 是无独立安装路径的库。拒绝套用其他形态的说明。

只有帮助目标读者行动、推理或避免误用的声明才保留。理由、历史、测试过程、重复目录和无关包细节移到所属来源。

<a id="package-readme-review"></a>
## 包 README 评审

要求以下内容，但不强制所有包使用同一内部标题集合：

- 可检索 YAML，精确 description，以及机械推导的 kind（package-group、package-reference、package-library、package-bundle）；
- 三至五句、最多 100 个 wc -w 风格词的英文 Summary，说明对用户／代理能做什么，并附可点击目录；
- 主体明确、术语稳定、动词直接、指令与条件分开、义务强度不变的受控英语；
- 何时选择或避免该包；
- 有最小安全配置／使用路径时给出：bundle 提供已验证 dsh plugin 安装，库提供消费入口，不为不适用形态写 profile 安装；
- 与消费者相关的可观察行为、失败、持久性、安全和性能限制；
- 不能从公开类型低成本推导的开发者概念：所有权、数据／生命周期设计、整体架构、概略数据流，精确细节链接代码；
- 包策略要求的规范 Model Experience 和 Known Limitations；
- 相邻文档确实有帮助时，为新人提供 Further Exploration；
- 最终非权威 Dev Note，作为局部想法、草稿和未决方向的唯一位置。

不复述 JSDoc 或生成目录，链接所有者，只解释本地需要的决策和关系。包摘要讲可见能力，不讲 Cordis 角色、注册或内部组件；源码标识仅在读者直接使用时出现。拒绝叙述内部函数／事件流／数据流的用户章节，以及只枚举 API 不解释概念的折叠内容。

<a id="reference-example"></a>
## 参考范例

session-persistence-jsonl 的[英文](../../../../../../packages/session/session-persistence-jsonl/README.md)和[中文](../../../../../../packages/session/session-persistence-jsonl/README.zh.md)展示生产格式：可检索 YAML、kind 选择参考标准、四句摘要、目录、覆盖选择／配置／布局／持久性／读取的用户章节、GitHub 原生 details 折叠开发设计和存储细节、进一步阅读、规范 Model Experience／Known Limitations 和最终 Dev Note。以其结构、证据和双语对齐为模板，每项声明落在所属源码及证据上。

<a id="verification"></a>
## 验证

迭代时运行最小定向检查，再执行常设文档检查：

```sh
pnpm run test:docs
pnpm run verify-translation-pairing --write <pair>
pnpm run doc-sync
pnpm run lint
git diff --check
```

技能变化还需运行调用元数据检查；行对齐配对要比较中英文物理行数。最终差异读两遍，分别检查事实完整性，以及简洁、导航和所有权。

<a id="dev-note"></a>
## 开发备注

无。
