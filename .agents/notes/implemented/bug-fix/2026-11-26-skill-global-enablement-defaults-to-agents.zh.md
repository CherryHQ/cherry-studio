# Agent Note: 全局启用的技能默认对智能体启用

Status: implemented

[English](2026-11-26-skill-global-enablement-defaults-to-agents.md) | 中文

## Problem

设置 → 技能 页显示某个本地技能已全局启用，但所有智能体的技能列表都把它标记为已禁用。该技能没有 `agent_skill` 记录，而默认规则只对内置技能回退为启用。输入框的技能菜单与会话的技能白名单都读取智能体级别的值，因此即使库级开关显示为开启，智能体既看不到也无法调用这个技能。

## Decision

全局禁用的技能不会出现在智能体的技能目录中。对于全局启用的技能，智能体优先使用显式保存的 `agent_skill` 值；没有该记录时，继承全局启用状态。

核对技能库时，系统将托管技能目录中新发现的文件夹登记为 `isEnabled: false`。用户在「设置 → 技能」中启用接纳的技能后，没有显式设置该技能的智能体便会继承启用状态。用户主动从市场或系统安装、从本地导入时，以及同步随应用提供的技能时，新登记的技能默认启用。刷新元数据时保留现有的开关状态。

手动创建智能体时，向导默认勾选所有全局启用的可选技能，并勾选且锁定全局启用的内置技能。取消勾选可选技能会将其加入 `disabledSkillIds`。创建智能体时，在同一事务中为每项取消勾选的技能写入值为 `false` 的显式 `agent_skill` 记录。`ResourceCreateResult` 展示新建智能体实际启用的技能。

对于 MCP `create_agent` 工具，`skillIds` 精确指定要启用哪些全局已启用的可选技能。省略该字段时继承所有全局启用的技能，传入 `[]` 时则不启用任何可选技能。内置技能遵循全局开关。工具会报告新建智能体实际启用的技能。

## Alternatives considered

- 在技能被接纳或全局开关变化时，为每个智能体写入 `agent_skill` 记录。这会产生大量记录写入，遗漏之后创建的智能体，并可能在切换全局开关时覆盖智能体显式保存的选择。
- 保持两级启用行为、只补充文档。技能仍会在设置里显示为已启用，却没有任何智能体能使用——正是被报告的状态。
- 只对 `source === 'local'` 修改回退规则。系统安装与市场安装同样可能缺少智能体级别的记录，按来源区分只是把同样的缺口留在一条人为边界之后。

## Consequences

- 智能体无法自行启用接纳的技能。用户需要先在「设置 → 技能」中全局启用该技能。
- 手动创建时取消勾选的技能，在全局关闭后重新启用时仍保留该选择。`create_agent` 收到显式选择时，也会为技能库中所有未选中的可选技能记录禁用状态，包括创建时全局禁用的技能。
- MCP `update_agent` 工具以实际启用的技能为基准，逐项应用变更。传入 `skillIds` 时，工具会替换可选技能的选择，并保留已启用的内置技能。
- 全局关闭技能时，技能仍保持安装，已保存的智能体级选择会在全局重新启用后继续生效。

## Verification

- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` 的「requires global activation before an Agent can use a skill adopted from the managed library」覆盖接纳与启用，「reimports an adopted library skill using its %s」覆盖重用已接纳技能的路径（直接路径与 junction）。
- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` 的「enables a globally enabled local skill for an agent that has no per-agent row」「hides a globally disabled local skill and preserves its per-agent opt-out when re-enabled」和「an explicit disabled row for a builtin skill overrides the enabled-by-default fallback」覆盖继承规则及显式设置的优先级。
- Regression — `src/main/data/services/__tests__/AgentService.test.ts` 的「inherits globally enabled skills and keeps a creation opt-out after reactivation」覆盖继承与选择的持久化。
- Regression — `src/main/ai/mcp/servers/__tests__/agentConfigTools.integration.test.ts` 的「applies and reports the skill selection $skillIds」覆盖省略、空列表和显式选择，「rejects a reviewed update if skill bindings change independently before it writes」验证并发编辑受到保护。
- Regression — `src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx` 的「starts inherited skills on and retains an explicit opt-out across catalog refreshes」和「keeps builtin skills checked and locked when clearing every optional skill」覆盖默认开关状态和取消选择。
- Regression — `src/renderer/components/resourceCatalog/dialogs/create/__tests__/ResourceCreateWizard.test.tsx` 的「submits a manual skill opt-out and reports the created Agent’s effective skills」覆盖提交与结果展示。
- Regression — `src/shared/ipc/schemas/__tests__/ai.test.ts` 的「accepts explicit opt-outs while leaving the remaining skills inherited」覆盖创建请求。
