# Agent Note: Vertex AI 服务商支持使用 Google 登录

Status: proposed

[English](2026-11-09-vertex-google-sign-in.md) | 中文

## Problem

Vertex AI 服务商目前只能通过粘贴服务账号密钥进行认证。组织向员工推广 Cherry 时，必须为每个人生成、发送、跟踪并吊销一个长期有效的密钥（或共用一个密钥）。密钥无法与个人账号的生命周期绑定，员工离职后在有人手动吊销其密钥之前仍可访问。许多组织直接禁止创建服务账号密钥。

Vertex 本身接受个人的 Google OAuth 令牌，因此访问权限可以跟随个人的 Google 账号和 IAM 群组成员身份。Cherry 目前既无法获取或刷新该令牌，也无法让管理员在其不受管理的设备上向员工提供预配置好的 Vertex 设置。

## Proposal

在现有服务账号密钥之外，为 Vertex 增加第二种登录方式：**使用 Google 登录**。

- **设置。** Vertex AI 设置新增 `服务账号密钥 | 使用 Google 登录` 选择器。选择器只切换视图，不保存任何内容。在已存储的服务账号密钥或 Google 客户端之上保存另一种方式的凭据时会先请求确认；在已登录的会话之上保存密钥时，会先退出登录（吊销令牌）再保存密钥。已登录时修改 OAuth 客户端 ID 同样会先请求确认，并在保存前退出登录；空白的客户端 ID 或密钥永远不会被保存。Google 模式需要组织在自己的 Google Cloud 项目中创建的“桌面应用”OAuth 客户端的客户端 ID 和密钥，并复用 `LoginOauthPanel` 提供登录/退出登录及已登录的邮箱。项目和地区在两种方式间共用。
- **流程。** Vertex 通过现有的 [OAuth 运行时](../../../../src/main/services/oauth/runtime/README.md) 登录，作为又一个回环 PKCE 服务商（`providers/vertexGoogle.ts`）：回调地址为 `127.0.0.1:29875`，权限范围为 `openid email https://www.googleapis.com/auth/cloud-platform`，并设置 `access_type=offline` 和 `prompt=consent`。`PkceOAuthClient` 接受可选的 `clientSecret`，因为 Google 桌面客户端在令牌端点要求提供该值。复用现有的 `oauth.*` IPC 路由，不新增任何 IPC 路由。内置的 `vertexai` 服务商已注册，任何使用 `iam-gcp` authConfig 的用户自建服务商都解析到同一定义。
- **运行时扩展点。** 服务商定义新增可选的 `tokenStore` 和可选的 `revokeToken`；其 `clientId` 字段被移除，因为运行时现在会把实际完成交换或刷新的客户端 ID 传给存储（Vertex 从服务商已保存的凭据中读取客户端），`extractAccountId(accessToken)` 新增 `tokenData` 参数（Vertex 从 id_token 读取邮箱，仅用于显示）。服务商定义统一通过 `providerDefinitions.ts` 中的一个解析函数查找，由它负责把用户自建的 `iam-gcp` 服务商映射到 Vertex 定义的规则，因此 `OAuthRuntimeService` 保持与具体服务商无关。退出登录时会尽力用已存储的刷新令牌调用 `revokeToken`：吊销被拒绝或失败只会记录日志，本地会话仍会被清除。
- **存储。** `VertexGoogleOAuthTokenStore` 把会话保存在服务商的 `iam-gcp` authConfig 中：`credentials: { type: 'authorized_user', clientId, clientSecret, refreshToken, accessToken, expiresAt, account }`，通过 `ProviderService.setAuthConfig` 写入。若登录完成时已保存的 OAuth 客户端已被更改，该存储会拒绝这次登录得到的令牌，因此令牌绝不会挂在并非签发它的客户端下。退出登录会保留项目、地区和 OAuth 客户端，服务商保持启用。凭据 schema 与该存储放在一起；渲染进程视图和保留会话的保存逻辑位于 `src/main/data/services/vertexGoogleSession.ts`；只有类型常量、其判断函数和视图类型共享在 `src/shared/utils/vertexGoogleCredentials.ts` 中。无需修改数据库 schema 或迁移：`credentials` 本就是自由格式的记录。
- **保密。** `GET /providers/:id/auth-config` 返回不含任何令牌的白名单视图（客户端 ID 和密钥、账号、`signedIn` 标志）。当保存操作针对同一 OAuth 客户端回传该视图时，`ProviderService.update` 会保留已存储的会话；客户端不同时会丢弃令牌和邮箱，`signedIn` 标志永远不会被存储。
- **请求。** 对话和合作伙伴模型（`buildVertexConfig`）从唯一的刷新方 `OAuthRuntimeService.getValidAccessToken` 获取访问令牌。`@ai-sdk/google-vertex` 的 Node 版本收到的 `googleAuthOptions` 带有一个只提供该令牌的最小 `authClient`，因此 google-auth-library 永远拿不到刷新令牌。模型列表以 `Bearer` 头发送同一令牌。刷新出现终止性失败时会清除会话，设置页显示为未登录；没有令牌时，对话会以“请重新使用 Google 登录”提示失败。服务账号密钥仍使用 edge 版本和 `googleCredentials`。
- **设置链接。** `cherrystudio://providers/vertex-google?data=<base64 JSON {project, location, clientId, clientSecret}>`（任何 `v` 参数都会被忽略）只作用于内置的 `vertexai` 服务商。确认对话框会显示项目、地区和客户端 ID，在链接会替换当前方式时给出警告，并提示仅在链接来自管理员时继续。确认后，若链接会以不同的客户端替换已登录的会话，会先退出登录，再保存 Google 模式并启用该服务商；导航会替换历史记录项，使“返回”无法重新打开携带密钥的链接。链接本身绝不会自动登录。

不在范围内：OpenClaw 的旧 Vertex 路径（继续使用服务账号密钥）、工作负载身份联合，以及任何由 Cherry 托管的 OAuth 客户端。

## Alternatives considered

- **内置 Cherry 自有的 OAuth 客户端 ID。** 所有用户共用一个客户端，意味着由 Cherry 而非组织负责敏感权限范围 `cloud-platform` 的同意屏幕验证，且每个组织的令牌都挂在一个它无法审计、也无法限定到本域的客户端上。已否决；由各组织注册自己的内部客户端。
- **读取应用默认凭据（`gcloud auth application-default login`）。** 需要安装 Google Cloud CLI 并运行终端命令，非技术员工无法完成，而且 ADC 文件与本机所有其他工具共用。
- **带有自己 IPC 路由的专用 Vertex 登录服务。** 它会重复实现 OAuth 运行时的回环流程、窗口限制、取消错误码、让其他窗口接入进行中的登录以及关闭处理。已否决，改用运行时。
- **使用运行时默认的 `oauth` authConfig 存储。** 它会把整个 authConfig 替换为 `type: 'oauth'`，并在退出时重置为 `api-key`，丢失项目、地区和 OAuth 客户端。按定义提供的 `tokenStore` 扩展点则把会话保留在 `iam-gcp` 中。
- **将会话存放在单独的加密文件中。** 服务账号私钥和其他 OAuth 服务商的令牌已经存放在服务商记录中；第二个存储会增加生命周期和迁移成本，却没有更强的保障。改为让令牌不进入渲染进程。
- **保留 edge SDK 并注入 bearer 头。** edge 封装总是先调用自身的 JWT 签名器，没有服务账号凭据时会直接抛错，覆盖请求头无法绕过。

## Acceptance criteria

- AC1 — 在 Google 模式下，用户通过浏览器登录后 Vertex 设置显示已登录的邮箱；退出登录后显示为未登录，并保留项目、地区和 OAuth 客户端 (verification: Electron)
- AC2 — 退出登录会先用已存储的刷新令牌调用服务商的吊销，再清除会话；吊销被拒绝或失败时仍会清除会话 (verification: unit)
- AC3 — 使用 Google 登录且没有服务账号密钥时，助手对话和智能体运行时都能通过 Vertex 服务商得到回复，“同步模型”能列出项目的模型 (verification: Electron)
- AC4 — 读取 auth-config 时，Google 凭据以带 `signedIn` 标志的白名单视图返回，永远不含刷新令牌或访问令牌 (verification: unit)
- AC5 — 保存项目、地区或同一 OAuth 客户端时用户保持登录；修改 OAuth 客户端 ID 会丢弃令牌和已登录的邮箱，且在客户端更改后才完成的登录所得令牌会被拒绝 (verification: unit)
- AC6 — 已登录用户的对话请求传入的 `googleAuthOptions` 中 `authClient` 返回运行时的访问令牌且不含 `googleCredentials`，模型列表以 `Bearer` 头发送该令牌 (verification: unit)
- AC7 — 刷新出现终止性失败的会话会被清除，读取 auth-config 时显示为未登录，对话失败时提示用户重新使用 Google 登录 (verification: unit)
- AC8 — 服务账号配置保持原有行为：JSON 密钥导入会填入私钥、客户端邮箱和项目；对话通过 edge 版本传入 `googleCredentials` 而不含 `googleAuthOptions`；修改地区会保留密钥；模型列表用该密钥为请求签名 (verification: unit)
- AC9 — 切换方式选择器不会保存任何内容；在已存储的密钥或 Google 客户端之上保存另一种方式的凭据会先请求确认；在已登录的会话之上保存密钥会先退出登录再保存；已登录时修改 OAuth 客户端 ID 会先请求确认并在保存前退出登录 (verification: renderer)
- AC10 — 缺少项目、地区、客户端 ID 或客户端密钥中任一字段（或其为空）的 `cherrystudio://providers/vertex-google` 数据会被拒绝，`v` 参数不影响解析 (verification: unit)
- AC11 — 打开设置链接会显示项目、地区和客户端 ID，并在其会替换当前方式时给出警告；仅在确认后更新内置的 `vertexai` 服务商（若以不同的客户端替换已登录的会话，会先退出登录），替换历史记录项，且绝不会发起登录 (verification: renderer)
- AC12 — 所有新增界面文案在每个已发布语言中都有译文，由 `pnpm i18n:check` 检查 (verification: unit)

## Risks

- **权限范围较广。** `cloud-platform` 涵盖该用户在 Google Cloud 中的全部权限。缓解：组织的同意屏幕为内部类型，令牌能做的事仍受该用户 IAM 角色限制；管理员应只授予 `roles/aiplatform.user`。
- **恶意设置链接。** 链接可能把用户指向攻击者的项目，使提示词在那里处理。缓解：确认对话框会显示项目和客户端，并提示仅在链接来自管理员时继续；链接绝不会自动登录。
- **令牌静态存放在服务商记录中。** 刷新令牌和访问令牌存放在服务商的 authConfig 中，与服务账号私钥和其他 OAuth 服务商的令牌相同；配对设备导出本就按设计携带服务商凭据。缓解：令牌永远不进入渲染进程，退出登录会在 Google 端吊销刷新令牌。
- **在 Cherry 之外吊销。** 若刷新令牌在 Google 端被吊销（例如由管理员吊销），缓存的访问令牌在过期前（最长一小时）会一直被 Vertex 拒绝，之后刷新失败才会清除会话，对话才会显示请重新登录的提示。
- **共用的固定回环端口 29875。** 若其他进程占用该端口，登录会受阻直到其退出；两个 Vertex 服务商同时登录时无法都绑定该端口，第二个会失败，直到第一个完成或被取消。
- **在 macOS 上测试设置链接。** macOS 上的开发版本无法接收 `cherrystudio://` 链接，因此操作系统交接环节需要打包版本才能测试。
- **两个 google-auth-library 主版本。** v9（`VertexAiService` 中服务账号的认证头）和 v10（`@ai-sdk/google-vertex` 的 Node 版本）会同时被打包，增加体积，升级时也需要跟踪两个版本。
- **客户端密钥的分发。** Google 将桌面客户端密钥视为非机密；仅凭泄露的密钥，若无本组织域内的用户登录，无法获得任何访问权限。
