# Agent Note: 环境依赖已安装文件大小

Status: proposed

[English](2026-10-29-binary-installed-sizes.md) | 中文

## Problem

环境依赖目前显示版本和可用来源，但不显示已安装文件大小。在 snapshot 路径遍历安装树会拖慢卡片及其他 snapshot 消费者。

## Proposal

完整设置页接受 snapshot 后，通过独立批量 IPC 请求字节数。主进程只测后端报告的唯一活动 mise 安装，先证明其 canonical 根属于 Cherry 管理的 installs 树，且包含可运行目标的 canonical。随包工具只测自身可执行文件。system、缺失、归属歧义和 core Rust 安装留白。Rust 的两棵隔离 home 含保留工具链和缓存，不能代表一个当前安装。

采用顺序、流式、迭代遍历，不跟随子链接。每项最多 100,000 个节点，软预算 3,000 ms；共享信号量允许两个扫描。未完整测量返回 null，绝不返回部分和。警告由主进程负责，渲染层失败静默。internal Cache 中成功结果（含零）有效 300,000 ms，null 有效 30,000 ms。来源、recipe、观测版本及根身份约束复用。mutation revision、busy 检查和 stop 使旧工作失效；扫描不持 mutation mutex。整批返回前再次检查有效性。

## Alternatives considered

- 复用 `getDirectorySize`：其整目录读取、无工作量和时间界限的递归及逐层错误日志不满足约束；修改还会影响 markdown 和 mini-app 消费者，因此独立实现域内有界测量。
- stat shim 或按 recipe 和版本猜目录：无法证明安装归属，尤其涉及 alias 和 npm/pipx recipe 时。
- 扫描系统目录或合计 Rust homes：归属范围超出单个安装。
- 将尺寸加入 snapshot 或开机预取：拖慢无关消费者并引入未请求的磁盘访问。

## Acceptance criteria

- AC1 — preset 和实际展示的 custom 卡片显示可靠归属的已安装普通文件逻辑字节数；无法归属的来源留白。 (verification: unit + renderer + Electron)
- AC2 — pending、null 和请求失败不增加尺寸节点、占位、错误 UI 或 renderer error 日志，且不改变安装操作；真实零仍可见。 (verification: unit + renderer + Electron)
- AC3 — snapshot 先于尺寸提交；mini 和 boot 不发起尺寸工作，扫描全局并发二、单项顺序 I/O 且工作量有界，过期批次不能发布。 (verification: unit + renderer + Electron)

## Risks

时间预算不能中断挂起的 OS 调用，不包含后端查询和信号量排队。没有事件的外部变更在后续请求的 TTL 到期或身份变化后观察。逻辑字节数不等于分配空间或可释放空间。真实 mise 安装树与 Windows/Linux 行为需要运行时验证。

## Verification

实现 worker 负责定向文件系统、manager、IPC 和 renderer 测试，并在任务报告记录实际闸门结果。维护者负责验收前的真实 Electron 截图、真实安装字节对照和列表时序验证。这些运行时验证尚未完成时，本说明保持 proposed。
