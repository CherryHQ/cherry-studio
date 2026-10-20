# Agent Note: 恢复中断的飞书授权

Status: implemented

[English](2026-10-20-feishu-authorization-recovery.md) | 中文

## 问题

飞书首次授权可能在凭据或身份持久化之前，已将待授权 Connection 写入 SQLite。启动时会将该行保留并标记为需要重新授权，但重连此前要求存在稳定用户 ID，导致无法恢复。另外，知识库传输层的响应体读取失败绕过了重试分类；注册接口的响应体超时被归为无效响应，导致轮询终止。

## 决策

重连仅在所有持久化的身份和显示字段、授权时间、校验时间均为 null，且授权范围为空时允许首次绑定身份。任何已有授权证据都会保留原有账户校验。恢复仍使用替换凭据引用、代次校验和预期引用的比较交换，不会转为新的首次授权会话。

两个飞书传输层都在传输错误边界内读取响应体，然后再解析 JSON。知识库响应体读取失败仍归为瞬态错误，使用现有的有界重试。注册请求超时在注册截止时间内重试；其他网络失败保留现有的请求失败行为。调用方取消与 JSON/schema 错误保持区分，不暴露原始传输错误详情。

HTTP 200 响应携带飞书错误码 `20005` 时，走与 HTTP 401 相同的终止错误路径，使授权失效。传输成功不代表令牌仍然可用。

## 考虑过的替代方案

删除并重建 Connection 会丢弃可恢复的无身份状态。只要用户 ID 缺失就跳过账户校验，可能替换已建立的账户。将所有响应错误都设为可重试，会混淆提供商数据格式错误与传输失败，并扩大现有注册重试策略。

## 后果

恢复无需数据库迁移。身份字段部分存在仍视为错误，不能作为 Connection 尚未使用的证据。CI 成功不代表已通过真实飞书或操作系统密钥环验收。

## 验证

- Regression — `ExternalKnowledgeRuntime.test.ts`：真实 SQLite 的启动协调和替换重连保留 Connection ID，持久化首次身份和凭据；真实 SDK 的响应体读取失败可重试并成功完成首次授权。
- Regression — `ExternalKnowledgeRuntime.test.ts`：任一残留授权标记都阻止无身份恢复；已有的账户不匹配、过期引用、取消及代次测试继续覆盖保护行为。
- Regression — `feishuKnowledgeProvider.test.ts` 和 `feishuAppRegistration.test.ts`：响应体失败、超时、取消、注册截止时间及无效响应均保持各自的结果分类。

- Regression — `ExternalKnowledgeRuntime.test.ts`：真实 SDK 传输收到 `20005` 后，真实 SQLite 中的 Connection 变为需要重新授权，并拒绝后续令牌获取。
