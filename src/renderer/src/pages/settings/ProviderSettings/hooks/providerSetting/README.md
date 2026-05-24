# Provider Setting Hooks

Hooks in this folder own one narrow provider-settings concern. They should resolve provider-local data, mutations,
timers, translations, bridge calls, and derived flags internally, then expose only the small UI-facing state/actions
their owning component needs.

Use `providerId` or the smallest required scalar as input. Do not pass provider/model/query/mutation/store/client bags
through call sites, and do not turn a hook into a page facade or cross-domain view model.

Coordination hooks may read across domains only when they own one named side effect. They should return no broad state
object and should stay separate from domain state hooks.
