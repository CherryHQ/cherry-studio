> [!NOTE]
> **Note:** `Grid` is an experimental API and is subject to change. File any issues on the [issue tracker](https://issuetracker.google.com/issues/new?component=1876021&template=1424126).

[`Grid`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/Grid.composable#Grid(kotlin.Function1,androidx.compose.ui.Modifier,kotlin.Function1)) is a Jetpack Compose API
that lets you flexibly implement a two-dimensional layout.
With this API, you can display items in multi-column
or multi-row layouts that adapt to the available container size.
![A flexible and adaptive two-dimensional layout with Grid](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/example.png) **Figure 1.** A flexible and adaptive two-dimensional layout with `Grid`.

## How is Grid different from similar composables?

Compose already offers similar components, such as [`LazyVerticalGrid`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/lazy/grid/LazyVerticalGrid.composable#LazyVerticalGrid(androidx.compose.foundation.lazy.grid.GridCells,androidx.compose.ui.Modifier,androidx.compose.foundation.lazy.grid.LazyGridState,androidx.compose.foundation.layout.PaddingValues,kotlin.Boolean,androidx.compose.foundation.layout.Arrangement.Vertical,androidx.compose.foundation.layout.Arrangement.Horizontal,androidx.compose.foundation.gestures.FlingBehavior,kotlin.Boolean,androidx.compose.foundation.OverscrollEffect,kotlin.Function1)).
These components are mainly for visualization of large, homogeneous data sets---
for example, displaying a content catalog in a video streaming app.
These components are NOT designed
for the structural layout of a screen or complex component.

You can also implement a two-dimensional layout
by combining multiple `Row` and `Column` composables.
However, this approach has some downsides,
such as deep hierarchies and difficulties in adaptability.

The following table provides an overview
of which layouts are suitable for each API:

| Component | Purpose |
|---|---|
| `LazyVerticalGrid`, `LazyStaggeredGrid`, `LazyHorizontalGrid` | Visualization of large, homogeneous data sets that require lazy loading. |
| `Row`, `Column`, `FlexBox` | One-dimensional layout |
| `Grid` | Two-dimensional layout |

> [!NOTE]
> **Note:** `Grid` doesn't support lazy loading.

## Terminology

Familiarize yourself with the following terminology
to understand how `Grid` works.

### Grid line

A grid is made up of lines, which run horizontally and vertically.
If your grid has three rows, it has four horizontal lines,
including the one after the last row.
In the following image, each dotted line represents a grid line:
![The grid consists of four horizontal lines and three vertical lines.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/grid-line.png) **Figure 2**. The grid consists of four horizontal lines and three vertical lines.

### Grid track

A grid track is the space between two grid lines.
A row track is between two horizontal lines,
and a column track is between two vertical lines.
To define the size of these tracks,
assign a size to them when you create the grid.
![A grid track for the first row.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/grid-track.png) **Figure 3**. A grid track for the first row.

### Grid cell

A grid cell is the intersection of a row and column track.
![A grid cell that is an intersection of the second row and the second column.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/grid-cell.png) **Figure 4**. A grid cell that is an intersection of the second row and the second column.

### Grid area

A grid area consists of several grid cells.
You can define a grid area by making an item span multiple tracks.
![A grid area that consists of four grid cells.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/grid-area.png) **Figure 5**. A grid area that consists of four grid cells.

### Grid gap

A grid gap is the gutter between grid tracks.
You can't place a UI element into a gap,
but you can span a UI element across it.
![A grid gap between the first column and the second column.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/grid/grid-gap.png) **Figure 6**. A grid gap between the first column and the second column.