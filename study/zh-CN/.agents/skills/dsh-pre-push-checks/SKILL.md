> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-pre-push-checks/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-pre-push-checks/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`c822d716c03ac59c71366e4b7bedae60b3f9f17174bc52b5c9eecbb780aa4357`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-pre-push-checks
description: Use before pushing, force-pushing, marking ready for review, or claiming checks pass on a deepseek-harness branch, and immediately after gh stack sync publishes rewritten branches, to select the smallest tests and checks that cover the outgoing or just-published diff without reflexively running the full repository suite.
---
```


<a id="dsh-pre-push-checks"></a>
# DSH 推送前检查

deepseek-harness 推送前运行一次相关本地验证。唯一顺序例外为 gh stack sync，可先发布级联重写，但必须立即验证，通过前不合并。Git hooks 刻意窄化：pre-commit 修复暂存 lint、检查空白及 vendored 元数据，pre-push 只运行增量类型检查。完整覆盖和平台矩阵由 CI 负责。

<a id="inspect-the-outgoing-change"></a>
## 检查待推送变更

1. 确认工作区和分支。

```sh
git status --short --branch
git rev-parse --show-toplevel
```

2. 核实实时 PR 基线或栈父层，获取引用，并对照检查完整范围。

```sh
pnpm --silent run change-scope --base <verified-base-ref>
```

命令不猜测或抓取基线，须提供已从实时状态核实的引用；检查非 HEAD 时传 --head。版本化 JSON 记录相对 merge-base 的提交路径，暂存／未暂存／未跟踪描述当前工作区。合入变化基线后重跑范围报告，重新判断影响，仅重跑被合并失效的检查。

<a id="select-relevant-evidence"></a>
## 选择相关证据

除 hooks 外没有通用本地基线。每项行为变更需要最窄且能抓住回归的测试／专项检查；只有差异实际涉及的接口才扩大验证。

新增／修改拥有资源或异步行为的测试、fixture、辅助函数或 CI 路径时，先用 [dsh-ci-test-reliability](../dsh-ci-test-reliability/SKILL.md) 判断恢复、反例、完全释放或并发进程证据。本技能仍负责选择命令，避免重复已通过验证。

- **包／脚本行为：** 运行所属 Vitest 文件或用例；共享契约变化时加邻包测试，除非确实横跨全仓库或用户要求，否则完整覆盖留给 CI。
- **Remote mock 类型：** 未构建时 any 只是明确的本地回退，不是严格证据。交接前跑 pnpm run typecheck，先重建缺失／过期／部分生成声明再诊断剩余错误。例外只留在[测试代理](../../../../../packages/test-support/remote-mock/README.md#remote-proxy)，不进入生产 Remote 类型、环境标志或复制签名。
- **文档、Agent Notes、目录及文档关联注释：** 运行 `pnpm run doc-sync`，文档工作流要求时运行完整 lint。
- **模型、编辑器、CLI、终端可见输出：** 运行所属的定向无密钥快照或真实可执行示例。
- **预期输出位置：** 录制 Session 代次同时作为重放输入和持久输出的测试放顶层 snapshots/，snapshot.yml 固定交付 profile、组合和头。父文件 session[.vN].jsonl，子文件 session.<ordinal>[.vN].jsonl，每角色选最高代次。没有该往返的 ARIA、几何、生成器、CLI、单测预期放所属 tests/expected/，不用 snapshots/ 或 *.snapshot.ts；走对应 test:expected、test:web 或 test。
- **Profile／配置位置：** 交付 profile 的跨包行为放 apps/cli/tests/profiles/，包特定 Loader 组合放包 tests/fixtures/；用户可选覆盖放 apps/cli/config/examples/，配 docs/user/ 指南。
- **包 manifest、公开导出、构建配置、worker/bin 入口或产物运行路径：** 运行 pnpm run build、相关 hygiene 和所属构建产物冒烟。
- **真实提供方／智能体行为：** 有凭据时运行相关 pnpm run test:e2e，绝不打印秘密。

不要只因下一步提交／推送就重跑通过的检查，尤其不要为重复 pre-push hook 而紧接推送前再跑 typecheck。

<a id="focus-unit-coverage-on-the-affected-source"></a>
### 将单测覆盖限定到受影响源码

测试选择和覆盖范围选择不同：Vitest 文件过滤只决定运行哪些测试，仓库默认仍统计所有 packages/*/*/src/**/*.ts。需要覆盖证据时，同时指定所属测试和必须证明覆盖的源码／包：

```sh
pnpm exec vitest run packages/<group>/<package>/tests/<behavior>.spec.ts \
  --coverage \
  --coverage.include='packages/<group>/<package>/src/**/*.ts'
```

行为仅在单模块时指定精确文件；多个文件／包可重复 --coverage.include，并传入覆盖所需全部所属测试。范围内仍遵守每文件 100% 阈值。

不清楚所属测试时，用 Vitest 依赖图发现候选，再检查候选测试，才能将运行视为证据：

```sh
pnpm exec vitest related packages/<group>/<package>/src/<changed>.ts \
  --run \
  --coverage \
  --coverage.include='packages/<group>/<package>/src/<changed>.ts'
```

vitest related 无法发现仅由配置、动态加载、子进程、worker、构建产物或外部提供方触达的行为，需显式选测试。不得用 --passWithNoTests、降低阈值或缩窄范围来隐藏受影响未覆盖文件。单测覆盖不足时添加其他相关测试，只有排除模块确不受影响才缩小源码范围。

<a id="full-local-rehearsal"></a>
## 完整本地演练

仅用户明确要求、诊断 CI 失败或变更确实广到无法可信缩窄时，才完整本地演练。以当前工作流和包脚本为清单，不重建已移除 check:pre-push 聚合命令。

<a id="protect-history-rewriting-pushes"></a>
## 保护重写历史的推送

独立／栈 PR 均允许 rebase，包括评审后。独立重写前获取远端并记录精确 OID，用 `--force-with-lease=<branch>:<observed-oid>` 发布，使并发更新中止推送。gh stack push/sync 自带租约保护，绝不用裸 --force。

重写推送后重取实时头，复查未解决线程、批准、可合并性和检查。重写前哈希及行内评论锚点不算当前证据。

<a id="post-sync-validation"></a>
### sync 后验证

gh stack sync 将获取、级联 rebase 和推送合为一次，无法在重写和发布之间插本地检查。之前要求干净工作区，记录官方顺序及精确远端头；返回后：

1. 重查各分支头和官方栈顺序。
2. 对照实时 PR 基线审查各重写层范围。
3. 每个受影响层运行本技能选定证据。
4. 全部通过前保持 PR 未合并，报告验证待完成。

sync 后失败时，保留租约保护发布的头，修复并验证后发布更正；不能只因 sync 命令成功就称栈已 ready。

<a id="handle-failures"></a>
## 处理失败

普通推送前相关检查失败时，先修复或解释阻塞，不抱希望直接推送。sync 后例外则阻止合并并按上述流程修复。

疑似环境特有失败必须证明：

- 记录精确命令、失败测试及平台差异。
- 确认相关非平台证据。
- 必需检查优先修复跨平台非确定性。
- 只有用户明确要求或同意才跳过本地 hook，并报告失败内容及为何预期 CI 不同。

<a id="push-procedure"></a>
## 推送流程

普通推送及独立 rebase 推送：

1. 选定相关检查运行一次。
2. 正常提交，继续前检查 pre-commit 自动修复的文件。
3. 正常推送；获授权重写则使用精确租约，使增量类型检查 hook 正常执行。
4. 核对远端引用与本地 HEAD 一致。

```sh
git rev-parse HEAD origin/$(git branch --show-current)
```

GitHub PR 推送后检查远端 CI：

```sh
gh pr checks
```

待完成检查如实报告；将失败归因于分支或环境前先调查。

gh pr checks 报 no checks reported 且 `/actions/runs?head_sha=<sha>` 的 total_count 为 0 时，怀疑推送或事件丢失前先查可合并性：

```sh
gh pr view <number> --json mergeable,mergeStateStatus
```

PR 为 CONFLICTING／DIRTY 时 GitHub 不创建 pull_request 运行，缺少信号是冲突，不是基础设施。唯一修复是解决冲突；空提交、allow-empty、草稿切换、回退再恢复都仍为零且污染历史。本地尚不能合并时用 `git merge-tree --write-tree HEAD origin/<base>` 确认冲突路径。

gh stack sync 使用后置验证顺序，不假装普通顺序可行。
