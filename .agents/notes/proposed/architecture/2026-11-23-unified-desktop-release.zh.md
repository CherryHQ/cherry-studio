# Agent Note: 桌面端统一发行与区域持久化

Status: proposed

[English](2026-11-23-unified-desktop-release.md) | 中文

## Problem

CN 和国际版安装包使用相同的资料路径，但运行区域由安装包决定。合并安装包需要保留现有登录、本地数据和已安装更新器所依据的信任关系。

## Proposal

统一发行沿用国际版包身份。包身份、更新轨道和镜像选择独立于产品区域。沿用已安装资料目录及其自定义路径映射。

打开产品窗口前，根据可信的已保存 API 来源恢复登录会话。授权、刷新、订阅、通知和区域界面跟随该区域。退出或会话到期后保留该资料的区域。历史兼容构建沿用原包身份，经原服务确认会话后才写入来源。过期或来源不明确的会话需要在原区重新登录。

资料尚无已确认区域时，通过应用代理匿名调用配置服务的 `POST /v1/resolve`，传入 `community_desktop`、平台和版本，启动等待上限为两秒。在现有应用状态表中持久化区域及来源。失败时依次使用中国大陆时区、明确的系统地区、首选系统语言中明确的地区，最后使用 GLOBAL。本地推断标为临时结果。后续首次成功解析在下一次启动生效。新登录由配置服务确认区域，整个授权过程固定在该区域。已经配置的 Provider 和模型在区域决策变化后仍可用。

旧更新路径继续提供兼容目标。Windows 保留现有 NSIS GUID。Linux AppImage 沿用旧清单，DEB / RPM 沿用系统包升级。macOS 先提供保留历史身份的已签名公证 CN 过渡版。过渡版基于固定版本构建 Squirrel.Mac，识别精确的国际版 Bundle ID，保留原团队和受信任标识的原生签名校验。过渡版使用统一稳定轨道，保留用户原有轨道偏好。各升级路径版本单调递增，过渡版只面向旧更新客户端提供。

在常规 Release 流程中按正式版 tag 精确启用 CN macOS 过渡包。自动构建和手动重试读取同一项设置。该 tag 中只有 CN macOS 构建使用带补丁的 Electron 发行包。

## Alternatives considered

旧 macOS 更新源直接跳转到统一 ZIP 会遇到 Bundle ID 查找和旧签名要求两道限制。继续发布双包会保留构建成本和包身份对产品区域的耦合。每次启动解析区域会使资料的运行区域随网络变化。

## Acceptance criteria

- AC1 — CN 和 GLOBAL 会话在正式签名升级后保留原区，即使网络出口相反或配置服务不可用也能在原区刷新会话 (verification: packaged artifact)
- AC2 — 首次解析跨启动保留，离线临时结果能够收敛，已配置 Provider 保持可用 (verification: Electron)
- AC3 — macOS 两种架构完成两次应用内更新并保留数据，同时拒绝错误 Bundle ID、错误签名者、篡改产物和降级 (verification: packaged artifact)
- AC4 — Windows 和 Linux 使用对应旧入口原地升级，当前国际版沿现有入口升级 (verification: packaged artifact)
- AC5 — 六组配置服务注册及签名升级验收通过后，发行源和镜像提供一套公开产物，并保留旧更新入口 (verification: packaged artifact)

## Risks

切流前确认配置服务的六组注册。使用历史正式签名安装包在两种架构上验证过渡构建，并检查原 Keychain 凭据及系统权限。发布运维负责灰度及暂停。已升级客户端通过更高的签名版本修复。
