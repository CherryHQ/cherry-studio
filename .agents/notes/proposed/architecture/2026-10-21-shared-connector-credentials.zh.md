# Agent Note: 本地 Connector 共用文件凭据

Status: proposed

[English](2026-10-21-shared-connector-credentials.md) | 中文

## 问题

飞书 Channel 将应用凭据放在频道配置中，尚未发布的知识库集成则在 `ExternalKnowledgeCredentialStore` 中将另一份应用凭据与用户令牌一起存储。从 Channel 页面创建凭据，并不意味着凭据归 Channel 所有。在业务模块间复制凭据会留下重复密钥，使更新和删除行为不明确。

Cherry Studio 将自行实现 Connector。专用的 `feishu_application` 表会将某个 Connector 的凭据结构固化到业务 schema 中。当前需要的是统一的凭据所有者与持久化文件存储，而非通用 OAuth Runtime 或带版本协议的存储框架。

## 提案

### 范围与决策

使用主进程 `CredentialStore`，以明文 JSON 文件存储迁入该系统的凭据。Channel、知识库及后续本地 Connector 引用凭据，不再各自保存重复的应用密钥。不新增 `feishu_application`、Connector 专用凭据表或通用账号数据库。

用户已明确选择本期使用明文，并确认知识库加密实现尚未发布。迁移知识库时替换该实现，不为它长期保留加密／明文两种存储模式。已发布的 Channel 数据与本地知识库测试数据仍须无损转换。本记录表达已讨论确定的设计，不代表实现完成或 GitHub Spec 已获批准。

Connector 由 Cherry 自行实现。OpenConnector 仅作为设计参考，不是本提案选择的依赖或 Runtime。远端知识库检索及此前推迟的阶段 B 仍不在范围内。

### 所有权与依赖

存储服务负责凭据查询、创建、条件替换、删除、文件序列化和变更通知。该共享 connector 能力放在 `src/main/services/credential/`；持久化到文件不代表它属于通用业务数据层。其 `index.ts` 只导出服务和错误契约，记录 schema 保持私有。通过现有主进程生命周期系统注册其持久运行状态。协议模块负责凭据 schema、注册、授权确认、令牌刷新和错误分类。业务模块负责自身配置、绑定、运行任务和连接状态。

现有 `feishuAppRegistration.ts` 继续作为共享注册协议。Channel 与知识库使用统一凭据所有者，不读取对方的服务或配置。保留知识库的授权身份校验和运行时取消规则，不将整个知识库 Runtime 搬入通用 Connector 抽象。

飞书首批使用两种记录：

| 类型 | 内容 | 引用方 |
| --- | --- | --- |
| 应用凭据 | 域、App ID、App Secret | Channel 绑定与用户授权记录 |
| 用户授权 | 应用凭据引用、令牌、过期时间、授权范围 | 知识库 Connection |

应用密钥只有一份权威存储。现有知识库 SQLite Connection 仍是业务授权状态和账号身份的权威来源，文件存储不再维护另一套连接状态。应用引用标识可复用凭据，不代表有权读取用户文档。Channel 启停与知识库同步相互独立。

### 文件模型

每条凭据一个 JSON 文件，以不透明凭据 ID 命名。记录只包含 ID、Connector 标识、凭据类型、显示名称以及经过 schema 校验的 payload。各 Connector 校验其支持的 payload；`payload` 不是未经验证的任意对象。

不增加 `formatVersion`、`schemaVersion`、`encoding` 或通用持久化 `revision`。目标只支持一种格式，实际格式变化时再引入对应迁移。本期不增加编码器注册表、可插拔存储后端或通用 OAuth Provider 基类。

凭据目录通过显式注册的路径键交给 `application.getPath` 解析，并排除在普通业务数据导出之外。POSIX 目录权限为 `0700`、文件权限为 `0600`；权限不等于明文加密。文件名不包含账号名称、App ID 或令牌。内存列表从文件派生，不维护第二份权威清单。

### 写入与异步正确性

主进程是文件的唯一写入者；Renderer 和 utility process 不直接修改凭据文件。存储层串行执行修改、校验内容，并通过临时文件原子替换。文件缺失与内容损坏或不可读分开处理。失败时不得覆盖损坏内容，也不得将其当作空存储。

仅串行写入不能拒绝旧网络响应。保留现有的预期凭据引用和预期 refresh token 检查：仅当当前凭据仍与发起刷新时一致，刷新结果才能提交。检查与文件修改须在同一个串行操作内执行。保留取消、重连、迟到错误处理的运行时 attempt／代次保护；拒绝通用持久化 `revision` 不意味着删除这些保护。

替换共享应用密钥必须使消费者的旧凭据快照失效。新的认证操作取得当前密钥；Channel 协调 SDK 连接，知识库隔离旧刷新／授权尝试。修改 App ID 或域代表另一应用身份，须显式重新绑定，不能原地覆盖无关身份。

### 边界与删除

凭据列表和管理走 IpcApi，因为它们是文件记录，不是 SQLite 支撑的 DataApi 资源。Renderer 响应只包含安全摘要和不透明引用，不回传已保存的秘密。手动输入的秘密发送到主进程存储，不提供通用秘密导出 IPC。日志不得记录凭据 payload。

Channel 和知识库业务行保持现有数据库所有权，只保存不透明凭据引用。删除 Channel 只解除绑定，不删除与知识库共用的凭据。知识库断开按现有用户授权语义处理，不删除共享应用密钥。本期用户授权仍由知识库拥有，共用存储不意味着未来消费者之间共用撤销行为。

显式删除凭据必须同时检查业务绑定与凭据之间的引用。主进程协调绑定准入和凭据回收，防止过期的使用检查与新绑定并发。使用关系从权威绑定解析，不额外维护引用计数。SQLite 与文件不共享事务：先写新凭据材料，再提交绑定，最后回收旧材料；恢复遗留材料时不得删除仍被引用的记录。

### UI 与交付

两个入口均可选择已有应用凭据、扫码创建应用或手动输入凭据。知识库不再暴露 Channel 专用导入入口或 `channel-app` 凭据来源。未选中适用应用时，连接流程以二维码注册作为主要入口，手动表单为次级入口。已有有效知识库授权可直接继续；已有应用但尚无用户授权时进入授权流程。

复用纯展示二维码面板，显示验证链接／确认码、加载、等待、过期、重试和取消操作。业务所有者保留各自会话与状态转换，不用通用授权 hook 合并不同完成条件。注册成功不等于用户授权成功。浏览器链接是扫码之外的显式选项；已放弃尝试的迟到响应不能重新打开浏览器或取消替代尝试。

先交付存储和迁移，再让 Channel 与知识库改用引用，最后调整共享选择／扫码界面。实现层之前先发布架构 Spec；共享基础设施放在现有飞书栈下方，消费者集成保留在对应归属层。

### 迁移与未来加密

对于已发布的 Channel 配置，先校验和转存应用凭据，再替换绑定、移除旧密钥。对于尚未发布的知识库文件，使用当前读取器解密已有本地测试凭据，转换为约定的明文记录，保留用户令牌和 Connection 身份。解密或写入失败时保留源数据并报告恢复要求，不静默重置凭据。这是单向转换，不是永久双写或回退路径。

仅当密钥材料一致时，才按域与 App ID 合并应用凭据。密钥冲突须明确解决，任一来源都不能自动覆盖另一方。各条转换提交前保留源数据，并保证重启可安全继续。完成迁移后只写目标格式；业务引用变化涉及的 SQL 迁移仍须追加。

未来加密位于同一存储边界之后。届时再选择受支持的操作系统保护机制，实施具体转换，保持业务凭据 ID 不变。本期既不交付加密，也不保留占位加密模式。本提案迁移范围内的凭据，以此替代此前的加密存储与文件格式版本方案。

飞书连接层（#20699）的授权恢复决策 继续约束身份连续性、条件替换、取消和旧请求隔离。在本提案实现之前，其中加密文件的验证描述仍对应现有代码。

### 可执行实施计划

以下路径和契约是待实现目标，并非已有 API。起点为 `codex/issue-15970-knowledge-ui` 上的 `d1b583fa48f1716264a67270ebbd872a9097a0f5`；开始实现时重新核对受影响调用方。保留现有 Source／Document 表结构和同步流水线。本次凭据工作独立于已暂缓的远端检索阶段。

#### 记录与绑定契约

新凭据 ID 使用 UUID，文件名为 `<id>.json`。注册 `feature.credentials`，对应 `{userData}/Credentials/connectors`，位于 `Data` 之外；加入 `NO_ENSURE`，由存储层以正确权限创建目录。校验 ID 后，通过 `application.getPath('feature.credentials', filename)` 解析路径。复用 `@main/utils/file` 的 `atomicWriteFile`，不另写原子文件工具。现有 Cherry Account 文件不进入此模块的扫描和清理范围。

以下仅主进程使用的类型草图确定初始记录形状。实际持久化采用严格 Zod schema，校验过期时间和非空值，并确认文件名与记录 ID 一致。秘密字段不进入跨进程响应类型。

```ts
type CredentialRecord = {
  id: string
  connector: 'feishu'
  label: string
} & (
  | {
      kind: 'application'
      payload: {
        domain: 'feishu' | 'lark'
        appId: string
        appSecret: string
        encryptKey?: string
        verificationToken?: string
      }
    }
  | {
      kind: 'user-authorization'
      payload: {
        applicationCredentialId: string
        tokens: null | {
          accessToken: string
          refreshToken: string
          accessTokenExpiresAt: number
          refreshTokenExpiresAt: number
          grantedScopes: string[]
        }
      }
    }
)
```

`tokens: null` 表示待授权记录，包括首次取消后仍可恢复的授权。记录存在不等于授权成功。飞书现有的 `encrypt_key` 和 `verification_token` 也迁入应用记录的可选字段，避免持久化 Channel 配置继续返回这些秘密。保留 `allowed_chat_ids` 等频道专有非敏感选项。

Channel 的飞书配置改为 `type`、可空的 `applicationCredentialId` 和频道专有选项；空引用表示未配置草稿，不能连接。域与 App ID 从所选应用的摘要获取。知识库保留现有 `credentialReference` 列，指向用户授权记录，并保留 Connection ID、账号身份、作为身份投影的 `appId` 和 `appCredentialSource`。用户授权记录再指向应用。此形状不需要新增 SQL 列或凭据表，JSON 和引用转换由应用执行。若实施中发现确实需要修改 SQL 约束，应生成追加迁移，不能改写已发布迁移。

注册用途与知识库授权策略保持显式区分。默认扫码允许在飞书侧选择已有应用，不通过 `createOnly` 强制新建，也不重命名应用或替换其预设。在本地已选应用时，传入其 App ID，为该应用申请追加权限。知识库声明必需的用户权限，两种选择路径都使用 `custom-app` 授权策略：注册结果不能证明应用是新建的。必需权限和身份校验仍不可缺少；重连保留 Connection 原有策略，包括历史 `personal-agent` 限制。只有密钥一致时才复用匹配的本地应用，并保留其名称和可选加密配置。复用不会授予 scope，也不代表机器人应用自动适合知识库。保留 Channel 的 `lark` 支持，但在知识库提供方支持 Lark 端点前，其选择列表只展示 `feishu`。不为了推断业务策略而向凭据增加注册来源字段。

#### 模块落点与服务生命周期

| 实现目标 | 职责与受影响调用方 |
| --- | --- |
| `src/main/services/credential/CredentialStoreService.ts` 及私有 `credentialSchemas.ts` | 文件记录、修改串行化、凭据间引用保护、安全摘要和变更事件。不导入 Channel 或知识库表；业务引用查询和迁移归属飞书连接层。 |
| `src/main/core/paths/pathRegistry.ts` 与 `src/main/core/application/serviceRegistry.ts` | 注册路径和生命周期服务；通过统一测试系统接入 mock。 |
| `src/main/services/FeishuRegistrationService.ts` 与现有 `feishuAppRegistration.ts` | 共享、按调用者隔离的注册会话与已有 HTTP 协议。声明 Channel／知识库需要追加的权限；不负责用户令牌刷新或机器人运行。 |
| `src/shared/ipc/schemas/credential.ts`、`src/shared/ipc/schemas/feishu.ts`、对应主进程 handler 及已有 IPC 组装入口 | 校验命令与安全输出；已保存 payload 的 schema 仅留在主进程。 |
| `src/shared/data/types/channel.ts`、`src/main/ai/channels/channelCommands.ts`、`ChannelManager.ts`、`ChannelRuntime.ts`、`channelAdapterLoader.ts`、`adapters/feishu/FeishuAdapter.ts` | 持久化引用、解析仅主进程可见的适配器配置、隔离迟到加载结果，并在共享密钥变化后协调连接。同步适配创建／更新／扫码命令的消费者。 |
| `src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`、`ExternalKnowledgeCredentialStore.ts`、`src/main/features/knowledge/KnowledgeService.ts` | 组合应用与授权记录；保留 token 串行通道、身份校验和重连 CAS；停用旧存储及其无范围限制的孤立凭据扫描。 |
| `src/renderer/components/credentials/` 与现有知识库／Channel 表单 | 使用 `@cherrystudio/ui` 实现共享应用选择器和二维码展示；页面各自保留授权／绑定状态。 |

`CredentialStoreService` 继承 `BaseService`，位于 `Phase.WhenReady`。初始化时修正目录权限、读取记录，之后开放凭据写入。飞书连接层在存储就绪后、两个消费者激活前执行转换。ChannelManager、KnowledgeService、FeishuRegistrationService 声明同阶段依赖。现有 BeforeReady 数据库服务通过阶段顺序保证可用，不额外声明 `@DependsOn`。迁移调用数据服务，不调用已运行的业务服务，避免生命周期依赖环。

初始化按绑定给出就绪结果：旧数据转换失败时，阻止该绑定激活和清理，保留源数据并返回可恢复错误；其他有效绑定仍可使用。知识库不能对被阻塞绑定执行现有启动协调后，将其误判为授权记录缺失。停止时拒绝新操作，由注册会话所属服务取消会话，等待已排队文件提交结束，并释放订阅。消费者在生命周期初始化之后解析服务，不能在服务尚未就绪的字段初始化器中取得它。

转换失败不能使列表／详情响应返回旧内联秘密，也不能因新 schema 校验而导致整个 Channel 列表失败。只有迁移读取原始旧配置。对外投影提供被阻塞／未配置摘要和恢复错误，Channel 命令在激活前检查就绪状态。备份恢复后，即使进程没有重启，也须在重新开放 Channel 或知识库准入前复查文件可用性。

#### 主进程操作与竞态边界

存储层只暴露本期需要的操作：`listSummaries`、`read`、`create`、`replaceApplication`、`rotateTokens`、`remove`、`withReferences` 和变更事件。`read` 返回类型化记录，或区分缺失、损坏、不可读。`create` 不覆盖已有 ID。`replaceApplication` 保留域／App ID，身份变化创建另一记录。`rotateTokens` 除授权 ID 外还要求预期 refresh token 和应用快照。这些操作都不在持有修改队列时执行提供方 HTTP 请求。

初期凭据量小，使用一个修改队列。`withReferences(ids, commit)` 在队列内加载、校验引用记录，再调用仅主进程可用的同步回调，通过 `withWriteTx` 提交业务绑定。回调不能 await、联网或重入存储。所有创建／重新绑定路径，包括通过 `channelCommands.ts` 调用的智能体工具，都必须经过此入口。删除 Channel 只解除引用，不自动删除应用。`remove(id, isReferenced)` 要求传入同步业务引用判断，在同一队列内与授权到应用的引用一起检查，再删除文件；损坏或不可读记录导致无法确定使用关系时，阻止删除。飞书连接层负责该引用判断和删除 IPC 路由，基础层不向渲染进程暴露无保护的删除入口。不引入启动时注册保护器的窗口，也不允许省略判断。数据服务仍是同步数据库写入者。

重连先写候选授权记录，再在 `withReferences` 内复查原 Connection 引用、运行时代次、候选及应用快照，调用现有 Connection／来源提交操作。比较失败只丢弃该尝试未使用的候选。token 轮换在修改队列内重新读取授权和应用，引用／token／应用快照已变化就拒绝提交；文件写入不能恢复已删除记录。共享密钥替换提交文件后，在下一个排队修改执行前同步隔离受影响消费者的旧操作。事件只包含 ID 和变更类型；Channel 请求协调，知识库先推进相关运行时代次，再等待后续工作。

在已经异步的 `channelAdapterLoader.ts` 内解析飞书秘密，不把 `ChannelRuntime.readDesired` 改成异步。向 FeishuAdapter 传入独立的主进程已解析配置类型。保留 ChannelRuntime 在等待加载后的 revision 检查，销毁过期适配器。移除 FeishuAdapter 的空配置隐式注册和密钥回写事件路径，改为激活 Channel 前显式注册。不改无关频道协议。

知识库不能继续对共用存储执行 `listReferences()` 后，删除自身 Connection 列表以外的全部凭据。它只能在迁移后，通过存储层权威使用检查清理未使用的知识库授权候选。未绑定应用是有意保留的可复用记录，不属于启动垃圾。本期不增加通用后台垃圾回收器或引用计数表。

#### IPC 与交互契约

| 路由目标 | 输入与可观察输出 |
| --- | --- |
| `credential.list` | Connector／类型筛选 → ID、类型、名称、适用时的域／App ID 和可用状态摘要，不返回已保存 payload。 |
| `credential.feishu.create_application` | 手动应用字段 → 摘要；同域／App ID 的材料不同则返回冲突，不静默更新已有应用。 |
| `credential.feishu.replace_application` | 应用 ID 和新秘密字段 → 摘要；保留应用身份并通知消费者。 |
| `credential.remove` | 凭据 ID → 已删除、原本不存在、被引用或不可读失败；不级联删除。 |
| `feishu.registration.begin/complete/cancel` | 域和注册用途 → 带验证链接／到期时间的所属会话；完成后保存应用并返回摘要，绝不返回密钥。 |
| 现有知识库授权／重连路由 | 所选应用引用或所属注册会话 → 现有用户授权会话，随后返回 Connection；不再将秘密作为业务配置输入。 |

通过已有 IPC 路由组装机制注册 schema 和 handler。注册会话绑定调用 Renderer 的 `IpcContext` 所有者，其他窗口不能完成或取消。重复完成不能重复创建应用。文件写入后才取消可能留下未绑定可复用应用，但不能激活 Channel 或发布知识库授权。未知 ID、错误凭据类型或不支持的域在调用提供方前失败。不提供已保存秘密的读取／导出路由；手动秘密只发往主进程，成功／取消后清空 Renderer 状态。替换应用时，省略的可选秘密字段保持不变；显式 null 只可清除 encryptKey／verificationToken，App Secret 不允许清空。摘要可报告可选秘密是否已配置，但不返回其值。

有多个应用时由用户明确选择。未选应用时，以二维码注册作为主要内容，同时直接提供“使用已有应用”和手动入口；仅在流程可见且活跃时启动注册，隐藏／卸载时取消。选择应用后，Channel 绑定并连接，知识库单独进入用户授权。保留已有有效知识库连接。二维码面板只展示 URL／确认码／状态／操作；浏览器链接为显式操作，不在每次状态转换时自动打开浏览器。分别标注应用注册与文档授权。缺少机器人能力或文档 scope 属于可操作的业务错误，不是存储错误，也不能通过复制凭据解决。

#### 转换与恢复算法

迁移仅读取两种实际旧格式：Channel 的内联飞书配置，以及尚未发布的加密 `external-knowledge.json`。不设置长期格式探测器或版本注册表。在任一消费者能够刷新 token 或接受新绑定前执行转换。

1. 在应用新配置 schema 前，读取原始持久化飞书 Channel 配置和知识库 Connection 引用。其他频道类型和凭据文件不动。保存相关行值供条件提交使用；断开／待授权 Connection 也纳入检查。
2. 用现有 safeStorage 读取器解密被引用的知识库条目。按域和 App ID 归一化应用，只合并相容材料。缺少的可选加密／验证字段可从另一来源补齐；非空秘密互相矛盾时须解决冲突，不能根据时间戳选胜者。空 Channel 配置转为未配置草稿；只填写部分字段的配置保持阻塞，等待修复。
3. 创建或复用应用文件，再写用户授权记录；合法待授权记录写空 token 集。对已有 `feishu:<uuid>` 引用，从 UUID 后缀得到目标授权 ID；校验后使用，已占用 ID 的类型或应用不符则拒绝。意外旧引用进入恢复流程，不直接拼接路径。重试时校验已有目标，不覆盖可能更新的 token。
4. 在同步数据库事务中比较旧 Channel 配置或 Connection 引用，提交新引用。Channel 的内联秘密在同次更新中移除；Connection 身份、scope 投影和 Source 行不变。比较失败不修改现有绑定。确认持久化目标和绑定后，才能移除已转换旧条目。
5. 旧知识库条目仅在转换提交后删除。存在未解决转换时，保留失败条目和旧加密文件；所有条目已处理后再删除文件。未被引用的旧条目提示明确恢复／丢弃，不能导入猜测的账号。绑定迁移后，日常读取只用目标记录，旧读取器只供迁移使用。
6. 重启时以已转换绑定为准。复用中断转换中已校验的应用／授权目标，完成源清理；不能用更旧的加密副本恢复已经提交的授权。本轮之后只清理能够证明无引用的候选；归属不明的材料保留待修复。

| 中断或失败位置 | 必须具备的恢复行为 |
| --- | --- |
| 目标文件提交前 | 旧源和绑定仍可由旧构建使用；新构建提示该绑定待迁移。 |
| 目标已存在，数据库引用未提交 | 重试校验并复用目标，不重复创建应用，不丢失源。 |
| 数据库已提交，旧源未清理 | 从目标继续，再清理对应旧条目；绝不恢复旧 token。 |
| 解密、校验或磁盘失败 | 保留源，只阻止受影响激活和不安全清理，提供重试或显式更换凭据。 |
| 备份恢复到另一配置目录 | 数据库引用可能缺少本地文件；显示凭据不可用并要求重新配置，不删除业务行或本地知识库内容。 |

被阻塞 Channel 的显式替换应先校验并保存替代凭据，再有条件重新绑定，不能先删除旧内联配置。已建立的知识库 Connection 在替换提交前仍须验证同一用户／租户。根据已有恢复决策，原身份不完整仍是错误。转换后不支持自动回退到旧可执行文件，因为旧构建无法解释只含引用的 Channel 配置。恢复使用新构建和保留源数据，不为降级实现双写。

#### 交付单元与完成门槛

| 单元 | 必须一起交付的修改 | 退出条件 |
| --- | --- | --- |
| 0 — Spec | 本中英文计划放在栈底 Spec 层；消费者专属交叉链接保留在其归属层。 | 文档检查；按仓库工作流，实施层之前取得当前提交的 Spec Approval。 |
| 1 — 文件存储 | 存储、schema、路径／生命周期注册、摘要／创建／替换 IPC 和针对性文件／队列测试。业务删除 IPC 与真实消费者绑定测试归属 #20699。切换前现有消费者继续使用原存储。 | AC2／AC7 存储边界通过；可测试迁移 helper，但不激活迁移。 |
| 2 — 飞书切换 | 共享注册会话、两个消费者引用、真实转换、Channel 适配器配置、知识库 token CAS／清理，以及现有表单／智能体命令调用新契约所需的最小修改。只在本单元激活转换。 | AC1／AC3／AC4／AC5 和不返回秘密的 IPC 一起通过；不存在只切换一半的消费者或仍活跃的旧写入者。 |
| 3 — 共享交互与验收 | 应用选择器、共享二维码面板、清楚的注册／授权流程、语言资源、当前参考文档和桌面场景。 | AC6 及累计 AC1–AC7 证据齐全，之后才将记录转为 implemented。 |

不能在单元 1 激活迁移，让旧消费者继续写旧文件／配置。单元 2 必须包含维持现有 UI 和智能体工具可用所需的 API／类型变化；单元 3 完善共享展示，不是修复已经不可用的中间提交。栈顺序为 main → `codex/shared-connector-credentials-spec` → `codex/shared-connector-credential-store` → #20699 → #20742 → #20800 → #20856 → #20903 → #20998。共享存储不依赖消费者表。#20699 负责业务引用查询、删除 IPC、注册和迁移；后续层在各自归属范围内适配消费者。用户已授权本地实施；不宣称已获得 GitHub Spec Approval 或实施 PR 已可正式审查。发布前重新核对远端 base。

#### 验证任务清单

新增回归前，先说明它保护的承诺结果。业务行复用 `setupTestDatabase()`，凭据使用真实临时文件，服务复用统一 mock，原子写入使用已有 `atomicWriteFile`。不模拟 Drizzle 链，也不只断言回调被调用。下列新增测试名是待创建目标，并非已运行测试。

| 测试目标 | 要证明的契约 |
| --- | --- |
| 新增 `src/main/services/credential/__tests__/CredentialStoreService.test.ts` | 无效 payload／ID、权限修正、原子替换失败、一次失败后队列仍可写入、token CAS、删除后不能复活。 |
| 新增 `src/main/ipc/handlers/__tests__/credentialBindings.integration.test.ts` | 并发绑定／删除、授权到应用的引用、删除 Channel 保留知识库、密钥替换隔离两个消费者的旧操作，以及记录不可读时拒绝删除。 |
| 新增 `src/main/services/credential/__tests__/migrateFeishuCredentials.test.ts` | 有数据的生产数据库 fixture 与真实文件；上述全部中断场景、重复／冲突应用、待授权记录、身份保留、重复转换。 |
| 新增 `src/main/services/__tests__/FeishuRegistrationService.test.ts` 及已有 `feishuAppRegistration.test.ts` | 应用选择、必需权限、会话所有者、取消／过期、重复完成、不返回秘密，并保留传输重试行为。 |
| 已有 Channel `ChannelManager.test.ts`、`ChannelRuntime.test.ts`、`channelCommands.test.ts`、`adapters/__tests__/FeishuAdapter.test.ts` | 异步凭据加载不能连接过期适配器；显式注册替换适配器隐式注册；只含引用的配置能正确解析后交给 SDK。 |
| 已有知识库 `ExternalKnowledgeRuntime.test.ts`、`authorizationRecovery.integration.test.ts`、`ExternalKnowledgeDisconnect.test.ts`、`feishuKnowledgeProvider.test.ts` | 替换存储后仍满足刷新／重连／取消／错误竞态和身份连续性；一个消费者的清理不能删除另一个的凭据。 |
| 新增凭据 IPC 测试；已有 `src/main/ipc/handlers/__tests__/channel.test.ts`、DataApi Channel 测试、`src/main/services/__tests__/LegacyBackupManager.test.ts` | 手动输入与脱敏响应、调用者所有权、命令／工具兼容、备份排除及恢复时文件缺失行为。 |
| 已有 `FeishuWikiWizard.test.tsx`、Channel `ChannelDetail.test.tsx`，以及新增选择器／面板测试和聚焦 Electron 场景 | 多应用、空状态、独立授权、错误／重试、隐藏／取消，以及放弃响应不能重新打开浏览器。 |

只在相关修改单元中使用项目 wrapper 和上述显式文件路径运行测试。检查 `pnpm check --plan --base <verified-base>`，运行受影响类型检查项目、范围内格式／lint，以及 `pnpm docs:affected --base <verified-base>`；审阅返回候选，包括知识库 README 和 IPC／数据参考。语言资源变化须运行 `pnpm i18n:sync` 并完成翻译。文档变化运行 `pnpm docs:check`；如有 SQL 变化，再运行迁移链及有数据的向前迁移检查。完整项目测试留给 CI。

桌面验收覆盖：Channel 创建应用后知识库选择复用、反向复用、删除 Channel 后知识库仍可使用、替换／重启，以及注册／授权中的取消。用受控协议响应复现失败场景，再单独记录真实飞书应用的机器人连接和文档授权结果。自动化模拟成功不代表真实提供方验收。凭据 payload 不得进入截图或测试报告。

## 考虑过的替代方案

- `feishu_application` 或按 Connector 分表存储凭据：拒绝；应用凭据属于可复用的 Connector 配置，本期无需独立的关系型应用目录。
- 读取 Channel 配置或将其密钥复制到知识库：拒绝；两者仍将 Channel 作为凭据来源，或留下可能分叉的副本。
- 通用持久化 `revision` 与 `formatVersion`、`schemaVersion`、`encoding`：首个格式不采用；保留实际需要的令牌／引用条件更新，不新增版本协议。
- 将加密作为前置条件或维护两种目标模式：推迟；用户选择本期明文，且知识库实现尚未发布。
- 通用 OAuth Runtime、一次实现全部 Connector 或接入外部 Connector Runtime：不在范围内；共享存储与展示，保留协议和业务所有权。

## 验收标准

- AC1 — Channel 与知识库不读取对方配置即可共用同一飞书应用凭据；App Secret 不重复保存在两者的业务行或用户令牌记录中（verification: main integration；owner: 凭据存储实现者）。
- AC2 — 目标记录为经过校验的明文 JSON，不新增 `feishu_application` 表或预设版本／编码字段；损坏输入和中断写入不能覆盖最后一份有效记录（verification: filesystem tests；owner: 凭据存储实现者）。
- AC3 — 在替换、取消或删除之前开始的刷新／授权响应，不能覆盖或恢复已删除的凭据，也不能使较新会话失效（verification: deferred-request integration tests；owner: 授权实现者）。
- AC4 — 删除 Channel 保留知识库绑定；删除被引用凭据会被拒绝，包含并发新绑定；应用密钥替换能传递到两个消费者，旧结果不能覆盖替换（verification: main integration；owner: 绑定实现者）。
- AC5 — 已发布 Channel 凭据与本地未发布知识库凭据经过迁移／重启后，绑定和身份保留；密钥冲突、解密不可用或写入失败时保留可恢复源数据（verification: production-migration SQLite and real-file fixtures；owner: 迁移实现者）。
- AC6 — 真实桌面以已有应用选择或二维码注册作为主要路径，手动配置为次级入口，单独完成用户授权，隐藏／取消／重试不会恢复已放弃的会话（verification: renderer and Electron；owner: UI 实现者）。
- AC7 — 凭据查询只暴露摘要，日志不含秘密，执行 POSIX 权限限制，普通业务数据导出排除凭据文件（verification: IPC, filesystem, and export tests；owner: 凭据边界实现者）。

## 风险

迁入后的知识库凭据将失去静态加密保护，有足够文件访问权限的进程可以读取明文。用户已接受本阶段存储选择；文件权限和 IPC 脱敏不能替代加密。通用存储不代表各 Connector 协议或凭据 payload 可以互换。

文件和 SQLite 的提交边界独立，迁移、绑定修改和清理需要覆盖中断场景。同一应用的冲突密钥无法仅凭身份解决。转换已有本地知识库测试数据时，操作系统解密可能不可用；应优先保留源数据，而非强行完成迁移。

本记录不宣称实现、真实提供方验收、迁移测试或当前提交的 Spec 审批已经完成。首批飞书范围不迁移无关的模型提供商／MCP 凭据存储。
