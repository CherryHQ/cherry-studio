> [!NOTE]
> **Note:** The `mediaQuery` function and the related data types are experimental and subject to change. File any issues on the [issue tracker](https://issuetracker.google.com/issues?q=componentid:1876021).

You need various types of information, such as device capability
and app status, to update your app layout.
Window width and height are the most commonly used information.
In addition to that, you can refer to the following information:

- Window posture
- Pointing devices precision
- Keyboard type
- Whether the camera and microphone are supported by the device
- The distance between a user and the device display

Because the information is updated dynamically,
you need to monitor it and trigger recomposition when any update happens.
The [`mediaQuery`](https://developer.android.com/reference/kotlin/androidx/compose/ui/mediaQuery.composable#mediaQuery(kotlin.Function1)) function abstracts the details of the information retrieval
and lets you focus on defining the condition to trigger the layout updates.

> [!NOTE]
> **Note:** "media" refers to the presentation medium that the UI is rendered on. The term "media" originates from [CSS media queries](https://www.w3.org/TR/mediaqueries-3/) which inspired the `mediaQuery` API.

The following example switches the layout to `TabletopLayout`
when the foldable posture is tabletop:


```kotlin
@Composable
fun VideoPlayer(
    // ...
) {
    // ...
            if (mediaQuery { windowPosture == UiMediaScope.Posture.Tabletop }) {
                TabletopLayout()
            } else {
                FlatLayout()
            }
    // ...
}
```

<br />

## Enable the `mediaQuery` function

To enable the `mediaQuery` function,
set the `isMediaQueryIntegrationEnabled` attribute of
the [`ComposeUiFlags`](https://developer.android.com/reference/kotlin/androidx/compose/ui/ComposeUiFlags) object to `true`:


```kotlin
class MyApplication : Application() {
    override fun onCreate() {
        ComposeUiFlags.isMediaQueryIntegrationEnabled = true
        super.onCreate()
    }
}
```

<br />

## Define a condition with parameters

You can define a condition as a lambda
that is evaluated within [`UiMediaScope`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope).
The `mediaQuery` function evaluates the condition according to
the current status and the device capabilities.
The function returns a boolean value,
so you can determine the layout with conditional branches
like an `if` expression.
Table 1 describes the parameters available in `UiMediaScope`.

| Parameter | Value type | Description |
|---|---|---|
| `windowWidth` | [`Dp`](https://developer.android.com/reference/kotlin/androidx/compose/ui/unit/Dp) | The current window width in dp. |
| `windowHeight` | `Dp` | The current window height in dp. |
| `windowPosture` | [`UiMediaScope.Posture`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.Posture) | The current posture of the application window. |
| `pointerPrecision` | [`UiMediaScope.PointerPrecision`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.PointerPrecision) | The highest precision of the available pointing devices. |
| `keyboardKind` | [`UiMediaScope.KeyboardKind`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.KeyboardKind) | The type of keyboard available or connected. |
| `hasCamera` | `Boolean` | Whether the camera is supported on the device. |
| `hasMicrophone` | `Boolean` | Whether the microphone is supported on the device. |
| `viewingDistance` | [`UiMediaScope.ViewingDistance`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.ViewingDistance) | The typical distance between the user and the device screen. |

A `UiMediaScope` object resolves the values of the parameters.
The `mediaQuery` function uses [`LocalUiMediaScope.current`](https://developer.android.com/reference/kotlin/androidx/compose/ui/package-summary#LocalUiMediaScope())
to access the `UiMediaScope` object,
which represents the current device capabilities and context.
This object is dynamically updated when any changes are made,
such as when the user changes the device posture.
The `mediaQuery` function then evaluates the `query` lambda
with the updated `UiMediaScope` object and returns a boolean value.
For example, the following snippet chooses between `TabletopLayout`
and `FlatLayout` based on the `windowPosture` parameter value.


```kotlin
@Composable
fun VideoPlayer(
    // ...
) {
    // ...
            if (mediaQuery { windowPosture == UiMediaScope.Posture.Tabletop }) {
                TabletopLayout()
            } else {
                FlatLayout()
            }
    // ...
}
```

<br />

### Make a decision based on the window size

[Window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes) are a set of opinionated viewport breakpoints
that help you design, develop, and test adaptive layouts.
You can compare the two parameters representing the current window size
with the threshold defined in the window size classes.
The following example changes the number of panes according to the window width.
[`WindowSizeClass`](https://developer.android.com/reference/androidx/window/core/layout/WindowSizeClass) class has constants for the thresholds
of window size classes (Figure 1).

The [`derivedMediaQuery`](https://developer.android.com/reference/kotlin/androidx/compose/ui/derivedMediaQuery.composable#derivedMediaQuery(kotlin.Function1)) function evaluates the `query` lambda
and wraps the result in a [`derivedStateOf`](https://developer.android.com/develop/ui/compose/side-effects#derivedstateof).
Because `windowWidth` and `windowHeight` can update frequently,
call the `derivedMediaQuery` function instead of the `mediaQuery` function
when you refer to those parameters in the `query` lambda.


```kotlin
val narrowerThanMedium by derivedMediaQuery {
    windowWidth < WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND.dp
}
val narrowerThanExpanded by derivedMediaQuery {
    windowWidth < WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND.dp
}
when {
    narrowerThanMedium -> SinglePaneLayout()
    narrowerThanExpanded -> TwoPaneLayout()
    else -> ThreePaneLayout()
}
```

<br />

**Figure 1**. Layout is updated according to the window width.

### Update layout according to the window posture

The `windowPosture` parameter describes the current window posture
as a `UiMediaScope.Posture` object.
You can check the current [posture](https://developer.android.com/develop/ui/compose/layouts/adaptive/foldables/learn-about-foldables) by comparing the parameter
with the values defined in the `UiMediaScope.Posture` class.
The following example switches layout according to the window posture:


```kotlin
when {
    mediaQuery { windowPosture == UiMediaScope.Posture.Tabletop } -> TabletopLayout()
    mediaQuery { windowPosture == UiMediaScope.Posture.Book } -> BookLayout()
    mediaQuery { windowPosture == UiMediaScope.Posture.Flat } -> FlatLayout()
}
```

<br />

### Check the precision of the available pointing device

A high precision pointing device helps users to point a UI element precisely.
The precision of a pointing device depends on the device type.

The `pointerPrecision` parameter describes the precision
of the available pointing devices, such as a mouse and touchscreen.
There are four values defined in the `UiMediaScope.PointerPrecision` class:
[`Fine`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.PointerPrecision#Fine()), [`Coarse`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.PointerPrecision#Coarse()), [`Blunt`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.PointerPrecision#Blunt()), and [`None`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.PointerPrecision#None()).
`None` means that no pointing device is available.
The precision ranges from highest to lowest in this order:
`Fine`, `Coarse`, and `Blunt`.

If multiple pointing devices are available and their precisions are different,
the parameter is resolved with the highest one.
For example, if there are two pointing devices --- a `Fine` precision device and
a `Blunt` precision device ---
`Fine` is the value of the `pointerPrecision` parameter.

The following example shows a larger button
when the user is using a pointing device with low precision:


```kotlin
if (mediaQuery { pointerPrecision == UiMediaScope.PointerPrecision.Blunt }) {
    LargeSizeButton()
} else {
    NormalSizeButton()
}
```

<br />

### Check the available keyboard type

The `keyboardKind` parameter represents the type of the available keyboards:
[`Physical`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.KeyboardKind#Physical()), [`Virtual`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.KeyboardKind#Virtual()), and [`None`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.KeyboardKind#None()).
If an on-screen keyboard is displayed and
a hardware keyboard is available at the same time,
the parameter is resolved as `Physical`.
If neither is detected, `None` is the value of the parameter.
The following example shows a message suggesting that users connect a keyboard
when no keyboard is detected:


```kotlin
if (mediaQuery { keyboardKind == UiMediaScope.KeyboardKind.None }) {
    SuggestKeyboardConnect()
}
```

<br />

### Check if the device supports camera and microphone

Some devices don't support cameras or microphones.
You can check if the device supports a camera and a microphone
with the `hasCamera` parameter and the `hasMicrophone` parameter.
The following example shows buttons to use with camera and microphone
when the device supports them:


```kotlin
Row {
    OutlinedTextField(state = rememberTextFieldState())
    // Show the MicButton when the device supports a microphone.
    if (mediaQuery { hasMicrophone }) {
        MicButton()
    }
    // Show the CameraButton when the device supports a camera.
    if (mediaQuery { hasCamera }) {
        CameraButton()
    }
}
```

<br />

### Adjust UI with the estimated viewing distance

Viewing distance is a factor that helps determine layout.
If the user is using the app from a distance,
they would expect the text and UI elements to be bigger.
The `viewingDistance` parameter provides an estimate of the viewing distance
based on the device type and its typical usage context.

There are three values defined in the `UiMediaScope.ViewingDistance` class:
[`Near`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.ViewingDistance#Near()), [`Medium`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.ViewingDistance#Medium()), and [`Far`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.ViewingDistance#Far()).
`Near` means that the screen is in close range,
and `Far` means that the device is viewed from a distance.
The following example increases the font size when the viewing distance is
`Far` or `Medium`:


```kotlin
val fontSize = when {
    mediaQuery { viewingDistance == UiMediaScope.ViewingDistance.Far } -> 20.sp
    mediaQuery { viewingDistance == UiMediaScope.ViewingDistance.Medium } -> 18.sp
    else -> 16.sp
}
```

<br />

## Preview a UI component

You can call the `mediaQuery` and `derivedMediaQuery` functions in the
composable functions to preview UI components.
The following snippet chooses between `TabletopLayout`
and `FlatLayout` based on the `windowPosture` parameter value.
To preview the `TabletopLayout`, the `windowPosture` parameter should be
[`UiMediaScope.Posture.Tabletop`](https://developer.android.com/reference/kotlin/androidx/compose/ui/UiMediaScope.Posture#Tabletop()).


```kotlin
when {
    mediaQuery { windowPosture == UiMediaScope.Posture.Tabletop } -> TabletopLayout()
    mediaQuery { windowPosture == UiMediaScope.Posture.Book } -> BookLayout()
    mediaQuery { windowPosture == UiMediaScope.Posture.Flat } -> FlatLayout()
}
```

<br />

The `mediaQuery` and `derivedMediaQuery` functions evaluate
the given `query` lambda within a `UiMediaScope` object,
which is provided as `LocalUiMediaScope.current`.
You can override it with the following steps:

1. Enable the `mediaQuery` function.
2. Define a custom object that implements the `UiMediaScope` interface.
3. Set the custom object to the `LocalUiMediaScope` with the [`CompositionLocalProvider`](https://developer.android.com/reference/kotlin/androidx/compose/runtime/CompositionLocalProvider.composable#CompositionLocalProvider(androidx.compose.runtime.CompositionLocalContext,kotlin.Function0)) function.
4. Call the composable to preview in the content lambda of the `CompositionLocalProvider` function.

You can preview the `TabletopLayout` with the following example:


```kotlin
@Preview
@Composable
fun PreviewLayoutForTabletop() {
    // Step 1: Enable the mediaQuery function
    ComposeUiFlags.isMediaQueryIntegrationEnabled = true

    val currentUiMediaScope = LocalUiMediaScope.current
    // Step 2: Define a custom object implementing the UiMediaScope interface.
    // The object overrides the windowPosture parameter.
    // The resolution of the remaining parameters is deferred to the currentUiMediaScope object.
    val uiMediaScope = remember(currentUiMediaScope) {
        object : UiMediaScope by currentUiMediaScope {
            override val windowPosture: UiMediaScope.Posture = UiMediaScope.Posture.Tabletop
        }
    }

    // Step 3: Set the object to the LocalUiMediaScope.
    CompositionLocalProvider(LocalUiMediaScope provides uiMediaScope) {
        // Step 4: Call the composable to preview.
        when {
            mediaQuery { windowPosture == UiMediaScope.Posture.Tabletop } -> TabletopLayout()
            mediaQuery { windowPosture == UiMediaScope.Posture.Book } -> BookLayout()
            mediaQuery { windowPosture == UiMediaScope.Posture.Flat } -> FlatLayout()
        }
    }
}
```

<br />