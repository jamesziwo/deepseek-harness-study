> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.agents/skills/dsh-ci-test-reliability/SKILL.md` · [英文原文](../../../../../.agents/skills/dsh-ci-test-reliability/SKILL.md) · [阅读索引](../../../README.md)
> 对应提交：`d28e8977ab8f80b32c843d52a76c7766fbb1286e` · 原文 SHA-256：`58e5de5c9cf7061eb4f39240dfcadc2e2e4a0cbf124f9c268f7e878bbf451dc1`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: dsh-ci-test-reliability
description: Design, review, and diagnose DeepSeek Harness tests and fixtures that can fail nondeterministically under CI concurrency, shared host resources, clocks, process-global state, subprocesses, network listeners, or asynchronous teardown. Use when adding or changing tests with those risks, investigating flaky CI, or reviewing test isolation; use dsh-pre-push-checks separately to select outgoing commands.
---
```


<a id="reliable-dsh-ci-tests"></a>
# 可靠的 DSH CI 测试

测试应在仓库真实 CI 拓扑下仍正确，而非仅在空闲工作站单独运行时通过。本技能负责隔离和可靠性决策，不替代测试分层策略，也不选择每个推送检查命令。

<a id="read-the-owning-rules"></a>
## 阅读所属规则

- 使用[测试策略](../../../../../docs/testing.md)选择单测、覆盖率、预期输出、快照、浏览器或真实 API 证据。
- 生命周期、子进程、取消和释放行为遵循[防御模式](../../../../../docs/defensive-patterns.md)。
- worker／任务拓扑影响测试时，读取当前 Vitest 配置和 GitHub 工作流。
- 录制会话情景还须遵循[快照说明](../../../../../snapshots/AGENTS.md)。
- 测试设计正确后，再用 [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) 选择发布前验证。

<a id="model-the-execution-topology"></a>
## 建模执行拓扑

除非活动配置证明相反，否则假定以下各层可能重叠：

1. 同一 Vitest 文件中的测试。
2. 不同 Vitest 文件或 worker 进程。
3. 同一任务内独立的 Vitest 或仓库检查进程。
4. runner 共用宿主机的不同 Actions 任务。

进程隔离并不隔离宿主端口、可预测路径、外部服务、数据库、socket 或继承的子进程。每个取得的资源都要明确所有者、原子分配方式、可观察就绪信号、已注册清理和完全结束信号。

不要仅因一个 fixture 缺乏隔离就串行化整个测试集，先缩小独占范围或改变分配方式。Vitest 串行块无法保护资源免受其他文件、进程、任务或 runner 干扰。

<a id="allocate-resources-atomically"></a>
## 原子分配资源

使用资源所有者提供的分配器，不要先检查可用性、稍后再占用。

- 网络 fixture 用 `listen(0)` 绑定回环地址，等服务报告监听后读取分配地址；不要扫描空闲端口后再绑定。
- 用 `mkdtemp` 创建每测试私有临时根，不使用可预测共享路径。
- 共享数据库、socket、会话和输出位置采用每测试唯一命名空间。
- 路径必须不存在时使用排他创建。
- 将稳定的录制标识与临时传输地址分开，在 fixture 内转换，不强迫真实资源使用录制值。

仅作解析输入或预期值的字面路径和 URL 不是已取得的资源，不要只因它们固定就改写。

<a id="contain-process-global-state"></a>
## 隔离进程全局状态

将 `process.env`、`cwd`、假定时器、区域和时区、模块 mock、注册表、控制台钩子、`globalThis` 和全局 `fetch` 拦截视为独占可变资源。

优先依赖注入或实例局部适配器；确需修改时：

- 记录原值是缺失还是存在；
- 精确还原该状态；
- 立即注册恢复逻辑；
- 用 `try/finally` 包围最小修改范围；
- 局部 finally 前可能失败时，保留 afterEach 兜底；
- 仅拦截 fixture 拥有的最窄、精确请求或调用。

<a id="respect-platform-owned-semantics"></a>
## 尊重平台语义

CI 在 Windows 和 POSIX 上运行同一测试集，操作系统拥有的值不一定能原样往返。

- 只有断言允许写回不精确时，恢复值才安全。例如恢复 mtime 来证明指纹仍失效可跨平台成立；恢复它来证明记录仍有效却假定了无损往返，而 NTFS 的 100 纳秒刻度不能无损表示所有小数毫秒。断言依赖恢复时，应重新读取期望值，而非使用记忆中的值。
- Windows 环境变量名不区分大小写，同时设置 `http_proxy` 和 `HTTP_PROXY` 实际只对应一项。
- Windows 异步释放文件句柄；POSIX 上立即完成的重命名或删除，可能需要按实测争用设置有界重试。
- Windows 不具备 POSIX 权限和信号语义；依赖它们的用例应显式说明原因并按平台跳过，而非削弱所有平台的断言。

优先选择所有平台都成立的观察；确实无法跨平台的用例，在对应平台显式排除。

<a id="budget-timeouts-against-the-lane"></a>
## 按 CI 执行通道分配超时

describe 或用例超时会覆盖而非服从 runner 的 `--testTimeout`。低于执行通道预算会收紧 CI 已授予的额度，而同一常量在默认值更低的宿主又像放宽。进程创建密集的测试集应采用通道预算，更紧限制必须说明原因。

提高测试预算时也提高钩子预算；准备和释放遭遇相同争用，只提高用例预算会把失败移到 afterEach。

超时本身是被测对象时，外层等待应远大于被测超时。例如验证 20 ms 截止时间，不能与测试框架自身等待竞速，否则负载决定哪个先报错。

<a id="synchronize-on-state"></a>
## 按状态同步

固定 sleep 不能证明准备完成或清理结束。

- 等待明确就绪事件、握手、状态转换、拥有的 Promise 或外部可观察条件。
- 用 deferred Promise 或屏障将竞态放在确定位置，并证明相关操作重叠。
- 超时只用来限制等待，不作为让断言成立的条件。
- 除非调度顺序本身是被测产品行为，不断言依赖调度器的顺序。
- 时间本身是测试对象时，注入或模拟时钟，并始终恢复真实定时器。

<a id="dispose-to-quiescence"></a>
## 释放到工作完全结束

取得资源后立即注册清理，确保断言失败也能释放。清理应停止新回调／请求、移除监听器、恢复全局钩子、终止拥有的工作，并等待子进程退出、服务关闭、worker 终止或等价完成信号。

只调用 `abort()`、`close()`、`kill()` 而不等完成信号，释放仍不完整。可能迟到完成时，要证明释放能阻止它修改其他测试。

<a id="prove-the-intended-regression"></a>
## 证明预期回归

- 可行时观察修复前普通回归失败。
- 新增静态／资料检查时，临时引入应拒绝情形，观察预期失败。
- 竞态测试用屏障证明重叠，反复执行本身不算竞态测试。
- 修复涉及跨进程隔离时，对端口、socket、共享路径、子进程等资源并发运行独立测试进程。
- fixture 启动子进程且自带截止时间时，先断言没有信号或超时结束它，再检查退出状态，使被杀子进程报超时而非状态不匹配。
- 验证外部状态、事件、文件、日志、退出或释放，不只信任组件自报结果。

压力运行补充确定性回归，不能替代它。

<a id="reject-flake-masking-fixes"></a>
## 拒绝掩盖偶发失败的修复

对于确定性本地测试，不要把以下做法称为根因修复：

- 未识别等待状态就提高超时；
- 添加重试；
- 将所有文件串行执行；
- 吞掉错误或未处理拒绝；
- 削弱断言；
- 用规范化抹去不稳定行为；
- 在清理或断言前添加 sleep。

真实 API 策略下，有文档说明的临时外部提供方测试仍可重试；例外限定在外部边界。

恢复既有预算不算掩盖。把测试集恢复到本已授予的通道预算，或按 runner 实测争用设置有界重试，都明确了等待工作并恢复额度，而非为未经分析的等待凭空增加余量。

<a id="diagnose-existing-flakes"></a>
## 诊断已有偶发失败

已有概率性 CI 失败请阅读[诊断流程](references/ci-flake-diagnosis.md)。仅诊断请求保持只读，除非用户也要求修复，否则只报告原因和证据。

<a id="validate-and-report"></a>
## 验证与报告

对受影响行为运行最小定向回归。只有变更确实承担该风险时才补拓扑证据：

- 全局修改需要恢复证据；
- 生命周期／子进程需要完全结束的释放证据；
- 端口、socket、共享路径需要独立进程并发证据；
- 新检查需要反例对照。

推送前使用 [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md)，报告精确命令和观察结果；不能把重试、跳过或待完成 CI 称为通过。
