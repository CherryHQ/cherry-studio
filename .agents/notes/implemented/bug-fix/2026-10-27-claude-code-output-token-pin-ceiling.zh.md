# Agent Note: Claude Code 将模型目录的输出上限钉成了端点拒绝的取值

Status: implemented

[English](2026-10-27-claude-code-output-token-pin-ceiling.md) | 中文

## 问题

`src/main/ai/runtime/claudeCode/environment.ts` 中的 `resolveRequestedOutputTokens` 会把模型目录里的 `maxOutputTokens` 钉进 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`，而唯一的上界是随包 CLI 自身的 128,000 上限。目录值描述的是模型能产出多少，而不是服务它的端点接受多少。

#22332 在 Work 中用 grok-4.6 报告了这一点：目录声明 500,000 的输出上限，于是每个 agent 回合都在线路上发送 `max_tokens: 128000`，而 xAI 的 Anthropic 兼容端点以 `400 Field 'max_tokens' must be at most 65536` 拒绝它。该故障是彻底的——没有任何回合能开始——而 128,000 的上界本来也无法阻止它，因为它高于请求被拒的那个上限。

## 决策

固定值以端点的接受上限为上界，目录值只能把固定值抬高到这个上界：

```ts
const MAX_REQUESTED_OUTPUT_TOKENS = 65_536
```

grok-4.6 现在正好固定为 65,536。这个值就是端点在自身错误信息中给出的边界，也是在不被拒绝的前提下能给模型的最高值。CLI 本身也会在这里对 `max_tokens` 做截断，因此预留更多只会让压缩预算为无人能用的空间让位。

显式的 agent `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 同样受该上界约束：它进入同一个请求，因此同样会触发这个 400；而压缩预算扣除的是实际固定的、已被收敛后的值。

## 备选方案

- 把所有固定值压到 CLI 默认的 32,000：不采用，因为它也会削减那些合法声明 48K–64K 输出的模型——这些模型的回合会比以前更早地在 `length` 处停止，这是静默的回归而不是报错。
- 保留 128,000 上界，只在网关分支收敛：不采用，因为该修复位于 `buildEnvironment`，而路由尚未解析；direct 分支同样以 Anthropic Messages 与同一批第三方端点通信，会被同样拒绝。
- 从注册表读取按服务商的输出上限：这是长期正确的形态，但目前并不存在这样的声明；为了一个已报告的服商去发明它是比该缺陷所需更大的设计变更。

## 后果

高于 65,536 的目录上限不再到达线路；grok-4.6 请求 65,536 而不是 128,000。声明低于 65,536 的模型不受影响，仍然固定为其声明上限。声明更大上限的第一方或原生 Anthropic 模型同样被约束在 65,536，因此其 agent 回合会比模型允许的更早截断；在有按端点区分的上限之前，这是统一上界所接受的代价。

## 验证

- 回归 — `vitest run --project main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`：228 项测试通过。新增：500K 目录上限配 500K 窗口固定为 `65536`，同时压缩窗口保持在 400K 以上（即 #22332 场景，此前固定为 `128000`）；`CLAUDE_CODE_MAX_OUTPUT_TOKENS=500000` 覆盖值在子进程 env 中被收敛为预算所依据的 `65536`，`48000` 原样保留，且在上下文窗口缺失或低于最小压缩窗口时超大覆盖值同样被收敛，而目录推导值在该情形下保持不固定；`393_216` 仍固定为上界；`16_384` 仍固定为其声明上限。
- `oxlint --deny-warnings` 与 `oxfmt` 在两个改动文件上通过。
