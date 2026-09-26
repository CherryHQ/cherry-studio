To configure the behavior of the `FlexBox` container, create a `FlexBoxConfig`
block and supply it using the `config` parameter.


```kotlin
FlexBox(
    config = {
        direction(FlexDirection.Column)
        wrap(FlexWrap.Wrap)
        alignItems(FlexAlignItems.Center)
        alignContent(FlexAlignContent.SpaceAround)
        justifyContent(FlexJustifyContent.Center)
        gap(16.dp)
    }
) { // child items
}
```

<br />

Use `FlexBoxConfig` to define the layout direction, wrapping behavior,
alignment, and gaps between items.

## Layout direction

The `direction` function sets the main axis, which dictates the direction
items are laid out in. It accepts the following values:

- `Row` (default): Sets the main axis to be horizontal. In left-to-right locales this will be left-to-right, with the opposite in right-to-left.
- `RowReverse`: Reverses the direction of `Row`.
- `Column`: Sets the main axis to be vertical, top-to-bottom.
- `ColumnReverse`: Reverses the direction of `Column`.

## Align items and distribute extra space

The following sections describe how to align items and distribute extra space
along the main and cross axes.

### Along the main axis

Use `justifyContent` to distribute items along the main axis. The following
table shows the behavior when the direction is `Row`.

|---|---|
|   | ![Illustration of a horizontal main axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/main-axis.png) |
| `Start` | ![Items aligned to the start of the main axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/mainaxis-start.png) |
| `Center` | ![Items aligned to the center of the main axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/mainaxis-center.png) |
| `End` | ![Items aligned to the end of the main axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/mainaxis-end.png) |
| `SpaceBetween` | ![Items distributed along the main axis with space between them.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/mainaxis-spacebetween.png) |
| `SpaceAround` | ![Items distributed along the main axis with space around them.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/mainaxis-spacearound.png) |
| `SpaceEvenly` | ![Items distributed along the main axis with space evenly around them.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/mainaxis-spaceevenly.png) |

### Along the cross axis

Use `alignItems` to align items along the cross axis within a single line. This
behavior can be overridden by individual items using the
[`alignSelf` modifier](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/item-behavior#item-alignment).

The following images show the behavior when the direction is `Row`:

|---|---|---|---|---|---|
| ![Illustration of a vertical cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis.png) | ![Items aligned to the start of the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis-start.png) | ![Items aligned to the end of the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis-end.png) | ![Items aligned to the center of the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis-center.png) | ![Items stretched to fill the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis-stretch.png) | ![Items aligned to their baseline along the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis-baseline.png) |
|   | `Start` | `End` | `Center` | `Stretch` | `Baseline` |

Use `alignContent` to align lines to the cross axis and to distribute extra
space between lines. This property only applies when there are multiple lines
(wrapping is enabled). The following images show the behavior when the direction
is `Row`:

|---|---|---|---|---|---|---|
| ![Illustration of a vertical cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/crossaxis.png) | ![Multiple lines of items aligned to the start of the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/aligncontent-start.png) | ![Multiple lines of items aligned to the end of the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/aligncontent-end.png) | ![Multiple lines of items aligned to the center of the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/aligncontent-center.png) | ![Multiple lines of items stretched to fill the cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/aligncontent-stretch.png) | ![Multiple lines of items distributed along the cross axis with space between them.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/aligncontent-spacebetween.png) | ![Multiple lines of items distributed along the cross axis with space around them.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/aligncontent-spacearound.png) |
|   | `Start` | `End` | `Center` | `Stretch` | `SpaceBetween` | `SpaceAround` |

## Wrap items

Wrapping lets a `FlexBox` container become multi-line, moving items that don't
fit onto a new row or column along the cross-axis. Configure wrapping behavior
using `wrap`.

|---|---|
| **`FlexWrap` value** | **Example using direction `Row`** |
| `NoWrap` (default): Prevents items from wrapping. Items overflow if the main size is insufficient. | ![Items in a single line overflowing the container because wrapping is disabled.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/wrapitems-1.png) |
| `Wrap`: When there is insufficient space for an item (plus any [gap](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/container-behavior#add-gaps)), a new line is created in the direction of the cross axis. For example, if the direction is `Row`, a new line is added **below**. | ![Items wrapping onto a new line below because wrapping is enabled.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/wrapitems-2.png) |
| `WrapReverse`: The same as `Wrap`, except the new line is added in the opposite direction to the cross axis. For example, if the direction is `Row`, a new line is added **above**. | ![Items wrapping onto a new line above because reverse wrapping is enabled.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/wrapitems-3.png) |

The following example shows how the `FlexBox` wrapping algorithm works. The
`FlexBox` container has a main size of `100dp`, with `wrap` set to
`FlexWrap.Wrap` and a gap of `8dp`. It contains three items with `basis` `20dp`,
`40dp`, and `50dp`, respectively.

There is `100dp` available space in the line. Child 1 is `20dp`.
There is space, so Child 1 is placed into the line.
![First item placed in the FlexBox container.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/algorithm-1.png) **Figure 1.** First item placed in the `FlexBox` container.

There is `80dp` available space in the line. The gap is `8dp`. Child 2 is
`40dp`. The required space is `48dp`. There is space, so the gap and Child 2
are placed into the line.
![Second item placed in the FlexBox container after the first item.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/algorithm-2.png) **Figure 2.** Second item placed in the `FlexBox` container after the first item.

There is `32dp` available space in the line. The gap is `8dp`. Child 3 is
`50dp`. The required space is `58dp`. There is not enough space in the current
line, so Child 3 is placed in a new line.
![Third item placed on a new line because it doesn't fit on the first line.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/algorithm-3.png) **Figure 3.** Third item placed on a new line because it doesn't fit on the first line.

## Add gaps between items

Add gaps between rows and columns using `rowGap` and `columnGap`. This is useful
to avoid adding spacing modifiers to children.

|---|---|---|
| ![Row gap adds vertical space between items.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/gap-1.png) | ![Column gap adds horizontal space between items.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/gap-2.png) | ![Gap adds both horizontal and vertical space between items.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/gap-3.png) |
| `rowGap` adds vertical space between items and lines. | `columnGap` adds horizontal space between items and lines. | `gap` is a convenience function that adds both `columnGap` and `rowGap`. |