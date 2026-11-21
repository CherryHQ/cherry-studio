# Agent Note: 通过 Cherry Cloud 接入 AMD 免费模型

Status: proposed

[English](2026-11-10-amd-free-models.md) | 中文

## 问题

Cherry Studio 与 AMD AI 开发者计划约定，为国内版用户免费提供 AMD 托管的模型。AMD 要求每个用户拥有自己的 AMD 开发者账号；用量按该账号自己的 Token Factory API Key 计量，AMD 通过 `register_source=cherry-studio` 识别 Cherry 来源的账号。

AMD 合作方注册接口（ADP v0.1，2026-10-27）只接受携带 AMD 分配的 `client_id`、用合作方 RSA 私钥签名（SHA256withRSA）、且从已登记出口 IP 发出的请求，因此无法由桌面客户端或浏览器直接调用。AMD 的负载接口（`GET /v1/models/utilization`）和用量接口同样需要用户自己的 Key。

目前这些环节都没有打通：桌面端只能通过用户手填 Key 的 `radeon-cloud` provider 访问 AMD；Cherry Cloud 网关每个上游供应商只有一把全局 Key；也没有合作方注册流程。2026-11-10 已与产品负责人评审过本地原型（三步注册网页、模型状态页、选择器中带「AMD 授权」锁标签的分组），本 Spec 以其确定的用户界面为目标。

## 方案

本功能包含三个交付物，各自只有一个状态所有者。

### Cherry Cloud API（`cherry-studio-cloud-api`，仅国内区域）

- **AMD 合作方客户端。** 新增一个小包，为每个合作方请求加上 `X-ADP-Client-Id`、`X-Timestamp`、`X-Nonce` 和 `X-Signature`，签名原文为 `X-App-Id={client_id}&X-Timestamp={ts}&X-Nonce={nonce}&Body={raw_body}`，复用 `internal/alipay/sign.go` 的 RSA 私钥解析。提供表单、公司查询、发送验证码、注册四个调用，以及用用户 Key 发起的用量和负载查询。配置使用 `CLOUD_API_AMD_*` 变量，通过现有 Secret/SealedSecret 机制下发；任一值缺失时功能关闭。外呼使用本区域的依赖超时，结果未知的注册请求绝不自动重发。
- **注册状态。** 新增仅国内的表，按 Cherry 账号记录 AMD `user_id`、以账号绑定关联数据加密封存的 AMD API Key、`register_source`、状态，以及进行中的尝试（幂等键、请求哈希、`possibly_sent`），沿用 `alipay_customer` 的模式。原始 Key 不出现在日志、响应或埋点中。
- **网页接口**（网页会话加 CSRF，规则与 `/api/v1/web-account` 一致）：注册表单（预填的已验证手机号临时从 ZITADEL 获取、不落库）、公司查询、发送验证码、提交注册、注册状态、模型负载。AMD 的响应信封（`code`、`field_errors`、`retry_after`）原样透传，便于网页把错误放到对应字段。
- **模型目录。** AMD 模型不是套餐。服务端把 `CLOUD_API_AMD_MODELS` 配置的模型（ID 以 `amd/` 开头，只支持 `openai-chat-completions`）列入 `/v1/models`，标记 `provider: "amd"`、`requires_login: true` 和 `activation_endpoint`，账号没有可用的 AMD Key 时再标记 `activation_required`。`/v1/models` 也支持未登录查询：只带登录前客户端 HMAC（与登录请求相同的 `X-Client-ID`/`X-Timestamp`/`X-Signature`，按 IP 限流）的请求也会列出全部已上架模型，包括需要开通的 AMD 模型，供未登录的客户端展示。列出不代表有调用权限；每次调用时仍校验登录、套餐权益和 AMD 开通状态。客户端用 `catalog=full` 请求完整目录；不带该参数时，服务端为旧版客户端保留原来只列已授权模型的行为。AMD 请求不做 Cherry 额度预留、扣减或结算。
- **网关。** `amd/` 模型的请求用调用者加密保存的 AMD Key 转发到当前环境的 AMD 模型网关，不使用供应商 Key 或其他账号的 Key，也不回退到付费模型。没有绑定或绑定已作废时返回 `403 AMD_ACTIVATION_REQUIRED`；AMD 拒绝 Key 时返回 `403 AMD_CREDENTIAL_INVALID`，这不是登出信号；AMD 自身的 `429` 返回 `RATE_LIMITED` 并保留 `Retry-After`。
- **桌面到网页的交接。** 对模型的 `activation_endpoint`（目前是 `/api/v1/amd/desktop/entry`）发起 `POST`（Product Session Bearer、对空请求体的 v2 设备签名、每次新的请求 ID）返回 `{ entry_url, expires_in }`：形如 `https://<cloud-api-origin>/amd/enter#<凭证>` 的链接，60 秒内有效且只能兑换一次。浏览器兑换后设置网页会话 Cookie 并跳转；网页随后要求与客户端相同的 Cherry 账号。这样无需 CORS 或共享 cookie 即可证明访问由客户端发起。

### 注册网页（新建独立前端项目）

- 两个页面。**开通页**：标题、一句说明、模型标签、三步表单（基本信息 → 开发者资料 → 验证手机号）和一行提示；必填项标 `*`；必填项为空时只禁用步骤按钮，只有填错才显示错误。**模型状态页**：来自 AMD 负载接口的各模型负载（`idle`/`busy`/`full`/`unknown`、百分比、每 10 秒刷新），仅对已注册用户显示。
- 网页只调用上述 Cherry Cloud 网页接口，从不持有 AMD 凭证。
- 本工作区 `.context/amd-register-web/` 下的本地原型是视觉参考；项目本身、托管域名和部署作为本工作的一部分新建。

### 桌面客户端（`cherry-studio`）

- CherryAI 选择器分组向所有用户展示服务端目录，客户端自己不保存模型列表。每个锁定行写明解锁方式：
  - **免费模型**：未登录时，`/api/v1/public/plans` 中免费套餐的模型，以及 `requires_login: true` 的独立模型，显示为锁定行。点击后先登录 Cherry AI，再选中该模型，接着完成用户刚才的操作。
  - **订阅模型**：与现在一样展示付费套餐预览；点击后开始订阅。
  - **AMD 模型**：未登录时取客户端 HMAC 签名的 `/v1/models` 中的 AMD 条目，登录后取其中 `activation_required` 的条目，显示为「AMD 授权」锁定行，hover 说明需要 AMD 授权。点击时如未登录先登录，再由主进程向已签名目录中该模型的 `activation_endpoint` 申请入口链接，并原样在系统浏览器中打开；如果账号其实已经授权，则不打开任何页面。客户端不自行拼接页面地址，也不记录、上报或保存该链接。
- 未登录时，模型同步用客户端 HMAC 读取 `/v1/models`。`requires_login: false` 的独立模型直接可用，其请求用对完整请求体的客户端 HMAC 签名，不带会话。登录后，所有独立模型无需套餐即可使用。
- 已授权的 AMD 模型与已授权的套餐模型一样同步进 CherryAI 提供方，标记免费且不占额度。未授权的 AMD 模型不写入模型表。
- 对话请求被 `AMD_ACTIVATION_REQUIRED` 或 `AMD_CREDENTIAL_INVALID` 拒绝时，模型快照失效，下次同步把该模型显示为锁定；输入框随后显示「AMD 授权」而不是发送。Cherry 登录保持不变。
- 登录后，AMD 锁定行和输入框提示读取 `GET /api/v1/amd/desktop/status`，按 `action` 显示下一步：注册、关联已有账号、重新验证（`credential_invalid`）、继续开通、开通中或联系客服。状态未知或未登录时显示「AMD 授权」。注册关闭时服务端返回关联，因此客户端此时不会提供新注册。
- 已选中但服务端不再列出的 Cloud 模型会被拦截，提示「该模型已下架，请切换模型」，只提供切换模型，因为登录或订阅都无法恢复它。目录读取失败时不算下架。
- 内置 Qwen 模型需要登录 Cherry AI 账号：未登录时主进程拒绝其请求，输入框显示现有的登录提示。服务端免费套餐提供等价模型后再下线 Qwen。
- 用户通过 `cherrystudio://navigate/settings/provider` 回跳或手动切回应用后，窗口聚焦会重新读取 AMD 状态并同步套餐和模型；以 `activated: true` 和目录中解锁的条目确认开通。不新增轮询。
- 是否提供 AMD 由服务端决定：海外区域不返回 AMD 模型。隐藏订阅推荐的选择器不显示任何锁定行。

### 范围限制

- 全球版：在 AMD 完成合规评估前不做。
- 关联已有 AMD 账号在网页上完成，客户端只负责打开入口。
- 应用内显示负载：不做；负载只在网页状态页展示。

## 备选方案

- **应用内注册对话框。** 已实现并评审，2026-11-10 被产品负责人否决：注册必须在网页上完成，而且对话框会在客户端里重复一套表单和条款界面。
- **客户端直接用用户 Key 调 AMD。** 否决：AMD 要求注册由合作方签名、且来自白名单 IP；Key 留在服务端还能保住 Cherry 的请求统计、风控和吊销能力。
- **所有用户共用一把 AMD 合作方 Key。** 否决：AMD 按用户 Key 计量和发放额度，并靠 Key 识别 Cherry 来源用户，共用 Key 会两者都丢掉。
- **把网页放进 API 域名下的 `web-account`。** 认证更简单，但负责人选择独立项目；入口链接让这一选择不依赖域名。
- **注册成功后授予合作方套餐。** 已被取代：AMD 模型需要调用者自己的 Key，而不是额度池，因此服务端改为从 `CLOUD_API_AMD_MODELS` 列出模型并标记 `activation_required`，不再授予套餐。
- **客户端写死的 AMD 占位模型列表。** 已移除：它会和网关实际能提供的模型脱节；改用服务端目录后，AMD 模型变化无需发布客户端。

## 验收标准

- AC1 — Cloud API 的 AMD 客户端对 AMD 文档示例生成完全一致的签名，并在发送前拒绝未签名、已过期或配置不全的调用。（verification: unit；owner: Cloud API）
- AC2 — 在模拟 AMD 服务下，表单、公司查询、发送验证码和注册原样透传 AMD 的响应信封和字段错误；同一请求体重复注册复用幂等键，请求体变化时换新键，结果未知的尝试不会被自动重发。（verification: integration；owner: Cloud API）
- AC3 — 注册或关联成功后封存 AMD Key；随后该账号的 `/v1/models` 以 `activation_required: false` 列出 AMD 模型，客户端 HMAC 签名的 `/v1/models` 以需要开通的状态列出这些模型，且任何响应和日志都不含原始 Key 或完整手机号。（verification: integration；owner: Cloud API）
- AC4 — AMD 模型的对话请求使用调用者自己的 AMD Key 转发；没有可用绑定的调用者收到 `403 AMD_ACTIVATION_REQUIRED`，Key 被拒绝时收到 `403 AMD_CREDENTIAL_INVALID`，AMD `429` 以 `RATE_LIMITED` 返回。（verification: integration；owner: Cloud API）
- AC5 — 模型负载接口为已注册账号返回 AMD 各模型的负载，保留 `unknown`，并拒绝未注册账号。（verification: unit 和 integration；owner: Cloud API）
- AC6 — 模型的 `activation_endpoint`（`/api/v1/amd/desktop/entry`）返回的入口链接以同一 Cherry 账号打开网页，用一次或 60 秒后失效，无法重放；桌面端以签名的空请求体 POST 申请，原样打开返回的地址，并拒绝 Cloud API 域名之外的地址。（verification: integration 和主进程测试；owner: Cloud API 和 desktop）
- AC7 — 网页对接 Cloud API 接口完成三步注册并显示状态页，把透传的字段错误放到对应步骤，且不对未触碰的空字段显示必填错误。（verification: web 单元测试和测试部署上的人工验证；owner: web 项目）
- AC8 — CherryAI 选择器分组展示服务端目录：未登录时，免费、独立、订阅和 AMD 行各自以对应的解锁方式（登录后选中、订阅、AMD 授权）锁定，游客可用的独立模型以客户端 HMAC 调用；登录后 AMD 行按状态的 `action` 显示；登录后，未授权的 AMD 模型显示为「AMD 授权」锁定行，授权并聚焦刷新后显示为可选的免费模型；客户端不保存模型列表，不显示订阅推荐的选择器中没有锁定行。AMD 拒绝请求时模型被锁定但不登出，输入框提供 AMD 授权。未登录时 Qwen 无法发送，输入框提示登录。（verification: renderer 和主进程测试、Electron；owner: desktop）
- AC9 — 任一 `CLOUD_API_AMD_*` 配置缺失，或在全球区域时，AMD 路由、目录条目和网关分支均不生效，现有行为不变。（verification: unit 配置测试；owner: Cloud API）

## 风险

- **AMD 待交付的改动。** v0.1 注册接口仍要求密码、也不返回 API Key；AMD 已承诺把密码改为选填、返回 `APIKey`，并新增已有账号的「登录并获取 Key」接口。这些上线前，AC3 和 AC4 无法对真实 AMD 通过；模拟服务按已承诺的合同实现。
- **凭证和网络。** `client_id`、私钥和出口 IP 登记都还没下发，测试环境同样需要。真实联调需等待。
- **文案和条款。** `terms_version` 仍是「待业务确认」；权益文案（新用户额度、专属资源、首批模型）发布前须与 AMD 确认。
- **手机号来源。** 预填依赖 ZITADEL 中有已验证的手机号；没有的账号需自行输入，并接收 AMD 自己的短信验证码。
- **Key 被吊销。** 用户若在 AMD 控制台重置 Key，下一次请求返回 `AMD_CREDENTIAL_INVALID`；模型重新锁定，用户通过同一入口重新授权。
- **跨仓库交付。** 三个交付物分别上线。服务端列出 AMD 模型时桌面端才显示 AMD 行；未登录用户要等服务端部署公开的 `/v1/models` 才能看到；通用选择器只在模型的 `available_features` 同时包含 `chat` 和 `translate` 时提供它们。
