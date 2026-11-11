> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/templates/package-library.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/templates/package-library.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`e65883a53950806ec5322b06ebf6dedc43f0c9377f7145e9cdc21e5a60db3993`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="template-package-library"></a>
# 模板：package-library

用于没有插件接口的包：入口导出普通模块 API，不向组合注册内容。例如 boot/app-boot、util/*、sdk/protocol、typert/generator。boot/app-boot 双语 README 是完整范例。

库 README 与包参考有三点区别：不写“安装到 profile”（库是依赖，不是层）；不写挂载配置（没有 cordis.yml 行）；Model Experience 只采用检查器审定形式，多数库为 none 或 indirect。

<a id="frontmatter"></a>
## Frontmatter 元数据

```yaml
---
description: "What the library lets a caller build, in one or two concrete sentences with the consuming packages or searchable domain terms."
kind: "package-library"
---
```

<a id="skeleton"></a>
## 结构示例

````markdown
# @deepseek-ai/dsh-<name>

English | [中文](README.zh.md)

## Summary

Three to five sentences and at most 100 `wc -w`-style words: what a caller can DO with the library, who consumes it, the smallest entry point, and the main boundary. Apply the [Summary voice rules](../SKILL.md#voice-rules).

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

### When to use it

Name the consuming call sites (which bins, packages, or runtimes import it) and when a caller should reach for it instead of a plugin.

### Entry point

The smallest import-plus-call that works, in a `text` or `ts` fence, followed by what success and failure look like. Link the owning contracts in `src/index.ts` for exact detail instead of restating them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Design notes and a source-map table. No API catalogs.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Adjacent pages, closest prerequisite first.

-----

<a id="model-experience"></a>
## Model Experience

Only the form the verify-package-readme-model-experience gate assigns this package (`none`, `indirect`, or the canonical blocks). A library never invents model effects it does not have.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Current package constraints as top-level bullets; allowlist the package in scripts/verify-package-readme-limitations.ts when none exist.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
````

<a id="rules"></a>
## 规则

- **按入口而非目录分类。** 选择前读 src/index.ts：默认导出服务类或 apply 导出属于 package-reference；package.json 的 dsh.bundle.patch 属于 package-bundle；都没有的普通模块 API 才是库。
- **绝不写 profile 安装指南。** `dsh plugin --profile <name> add <package>` 虽可安装 npm 依赖，但只对声明 dsh.bundle 的包激活层；对库至多只是无激活作用的依赖，不应作为安装路径。
- 配对编辑后重跑 `pnpm run verify-translation-pairing --write packages/<group>/<pkg>/README.md`。
