# Agent Note: 全局启用的技能默认对智能体启用

Status: implemented

[English](2026-11-26-skill-global-enablement-defaults-to-agents.md) | 中文

## Problem

设置 → 技能 页显示某个本地技能已全局启用，但所有智能体的技能列表都把它标记为已禁用。该技能没有 `agent_skill` 记录，而默认规则只对内置技能回退为启用。输入框的技能菜单与会话的技能白名单都读取智能体级别的值，因此即使库级开关显示为开启，智能体既看不到也无法调用这个技能。

## Decision

每个智能体的实际启用状态为 `global_enabled AND (agent_skill override ?? activationState = 'active')`。全局开关开启时，优先使用保存的 `agent_skill` 选择。没有单独设置的智能体会继承已确认的技能。

核对技能库时，系统将托管目录中新发现的文件夹登记为 `isEnabled: false` 和 `activationState: 'pending'`。「设置 → 技能」在列表和详情页显示待确认状态。即使保存的全局开关已开启，点击**为智能体启用**仍会通过 `PATCH /skills/:skillId` 发送 `isGlobalEnabled: true`。该请求在同一次写入中保存开关值，并将 `activationState` 设为 `active`。用户主动从市场或系统安装、从本地导入时，以及同步随应用提供的技能时，新登记的技能默认已确认并启用。刷新元数据时保留开关值和确认状态。

升级迁移将满足 `source = 'local' AND source_url IS NULL` 的记录设为 `pending`，其余记录为 `active`。旧版本保存了开关值，但没有记录是谁设置的。符合条件的旧技能都需要确认一次才能被继承，包括用户曾手动开启的技能。

手动创建智能体时，用户可通过 `disabledSkillIds` 取消选择。创建智能体的同一事务会将每项取消选择保存为显式的 `false`。`ResourceCreateResult` 展示新建智能体实际启用的技能。

待确认的技能无法新增启用它的 `agent_skill` 绑定。对于 MCP `create_agent`，`skillIds` 精确指定要启用哪些已确认且全局启用的可选技能。省略该字段时遵循继承规则，传入 `[]` 时则不启用任何可选技能。内置技能遵循全局开关。工具会报告新建智能体实际启用的技能。

## Alternatives considered

- 在技能被接纳或全局开关变化时，为每个智能体写入 `agent_skill` 记录。这会产生大量记录写入，遗漏之后创建的智能体，并可能在切换全局开关时覆盖智能体显式保存的选择。
- 保持两级启用行为、只补充文档。技能仍会在设置里显示为已启用，却没有任何智能体能使用——正是被报告的状态。
- 只对 `source === 'local'` 修改回退规则。系统安装与市场安装同样可能缺少智能体级别的记录，按来源区分只是把同样的缺口留在一条人为边界之后。
- 重置所有从目录发现的旧技能的全局开关。这样会暂停已保存的 `true` 绑定，影响已经使用该技能的智能体。保留开关值和绑定可以让这些智能体继续使用技能，新的继承则需要等待确认。

## Consequences

- 未单独启用该技能的智能体需要等待用户确认，才能继承从目录发现的技能。只要全局开关开启，已保存的 `true` 绑定仍然有效。
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
- Regression — `src/main/ai/skills/__tests__/SkillService.test.ts` 的「requires confirmation for pending inheritance and preserves recorded overrides」「does not create an enabling binding for an unconfirmed skill」「preserves pending and confirmed states through repeated library reconciliation and metadata refresh」和「activates a pending legacy skill when explicitly reimported from the library」覆盖待确认技能的启用。
- Regression — `src/main/data/db/__tests__/skillActivationMigration.test.ts` 的「requires confirmation for legacy adoptions while preserving global switches and Agent bindings」验证升级迁移。
- Regression — `src/main/ai/mcp/servers/__tests__/agentConfigTools.integration.test.ts` 的「blocks explicit selection of a pending skill during Agent creation」和「blocks new pending bindings during updates and keeps existing bindings through unrelated edits」覆盖新增绑定和已有绑定。
- Regression — `src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx` 的「confirms a pending Skill even when its saved global switch is already on」和 `src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx` 的「offers confirmation in place of an on switch for a pending Skill」分别覆盖两处确认操作。
