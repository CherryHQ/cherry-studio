# Agent Note: Vertex AI 提供商支持使用 Google 登录

Status: proposed

[English](2026-11-09-vertex-google-sign-in.md) | 中文

## Problem

Vertex AI 提供商目前只能通过粘贴服务账号密钥进行认证。组织向员工推广 Cherry 时，必须为每个人生成、发送、跟踪并吊销一个长期有效的密钥（或共用一个密钥）。密钥无法与个人账号的生命周期绑定，员工离职后在有人手动吊销其密钥之前仍可访问。许多组织直接禁止创建服务账号密钥。

Vertex 本身接受个人的 Google OAuth 令牌，因此访问权限可以跟随个人的 Google 账号和 IAM 群组成员身份。Cherry 目前既无法获取或刷新该令牌，也无法让管理员在其不受管理的设备上向员工提供预配置好的 Vertex 设置。

## Proposal

在现有服务账号密钥之外，为 Vertex 增加第二种登录方式：**使用 Google 登录**。

- **设置。** Vertex AI 设置新增 `服务账号密钥 | 使用 Google 登录` 选择器。Google 模式需要组织在自己的 Google Cloud 项目中创建的“桌面应用”OAuth 客户端的客户端 ID 和密钥，并显示登录/退出登录及已登录的邮箱。项目和区域在两种模式间共用。
- **流程。** 主进程通过现有的 `PkceOAuthClient` 和 `LoopbackCallbackTransport`（固定的 `127.0.0.1` 端口；桌面客户端接受任意回环端口）执行授权码 + PKCE 流程，scope 为 `openid email cloud-platform`，并设置 `access_type=offline`。`PkceOAuthClient` 新增可选的 `clientSecret`，因为 Google 桌面客户端在令牌端点要求提供该值。
- **存储。** 刷新令牌存放在现有 `iam-gcp` authConfig 中：`credentials: { type: 'authorized_user', clientId, clientSecret, refreshToken, account }`。不使用 `OAuthRuntimeService`，因为它的令牌存储会把整个 authConfig 替换为 `oauth`，从而丢失项目和区域。无需修改 schema 或迁移：`credentials` 本就是自由格式的记录。
- **保密。** `GET /providers/:id/auth-config` 会去掉刷新令牌并返回 `signedIn: true`；`PATCH /providers/:id` 在传入配置仍使用同一 OAuth 客户端时恢复已存储的令牌，因此修改项目或区域不会导致退出登录。
- **请求。** 对话（`buildVertexConfig`）、合作伙伴模型（MaaS）和模型列表以 `googleAuthOptions` 传入 `authorized_user` 凭据。这需要 `@ai-sdk/google-vertex` 的 Node 版本（由 google-auth-library 刷新令牌）；服务账号密钥仍使用 edge 版本，行为不变。
- **设置链接。** `cherrystudio://providers/vertex-google?v=1&data=<base64 JSON {project, location, clientId, clientSecret}>` 会打开 Vertex 设置，并在用户确认显示项目、区域和客户端 ID 的对话框后填入 Google 模式。链接本身绝不会自动登录。管理员可借此向不受管理设备上的员工发送一个链接完成配置。

不在范围内：OpenClaw 的旧 Vertex 路径（继续使用服务账号密钥）、工作负载身份联合，以及任何由 Cherry 托管的 OAuth 客户端。

## Alternatives considered

- **内置 Cherry 自有的 OAuth 客户端 ID。** 所有用户共用一个客户端，意味着由 Cherry 而非组织负责敏感 scope `cloud-platform` 的同意屏幕验证，且每个组织的令牌都挂在一个它无法审计、也无法限定到本域的客户端上。已否决；由各组织注册自己的内部客户端。
- **读取应用默认凭据（`gcloud auth application-default login`）。** 需要安装 Google Cloud CLI 并运行终端命令，非技术员工无法完成，而且 ADC 文件与本机所有其他工具共用。
- **经由 `OAuthRuntimeService`。** 其按提供商划分的令牌存储会以 `type: 'oauth'` 覆盖 authConfig，并在退出时重置为 `api-key`，丢失 Vertex 的项目和区域。将该存储通用化是其 README 中延后的“通用 OAuth”方案，仅为一个提供商不值得。
- **将刷新令牌存放在单独的加密文件中。** 服务账号私钥已经存放在同一 authConfig 中；第二个存储会增加生命周期和迁移成本，却没有更强的保障。改为让令牌不进入渲染进程。
- **保留 edge SDK 并注入 bearer 头。** edge 封装总是先调用自身的 JWT 签名器，没有服务账号凭据时会直接抛错，覆盖请求头无法绕过。

## Acceptance criteria

- AC1 — 在 Google 模式下，用户通过浏览器登录后 Vertex 设置显示“已登录为 <邮箱>”；退出登录会在 Google 端吊销令牌并在本地清除，同时保留客户端 ID 和密钥 (verification: Electron)
- AC2 — 使用 Google 登录且没有服务账号密钥时，助手对话和智能体运行时都能通过 Vertex 提供商得到回复，“同步模型”能列出项目的模型 (verification: Electron)
- AC3 — 渲染进程永远收不到刷新令牌，保存其他 Vertex 设置不会导致退出登录，除非 OAuth 客户端 ID 改变 (verification: unit)
- AC4 — 已登录用户的对话请求携带含 `authorized_user` 凭据的 `googleAuthOptions` 且不含 `googleCredentials`；已配置但未登录的提供商会以“使用 Google 登录”提示失败 (verification: unit)
- AC5 — 现有服务账号配置的行为与之前完全一致，包括 JSON 导入、修改区域和模型列表 (verification: unit)
- AC6 — 打开 `cherrystudio://providers/vertex-google` 链接会显示项目、区域和客户端 ID 供确认，仅在确认后填入 Google 模式，并拒绝缺少任一字段的数据 (verification: unit)
- AC7 — 所有新增界面文案在每个已发布语言中都存在 (verification: docs gate)

## Risks

- **权限范围较广。** `cloud-platform` 涵盖该用户在 Google Cloud 中的全部权限。缓解：组织的同意屏幕为内部类型，令牌能做的事仍受该用户 IAM 角色限制；文档建议只授予 `roles/aiplatform.user`。
- **恶意设置链接。** 链接可能把用户指向攻击者的项目，使提示词在那里处理。缓解：确认对话框会显示项目和客户端，并提示仅在链接来自管理员时继续；链接绝不会自动登录。
- **固定回环端口 29875。** 若其他进程占用该端口，登录会受阻直到其退出；错误信息会说明原因。
- **客户端密钥的分发。** Google 将桌面客户端密钥视为非机密；仅凭泄露的密钥，若无本组织域内的用户登录，无法获得任何访问权限。
