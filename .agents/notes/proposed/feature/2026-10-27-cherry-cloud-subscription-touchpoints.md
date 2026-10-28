# Agent Note: Cherry Cloud subscription touchpoints

Status: proposed

English | [中文](2026-10-27-cherry-cloud-subscription-touchpoints.zh.md)

## Problem

Cherry Cloud subscriptions (Flash in the global edition) are reachable only from one account-panel row and the profile page, and both are hidden in the China edition, so its Plus plan cannot be sold. Users who would subscribe never meet the offer where they need it: the model selector only lists models they already own, quota exhaustion appears only as a selector description, and a completed web checkout is invisible in the client until some later refresh.

## Proposal

- **One flow for both editions.** Subscription surfaces, touchpoints, and interactions are identical in the China and global editions. Plans, models, plan names, and quotas come from the Cherry Cloud backend (`display_name` renders as Plus or Flash); the client never hardcodes a plan name or price. The account portal is `/account/plans` on the same origin as the Cherry Cloud API in every environment, so the edition's production origin selects the China or global portal and a configured development origin selects its own portal.
- **The web owns sign-in and checkout.** Sign-in, sign-up, account choice, plan details, and payment are web pages built outside this repository. The client opens them and handles the return. No in-client paywall, success dialog, price, renewal date, or introductory offer is shown.
- **Settings and account panel.** Remove the global-only gates on the profile settings page and route, the subscription section, and the account-panel subscription row, so both editions show them. Unsubscribed accounts see a blue "Subscribe" action. Subscribed accounts see the plan name with the tightest remaining quota percentage, and hovering the row shows a card with per-window usage, recovery times, and a "View usage details" link to the usage page.
- **China-edition onboarding.** Enable the existing Cherry Account login. Change only the button copy: the primary button reads "Sign in" and the secondary button reads "Use a custom provider". Layout, the hint text, language switch, skip, privacy consent, the authorizing state, and the existing post-login routing (first available agent model, otherwise the no-models dialog) stay unchanged. Global-edition onboarding is untouched.
- **Model selector.** The Cherry AI group lists subscription models before free models. Free models carry a green "Free" text tag; the shared free model tag shows this text instead of a gift icon everywhere it appears. Paid plans may list their models in an optional `models` field on `available_plans[]`; models the account cannot use yet appear in the group as locked rows with their capability tags and a lock "Subscription" tag, and choosing one starts the Subscribe action instead of selecting it. Locked rows follow the same `available_features` rule as owned models and ignore `purchase_available`, which the portal decides. The group header shows a blue "Subscribe" link while unsubscribed and the plan name as a pill once subscribed. Quota-exhausted models keep the existing unavailable state.
- **Subscribe action.** Every touchpoint uses one action: dismiss the red dot and open the edition's portal. A signed-out user first goes through the existing Cherry Account login; the portal opens after sign-in completes. Sign-in failures keep the specific upgrade-required and service-unavailable messages, and a portal that fails to open is reported separately.
- **Return and success reminder.** When the main window regains focus, the client refreshes account plans and model availability. When the same account gains an active paid entitlement it did not have before, the client shows one light toast, "{plan} is active". A `cherrystudio://` return link from the web checkout and switching to a chosen target model are follow-ups once the web return format and plan model lists are available.
- **Quota-exhausted notice.** A shared notice sits directly above the composer input in both chat and agent composers. It appears while the current model is a Cherry Cloud model whose quota is exhausted, and states when quota recovers. A free model offers "Subscribe" (unless already subscribed); a paid model offers "View usage". "Switch model" opens the model selector. Sending is blocked without a request, and the draft is kept. The notice disappears when the model changes or refreshed quota shows recovery. The copy does not suggest upgrading, because no higher plan exists yet.
- **Red dot.** The sidebar account avatar shows a red dot while the user has no active paid entitlement, until the first time any Subscribe touchpoint is used. The dismissal survives restarts.
- **Usage page.** Both a 30-day rolling window and a `subscription_month` billing-period window are labeled "Monthly usage". The recovery time is `next_recovery_at`, or `period_end` for a billing-period window. A blue "FAQ & help" link next to the section title opens the edition's subscription FAQ once its URL is provided.
- **Development backend.** A backend configured through `MAIN_VITE_CHERRY_CLOUD_API_ORIGIN` may return a plain-HTTP authorization URL on exactly that origin, so a LAN backend without HTTPS can be used for integration testing. Production builds never set the override.

## Alternatives considered

- In-client paywall dialog with plan details: rejected; plans and their models change, so the web page owns plan presentation.
- Subscription-success dialog, with or without marketing effects: rejected in favor of a light toast that does not interrupt the user.
- Group-header link only, with no locked rows, as in the global edition today: kept as the behavior while a backend omits plan model lists, not as the target.
- Deriving locked rows from the model catalog or from a main-process model sync: rejected; the China backend's `/v1/models` lists only owned models, and an extra plans request on every sync changes network behavior for every client.
- Filtering locked rows by `purchase_available`: rejected; the China backend reports `false` for plans its portal still sells, and the usage page already ignores the field.
- Hardcoding Plus and Flash per edition: rejected; the backend already sends `display_name`.
- Polling during checkout: rejected; refreshing on focus covers the return without background traffic.
- Showing the first-month introductory price in the client: rejected by the product decision of 2026-10-27.
- Cherry Account login in global-edition onboarding: deferred; global onboarding stays on CherryIN in this work.
- Accepting any plain-HTTP authorization URL: rejected; only the explicitly configured development origin is exempt.

## Acceptance criteria

- AC1 — In the China edition, settings show the profile page with the subscription section, and the account panel shows the subscription row; every environment opens `/account/plans` on its Cherry Cloud API origin. (verification: renderer)
- AC2 — China-edition onboarding shows "Sign in" and "Use a custom provider", signs in with a Cherry Account, and keeps the existing post-login routing; global-edition onboarding is unchanged. (verification: renderer)
- AC3 — The Cherry AI group lists subscription models before free models; free models show a green "Free" text tag and no gift icon appears for the free tag anywhere; plan models the account cannot use appear as locked rows with capability tags that start Subscribe instead of selecting; the header shows a "Subscribe" link while unsubscribed and the backend plan name once subscribed. (verification: renderer + Electron)
- AC4 — Any Subscribe touchpoint opens the portal, removes the account-avatar red dot permanently, and for a signed-out user starts Cherry Account login before opening the portal; sign-in and portal failures show their specific messages. (verification: renderer)
- AC5 — After checkout, regaining window focus refreshes plans and models, and a newly active paid entitlement on the same account shows exactly one toast naming the plan. (verification: renderer + Electron)
- AC6 — When the current chat or agent model has exhausted quota, the notice above the input shows the recovery time and the actions for a free or paid model, without suggesting an upgrade; sending issues no request and keeps the draft; switching to an available model hides the notice. (verification: renderer + Electron)
- AC7 — The usage section labels 30-day rolling and `subscription_month` windows "Monthly usage" and shows their recovery time from `next_recovery_at` or `period_end`; the plans response with a `subscription_month` window passes validation. (verification: unit + renderer)
- AC8 — No client surface shows a hardcoded plan name, price, renewal date, or introductory offer. (verification: renderer)
- AC9 — The account panel shows a blue "Subscribe" action while unsubscribed and, once subscribed, the plan name with the tightest remaining percentage and a hover card of per-window usage that links to the usage page. (verification: renderer + Electron)
- AC10 — A plain-HTTP authorization URL is accepted only on the origin configured by `MAIN_VITE_CHERRY_CLOUD_API_ORIGIN`; other HTTP origins remain rejected. (verification: unit)

## Risks

- Locked rows need the backend to add `models` to `available_plans[]`; until it ships, the group shows only the header link.
- Subscription models must list `agent`, `chat`, and `translate` in `available_features`; a model that grants `chat` without `translate` appears in no picker, which the China integration backend currently does.
- A brand-new China-edition account with no Cloud models and no plan model list has no Cherry AI group in the selector, so the selector offers no Subscribe entry; the account panel and red dot still do.
- The FAQ URLs and the `cherrystudio://` return format still need agreement with the web team; focus refresh works without the return link.
- Enabling Cherry Account login in China-edition onboarding reverses the default chosen in #20155; CherryIN stays available as a provider in settings.
- The red dot reaches every user without a paid entitlement, including users who only use their own providers.
- The development HTTP exemption trusts whoever controls the build-time override; it must never be set for release builds.
