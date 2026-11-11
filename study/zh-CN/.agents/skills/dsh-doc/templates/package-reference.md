> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/templates/package-reference.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/templates/package-reference.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`b9e75748bd32b40960b51df2549afbe5ed4fb7454f235b134505e9b40d70f103`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="template-package-reference"></a>
# 模板：package-reference

用于入口为 Cordis 插件、在组合中挂载的包，即默认服务导出或 apply 函数。这是 packages/<group>/<pkg>/README.md 的默认类型。session-persistence-jsonl 双语 README 是范例。

<a id="frontmatter"></a>
## Frontmatter 元数据

```yaml
---
description: "What the package lets a reader choose, configure, or debug, in one or two concrete sentences with searchable domain terms."
kind: "package-reference"
---
```

<a id="skeleton"></a>
## 结构示例

````markdown
# @deepseek-ai/dsh-<name>

English | [中文](README.zh.md)

## Summary

Three to five sentences and at most 100 `wc -w`-style words on what a user or agent can DO with the package: outcomes, when to choose it, main cost, most important boundary. Apply the [Summary voice rules](../SKILL.md#voice-rules); never describe its role, type, or internal identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

One orienting sentence: the common path.

### When to choose it

Choose or avoid the package: one paragraph naming the deciding conditions and the fallback package.

### Minimal configuration

The smallest mount that works, as a `cordis.yml` snippet, plus the config table:

| Field | Default | Meaning |
|---|---|---|
| `<field>` | `<default>` or `required` | One-line meaning |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-<name>) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Design concept, component architecture, and hand-waving dataflow — enough to understand the package. A source-map table links files for exact detail. No API catalogs or JSDoc restatement.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Three to seven adjacent pages, closest prerequisite first, one short phrase each.

-----

<a id="model-experience"></a>
## Model Experience

<per the Model Experience contract in docs/cookbook/adding-a-package.md#4-write-the-package-readme; the verify-package-readme-model-experience gate owns the required form>

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

One orienting sentence, then top-level bullets naming current package constraints. Packages with none use the allowlist in scripts/verify-package-readme-limitations.ts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
````

<a id="rules"></a>
## 规则

- **先核验后写作。** 将包挂载进测试组合，执行 README 声明的每条命令、配置字段、默认值及行为。删除未复现内容，配置字段链接生成目录，不重复列举。
- **安装说明。** 普通插件通过 cordis.yml 行挂载；只有声明 dsh.bundle.patch 的包通过 `dsh plugin --profile <name> add <package>` 安装为层。没有该声明就说明如何挂载组合，不写 dsh plugin add。
- **Model Experience 和 Known Limitations 由检查器负责。** 精确匹配标题及包特定形式；行为让包改变分类时，同一变更更新检查器审计清单。
- 配对编辑后重跑 `pnpm run verify-translation-pairing --write packages/<group>/<pkg>/README.md`。
