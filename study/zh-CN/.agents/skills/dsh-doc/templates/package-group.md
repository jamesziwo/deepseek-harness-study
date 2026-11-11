> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-doc/templates/package-group.md` · [英文原文](../../../../../../.agents/skills/dsh-doc/templates/package-group.md) · [阅读索引](../../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`53cb8a73b3d465e8cc318e530bcbd505f373c64b9f4bdb25d2253d2aab5d0e9a`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

<a id="template-package-group"></a>
# 模板：package-group

用于 packages/README.md 和各 packages/<group>/README.md。页面是一张地图：介绍能力家族，每个直接子包一行职责，并链接所属细节，不复述包契约。

<a id="frontmatter"></a>
## Frontmatter 元数据

```yaml
---
description: "The <group> package group: what the packages under packages/<group>/ own, for readers choosing or navigating the family."
kind: "package-group"
---
```

<a id="skeleton"></a>
## 结构示例

````markdown
# <group>/ — <one-line subject>

English | [中文](README.zh.md)

## Summary

Three to five sentences and at most 100 `wc -w`-style words: what the family provides, what a reader can DO with it, which package owns which half, and the main boundary. Apply the [Summary voice rules](../SKILL.md#voice-rules).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

One short orienting sentence, then the package map:

| Package | Role |
|---|---|
| [`<pkg>`](<pkg>/README.md) | One-line role: what it contributes |

<a id="related-documentation"></a>
## Related documentation

- [Adjacent owner](../../<path>.md) — what it adds to this family.

<a id="dev-note"></a>
## Dev Note

None.
````

<a id="rules"></a>
## 规则

- 每个直接子包一行，职责文字说明贡献，不描述内部实现。
- 只有帮助读者在直接子包之间选择时，才添加 ctx key、包形态或 npm-name 列。
- 相关文档链接邻近所有者，如包组地图、子系统页、Agent Notes，每个链接附短语。
- 不加 Model Experience 或 Known Limitations，包组地图不拥有运行时行为。
- 配对编辑后重跑 `pnpm run verify-translation-pairing --write packages/<group>/README.md`。
