Tools for debugging your Compose UI are available in Android Studio.

## Layout Inspector

Layout Inspector lets you inspect a Compose layout inside a running app in an
emulator or physical device. You can use the Layout Inspector to check how often
a composable is recomposed or skipped, which can help identify issues with your
app. For example, some coding errors might force your UI to recompose
excessively, which can cause [poor performance](https://developer.android.com/develop/ui/compose/performance).
Some coding errors can prevent your UI from recomposing and, therefore,
prevent your UI changes from showing up on the screen. If you're new to
Layout inspector, check the [guidance](https://developer.android.com/studio/debug/layout-inspector) on how to
run it.

> [!NOTE]
> **Note:** If you're not seeing Compose components in layout inspector, make sure you are not removing `META-INF/androidx.compose.*.version` files from the APK. These are required for layout inspector to work.

### Get recomposition counts

When debugging your Compose layouts, knowing when composables
[recompose](https://developer.android.com/develop/ui/compose/mental-model#recomposition) is important in
understanding whether your UI is implemented properly. For example, if it's
recomposing too many times, your app might be doing more work than is necessary.
On the other hand, components that don't recompose when you anticipate them to
can lead to unexpected behaviors.

The Layout Inspector shows you when discrete composables in your layout
hierarchy have either recomposed or skipped, as you interact with your app. In
Android Studio, your recompositions are highlighted to help you determine
where in the UI your composables are recomposing.

**Figure 1.** Recompositions are highlighted in Layout Inspector.

The highlighted portion shows a gradient overlay of the composable in the image
section of the Layout Inspector, and gradually disappears so that you can get an
idea of where in the UI the composable with the highest recompositions can be
found. If one composable is recomposing at a higher rate than another
composable, then the first composable receives a stronger gradient overlay
color. If you double-click a composable in the layout inspector, you're taken to
the corresponding code for analysis.

> [!NOTE]
> **Note:** To view recomposition counts, make sure your app is using an API level of 29 or higher, and `Compose 1.2.0` or higher. Then, deploy your app as you normally would.

![](https://developer.android.com/static/develop/ui/compose/images/li-recomposition-counts.png) **Figure 2.**The composition and skip counter in Layout Inspector.

Open the **Layout Inspector** window and connect to your app process. In the
**Component Tree** , there are two columns that appear next to the layout
hierarchy. The first column shows the number of compositions for each node and
the second column displays the number of skips for each node. Selecting a
composable node shows the dimensions and parameters of the composable, unless
it's an inline function, in which case the parameters can't be shown. You can
also see similar information in the **Attributes** pane when you select a
composable from the **Component Tree** or the **Layout Display**.

Resetting the count can help you understand recompositions or skips during a
specific interaction with your app. If you want to reset the count, click
**Reset** near the top of the **Component Tree** pane.

> [!NOTE]
> **Note:** If you don't see the new columns in the **Component Tree** pane, you can view them by selecting **Show Recomposition Counts** from the **View Options** menu ![Layout Inspector View Options
> icon](https://developer.android.com/static/studio/images/buttons/live-layout-inspector-view-options-icon.png) near the top of the **Component Tree** pane, as shown in the following image.

![Enable the composition and skip counter in Layout
Inspector](https://developer.android.com/static/develop/ui/compose/images/li-show-recomposition-counts.png)

**Figure 3**. Enable the composition and skip counter in Layout Inspector.

### Compose semantics

In Compose, [Semantics](https://developer.android.com/develop/ui/compose/accessibility/semantics) describe your UI in an
alternative manner that is understandable for
[Accessibility](https://developer.android.com/develop/ui/compose/accessibility) services and for the
[Testing](https://developer.android.com/develop/ui/compose/testing) framework. You can use the Layout Inspector
to inspect semantic information in your Compose layouts.
![Semantic information displayed using the Layout Inspector.](https://developer.android.com/static/develop/ui/compose/images/layout_inspector_semantics_new.png) **Figure 4.** Semantic information displayed using the Layout Inspector.

When selecting a Compose node, use the **Attributes** pane to check whether it
declares semantic information directly, merges semantics from its children, or
both. To quickly identify which nodes include semantics, either declared or
merged, use select the **View options** drop-down in the **Component Tree** pane
and select **Highlight Semantics Layers**. This highlights only the nodes in the
tree that include semantics, and you can use your keyboard to quickly navigate
between them.

## Compose UI Check

To help you build more adaptive and accessible UIs in Jetpack Compose, Android
Studio provides a UI Check mode in Compose Preview. This feature is similar
to [Accessibility Scanner](https://developer.android.com/guide/topics/ui/accessibility/testing#accessibility-scanner)
for views.

When you activate Compose UI check mode on a Compose Preview, Android Studio
automatically audits your Compose UI and suggests improvements to make your UI
more accessible and adaptive. Android Studio checks that your UI works across
different screen sizes. In the **Problems** panel, the tool shows the issues
that it detects, such as text stretched on large screens or low color contrast.

To access this feature, click the UI Check icon on Compose Preview:
![](https://developer.android.com/static/studio/images/design/compose-ui-check-entry.png) **Figure 5.** Entry point to UI check mode.

UI check automatically previews your UI in different configurations and
highlights issues found in different configurations. In the **Problems** panel,
when you click an issue, you can see the details of the issue, suggested fixes,
and the renderings that highlight the area of the issue.
![](https://developer.android.com/static/studio/images/design/compose-ui-check.png) **Figure 6.** UI check mode in action.

### Fix with AI

For issues detected in UI Check mode, you can use the AI agent to propose and
apply code fixes. Click the **Fix with AI** button on an issue in the
**Problems** panel. The agent analyzes the problem and your code to suggest
changes that resolve the accessibility or adaptive issue.
![](https://developer.android.com/static/studio/preview/features/images/ui-check-mode-single-fix.png) **Figure 7.** The agent fixes UI issues in UI Check mode.