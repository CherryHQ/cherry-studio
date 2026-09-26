This page describes how to implement basic [`Grid`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/Grid.composable#Grid(kotlin.Function1,androidx.compose.ui.Modifier,kotlin.Function1)) layouts.

## Set up project

1. Add the [`androidx.compose.foundation.layout`](https://developer.android.com/jetpack/androidx/versions) library to your project's
   `lib.versions.toml`.

       [versions]
       compose = "1.13.0-alpha03"

       [libraries]
       androidx-compose-foundation-layout = { group = "androidx.compose.foundation", name = "foundation-layout", version.ref = "compose" }

2. Add the library dependency to your app's `build.gradle.kts`.

       dependencies {
           implementation(libs.androidx.compose.foundation.layout)
       }

## Create a basic grid

The following example creates a basic 2x3 grid,
with the columns and rows having a fixed size of `100.dp`.


```kotlin
Grid(
    config = {
        repeat(2) {
            column(100.dp)
        }
        repeat(3) {
            row(100.dp)
        }
    }
) {
    Card1(containerColor = PastelRed)
    Card2(containerColor = PastelGreen)
    Card3(containerColor = PastelBlue)
    Card4(containerColor = PastelPink)
    Card5(containerColor = PastelOrange)
    Card6(containerColor = PastelYellow)
}
```

<br />

![A basic grid consists of rows and columns with fixed size.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/six-cards-in-grid.png) **Figure 1**. A basic grid consists of rows and columns with fixed size.

To learn how to implement more advanced grids,
see [Set container properties](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/container-properties) and [Set item properties](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/item-properties).