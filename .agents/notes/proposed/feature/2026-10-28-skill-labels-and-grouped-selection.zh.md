# Agent Note: 技能标签与智能体技能选择器中的分组批量开关

Status: proposed

[English](2026-10-28-skill-labels-and-grouped-selection.md) | 中文

## 问题

已安装技能目前没有可用的用户自定义分组能力。设置 → 技能沿用共享资源目录，只有 `all` / `system` / `builtin` 三个范围页签（`src/renderer/pages/settings/SkillsSettings.tsx:10`、`:29`、`:41`）；智能体创建与智能体编辑共用的技能选择器只渲染一个扁平 `CatalogToggleGrid`，搜索仅匹配 `skill.name`，唯一的批量控件是一个全局「全部启用」开关，没有分组、没有分组级控件，也不支持按标签筛选（`src/renderer/components/resourceCatalog/dialogs/skill/SkillCatalogPicker.tsx:51`、`:58`、`:69`、`:92`；调用方 `src/renderer/components/resourceCatalog/dialogs/create/steps/CapabilityStep.tsx:32`、`src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx:1279`）。因此配置一组相关技能只能逐行滚动勾选，并且要为每个智能体重复同一套操作。

唯一与分组相关的字段是 `sourceTags`——从技能 `SKILL.md` 解析出的发布者元数据（`src/shared/data/api/schemas/skills.ts:17`；解析与持久化路径 `src/main/utils/markdownParser.ts:391`、`src/main/ai/skills/SkillService.ts:544`）。仓库已存在通用的用户标签存储，具备增删改查、多对多绑定与批量读取（`src/main/data/db/schemas/tagging.ts:11`、`:26`；`src/main/data/services/TagService.ts:135`、`:241`；`src/main/data/api/handlers/tags.ts:23`、`:63`），但 `'skill'` 不在允许的实体类型中（`src/shared/data/types/entityType.ts:26`），已安装技能的响应没有用户标签投影（`src/shared/data/api/schemas/skills.ts:7`），且 v2 技能契约明确规定拒绝外层 `tags` 字段与 `tagIds` 查询过滤（`src/shared/data/api/schemas/__tests__/skills.test.ts:26`；另一处相反断言见 `src/main/ai/skills/__tests__/SkillService.test.ts:352`）。

以发布者元数据作为主要分组维度目前不可用：`resources/skills/*/SKILL.md` 下 6 个普通内置包、`resources/code-cli-skills/*/SKILL.md` 下 14 个按条件安装的 Code CLI 模板，都没有声明顶层 `tags` 键（逐个解析各文件首段 YAML 实测），因此这些技能只会落在「未标注」分组。模板只在对应可执行文件可用时才安装（`src/main/services/codeCli/CodeCliService.ts:152`、`:160`）。外部安装的技能可能带元数据标签，其在真实安装环境中的普及程度本文不作结论。

报告所述的代价——集合变大后反复滚动、漏选与错选——来自 issue 报告，不是实测的可用性研究结论。

## 提案

### 1. 一套共享的标签模型，而不是第二套

标签是用于组织技能的共享用户自定义概念，存放在既有 SQL 表中：一条 `tag` 记录加一条指向该已安装技能的 `entity_tag` 绑定。这复用标签的增删改查、名称唯一性、多对多绑定、批量读取与级联清理，因此**不新增表、不新增列、不需要 schema 迁移**。但它会改变两处契约：实体类型的 API 枚举（`src/shared/data/types/entityType.ts:26`）与已安装技能的响应（见第 2 节）。标签是扁平结构，不编码层级、顺序或拖放。

对四个产品问题的回答，作为待批准的提案：

| 问题 | 提案 |
| --- | --- |
| 是否要做，以及分组是一套共享概念还是仅在设置页 | 做。使用一套共享标签存储；智能体选择器作为首个消费方，因为分组级批量开关才是当前无人覆盖的缺口。设置 → 技能只增加技能详情上的最小标注入口，不再引入第二套组织模型。 |
| 文件夹/层级还是扁平标签 | 扁平标签。扁平多对多标签即可满足本次交付的组织需求，不必定义层级、顺序或拖放；将来的层级是独立设计。 |
| 首次交付范围 | 技能详情上的标签标注，加上智能体技能选择器中的可折叠标签分组、分组级批量开关与按标签筛选的搜索。不含技能页树形结构、打包、重命名与备注。 |
| 是否内建「按来源分组」 | 本次不做。来源是安装出处（`src/main/ai/skills/SkillService.ts:153`），已由徽章展示（`src/renderer/components/resourceCatalog/catalog/SkillSourceBadge.tsx:6`），而范围为文件系统分类；因此把自动来源分组作为一个范围选择否掉，而不是判定数据无用。分组为一个标签一段，外加末尾的「未标注」。 |

### 2. 已安装技能上的读投影

`InstalledSkill` 新增用户标签投影，只携带每个标签的 **id 与名称**（派生自 `TagSchema`，`src/shared/data/types/tag.ts:21`）。颜色与时间戳不进入投影：本次交付没有消费方读取它们，编辑器的标签词表来自 `/tags`。

所有返回 `InstalledSkill` 的路径都必须产出该投影，包括 `list`、`listAll`、事务内单条读取、目录查找，以及全局开关与安装操作的响应；存在调用方事务时要透传（`src/main/data/services/AgentGlobalSkillService.ts:38`、`:67`、`:104`、`:127`、`:312`）。列表读取用既有批量助手解析标签（`src/main/data/services/TagService.ts:241`），而不是每个技能查一次：在行映射里加载会为每个技能增加一次查询。`GET /skills` 继续拒绝 `tagIds`（`src/shared/data/api/schemas/skills.ts:39`），`PATCH /skills/:skillId` 继续只接受全局可用性（`:51`）；用户标签的写入走标签 API。

标签操作不重写描述符元数据，也不改变可用性；元数据刷新可以正常改动 `sourceTags` 等元数据，但不得触碰用户标签绑定。

### 3. 对「仅暴露元数据标签」决定的局部替代

本提案局部替代 v2 关于已安装技能只暴露发布者元数据标签的决定。用户自定义的用途/项目组织现在同时具备生产者（第 4 节）与消费方（第 5 节），而先前的决定缺少这两者。`sourceTags` 仍是发布者元数据并保留原有含义。`/skills` 继续拒绝 `tagIds`，技能 PATCH 仍只限全局可用性，用户标签写入走标签 API。把响应字段命名为 `labels` 并不能消除语义反转：对外层 `tags` 字段的字面拒绝可以保留，但误导性的用例标题必须修改，并补充正向的标签契约覆盖。

### 4. 生产者：技能详情

设置 → 技能 → 技能详情（`src/renderer/pages/settings/SkillDetails/SkillDetails.tsx:187`）增加一个小型标签入口：创建标签、把已有标签分配给本技能、从本技能解除标签。解除指**删除绑定**，不是删除共享标签。创建标签与分配是两个独立写入（`TagService.ts:135`、`:284`），因此「创建成功但分配失败」会留下一个可复用的标签，界面不得报告为已分配。写入失败时保留最后一次成功的绑定并给出本地化错误。内置描述符内容只读（`SkillDetails.tsx:246`）不限制标签编辑：标签是数据库记录。

在选择器内创建标签、对已安装技能批量标注、以及全局标签管理界面均为后续工作；详情页已存在，是足够的生产者。

### 5. 选择器：分组、分组控件、搜索

`SkillCatalogPicker` 使用既有 Accordion 基础组件（`packages/ui/src/components/primitives/accordion.tsx:7`、`:21`）组合既有 `CatalogToggleGrid`（`src/renderer/components/resourceCatalog/dialogs/components/CatalogPicker.tsx:60`），每个标签一段，并在末尾加一段「未标注」。

分组范围（提案）：只为「全局可用技能中出现的标签」建段；非空的「未标注」放在最后；段身份使用标签 id；段按标签名称排序，段内技能保持既有顺序（`src/main/data/services/AgentGlobalSkillService.ts:90`）。搜索先 trim、大小写不敏感，匹配技能名称**或**段标签名称；标签名命中会展开该段成员，其他段只保留技能名命中，命中的段会被展开，清空查询后恢复之前的折叠状态且不改变选择。来源或 `sourceTags` 本身不产生任何段。独立的标签芯片与「标签+文本」组合过滤属于后续工作。

选择仍是既有的 id 数组（`SkillCatalogPicker.tsx:26`、`:94`）；选择器不保存任何订阅式分组，因此之后往标签里加入的技能绝不会自动授予既有智能体。分组控件的目标集合是该段**符合条件的、匹配当前查询的成员，与折叠状态无关**——否则折叠的段会得到空目标——计数也使用同一集合。示例：`A={x,y}`、`B={y,z}`，先选 A 再选 B，再清空 A，只剩 `{z}`；`y` 在两段都是关闭，B 为半选，且不提交重复 id。

必须保持的既有行为：

- 创建模式下内置技能为勾选且锁定，不进入提交的可选 id；编辑模式下内置技能可像其他可用技能一样操作；全局禁用的技能保持不出现。
- 分组操作在两种模式下都保留目标集合之外的 id，包括编辑模式保留的隐藏 id——它涵盖可选集合之外的 id，而不只是被搜索隐藏的行。已选中但不可选的项仍可被关闭。
- 全局「全部启用」开关继续作用于所有可用的可选 id，与搜索、折叠和标签无关；编辑模式保留隐藏选择，创建模式保持原有的整数组替换语义，包括关闭时丢弃隐藏草稿选择；无可选 id 时该控件未勾选且禁用。
- 加载中、`disabled`、以及没有符合条件成员的分组都不能改变选择。
- `trailingItem` 在段之外只渲染一次——加载期间隐藏，加载完成后即使无匹配或所有段都折叠也存在——市场/导入/系统菜单保持既有 portal 与父对话框关闭行为（`CatalogPicker.tsx:87`、`:181`；`SkillCatalogPicker.tsx:109`、`:163`）。

分组控件是一个带半选状态的复选框（`packages/ui/src/components/primitives/checkbox.tsx:8`、`:17`；二元开关无法表达「部分选中」），放在段标题旁边、Accordion 触发器的交互内容**之外**，使展开与选择是两个可键盘操作的独立控件；切换选择不会展开或折叠。可见文本与无障碍名称都携带标签名与符合条件的匹配成员数。

### 6. 失效通知

投影嵌入在 `/skills` 响应中，因此一次标签变更让已挂载的消费方保持陈旧属于正确性缺陷，而 `TagService` 目前在创建/绑定/重命名/删除时都不发布技能变更通知（`src/main/data/services/TagService.ts:160`、`:195`、`:284`、`:412`）。成本最低的正确机制是提交后用既有发布器发一个覆盖 `/skills` 与 `/skills/:skillId` 的通知批次（`src/main/data/services/AgentGlobalSkillService.ts:210`；契约 `src/main/data/dataApiDataChange.ts`），需要时再刷新标签选项。绑定操作知道自己的技能 id；重命名与删除可以保守地使技能端点失效，而不必枚举受影响的 id。不在范围内：逐技能广播、新的事件框架，或为了精确而强制的删除前 id 扫描。重新校验必须保留智能体表单的未保存状态。

## 考虑过的替代方案

| 替代方案 | 评估 |
| --- | --- |
| 按发布者 `sourceTags` 分组 | 内置技能没有声明任何标签，内置库只会显示「未标注」，直到用户安装了带标签的第三方技能；它也无法表达用户选择的用途/项目意图。保留为徽章，不作为分组维度。 |
| 把 `source` 做成内建分组维度 | 作为产品范围选择否掉：来源是安装出处，范围是文件系统分类，而且报告者自己给出的备选方案把用户标签排在前面。将来可以增量地重新考虑。 |
| 在 `agent_global_skill` 上新增 JSON 标签列 | 重复既有多对多存储，需要迁移以及自己的重命名/唯一性策略，且没有任何 `entity_tag` 无法满足的需求。 |
| 现在就做文件夹/层级 | 面更大（树模型、排序、文件夹界面），并与 #19760 已跟踪的分类工作重叠；扁平标签是报告者提出的更低成本一步。 |
| 保存选中的标签，在智能体加载时展开 | 会静默把之后加入标签的技能授予既有智能体，也无法表达「这个智能体有 x 没有 y」（当二者共享同一标签时）。选择仍保持为 id 列表。 |
| 维持仅元数据契约、什么都不做 | 报告的重复劳动代价与此前无人覆盖的选择器缺口都保留；v2 决定早于用户标签的生产者与消费方。 |

## 验收标准

- AC1 — 在设置 → 技能 → 技能详情中，用户可以创建并分配共享标签、复用已有标签、并从内置或非内置的已安装技能上解除标签；产生的绑定在重开页面与重载窗口后仍然存在。(verification: renderer and Electron; owner: label-producer implementer)
- AC2 — 非法的标签输入，或分配/解除失败，会保留最后一次成功的绑定并给出本地化错误；若标签创建成功但分配失败，界面不得报告分配成功，且已创建的标签仍可复用。(verification: renderer and main service tests with real SQLite; owner: label-producer implementer)
- AC3 — 所有携带 InstalledSkill 的响应都暴露当前用户标签的 id 与名称，未标注技能返回空数组；标签操作不改变描述符元数据与全局可用性，技能 API 继续拒绝 tagIds 查询过滤以及通过技能 PATCH 写标签。(verification: shared schema and main service tests; owner: data implementer)
- AC4 — 加载非空的已安装技能列表最多增加一次标签数据查询，且没有逐技能或逐标签的 renderer 请求；列表与单技能结果在标签成员与名称上一致。(verification: real-SQLite query instrumentation and response assertions; owner: data implementer)
- AC5 — 同 id 的重装、内置同步与元数据协调保留用户标签绑定；卸载或协调删除在一个事务内原子移除该技能的绑定，同时保留共享标签定义，且之后的全新安装不会继承已删除的绑定。(verification: main service tests with real SQLite; owner: data implementer)
- AC6 — 智能体创建与编辑都显示「全局可用技能中出现的标签」对应的可折叠分组，按标签名称排序，非空的「未标注」在最后；带多个标签的技能出现在每个相应分组，仅来源或 sourceTags 不产生任何分组。(verification: renderer consumer tests; owner: selector implementer)
- AC7 — 分组控件精确选中或清空该组符合条件的、匹配查询的成员（与折叠状态无关），保留其他所有已选 id，并由同一集合推导全选/半选/未选；点击半选状态为全选；先选 A={x,y}、再选 B={y,z}、再清空 A 之后只剩 z 被选中、B 为半选且没有重复 id。(verification: stateful renderer interaction tests; owner: selector implementer)
- AC8 — 创建模式的内置技能保持勾选与锁定且不进入提交的可选 id，编辑模式的内置技能保持可操作，全局禁用的技能保持不出现；分组操作遵守行的可用性规则并在两种模式下保留集合之外的 id；加载中、禁用、以及零符合成员的分组都不能改变选择。(verification: picker and create/edit consumer tests; owner: selector implementer)
- AC9 — 全局「全部启用」作用于所有可用的可选 id，与搜索、折叠或标签无关；编辑模式保留该集合之外的已选 id，创建模式保持原有的整数组替换行为，包括关闭时清除隐藏草稿选择，且可选集合为空时控件未勾选且禁用。(verification: stateful renderer interaction tests; owner: selector implementer)
- AC10 — 经过 trim 且大小写不敏感的搜索匹配技能名称或分组标签名称；标签名称命中会展开该组，其他组只保留技能名称命中，命中的分组会被展开，清空搜索后恢复之前的折叠状态且不改变选择。(verification: renderer interaction tests; owner: selector implementer)
- AC11 — 分组展开与批量选择是两个可独立键盘操作的控件；批量选择不会展开或折叠分组，半选状态以无障碍方式暴露，可见文本与无障碍名称都标明标签与符合条件的匹配成员数。(verification: renderer accessibility assertions and Electron keyboard interaction; owner: selector implementer)
- AC12 — 市场、本地导入与系统技能入口在既有 portal 与父对话框关闭行为下保持可用；加载完成后尾部动作在分组之外只出现一次，即使无匹配或所有分组都折叠；加载与空状态保持真实。(verification: existing picker consumer tests and Electron; owner: selector implementer)
- AC13 — 智能体创建完成或编辑成功自动保存后，重新打开显示所选的逐技能启用状态且没有重复提交的 id；之后的标签分配、解除、重命名或删除既不把技能授予智能体，也不移除其已保存的技能选择、不改变全局可用性。(verification: Electron with a disposable profile and persisted-data assertions; owner: desktop verifier)
- AC14 — 标签变更成功后，持续挂载的技能选择器、技能详情与标签选项通过既有通知/重新校验机制收敛到已提交数据，包括存在其他订阅的 renderer 时，且不重置智能体未保存的选择；失败的变更不得产生虚假的成功状态。(verification: main notification tests and renderer convergence tests; owner: invalidation implementer)
- AC15 — 所有新增界面文案、无障碍名称、计数消息与用户可见错误都走 i18next，并在全部 15 份 renderer 语言文件中拥有经复核的译文，没有未翻译占位符或插值/复数不匹配。(verification: i18n check and locale review; owner: label-producer and selector implementers)

## 风险

- `EntityTypeSchema` 是一个被标签、分组与固定共用的扁平枚举，其设计注释明确说明新增取值会在 schema 边界同时放开三者（`src/shared/data/types/entityType.ts:12`）。因此允许 `'skill'` 会让分组与固定 API 接受技能 id，尽管本次交付不提供技能分组或技能固定的界面、成员关系或渲染。这是在请求中的 Spec 批准里明确包含的边界扩展，而不是「可接受的副作用」；按功能收窄是另一个独立决定，因为扁平枚举是刻意设计。
- 标签名称是数据库范围的单一词表：trim 后 1–64 字符、数据库内唯一（`src/shared/data/types/tag.ts:14`；`src/main/data/db/schemas/tagging.ts:11`）。重名冲突、跨实体的重命名/删除影响，以及不存在大小写不敏感的唯一性，都必须保持可理解。按智能体私有的标签字典将是全新契约。
- `entity_tag` 对技能表没有外键，因此可能残留过期的实体绑定，删除时必须清理。标签外键在删除标签时级联，标签读取使用内连接（`tagging.ts:34`；`TagService.ts:114`、`:218`），所以删除共享标签会移除绑定而不影响技能。
- 技能 id 是 UUID，不需要扩展 `EntityIdSchema`（`src/shared/data/types/entityType.ts:43`）；非法 id 在边界处被拒绝。
- 标签 API 对一个实体可提交的标签列表、以及一个标签可提交的实体列表都限制为 100 条（`src/shared/data/api/schemas/tags.ts:13`）。两者都不是智能体分组选择的上限，且「替换全部」操作不能被当作追加绑定来分片。
- 元数据刷新会用 `SKILL.md` 重写 `sourceTags`（`src/main/ai/skills/SkillService.ts:549`、`:1134`）；标签投影绝不能由该路径写入，否则一次重装就会抹掉用户组织。
- 需要的是原子清理，而不只是加一次删除调用：卸载必须在一个事务内删除技能与其绑定，同时保留可复用的标签定义（`AgentGlobalSkillService.ts:157`）。
- 大规模安装会让渲染行数按标签成员关系倍增，而不是只按技能数；该网格直接映射行、没有虚拟化（`CatalogPicker.tsx:102`）。需要用有代表性的高成员关系数据测量列表查询耗时、序列化投影体积、搜索/展开/切换延迟与通知触发的重新取数，才能声称既有网格足够。
- Accordion 组合容易意外嵌套交互控件；独立焦点目标、半选状态、可见动作范围，以及搜索移除当前聚焦行时的行为都需要验证。
- 后台标签刷新可能与智能体初始化与自动保存竞态；重新校验必须保留未保存选择与既有隐藏选择策略。
- 15 种语言覆盖包含复数、无障碍名称、用户创建的过长标签名与错误文案；键同步并不能证明译文质量或布局可用性。

## 批准后的实施分层

| 层 | 工作 | 覆盖的验收 |
| --- | --- | --- |
| 1. 数据 | 实体类型准入、所有 `InstalledSkill` 路径上的标签投影、批量读取、原子清理、通知批次 | AC3、AC4、AC5、AC14 |
| 2. 生产者 | 技能详情上的标签入口，含失败与部分成功语义 | AC1、AC2 |
| 3. 选择器 | 分组、分组控件、按标签搜索、保持既有不变式与无障碍 | AC6–AC12 |
| 4. 端到端与语言 | 已持久化的智能体选择、跨消费方收敛、全部 15 种语言 | AC13、AC15（叠加前几层的证据） |

每层都链接本 Spec 并列出它覆盖的 AC；最后一层把所有标准映射到证据，并把本文移到 `implemented`。

## 范围边界

- 本 Spec PR 只包含中英文提案与配对 sidecar。实现要在当前 Spec head 获得明确的人工批准之后才开始。
- 该功能是把**技能按标签分配给智能体**；它不是对智能体本身做分组或批量选择。
- 标签是扁平、共享、用户自有的组织元数据：不与发布者 `sourceTags` 合并、不编码层级、不产生持续的「按标签授予」关系。
- 技能详情是初始的创建/复用/解除入口。选择器内创建标签、批量标注、以及全局标签重命名/删除管理界面属于后续工作。
- 选择器筛选在既有搜索框内使用标签名与技能名匹配。独立标签芯片、多标签布尔过滤与服务端 `/skills?tagIds=…` 过滤不在本次交付内。
- 自动来源分组、设置目录里的标签分组、文件夹、拖放、打包、显示名覆盖与技能备注，作为与 #19760 协调的后续工作。
- 既有标签重命名/删除必须刷新新的消费方；这不授权重构跨无关产品域的标签同步。
- 不引入独立的标签存储、SQL 迁移、技能 PATCH 扩展、持久化折叠偏好，也不承诺未来的层级兼容性。
- Spec PR 关联 issue，但不声称功能已实现，也不关闭任何一个 issue。

## 本文未确立的事项

- 真实安装库或市场中元数据标签的普及程度；只测量了内置模板的内容。
- 仅详情页标注对「组织大规模集合」的用户是否足够易发现。
- 可接受的性能上限、有代表性的技能/标签/成员数量、极端规模下 SQLite 参数上限的行为，以及完整 `Tag[]` 与更窄投影的成本差异。
- 真实的键盘/读屏行为、焦点恢复、视口适配、已翻译的计数文案或跨 renderer 收敛。
- 任何实现正确性：目前尚不存在实现。
- 人工对四个产品选择与共享枚举扩展的接受。
