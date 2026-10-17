# Accessibility readout

Recaptured 2026-10-13 from the real renderer module `showErrorDetailPopup` on the Vite main window. Earlier readouts that listed only Chinese `报告问题` / `关闭` and omitted AI consultation are superseded.

UI language observed: English.

## Before

Source `243f7bdeaba60f7241bc059e8c2bd5dc3c302096`. Target `http://localhost:5173/windows/main/index.html`.

### before-5xx

Visible error: `AI_APICallError: Service Unavailable`.

Buttons: `Report a problem`, `AI consultation`.

## After

Source `a11793e108484f443af8aa130b4a857499d3b529`. Target `http://localhost:5174/windows/main/index.html`. Each scene reloaded this main window before opening the fixture. The first quota and unknown files from the earlier driver are superseded by these recaptures.

### after-5xx

Visible error: `AI_APICallError: Service Unavailable`.

Direct `Report a problem` count: 0. `AI consultation` count: 1.

### after-5xx-ai-consultation

Dialog name: `AI consultation`. Empty profile shows the model picker (`No usable model is configured yet`). No report submitted.

### after-quota

Visible error: `ProviderError: insufficient_balance`.

Direct `Report a problem` count: 1. `AI consultation` count: 1.

### after-quota-review

Error Detail closed. Dialog title: `Report a problem`. Description includes `insufficient_balance`. Not submitted.

### after-unknown

Visible error: `ProviderError: something unexplained happened`.

Direct `Report a problem` count: 1. `AI consultation` count: 1.

### after-unknown-review

Error Detail closed. Dialog title: `Report a problem`. Description includes `something unexplained happened`. Not submitted.

## Profile note

`CS_DEV_PROFILE_ROOT` kept these launches off the Documents database. The one boot-config mapping added by the earlier suffix-only baseline launch was removed after a local backup. User databases were not modified.
