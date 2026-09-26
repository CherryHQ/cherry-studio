# Native Controls

Native iOS controls provide built-in haptics, accessibility, and platform-appropriate styling.

> **Prefer `@expo/ui` for these controls.** Its `Slider`, `Switch`, `DateTimePicker`, `Menu`, and segmented pickers render as real SwiftUI / Jetpack Compose and follow platform design conventions automatically — recommended over the React Native controls below. See the **`expo-ui`** skill; use the React Native controls below as a fallback when you're not using `@expo/ui`.

## Switch

Use for binary on/off settings. Has built-in haptics.

```tsx
import { Switch } from "react-native";
import { useState } from "react";

const [enabled, setEnabled] = useState(false);

<Switch value={enabled} onValueChange={setEnabled} />;
```

Don't recolor the Switch — native styling adapts to dark mode automatically.

## Segmented Control

Use for non-navigational tabs or mode selection. Avoid changing default colors.

```tsx
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { useState } from "react";

const [index, setIndex] = useState(0);

<SegmentedControl
  values={["All", "Active", "Done"]}
  selectedIndex={index}
  onChange={({ nativeEvent }) => setIndex(nativeEvent.selectedSegmentIndex)}
/>;
```

### Rules

- Maximum 4 options — use a picker for more
- Keep labels short (1-2 words)
- Avoid custom colors — native styling adapts to dark mode

### With Icons (iOS 14+)

```tsx
<SegmentedControl
  values={[
    { label: "List", icon: "list.bullet" },
    { label: "Grid", icon: "square.grid.2x2" },
  ]}
  selectedIndex={index}
  onChange={({ nativeEvent }) => setIndex(nativeEvent.selectedSegmentIndex)}
/>
```

## Slider

Continuous value selection.

```tsx
import Slider from "@react-native-community/slider";
import { useState } from "react";

const [value, setValue] = useState(0.5);

<Slider
  value={value}
  onValueChange={setValue}
  minimumValue={0}
  maximumValue={1}
/>;
```

### Discrete Steps

```tsx
<Slider
  value={value}
  onValueChange={setValue}
  minimumValue={0}
  maximumValue={10}
  step={1}
/>
```

## Date/Time Picker

Compact pickers with popovers. Has built-in haptics.

```tsx
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";

const [date, setDate] = useState(new Date());

<DateTimePicker
  value={date}
  onChange={(event, selectedDate) => {
    if (selectedDate) setDate(selectedDate);
  }}
  mode="datetime"
/>;
```

### Modes

- `date` — Date only
- `time` — Time only
- `datetime` — Date and time

### Display Styles

```tsx
// Compact inline (default)
<DateTimePicker value={date} mode="date" />

// Spinner wheel
<DateTimePicker
  value={date}
  mode="date"
  display="spinner"
  style={{ width: 200, height: 150 }}
/>

// Full calendar
<DateTimePicker value={date} mode="date" display="inline" />
```

### Time Intervals

```tsx
<DateTimePicker
  value={date}
  mode="time"
  minuteInterval={15}
/>
```

### Min/Max Dates

```tsx
<DateTimePicker
  value={date}
  mode="date"
  minimumDate={new Date(2020, 0, 1)}
  maximumDate={new Date(2030, 11, 31)}
/>
```

## TextInput

Native text input with various keyboard types.

```tsx
import { TextInput } from "react-native";
import { colors } from "@/theme/colors";

<TextInput
  placeholder="Enter text..."
  placeholderTextColor={colors.secondaryLabel as string}
  style={{
    padding: 12,
    fontSize: 16,
    borderRadius: 8,
    backgroundColor: colors.secondarySystemBackground,
  }}
/>
```

### Keyboard Types

```tsx
// Email
<TextInput keyboardType="email-address" autoCapitalize="none" />

// Phone
<TextInput keyboardType="phone-pad" />

// Number
<TextInput keyboardType="numeric" />

// Password
<TextInput secureTextEntry />

// Search
<TextInput
  returnKeyType="search"
  enablesReturnKeyAutomatically
/>
```

### Multiline

```tsx
<TextInput
  multiline
  numberOfLines={4}
  textAlignVertical="top"
  style={{ minHeight: 100 }}
/>
```

## Picker (Wheel)

For selection from many options (5+ items).

```tsx
import { Picker } from "@react-native-picker/picker";
import { useState } from "react";

const [selected, setSelected] = useState("js");

<Picker selectedValue={selected} onValueChange={setSelected}>
  <Picker.Item label="JavaScript" value="js" />
  <Picker.Item label="TypeScript" value="ts" />
  <Picker.Item label="Python" value="py" />
  <Picker.Item label="Go" value="go" />
</Picker>;
```

## Best Practices

- **Haptics**: Switch and DateTimePicker have built-in haptics — don't add extra
- **No native Stepper**: React Native has no `Stepper` component — compose increment/decrement from two Buttons or a numeric TextInput
- **Accessibility**: Native controls have proper accessibility labels by default
- **Dark Mode**: Avoid custom colors — native styling adapts automatically
- **Spacing**: Use consistent padding around controls (12-16pt)
- **Labels**: Place labels above or to the left of controls
- **Grouping**: Group related controls in sections with headers
