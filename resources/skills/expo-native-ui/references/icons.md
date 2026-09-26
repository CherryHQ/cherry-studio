# Icons (SF Symbols)

Use SF Symbols on iOS for native feel. SF Symbols are an Apple asset and never render on Android - every icon needs a Material counterpart (see "Android: Material Icons" below). Never use FontAwesome or Ionicons on either platform, and never emoji as icons.

## Basic Usage

```tsx
import { SymbolView } from "expo-symbols";
import { colors } from "@/theme/colors";

<SymbolView
  tintColor={colors.label}
  resizeMode="scaleAspectFit"
  name="square.and.arrow.down"
  style={{ width: 16, height: 16 }}
/>;
```

## Props

```tsx
<SymbolView
  name="star.fill"                    // SF Symbol name (required)
  tintColor={colors.label}            // Icon color
  size={24}                           // Shorthand for width/height
  resizeMode="scaleAspectFit"         // How to scale
  weight="regular"                    // thin | ultraLight | light | regular | medium | semibold | bold | heavy | black
  scale="medium"                      // small | medium | large
  style={{ width: 16, height: 16 }}   // Standard style props
/>
```

## Common Icons

### Navigation & Actions
- `house.fill` - home
- `gear` - settings
- `magnifyingglass` - search
- `plus` - add
- `xmark` - close
- `chevron.left` - back
- `chevron.right` - forward
- `arrow.left` - back arrow
- `arrow.right` - forward arrow

### Media
- `play.fill` - play
- `pause.fill` - pause
- `stop.fill` - stop
- `backward.fill` - rewind
- `forward.fill` - fast forward
- `speaker.wave.2.fill` - volume
- `speaker.slash.fill` - mute

### Camera
- `camera` - camera
- `camera.fill` - camera filled
- `arrow.triangle.2.circlepath` - flip camera
- `photo` - gallery/photos
- `bolt` - flash
- `bolt.slash` - flash off

### Communication
- `message` - message
- `message.fill` - message filled
- `envelope` - email
- `envelope.fill` - email filled
- `phone` - phone
- `phone.fill` - phone filled
- `video` - video call
- `video.fill` - video call filled

### Social
- `heart` - like
- `heart.fill` - liked
- `star` - favorite
- `star.fill` - favorited
- `hand.thumbsup` - thumbs up
- `hand.thumbsdown` - thumbs down
- `person` - profile
- `person.fill` - profile filled
- `person.2` - people
- `person.2.fill` - people filled

### Content Actions
- `square.and.arrow.up` - share
- `square.and.arrow.down` - download
- `doc.on.doc` - copy
- `trash` - delete
- `pencil` - edit
- `folder` - folder
- `folder.fill` - folder filled
- `bookmark` - bookmark
- `bookmark.fill` - bookmarked

### Status & Feedback
- `checkmark` - success/done
- `checkmark.circle.fill` - completed
- `xmark.circle.fill` - error/failed
- `exclamationmark.triangle` - warning
- `info.circle` - info
- `questionmark.circle` - help
- `bell` - notification
- `bell.fill` - notification filled

### Misc
- `ellipsis` - more options
- `ellipsis.circle` - more in circle
- `line.3.horizontal` - menu/hamburger
- `slider.horizontal.3` - filters
- `arrow.clockwise` - refresh
- `location` - location
- `location.fill` - location filled
- `map` - map
- `mappin` - pin
- `clock` - time
- `calendar` - calendar
- `link` - link
- `nosign` - block/prohibited

## Animated Symbols

```tsx
<SymbolView
  name="checkmark.circle"
  animationSpec={{
    effect: {
      type: "bounce",
      direction: "up",
    },
  }}
/>
```

### Animation Effects

- `bounce` - Bouncy animation
- `pulse` - Pulsing effect
- `variableColor` - Color cycling
- `scale` - Scale animation

```tsx
// Bounce with direction
animationSpec={{
  effect: { type: "bounce", direction: "up" }  // up | down
}}

// Pulse
animationSpec={{
  effect: { type: "pulse" }
}}

// Variable color (multicolor symbols)
animationSpec={{
  effect: {
    type: "variableColor",
    cumulative: true,
    reversing: true
  }
}}
```

## Symbol Weights

```tsx
// Lighter weights
<SymbolView name="star" weight="ultraLight" />
<SymbolView name="star" weight="thin" />
<SymbolView name="star" weight="light" />

// Default
<SymbolView name="star" weight="regular" />

// Heavier weights
<SymbolView name="star" weight="medium" />
<SymbolView name="star" weight="semibold" />
<SymbolView name="star" weight="bold" />
<SymbolView name="star" weight="heavy" />
<SymbolView name="star" weight="black" />
```

## Symbol Scales

```tsx
<SymbolView name="star" scale="small" />
<SymbolView name="star" scale="medium" />  // default
<SymbolView name="star" scale="large" />
```

## Multicolor Symbols

Some symbols support multiple colors:

```tsx
<SymbolView
  name="cloud.sun.rain.fill"
  type="multicolor"
/>
```

## Android: Material Icons

On Android an SF Symbol source renders nothing - an app that ships SF-only iconography ships blank icons. Give every icon a Material source:

- **Tab bars**: pass `md` (Material Symbol name) beside `sf` on NativeTabs triggers - `<NativeTabs.Trigger.Icon sf="gear" md="settings" />` (SDK 55+, see the `expo-router` skill).
- **In screens**: `@expo/vector-icons` Material families, gated by platform:

```tsx
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

process.env.EXPO_OS === "ios" ? (
  <SymbolView name="gear" tintColor={colors.label} style={{ width: 24, height: 24 }} />
) : (
  <MaterialIcons name="settings" size={24} color={colors.label} />
);
```

One icon family per platform - never a mixed set, never SF names on Android or Material glyphs on iOS.

## Finding Symbol Names

1. Use the SF Symbols app on macOS (free from Apple)
2. Search at https://developer.apple.com/sf-symbols/
3. Symbol names use dot notation: `square.and.arrow.up`

## Best Practices

- On iOS, always use SF Symbols over vector icon libraries; on Android, use Material icons (see above)
- Match symbol weight to nearby text weight
- Use `.fill` variants for selected/active states
- Use the cross-platform `colors` helper (see SKILL.md "Colors") for tint to support dark mode
- Keep icons at consistent sizes (16, 20, 24, 32)
