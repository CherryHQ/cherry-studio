# Agent Note: 让用户自己框选上传的头像

Status: proposed

[English](2026-11-15-avatar-crop.md) | 中文

## 问题

上传的头像图片总是由系统替用户裁剪。`prepareEntityImageBytes`（`src/renderer/utils/image.ts`）取图片正中最大的正方形，缩放成 128×128 的 WebP。智能体和助手头像（`prepareAvatarImage`，由 `AgentAvatarPicker`、`AssistantAvatarPicker`、`DraftAgentAvatarPicker` 调用）以及用户头像（`UserProfileEditor`）都经过它。宽图或长图里人脸常常不在正中，保存的头像就把脸切掉了，用户只能先用别的软件裁好再重新上传。

## 提案

- 为智能体、助手或用户头像选择图片后，先打开裁剪对话框，确认前不保存任何内容。图片位于固定的正方形取景框下（用户头像以圆形显示，取景框也是圆形）。用户拖动图片移动位置，用滑块、鼠标滚轮、触控板双指或方向键缩放。
- 取景框初始为正中最大的正方形、缩放为 1，所以不做任何调整直接确认，保存的头像与现在相同。
- 确认后把框选区域交给 `prepareEntityImageBytes`，由它裁剪该区域而不是正中正方形，输出仍是 128×128 WebP。保存流程的其他部分不变。
- 取消、按 Escape 或关闭对话框都不保存，保留当前头像。
- 对话框基于 `createPopup`（`src/renderer/services/popup`），现有的异步上传处理可以直接 await 它。拖动和缩放使用 `react-easy-crop`（MIT 许可，只有一个小依赖），不自己写指针处理。
- 10 MB 的大小检查仍在打开对话框之前进行。小程序图标和服务商 logo 保留自动裁剪，它们是 logo 而不是头像。

## 备选方案

- 保留自动居中裁剪（否决：用户无法修正偏离中心的人脸）。
- 自己实现拖动和缩放（否决：指针、滚轮、双指和键盘处理正是 `react-easy-crop` 已经提供并测试过的）。
- 在头像弹出层里直接裁剪，而不是用对话框（否决：弹出层太小，不便框选照片，而且点击外部就会关闭）。
- 所有上传图片都裁剪，包括 logo（否决：logo 通常本来就是正方形，多一步只增加麻烦）。

## 验收标准

- AC1 — 为智能体、助手或用户头像选择图片后，打开裁剪对话框，图片位于正方形取景框下（用户头像为圆形），用户确认前不保存任何内容 (verification: renderer; owner: implementer)
- AC2 — 不移动、不缩放直接确认，保存的正方形与自动裁剪的结果相同 (verification: unit; owner: implementer)
- AC3 — 移动或缩放后确认，保存的正是取景框内的区域，并缩放为 128×128 (verification: unit; owner: implementer)
- AC4 — 取消、按 Escape 或关闭对话框都不保存，保留原来的头像 (verification: renderer; owner: implementer)
- AC5 — 对话框的缩放控件可用滑块和键盘操作，且所有语言都有对应文案 (verification: renderer; owner: implementer)
- AC6 — 在应用中，于编辑对话框裁剪的智能体头像，在顶部栏和资料面板中显示为框选的区域 (verification: Electron; owner: implementer)

## 风险

- 动图 GIF 会失去动画，与现在的自动裁剪一样，因为 canvas 只写出一帧。
- `react-easy-crop` 成为渲染进程依赖；它会被打包，渲染进程增加几 KB。
