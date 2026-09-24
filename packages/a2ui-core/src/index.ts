/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * `@prometheus-ags/a2ui-core` — vendored, version-pinned re-export of
 * Google's `@a2ui/web_core` (A2UI Core Library, https://a2ui.org/).
 *
 * This package is NOT a fork or source copy: it is a thin, exact-pinned
 * dependency wrapper. UAR code should import from
 * `@prometheus-ags/a2ui-core` (this package) rather than reaching into
 * `@a2ui/web_core` directly, so that:
 *   - the upstream version is pinned and bumped deliberately (see
 *     UPSTREAM.md), and
 *   - a single internal import surface exists if/when UAR needs to patch
 *     or diverge from upstream behavior in a future change.
 *
 * Default export surface is v0_8 (upstream's own default), matching
 * `@a2ui/web_core`'s package.json `"main"`/`"exports"["."]`. Import
 * `@prometheus-ags/a2ui-core/v0_9` for the v0.9 surface.
 *
 * Upstream copyright and license (Apache-2.0, Google LLC) are preserved
 * verbatim in ./LICENSE and in every upstream source file this package
 * re-exports (unmodified, resolved via node_modules).
 */
export * from '@a2ui/web_core'
