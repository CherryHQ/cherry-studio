> [!NOTE]
> **Note:** FlexBox is an experimental API and is likely to change in the future. To use it, annotate your code with `@ExperimentalFlexBoxApi`. Please file any issues or feedback on the [issue tracker](https://issuetracker.google.com/issues/new?component=1876021&title=%5BFlexBox%5D).

[`FlexBox`](https://developer.android.com/reference/kotlin/androidx/compose/foundation/layout/FlexBox.composable#FlexBox(androidx.compose.ui.Modifier,androidx.compose.foundation.layout.FlexBoxConfig,kotlin.Function1)) is a container that lays out items in a single direction. It can
resize, wrap, align, and distribute space among items to optimally fill the
available space. It's a useful layout for different sized items and for resizing
items when the available space changes.

With `FlexBox`, you can:

- Control how items grow and shrink to fill the available space
- Wrap items onto new rows or columns when there isn't enough space for them
- Distribute extra space between items using convenient presets

## When to use FlexBox

`FlexBox` is usually used to display a small number of items *within* an
overall screen layout. For an overall screen layout,
`Grid` is usually a better choice. `FlexBox` does not support lazy-loading of
items. To display large numbers of items, use [lazy lists and grids](https://developer.android.com/develop/ui/compose/lists). If you
need to wrap items, use `FlexBox` instead of `FlowRow` and `FlowColumn`.

## Terminology and concepts

> [!IMPORTANT]
> **Key Point:** `FlexBox` is heavily influenced by the [CSS Flexible Box Layout specification](https://www.w3.org/TR/css-flexbox-1/) and has almost identical concepts, terminology, and behavior. If you're familiar with `display: flex`, you'll find `FlexBox`'s properties and behavior almost identical.

`FlexBox` lays out its items in either horizontal or vertical *lines* . This
direction of these lines establishes the *main axis* . 90 degrees to the main
axis is the *cross axis* . The length of the `FlexBox` along the main axis is
known as the *main size* . The corresponding cross axis length is known as the
*cross size* . These sizes and axes form the basis of `FlexBox`'s behavior.


![FlexBox with horizontal main axis and vertical cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/intro-row-2.png) **Figure 1.** Axes and sizes when the `FlexBox` direction is `Row`. ![FlexBox with vertical main axis and horizontal cross axis.](https://developer.android.com/static/develop/ui/compose/images/layouts/adaptive/flexbox/intro-column.png) **Figure 2.** Axes and sizes when the `FlexBox` direction is `Column`.

<br />

### Apply properties

You can apply `FlexBox` properties in two ways:

- To the `FlexBox` container using `FlexBox(config)`
- To an item inside the `FlexBox` using `Modifier.flex`

| **Container properties (`config`**) | **Item properties (`Modifier.flex`**) |
|---|---|
| - `direction` - the item layout direction - `wrap` - whether to wrap items if the **main size** is insufficient - `justifyContent` - how to **distribute** items along the **main axis** - `alignItems` - how to **align** items along the **cross axis** - `alignContent` - how to distribute extra space from the **cross size** when there are multiple lines - `rowGap` / `columnGap` - adds space between items and lines See [Set container behavior](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/container-behavior) for more information about these properties. | - `basis` - the size of the item before any extra space from the **main size** is distributed - `grow` - the share of extra space from the **main size** that this item should receive - `shrink` - the share of space deficit from the **main size** that this item should receive - `alignSelf` - how to distribute extra space from the **cross size** to this item, overrides `alignItems` - `order` - controls the layout order See [Set item behavior](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/item-behavior) for more information about these properties. |

### Understand the `FlexBox` layout algorithm

One of `FlexBox`'s most powerful features is its ability to resize its children
to best fit the space available to it. Understanding how `FlexBox` does this can
help you set `FlexBox` properties to optimize your UI for all possible sizes.

`FlexBox`'s layout algorithm works in the following way:

1. **Calculate child base size** : Use the child's [`basis` value](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/item-behavior#set-initial-size)
   to calculate its initial size along the main axis before any extra space is
   distributed.

2. **Sort the children** : Sort the children by their [`order`](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/item-behavior#item-order) values, if
   present.

3. **Build lines** : For each child, check if its initial size plus
   [`gap`](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/container-behavior#add-gaps) will fit into the remaining space on the current line.
   If so, place this child into the line. If not, place it onto a new line if
   [wrapping is enabled](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/container-behavior#wrap-items), or place the item into the current line
   where it will overflow (it will be partially obscured by the edge of the
   container).

4. **Align or resize items in the main axis** : For each line, distribute extra
   space *to* or between items by [resizing](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/item-behavior#item-size) or
   [aligning](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/container-behavior#main-axis) them.

5. **Align or resize items in the cross axis** : For each line, distribute extra
   space to or between items and lines by [stretching or aligning
   them](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/container-behavior#cross-axis).

Now that you're familiar with `FlexBox` concepts, see [Get started](https://developer.android.com/develop/ui/compose/layouts/adaptive/flexbox/get-started) to
create a basic `FlexBox`.