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
- **权益。** 新建一个非默认的免费套餐「AMD 免费模型」，以 `openai-chat-completions` 规则列出 AMD 模型，配一个按请求计量的额度池。注册成功后以新的权益来源 `partner` 为账号授予该套餐。`/v1/models`、`/api/v1/account` 和桌面同步因此自动包含这些模型，客户端无需写死列表。该套餐标记 `partner: "amd"`，并在 `available_plans` 中保留模型预览，供未注册的客户端显示锁定行。
- **网关。** 绑定到 AMD 合作方供应商的模型仍从现有路由取上游地址，但 API Key 取自调用者的注册记录，而不是供应商密钥。缺少或被吊销的用户 Key 返回专门的、不可重试的错误码，而不是 `UPSTREAM_UNAVAILABLE`。AMD 自身的额度限制（`429`）按限流错误透传；除请求计数外，Cherry 不对这些请求计量或计费。
- **桌面到网页的交接。** `POST /api/v1/amd/desktop/entry`（Product Session Bearer、对空请求体的 v2 设备签名、每次新的请求 ID）返回 `{ entry_url, expires_in }`：形如 `https://<cloud-api-origin>/amd/enter#<凭证>` 的链接，60 秒内有效且只能兑换一次。浏览器兑换后设置网页会话 Cookie 并跳转；网页随后要求与客户端相同的 Cherry 账号。这样无需 CORS 或共享 cookie 即可证明访问由客户端发起。

### 注册网页（新建独立前端项目）

- 两个页面。**开通页**：标题、一句说明、模型标签、三步表单（基本信息 → 开发者资料 → 验证手机号）和一行提示；必填项标 `*`；必填项为空时只禁用步骤按钮，只有填错才显示错误。**模型状态页**：来自 AMD 负载接口的各模型负载（`idle`/`busy`/`full`/`unknown`、百分比、每 10 秒刷新），仅对已注册用户显示。
- 网页只调用上述 Cherry Cloud 网页接口，从不持有 AMD 凭证。
- 本工作区 `.context/amd-register-web/` 下的本地原型是视觉参考；项目本身、托管域名和部署作为本工作的一部分新建。

### 桌面客户端（`cherry-studio`）

- AMD 模型列在 CherryAI 选择器分组内，与内置 Qwen 模型放在一起，不另设分组。
- 未注册的国内版用户看到来自套餐预览的 AMD 模型，以带「AMD 授权」标签的锁定行显示；hover 提示需要登录 AMD 授权。点击时如未登录先登录 Cherry AI，再由主进程申请入口链接并原样在系统浏览器中打开；客户端不自行拼接页面地址，也不记录、上报或保存该链接。已注册用户在同一分组中看到可选的已授权模型。原型中写死的占位模型列表被移除。
- 与 AMD 模型一样，内置 Qwen 模型需要登录 Cherry AI 账号：未登录时主进程拒绝其请求，输入框显示现有的登录提示。
- 用户回到应用后，现有的窗口聚焦刷新会重新同步套餐和模型，不新增轮询。
- 非国内版、以及隐藏订阅推荐的选择器中，不显示 AMD 行、标签和入口。

### 范围限制

- 全球版：在 AMD 完成合规评估前不做。
- 关联已有 AMD 账号：在 AMD 上线「登录并获取 Key」接口前不做；网页如实提示 `ACCOUNT_EXISTS`。
- 应用内显示负载：不做；负载只在网页状态页展示。

## 备选方案

- **应用内注册对话框。** 已实现并评审，2026-11-10 被产品负责人否决：注册必须在网页上完成，而且对话框会在客户端里重复一套表单和条款界面。
- **客户端直接用用户 Key 调 AMD。** 否决：AMD 要求注册由合作方签名、且来自白名单 IP；Key 留在服务端还能保住 Cherry 的请求统计、风控和吊销能力。
- **所有用户共用一把 AMD 合作方 Key。** 否决：AMD 按用户 Key 计量和发放额度，并靠 Key 识别 Cherry 来源用户，共用 Key 会两者都丢掉。
- **把网页放进 API 域名下的 `web-account`。** 认证更简单，但负责人选择独立项目；入口链接让这一选择不依赖域名。
- **用账号标志位代替套餐权益。** 否决：现有的套餐 / 权益 / 目录链路已经驱动 `/v1/models` 和桌面同步；标志位需要另起一条目录分支。

## 验收标准

- AC1 — Cloud API 的 AMD 客户端对 AMD 文档示例生成完全一致的签名，并在发送前拒绝未签名、已过期或配置不全的调用。（verification: unit；owner: Cloud API）
- AC2 — 在模拟 AMD 服务下，表单、公司查询、发送验证码和注册原样透传 AMD 的响应信封和字段错误；同一请求体重复注册复用幂等键，请求体变化时换新键，结果未知的尝试不会被自动重发。（verification: integration；owner: Cloud API）
- AC3 — 注册成功后封存 AMD Key，并以 `partner` 来源授予 AMD 套餐；随后该账号的 `/v1/models` 和 `/api/v1/account/plans` 包含 AMD 模型，且任何响应和日志都不含原始 Key 或完整手机号。（verification: integration；owner: Cloud API）
- AC4 — AMD 模型的对话请求使用调用者自己的 AMD Key 转发；未注册或 Key 已吊销的调用者收到专门的不可重试错误，AMD `429` 以限流错误返回。（verification: integration；owner: Cloud API）
- AC5 — 模型负载接口为已注册账号返回 AMD 各模型的负载，保留 `unknown`，并拒绝未注册账号。（verification: unit 和 integration；owner: Cloud API）
- AC6 — `/api/v1/amd/desktop/entry` 返回的入口链接以同一 Cherry 账号打开网页，用一次或 60 秒后失效，无法重放；桌面端以签名的空请求体 POST 申请，原样打开返回的地址，并拒绝 Cloud API 域名之外的地址。（verification: integration 和主进程测试；owner: Cloud API 和 desktop）
- AC7 — 网页对接 Cloud API 接口完成三步注册并显示状态页，把透传的字段错误放到对应步骤，且不对未触碰的空字段显示必填错误。（verification: web 单元测试和测试部署上的人工验证；owner: web 项目）
- AC8 — 国内版 CherryAI 选择器分组列出 AMD 模型：未注册用户看到带 hover 提示的「AMD 授权」锁定行，注册并聚焦刷新后看到可选的已授权模型；非国内版和不显示订阅推荐的选择器中没有这些行。未登录时 Qwen 无法发送，输入框提示登录。（verification: renderer 和主进程测试、Electron；owner: desktop）
- AC9 — 任一 `CLOUD_API_AMD_*` 配置缺失，或在全球区域时，AMD 路由、套餐授予和网关分支均不生效，现有行为不变。（verification: unit 配置测试；owner: Cloud API）

## 风险

- **AMD 待交付的改动。** v0.1 注册接口仍要求密码、也不返回 API Key；AMD 已承诺把密码改为选填、返回 `APIKey`，并新增已有账号的「登录并获取 Key」接口。这些上线前，AC3 和 AC4 无法对真实 AMD 通过；模拟服务按已承诺的合同实现。
- **凭证和网络。** `client_id`、私钥和出口 IP 登记都还没下发，测试环境同样需要。真实联调需等待。
- **文案和条款。** `terms_version` 仍是「待业务确认」；权益文案（新用户额度、专属资源、首批模型）发布前须与 AMD 确认。
- **手机号来源。** 预填依赖 ZITADEL 中有已验证的手机号；没有的账号需自行输入，并接收 AMD 自己的短信验证码。
- **Key 被吊销。** 用户若在 AMD 控制台重置 Key，在提供重新关联路径前请求会失败；专门的错误码让这种情况可见，而不是看起来像服务故障。
- **跨仓库交付。** 三个交付物分别上线。桌面端的行没有客户端开关：Cloud API 功能启用之前，点击会提示无法打开 AMD 页面。
