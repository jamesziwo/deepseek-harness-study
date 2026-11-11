> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/references/metadata-links-i18n.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/references/metadata-links-i18n.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`b505cf2de8c91e0ba1b39e16393059ce1d879937531579fd7690fdaaf7edcd3c`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="metadata-links-and-bilingual-pairs"></a>
# 元数据、链接与双语配对

<a id="summary"></a>
## 摘要

README 元数据是检索和模板选择接口，不是小报告或广告。kind 选择技能中现有且对应标准的唯一模板；frontmatter 不重复文件命名或已执行检查负责的字段。双语页面同等权威、结构一一对应、物理行精确对齐。*.i18n.yaml 记录最后确认配对并支持自动合并。链接须在 GitHub 和网站正确渲染，仓库内部采用有效相对 URL。

<a id="table-of-contents"></a>
## 目录

- [README 元数据](#readme-metadata)
- [Kind 系统](#the-kind-system)
- [Description 质量](#description-quality)
- [仓库链接与路径提及](#repository-links-and-path-mentions)
- [双语行对齐](#bilingual-line-alignment)
- [双语一致性记录](#bilingual-consistency-records)
- [开发备注](#dev-note)

<a id="readme-metadata"></a>
## README 元数据

每份编写的 README 以 YAML frontmatter 开头。允许自定义字段，但通用字段应稳定，便于搜索和索引。

```yaml
---
description: "Example capability for users and maintainers choosing, configuring, or debugging the package."
kind: "package-reference"
---
```

包 README 配对必填 description 和 kind。标题及 package manifest 已拥有名称，文档职责及阅读路径已表达受众，重复这些字段没有检索价值。另一语言路径由同目录 README.zh.md 决定，配对状态由 sidecar 拥有，因此局部 i18n 冗余。仓库没有分类治理和搜索消费者前不加 tags。键默认小写连字符，已有约定另说；不把易变代码清单放进 frontmatter。

<a id="the-kind-system"></a>
## Kind 系统

kind 直接选择文档模板，每种 kind 恰好一个现有模板，每个模板必须有 kind。依次机械推导：

1. README 是 `packages/README.md` 或 `packages/<group>/README.md` → `package-group`。
2. package manifest 声明 `dsh.bundle.patch` → `package-bundle`。
3. 包在 `scripts/doc-standard.spec.ts` 的已审计库注册表中 → `package-library`。
4. 其余默认服务导出或 apply 插件 → `package-reference`。

| `kind` | 仓库位置 | 模板 | 标准 |
|---|---|---|---|
| `package-group` | `packages/README.md`、`packages/<group>/README.md` | [package-group.md](../templates/package-group.md) | 包组地图：介绍能力家族、直接包和组合关系，链接包自身细节。 |
| `package-reference` | 带插件入口的 `packages/<group>/<package>/README.md` | [package-reference.md](../templates/package-reference.md) | 包契约：遵循[评审标准](review.md#package-readme-review)及[包文档要求](../../../../../../docs/cookbook/adding-a-package.md#4-write-the-package-readme)。 |
| `package-library` | 普通模块入口的 `packages/<group>/<package>/README.md` | [package-library.md](../templates/package-library.md) | 库契约：消费入口和边界，不写 profile 安装或挂载配置。 |
| `package-bundle` | 声明 dsh.bundle.patch 的 `packages/<group>/<package>/README.md` | [package-bundle.md](../templates/package-bundle.md) | 可安装配置层：已验证 dsh plugin 安装、层语义和 patch 文档。 |

分配 package-library 或 package-bundle 前检查 package.json 和 src/index.ts。dsh.bundle.patch 表示 bundle，apply／默认服务导出表示插件，普通模块 API 表示库。`dsh plugin --profile <name> add <package>` 可安装 npm 依赖，但只有声明 dsh.bundle 的包会激活配置层，绝不能把该命令当作库或普通插件安装入口。检查器按相同事实推导 kind，并拒绝错误 kind、name、audience、tags 和局部 i18n。新增 kind 需独立模板、明确位置／所有者及定向映射检查。

<a id="description-quality"></a>
## Description 质量

代理先检索 frontmatter description 筛选页面，再加载全文。像 Skill 描述一样写：说明覆盖内容和何时阅读，一两句具体话，包含可检索领域词，并区分邻近文档。不概括每节、不宣称优越、不重复标题、不空泛宣传、不保留变更史，也不写技术状态报告。

良好示例：`The shipped JSONL session-persistence backend for deployments and maintainers choosing, configuring, or debugging per-session durable logs with optional Zstandard compression.`——说明 JSONL 后端、目标读者、选择／配置／排障场景及可选压缩。

较弱示例：`The best and most advanced session storage implementation with lots of optimizations.`——只有“最好、最先进、很多优化”的空泛宣传。

<a id="repository-links-and-path-mentions"></a>
## 仓库链接与路径提及

链接目标必须可机器校验，路径提及相对于讨论上下文。当前页目录用片段链接，外部资源用完整 URL。

理想内部链接从仓库根标识目标，但 `/docs/...` 在 GitHub 解析到仓库外，网站投影器不改写，verify-md-links 也跳过。在仓库解析器覆盖所有渲染器前，Markdown 使用当前有效相对 URL；文字中的 docs/、packages/session/ 按讨论上下文描述。不要仅为模仿绝对路径使用未经检查的开头斜杠链接。

<a id="bilingual-line-alignment"></a>
## 双语行对齐

英文和简体中文同等权威。frontmatter 键顺序、标题、空行、段落、列表项、表格、围栏、目标和总物理行数逐项对应。英文相对链接指 .md，中文有对应版本时指 .zh.md，否则回退英文；配对检查将两者视为同一文档。每行自然翻译，不硬换行；代码块字节不变，首次术语注解位置可调整但不改变行结构。

行数相同只是结构检查，不证明含义忠实；完整性、术语、自然语言及逐行命题等价仍由评审负责。

<a id="bilingual-consistency-records"></a>
## 双语一致性记录

每对文档保留 *.i18n.yaml。verify-translation-pairing 使用 Git blob 哈希恢复最后确认文本、检查结构和行对齐、支持自动合并、记录生成区域并封存归档。任一语言修改后运行 `pnpm run verify-translation-pairing --write <pair>`。不要将内容哈希复制进 README frontmatter，否则独立编辑会修改同一头行，制造本可避免的冲突。

<a id="dev-note"></a>
## 开发备注

无。
