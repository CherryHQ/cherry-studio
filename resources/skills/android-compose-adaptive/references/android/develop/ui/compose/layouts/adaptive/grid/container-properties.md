You can define a Grid container configuration to create flexible layouts
that respond to different screen sizes and content types.
This page describes how to do the following:

- [Define a grid](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/container-properties#grid-definition): Set up the basic structure of rows and columns.
- [Place items in a grid](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/container-properties#item-placement): Understand how items are placed into grid cells and how to change flow direction.
- [Manage track sizing](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/container-properties#grid-track-size): Use fixed, percentage, flexible, and intrinsic sizing to set track sizes.
- [Set gaps](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/container-properties#grid-gap): Manage the "gutters" between rows and columns.

## Define a grid

A grid consists of columns and rows.
The [`Grid`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/Grid.composable#Grid(kotlin.Function1,androidx.compose.ui.Modifier,kotlin.Function1)) composable has a `config` parameter
that accepts a lambda to define the columns and rows
within [`GridConfigurationScope`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridConfigurationScope).
The following example defines a grid that has three rows and two columns,
each with a fixed size specified in [`Dp`](https://developer.android.com/reference/kotlin/androidx/compose/ui/unit/Dp):


```kotlin
Grid(
    config = {
        repeat(2) {
            column(160.dp)
        }
        repeat(3) {
            row(90.dp)
        }
    }
) {
}
```

<br />

## Place items in a grid

`Grid` takes the UI elements
in the `content` lambda and places them into grid cells.
The grid lays out items regardless of
whether you have explicitly defined the rows and columns.
By default,
`Grid` tries to place a UI element in the available grid cell in the row;
if it can't, it places it in an available grid cell in the next row.
If there are no empty cells, `Grid` creates a new row.

In the following example, the grid has six grid cells
and places a card into each one (Figure 1).
Each grid cell is `160dp` x `90dp`,
making the total grid size `320dp` x `270dp`.


```kotlin
Grid(
    config = {
        repeat(2) {
            column(160.dp)
        }
        repeat(3) {
            row(90.dp)
        }
    }
) {
    Card1()
    Card2()
    Card3()
    Card4()
    Card5()
    Card6()
}
```

<br />

![Six cards are placed in a grid that has three rows and two columns.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/placement.png) **Figure 1**. Six cards are placed in a grid that has three rows and two columns.

To change this default behavior to filling by column,
set the [`flow`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridConfigurationScope#flow()) property to [`GridFlow.Column`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridFlow#Column()).


```kotlin
Grid(
    config = {
        repeat(2) {
            column(160.dp)
        }
        repeat(3) {
            row(90.dp)
        }
        gap(8.dp)
        flow = GridFlow.Column // Grid tries to place items to fill the column
    },
) {
    Card1()
    Card2()
    Card3()
    Card4()
    Card5()
    Card6()
}
```

<br />

![The flow function changes the direction to place items.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/grid-flow.png) **Figure 2** . `GridFlow.Row` (left) and `GridFlow.Column` (right).

## Manage track sizing

Rows and columns are collectively referred to as a [grid track](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid#grid-track).
You can specify the size of a grid track using one of the following methods:

- **Fixed** (`Dp`): Allocates a specific size (e.g., `column(180.dp)`).
- **Percentage** (`Float`): Allocates a percentage of the total available space from `0.0f` to `1.0f` (e.g., `row(0.5f)` for 50%).
- **Flexible** ([`Fr`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/Fr)): Distributes remaining space proportionally after fixed and percentage tracks are calculated. For example, if two rows are set to `1.fr` and `3.fr`, the latter receives 75% of the remaining height.
- **Intrinsic** : Sizes the track based on the content inside it. For more information, see [Determine grid track size intrinsically](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/container-properties#intrisic-grid-track-size).

The following example uses the different track sizing options
to define the row heights:


```kotlin
Grid(
    config = {
        column(1f)

        row(100.dp)
        row(0.2f)
        row(1.fr)
        row(GridTrackSize.Auto)
    },
    modifier = Modifier.height(480.dp)
) {
    PastelRedCard("Fixed(100.dp)")
        PastelGreenCard("Percentage(0.2f)")
    PastelBlueCard("Flex(1.fr)")
        PastelYellowCard("Auto")

}
```

<br />

![Row heights defined using the four primary track sizing options.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/track-sizes.png) **Figure 3** . Row heights defined using the four primary track sizing options in `Grid`.

### Set the minimum size for flexible grid tracks

When a grid container has no remaining space,
a standard flexible track can shrink to `0.dp`.
To prevent this and ensure content isn't crushed,
use [`GridTrackSize.MinMax`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridTrackSize#MinMax(androidx.compose.ui.unit.Dp,androidx.compose.foundation.layout.Fr))
to enforce an explicit minimum size while keeping the track flexible.

The following example allocates at least `100.dp` to the first row:


```kotlin
Grid(
    config = {
        column(1f)
        // The first row has a minimum height of 100.dp and can expand to 
        // the half of the remaining space.
        row(GridTrackSize.MinMax(100.dp, 1.fr))
        // The second row takes the half of the remaining space.
        row(1.fr)
        // The third row has a fixed height of 200.dp.
        row(200.dp)
    },
    modifier = Modifier.size(360.dp) // Total grid height is 360.dp
) {
    PastelRedCard("MinMax(100.dp, 1.fr)")
        PastelGreenCard("Flex(1.fr)")
    PastelBlueCard("Fixed(200.dp)")
}
```

<br />

![Row heights defined using the four primary track sizing options.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/track-size-minmax.png) **Figure 4** . The first row has at least `100.dp` height.

### Set the minimum grid track size to place lazy lists

Standard flexible tracks automatically query the intrinsic sizes of
their children to establish a base size.
However, Jetpack Compose prohibits querying the intrinsic sizes of
[`SubcomposeLayout`](https://developer.android.com/reference/kotlin/androidx/compose/ui/layout/SubcomposeLayout.composable#SubcomposeLayout(androidx.compose.ui.Modifier,kotlin.Function2)), which backs components,
such as [`LazyColumn`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/lazy/LazyColumn.composable) and [`LazyRow`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/lazy/LazyRow.composable).

Placing a lazy list inside a standard flexible track causes
an [`IllegalStateException`](https://developer.android.com/reference/java/lang/IllegalStateException) crash.
To safely place lazy lists inside a flexible grid track,
use `MinMax` with an explicit minimum size (such as `0.dp`)
to bypass the intrinsic measurement pass.


```kotlin
Grid(
    config = {
        column(1f)
        // The first row's height is determined by the height of the Text composable.
        row(GridTrackSize.Auto)
        // The second row occupies the remaining space, allowing the LazyColumn to scroll.
        row(GridTrackSize.MinMax(0.dp, 1.fr))

        gap(8.dp)
    },
    modifier = Modifier.size(width = 170.dp, height = 240.dp)
) {
    Text("LazyColumn in a Grid")
    // The LazyColumn is placed in the second row, filling the remaining space.
    LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items(100) { number ->
            PastelGreenCard("Card $number")
        }
    }
}
```

<br />

![Row heights defined using the four primary track sizing options.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/lazy-column-in-grid.png) **Figure 5** . `LazyColumn` in a grid cell.

### Determine grid track size intrinsically

You can use [intrinsic sizing](https://developer.android.com/develop/ui/compose/layouts/intrinsic-measurements) for a `Grid`
when you want the layout to adapt to the content,
rather than forcing it into a fixed container.
The grid track size is determined with the following values:

- [`GridTrackSize.MaxContent`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridTrackSize#MaxContent()): Use the content's maximum intrinsic size (e.g., the width is determined by the full length of the text in a text block with no wrapping).
- [`GridTrackSize.MinContent`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridTrackSize#MinContent()): Use the content's minimum intrinsic size (e.g., the width is determined by the longest single word in a text block).
- [`GridTrackSize.Auto`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridTrackSize#Auto()): Use a flexible size for a track that adapts based on available space. It behaves like `MaxContent` by default, but shrinks and wraps its content to fit within the parent container.

The following example places two texts side by side.
The column size for the first text is determined
by the required minimum width to display the text,
and the second column width depends on the required maximum width of the text.


```kotlin
Grid(
    config = {
        column(GridTrackSize.MinContent)
        column(GridTrackSize.MaxContent)
        row(1.0f)
    },
    modifier = Modifier.width(480.dp)
) {
    Text("Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras imperdiet.")
    Text("Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras imperdiet.")
}
```

<br />

![Intrinsic sizes specified in the columns.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/intrinsic-size.png) **Figure 5**. Intrinsic sizes specified in the columns.

## Set gaps between rows and columns

Once your grid tracks are sized,
you can modify the [grid gap](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid#grid-gap) to refine the spacing between the tracks.
You can specify the column gap with the [`columnGap`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridConfigurationScope#columnGap(androidx.compose.ui.unit.Dp)) function,
and the row gap with [`rowGap`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridConfigurationScope#rowGap(androidx.compose.ui.unit.Dp)). In the following example,
there is a `16dp` gap between each row,
and an `8dp` gap between each column (Figure 5).


```kotlin
Grid(
    config = {
        repeat(2) {
            column(160.dp)
        }
        repeat(3) {
            row(90.dp)
        }
        rowGap(16.dp)
        columnGap(8.dp)
    }
) {
    Card1()
    Card2()
    Card3()
    Card4()
    Card5()
    Card6()
}
```

<br />

![Gaps between rows and columns.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/gaps.png) **Figure 6**. Gaps between rows and columns.

You can also use the convenience function [`gap`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridConfigurationScope#gap(androidx.compose.ui.unit.Dp))
to define gaps of the same column and row size,
and to define column and gap sizes separately using a single function.
The following code adds `8dp` gaps to the grid:


```kotlin
Grid(
    config = {
        repeat(2) {
            column(160.dp)
        }
        repeat(3) {
            row(90.dp)
        }
        gap(8.dp) // Equivalent to columnGap(8.dp) and rowGap(8.dp)
    }
) {
    Card1()
    Card2()
    Card3()
    Card4()
    Card5()
    Card6()
}
```

<br />

## Define grid areas with named areas

Named areas allow you to attach names to groups of grid cells,
which are called [grid areas](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid#grid-area).
You can use these names instead of [coordinate indexes](https://developer.android.com/develop/ui/compose/layouts/adaptive/grid/item-properties#position)
when placing UI elements in the grid.

Using named areas has two main benefits to code readability:

- When defining the grid layout, the purpose and placement of the expected content is clear.
- When adding the content, the purpose of that content is clear.

To organize complex layouts clearly, you can decouple your physical grid
structure from child placement by defining semantic grid areas.

Inside the `config` lambda, use the [`area`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridConfigurationScope#area(kotlin.Any,kotlin.Int,kotlin.Int,kotlin.Int,kotlin.Int)) function in
`GridConfigurationScope` to register named areas in the grid.
You can then assign child composables to these areas
using the [`gridItem`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/GridScope#(androidx.compose.ui.Modifier).gridItem(kotlin.Any,androidx.compose.ui.Alignment)) modifier
with the corresponding area identifier. The `area` function maps
a semantic identifier (such as an `enum` class value or a string key) to
a set of physical grid coordinates. Grid lines and indexes are **1-based**
(that is, the first row is `1`, and the first column is `1`).

For example, you define a grid that has four area IDs:


```kotlin
/**
 * An enum representing the IDs for named areas within the grid.
 */
enum class GridAreaNames {
    Area1,
    Area2,
    Area3,
    Area4
}
```

<br />

Provide the name for the area using the `areaId` parameter along with the area's
cell coordinates and spans.
The `gridItem` modifier uses the `areaId` as a key
to assign each child item to its designated grid area,
as shown in the following example:


```kotlin
Grid(
    config = {
        // Define a single column that takes all available width.
        repeat(2) { column(0.5f) }

        // Define four rows, each taking 25% of the total height.
        repeat(4) { row(0.25f) }

        // Define named grid areas by associating an areaId with specific row and column indices.
        // Row and column indices are 1-based.
        area(areaId = GridAreaNames.Area1, row = 1, column = 1, columnSpan = 2)
        area(areaId = GridAreaNames.Area2, row = 2, column = 1, rowSpan = 3)
        area(areaId = GridAreaNames.Area3, rows = 2..3, columns = 2..2)
        area(areaId = GridAreaNames.Area4, row = 4, column = 2)

        gap(4.dp)
    },
    modifier = Modifier.size(360.dp)
) {
    PastelRedCard(
        "Area 1",
        // Use Modifier.gridItem(areaId) to place this composable into the
        // grid area defined with the matching ID in the config block.
        modifier = Modifier.gridItem(areaId = GridAreaNames.Area1)
    )
    PastelGreenCard(
        "Area 2",
        modifier = Modifier.gridItem(areaId = GridAreaNames.Area2)
    )
    PastelBlueCard(
        "Area 3",
        modifier = Modifier.gridItem(areaId = GridAreaNames.Area3)
    )
    PastelYellowCard(
        "Area 4",
        modifier = Modifier.gridItem(areaId = GridAreaNames.Area4)
    )
}
```

<br />

By using named areas, you can reorganize or adjust the physical layout grid (for
example, changing rows, columns, or track sizes) in the `config` lambda
without needing to modify the order or parameters of the child composables.