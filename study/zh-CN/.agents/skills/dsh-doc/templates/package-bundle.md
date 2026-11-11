> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/templates/package-bundle.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/templates/package-bundle.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`9f6751700f4886b85b2b7334f4caa6621dbe815e969d32e94e9af046bc3f2f51`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="template-package-bundle"></a>
# 模板：package-bundle

适用于 manifest 声明 dsh.bundle.patch 的可安装 profile 层，例如 packages/bundle/*、dsh-subagent-codex、dsh-subagent-claude-code。bundle/base 双语 README 是完整示例。

Bundle README 先讲 profile 安装路径和层语义，折叠实现说明 patch 文档；不把包描述为可导入库或单个挂载插件。

<a id="frontmatter"></a>
## Frontmatter 元数据

```yaml
---
description: "What the bundle layer adds to a dsh --profile surface, for users composing or customizing a profile."
kind: "package-bundle"
---
```

<a id="skeleton"></a>
## 结构示例

````markdown
# @deepseek-ai/dsh-<name>

English | [中文](README.zh.md)

## Summary

Three to five sentences and at most 100 `wc -w`-style words: what a profile gains from this layer, which profiles already include it, how a user adds or removes it, and the main boundary. Apply the [Summary voice rules](../SKILL.md#voice-rules).

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

### Install into a profile

The verified install path — run it against the current checkout before writing:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-<name>
dsh plugin --profile <name> remove @deepseek-ai/dsh-<name>
```

State where in-box bundles resolve from, what the reconcile step activates, and what fails when the patch declaration is missing.

### What you get

The observable surface this layer adds: tools, providers, or UI rows, and which package owns each row's behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch document: insert list, row ids, platform gating, override semantics. Source-map table links `cordis.patch.yml` and `src/`. No API catalogs.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Adjacent pages: the group map, the profile contract, the composition graph.

-----

<a id="model-experience"></a>
## Model Experience

The form the verify-package-readme-model-experience gate assigns (bundle carriers are `indirect` or `none`: each inserted row's package owns its model-facing behavior).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Current constraints: override semantics, platform gates, and conflict rules a user must respect.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
````

<a id="rules"></a>
## 规则

- **仅 dsh.bundle.patch 包使用此模板。** 分类前检查 package.json，dsh plugin reconcile 仅为这类包激活配置层。
- **测试安装路径。** 在临时 profile 运行 `dsh plugin --profile <name> add <this-package>`，先复现警告、层激活和失败模式，再写文档。
- 配对编辑后重跑 `pnpm run verify-translation-pairing --write packages/<group>/<pkg>/README.md`。
