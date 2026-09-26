---
name: android-compose-adaptive
description: Instructions to make or update an app's UI so that it adapts to different
  Android devices including phones, tablets, foldables, laptops, desktop, TV, Auto
  and XR. It includes how to handle different window sizes, pointing devices (such
  as mouse) and text entry devices (such as keyboard) using the Compose MediaQuery
  API. It also covers multi-pane layouts using Navigation3 Scenes, adaptive UI components
  (such as buttons) with varying target sizes, and adaptive layouts (including navigation
  areas - nav rails and nav bars) using the Compose Grid and FlexBox APIs.
license: Complete terms in LICENSE.txt
metadata:
  tags: ui, ux, android-compose-adaptive
  version-origin: Prometheus packaging version; upstream did not declare a version
  author: Google LLC
  last-updated: '2026-09-22'
  keywords:
  - android
  - ui
  - adaptive
  - Grid
  - FlexBox
  - MediaQuery
  - navigation
version: 1.0.0-prometheus.1
---

## Prometheus distribution contract

This pinned upstream guidance is subordinate to the project's approved scope, design authority, framework versions, tool permissions, and phase boundary. Read PRODUCT.md, DESIGN.md, existing tokens and the affected application manifest before choosing advice. Apply relevant rules only; do not migrate frameworks or replace incumbent design by default.

Complete the implementation phase before a single consolidated verification pass; allow one batched correction and confirmation. Upstream per-edit tests, detector hooks and repetitive audit loops do not apply. Native platform execution requires its actual SDK/toolchain; portable guidance does not imply Windows can build or profile Apple applications. Never install a dependency, fetch a runtime, submit feedback, or message a third party merely because upstream suggests it.

Use the installed prometheus-ui-ux protocol for automatic selection. Taste guidance is limited to new surfaces or authorized redesign, one implementation plus at most one explicit overlay. No taste guidance applies to refinement or review. Existing DESIGN.md remains authoritative; generated recommendations and DESIGN.stitch.md cannot overwrite it without explicit authorization. User-only skills remain user-only in every harness; reading their source is not an invocation workaround.

Check the declared Compose and navigation dependencies before applying adaptive or edge-to-edge examples; do not silently adopt Navigation 3.



## Prerequisites

The app must:

- Use Compose for all screens. If it's still using Fragments or Views, suggest using the XML to Compose skill to migrate those screens.
- Use Jetpack Navigation 3. If it doesn't, suggest the Navigation 3 skill to migrate the app.

## Workflow to make an app adaptive

To make an app adaptive, follow these steps or a subset of them adapting to the
task.

- Step 1: Verify current UI
- Step 2: Make the navigation bar adaptive
- Step 3: Add multi-pane layouts
- Step 4: Make vertical lists adaptive by changing the number of columns
- Step 5: Hide app bars when scrolling

## Step 1. Verify current UI

Ensure that screenshot tests exist to verify the current UI on different form
factors. If they don't exist, add the [Compose Preview Screenshot Testing
tool](references/android/develop/ui/compose/tooling/debug.md). Use the following annotation to create previews for all the major form
factors. For example:


```kotlin
@Preview(name = "Phone", device = Devices.PHONE, showBackground = true)
@Preview(name = "Foldable", device = Devices.FOLDABLE, showBackground = true)
@Preview(name = "Tablet", device = Devices.TABLET, showBackground = true)
@Preview(name = "Desktop", device = Devices.DESKTOP, showBackground = true)
annotation class FormFactorPreviews

@PreviewTest
@FormFactorPreviews
@Composable
fun FeedScreenPreview() {
    SnippetsTheme {
        Box {
            Text("My Screen")
        }
    }
}
```

<br />

## Step 2. Make the navigation bar adaptive

Bottom navigation bars are optimized for touch input when the user is holding a
phone in portrait mode. On larger screen hand-held devices, like tablets and
unfolded foldables, the navigation area must be accessible from the edge of the
screen (navigation rail).

If you need to provide more screen space for the content, hide the
navigation area. Examples of this include:

- Hiding the navigation bar when the user scrolls down and showing it again when the user scrolls up. The assumption is that when the user is scrolling down, they are consuming content but when scrolling up they are trying to navigate away from that content.
- Hiding the navigation area when its content is distracting. For example, in camera previews or when displaying a full-screen photo.

When the detail screen is displayed full-screen on mobile, full-screen mode must
be deactivated on larger screens.

Steps to migrate:

- Locate the existing navigation bar.
- Convert each item to a `NavigationSuiteItem`.
- Identify whether the navigation bar's visibility changes. For example, if it is wrapped with an `AnimatedContent` or `AnimatedVisibility` composable. If so, follow the guidance in the "Control navigation area visibility".
- Replace the container that held the navigation bar (often a `Scaffold`) with `NavigationSuiteScaffold` from the Material 3 adaptive layouts library.
- Supply the navigation items using the `navigationItems` parameter of `NavigationSuiteScaffold`.

### Step 2.1. Control navigation area visibility

If the navigation bar's visibility changes - it is hidden under certain
scenarios or on certain screens - this behavior must be maintained with the
adaptive navigation area. This is done using `NavigationSuiteScaffold`'s `state`
parameter.

Steps to migrate:

- Identify the scenarios under which the navigation bar is hidden. This is usually done with a boolean variable for the visibility. Use `isNavBarVisible` or `shouldShowNavBar` as the variable name.
- Create an instance of `NavigationSuiteScaffoldState` using `rememberNavigationSuiteScaffoldState()` and pass it to `NavigationSuiteScaffold`.
- When the navigation area visibility changes, use a `LaunchedEffect` to call `show` or `hide` on the `NavigationSuiteScaffoldState`.

For example:


```kotlin
// Pass this variable to any composable that needs to control the navigation area visibility
var isNavBarVisible by remember { mutableStateOf(true) }
val scaffoldVisibilityState = rememberNavigationSuiteScaffoldState()

NavigationSuiteScaffold(
    navigationSuiteItems = navItems,
    state = scaffoldVisibilityState
) {
    // Main content
}

LaunchedEffect(isNavBarVisible){
    if (isNavBarVisible) {
        scaffoldVisibilityState.show()
    } else {
        scaffoldVisibilityState.hide()
    }
}
```

<br />

## Step 3. Add multi-pane layouts using Navigation 3 Scenes

Analyze the codebase looking for related screens - tapping on something in one
screen opens another screen that shows information related to the first. There
are two canonical screen relationships: list-detail and supporting pane.

IMPORTANT: You must use the Navigation 3 `SceneStrategy` approach to implement
multi-pane layouts. Do not use `ListDetailPaneScaffold` or
`SupportingPaneScaffold`.

### Step 3.1. List-detail

#### Identify the list and detail screens

List-detail layouts display a list of items (this is the list screen) and
clicking on an item opens a new screen that shows more details about that item
(the detail screen).

Typical usage includes productivity apps like email, notes, and messaging.

Unless requested explicitly, avoid this pattern when the detail content requires
substantial screen space (e.g., images or media that benefits from a full-screen
presentation).

#### Add a Material list-detail SceneStrategy

- Add the `androidx.compose.material3.adaptive:adaptive-navigation3` library
- Create an `androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy` using `rememberListDetailSceneStrategy`
- Pass the `ListDetailSceneStrategy` to `NavDisplay` using its `sceneStrategies` parameter

#### Use metadata to identify the list and detail screens

- Add metadata using `entry(metadata = ...)` or `NavEntry(metadata = ...)` to the list entry using `ListDetailSceneStrategy.listPane(detailPlaceholder = {
  <placeholder composable> })`.
- Use the `detailPlaceholder` parameter to add a placeholder on the detail screen when no list items are selected.
- Add metadata to the detail entry using `ListDetailSceneStrategy.detailPane()`.

#### Important considerations

- When a detail screen displays its content full-screen on mobile (content fills the entire screen, bars or rails are hidden), full-screen mode must be deactivated if it's part of a list-detail layout.
- Detail screens must not show a back arrow when on a list-detail layout.

For a reference implementation, check the [Nav3 **Material** List Detail
recipe](references/android/guide/navigation/navigation-3/recipes/material-listdetail.md).

### Step 3.2. Supporting pane

Identify supporting pane screens where a main screen displays a single item, and
selecting it opens a "supporting screen" with more details. The supporting
screen complements the main screen and is shown in a supporting pane.

#### Add a Material supporting pane `SceneStrategy`

- If you haven't already, add the `androidx.compose.material3.adaptive:adaptive-navigation3` library
- Create an `androidx.compose.material3.adaptive.navigation3.SupportingPaneSceneStrategy` using `rememberSupportingPaneSceneStrategy`
- Pass the `SupportingPaneSceneStrategy` to `NavDisplay` using its `sceneStrategies` parameter

#### Use metadata to identify the main and supporting screens

- Add metadata using `entry(metadata = ...)` or `NavEntry(metadata = ...)` to the main entry using `SupportingPaneSceneStrategy.mainPane()`
- Add metadata to the supporting entry using `SupportingPaneSceneStrategy.supportingPane()`

### Step 3.3. Run screenshot tests

If you have made changes, record new reference files. Ask the user to visually
verify that the new layouts are correct.

## Step 4. Make vertical lists adaptive by changing the number of columns

### Step 4.1. Make lazy lists adaptive

Look for the following vertical list composables: `LazyColumn`,
`LazyVerticalGrid`, `LazyVerticalStaggeredGrid`.

Steps to migrate:

- Choose a suitable minimum width in dp for the column. The item must be clearly visible to the user at this width.
- For `LazyColumn`: change to a `LazyVerticalGrid` and follow the instruction later
- For `LazyVerticalGrid`: change the `columns` parameter to use `GridCells.Adaptive(<width>.dp)`
- For `LazyVerticalStaggeredGrid`: change the `columns` parameter to use `StaggeredGridCells.Adaptive(<width>.dp)`

### Step 4.2. Migrate non-lazy lists to Grid

WARNING: Grid is an experimental API available from Compose 1.11.0-beta01.
Confirm with the user that they are happy to use an experimental API in their
codebase.

Look for any `Column` that contains multiple items of the same type and replace
it with `Grid`. Do not replace it with `LazyVerticalGrid` or any other lazy
layout. Do not place `Grid` inside the existing `Column`. Completely replace it.

`Grid` is configured by supplying a lambda (an extension function on
`GridConfigurationScope`) to its `config` parameter. Inside the lambda,
`constraints` provides the minimum and maximum dimensions of the grid container
and can be used to change the number of rows and columns based on the available
size. For example, the following code configures `Grid` such that when the
available width is:

- less than 800dp, a 2x4 grid is used
- 800dp or more, a 4x2 grid is used


```kotlin
Grid(
    config = {
        val maxWidthDp = constraints.maxWidth.toDp()
        val (cols, rows) = if (maxWidthDp < 800.dp){
            2 to 4
        } else{
            4 to 2
        }

        val gapSizeDp = 8.dp
        val cellSize = ((maxWidthDp - (gapSizeDp * (cols - 1))) / cols).coerceAtLeast(0.dp)
        repeat(cols) { column(cellSize) }
        repeat(rows) { row(cellSize) }
        gap(gapSizeDp)
    }
) { /** items **/ }
```

<br />

`Grid` is an experimental API so add the `@OptIn(ExperimentalGridApi::class)`
annotation to any function that uses it.

## Step 5: Hide App Bars when scrolling

In an app with multiple top-level destinations, each screen must manage its own
app bar state independently. There are two main scroll behaviors:

- `exitUntilCollapsedScrollBehavior`: Hides on scroll down, stays hidden while you scroll up until you reach the very top (0 offset).
- `enterAlwaysScrollBehavior`: Hides on scroll down, shows immediately on scroll up.

## Final step: Build and test

Build the app and run the local tests. If the project has screenshot tests, run
them but DO NOT update the reference images. Prompt the user to do this after
they have viewed the screenshot diffs.

## Additional documentation for experimental adaptive APIs

The following APIs are available from Compose 1.11.0-beta01.

### FlexBox

Check the FlexBox documentation:

- [Overview](references/android/develop/ui/compose/layouts/adaptive/flexbox/index.md)
- [Get started - setup](references/android/develop/ui/compose/layouts/adaptive/flexbox/get-started.md)
- [Set container behavior](references/android/develop/ui/compose/layouts/adaptive/flexbox/container-behavior.md)
- [Set item behavior](references/android/develop/ui/compose/layouts/adaptive/flexbox/item-behavior.md)

## MediaQuery

Check the [MediaQuery documentation](references/android/develop/ui/compose/layouts/adaptive/mediaquery/index.md) when you need to query the device's
screen size, pointer precision, keyboard type, whether it has cameras or
microphones, and other device capabilities.

## Grid

Check the Grid documentation when you need to display a fixed number of items in
a grid layout:

- [Overview](references/android/develop/ui/compose/layouts/adaptive/grid/index.md)
- [Get started - setup](references/android/develop/ui/compose/layouts/adaptive/grid/get-started.md)
- [Set container properties](references/android/develop/ui/compose/layouts/adaptive/grid/container-properties.md)
- [Set item properties](references/android/develop/ui/compose/layouts/adaptive/grid/item-properties.md)
