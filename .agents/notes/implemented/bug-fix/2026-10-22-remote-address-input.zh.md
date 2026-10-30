# Agent Note: 保留输入的远程连接地址

Status: implemented

[English](2026-10-22-remote-address-input.md) | 中文

## 问题

保存 HTTP 或 HTTPS 自定义地址时，原始写法被丢弃。再次打开对话框会显示带有显式端口和路由的 WebSocket URL，用户无法恢复自己输入的地址。

## 决策

在现有公告端点 Preference 中，以可选的 `inputUrl` 保存经过校验并去除首尾空白的输入，与解析后的主机、端口和安全协议一起保存。选择器和对话框使用该输入进行显示；没有此字段的旧设置继续显示端点 URL。

网关仅校验和发布主机、端口及安全协议。邀请匹配只比较这些传输字段，不包含显示元数据。QR v3 和经过认证的端点快照保持不变。

## 考虑过的替代方案

- 将输入存入第二个 Preference：不采用，因为分别保存可能导致显示地址与端点不一致。
- 在共享通信协议中加入 HTTP/HTTPS 或显示元数据：保留桌面端输入不需要这样做，而且会要求移动端再次更新协议。

## 后果

现有设置无需迁移。新保存的设置在去除首尾空白后，保留协议、主机名写法、显式端口及允许的路径写法。校验、监听配置和配对授权保持不变。清除覆盖地址时，输入和端点一起删除。

## 验证

- Regression — `DeviceConnectionsSettings.test.tsx`：HTTP/HTTPS 输入保存后重新打开保持不变，选择器显示原输入，二维码端点保持兼容，清空恢复自动地址，旧设置仍可打开。
- Regression — `ApiGatewayService.test.ts`：邀请端点不包含 `inputUrl`，同时仍拒绝无效的已存储目标地址。
- Regression — 真实 Electron：HTTP 和 HTTPS 输入在保存并重新打开后保持不变；HTTP 选择在重新加载渲染页面后也保持不变。
