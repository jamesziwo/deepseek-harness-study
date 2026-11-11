> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-merging-stacked-prs/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-merging-stacked-prs/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`d7b45f7c56f741e725d369887396f582f65d131c775ae58861d7835ca892bfcd`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-merging-stacked-prs
description: Use when landing a stack of dependent GitHub PRs (A ← B ← C, where each bases on the one below) onto master, merging a PR whose base is another open PR's branch, or whenever a request mentions "stacked PRs", "PR stack", "dependent PRs", or merging several related PRs in sequence. Requires every same-repository dependency chain to use GitHub's official stacked-PR feature before landing so GitHub owns stack-wide rules, CI, ordering, retargeting, and merge state.
---
```


<a id="landing-an-official-github-pr-stack"></a>
# 合并官方 GitHub PR 栈

通过 GitHub 原生 stack 对象和 gh stack merge 合入依赖 PR，不用逐 PR merge/edit 手工模拟。允许的 merge-forward／rebase 历史由[根规则](../../../../../AGENTS.md)规定，评审修复传播由[栈评审指南](../../../../../docs/cookbook/responding-to-pr-review-on-a-stack.md)负责。

<a id="require-native-stack-support"></a>
## 要求原生栈支持

修改 GitHub 前运行 `gh stack --version`。官方扩展或服务端功能不可用则停止，不回退手动逐个合并／改基线。所有头分支须同仓库，跨 fork 链直接停止。

使用干净专用 worktree，获取当前 PR 元数据和精确 OID，不信分支名或旧报告：

```sh
gh pr view <pr> --json number,author,baseRefName,baseRefOid,headRefName,headRefOid,isCrossRepository,state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup
```

每条疑似链至少查询一个 PR 的 PullRequest.stack 和 stackEntry.position；官方对象才是栈成员权威，不能只按基线推断。size 超过返回页时分页 entries：

```sh
gh api graphql -F owner=<owner> -F name=<repo> -F number=<pr> -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      author { login }
      baseRefName
      headRefName
      stackEntry { position }
      stack {
        number
        baseRefName
        size
        entries(first: 100) {
          nodes {
            position
            pullRequest { number author { login } baseRefName headRefName state isDraft }
          }
        }
      }
    }
  }
}'
```

按实时 PR 基线确定自底向上顺序：底层指主干，上层指紧邻下层头分支。

<a id="link-missing-stack-members"></a>
## 补齐栈成员

先比较已有栈条目和预期链；单栈可包含保持顺序的子集，多栈编号、意外成员或顺序冲突时，任何修改前先取得用户方向。

有依赖 PR 尚未加入官方栈时：

1. 精确比较所有 author.login。
2. 作者完全一致时，自动按自底向上顺序链接：

```sh
gh stack link --base <trunk> <bottom-pr> <next-pr> ... <top-pr>
```

3. 作者不同或任何作者不可得时，改变 GitHub 前询问是否链接。
4. 重查 GraphQL，要求单一栈编号、预期主干、完整 PR 集合、正确位置和基线链。

绝不自动解散、重排或重建已有栈。gh stack link 是追加式，已合并或排队条目不能退出栈。

<a id="refresh-only-when-needed"></a>
## 仅必要时刷新

不要仅因存在刷新机制就重写分支。实时合并状态或仓库规则要求更新主干时，选择任一允许历史：

- **原生级联 rebase：** 本地未跟踪时用 gh stack checkout，再 gh stack sync。它可能在本地验证前重写并租约保护推送所有活动层；随后立即审查重写范围并验证每个受影响层，通过前不合并或称 ready。冲突时用 gh stack rebase，解决验证后 gh stack push；发现本地／远端栈组成分歧则取消并询问，不自动删除重建远端栈。
- **增量 merge-forward：** 将主干合入最底受影响分支，再自底向上把更新父层合入子层，普通推送。进行中的合并若遇基线前进，先保留当前检查点再合并新头。

评审后仍可重写历史，但旧 OID 假设失效。推送后重新获取精确头，并复查未解决线程、批准、可合并性及检查。绝不用裸 --force 或覆盖并发前进的远端。

<a id="preflight-the-merge-range"></a>
## 合并范围预检

合并前即时重查官方栈。选定 PR 必须开放、非草稿、顺序正确并满足评审检查要求；逐个判断，顶层 ready 不证明依赖 ready。

“合并栈”表示全部；部分合入必须明确边界 PR，并包含底部到该边界全部层。

<a id="merge-through-the-stack-api"></a>
## 通过栈 API 合并

按官方栈编号合并完整栈：

```sh
gh stack merge <stack-number> --yes --merge
```

用户明确要求部分合入时，合到指定边界 PR：

```sh
gh stack merge <boundary-pr> --yes --merge
```

不传 --delete-branch，不手动重定向依赖，也不发逐 PR 合并命令。GitHub 自底向上合并范围，并重定向／rebase 剩余上层。直接合并全成或全不成；主干使用合并队列时，选定范围一起入队但可能分组落地。

不绕过合并要求。原生合并报阻塞时，在所属 PR 修复或停下报告，绝不回退 gh pr merge。

<a id="verify-the-landed-state"></a>
## 核验合入状态

等待每个选定 PR 报 MERGED；已排队不算合入完成：

```sh
gh pr view <pr> --json number,state,mergedAt,mergeCommit,baseRefName,headRefName
```

部分合入后重查栈，确认剩余 PR 顺序正确、指主干或下层。GitHub 可能重写剩余层，因此复查头、评审和 CI。

仅在对应 PR 为 MERGED 后，单独最终清理分支；删除前 GitHub 必须报告无开放 PR 以它为基线：

```sh
gh pr list --state open --base <branch> --json number --jq length
```

结果不是 0 就禁止删除。

<a id="checklist"></a>
## 检查表

- [ ] 原生 gh stack 可用，所有 PR 分支同仓库。
- [ ] 实时基线和精确头形成一条自底向上依赖链。
- [ ] GraphQL 确认唯一官方栈、主干、成员和顺序；合格同作者链已自动链接。
- [ ] 重写层验证通过，之后重查评审、批准、可合并性和检查。
- [ ] 全栈或明确前缀通过 gh stack merge --yes --merge 提交。
- [ ] 选定 PR 全为 MERGED，剩余层仍构成预期官方栈。
- [ ] 只有已合并且无依赖后才删除分支。
