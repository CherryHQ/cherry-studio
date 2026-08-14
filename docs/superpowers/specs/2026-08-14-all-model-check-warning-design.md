# All-model check warning design

## Goal

Make the warning shown in the **All models** form communicate the financial risk of sending many real, concurrent requests more strongly, while preserving the explanation of which costly generation and speech models are skipped.

## Approved copy

Chinese:

> 检测所有模型会向选中的模型和 API 密钥发送大量真实请求，可能在短时间内产生高额费用，请确认费用风险后再开始。图片、视频、音频生成及语音识别、语音合成模型会跳过。

Other locales should preserve the same meaning: all-model checks can send many real requests, concurrent execution may create high charges in a short time, users should confirm the cost risk before starting, and generation and speech models are skipped.

## Scope

- Apply the stronger warning only to the **All models** form.
- Keep the single-model warning and all detection behavior unchanged.
- Keep the existing warning alert style and placement unchanged.
- Update the affected locale resources through the existing i18n workflow.

## Verification

- A focused dialog test asserts that the single-model and all-model forms use their respective warning keys.
- The renderer i18n check passes.
- Runtime inspection confirms the stronger copy appears only after switching to **All models**.
