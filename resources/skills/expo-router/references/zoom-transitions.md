# Apple Zoom Transitions

Fluid zoom transitions for navigating between screens. iOS 18+, Expo SDK 55+, Stack navigator only.

```tsx
import { Link } from "expo-router";
```

## Basic Zoom

Use `withAppleZoom` on `Link.Trigger` to zoom the entire trigger element into the destination screen:

```tsx
<Link href="/photo" asChild>
  <Link.Trigger withAppleZoom>
    <Pressable>
      <Image
        source={{ uri: "https://example.com/thumb.jpg" }}
        style={{ width: 120, height: 120, borderRadius: 12 }}
      />
    </Pressable>
  </Link.Trigger>
</Link>
```

## Targeted Zoom with `Link.AppleZoom`

Wrap only the element that should animate. Siblings outside `Link.AppleZoom` are not part of the transition:

```tsx
<Link href="/photo" asChild>
  <Link.Trigger>
    <Pressable style={{ alignItems: "center" }}>
      <Link.AppleZoom>
        <Image
          source={{ uri: "https://example.com/thumb.jpg" }}
          style={{ width: 200, aspectRatio: 4 / 3 }}
        />
      </Link.AppleZoom>
      <Text>Caption text (not zoomed)</Text>
    </Pressable>
  </Link.Trigger>
</Link>
```

`Link.AppleZoom` accepts only a single child element.

## Destination Target

Use `Link.AppleZoomTarget` on the destination screen to align the zoom animation to a specific element:

```tsx
// Destination screen (e.g., app/photo.tsx)
import { Link } from "expo-router";

export default function PhotoScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Link.AppleZoomTarget>
        <Image
          source={{ uri: "https://example.com/full.jpg" }}
          style={{ width: "100%", aspectRatio: 4 / 3 }}
        />
      </Link.AppleZoomTarget>
      <Text>Photo details below</Text>
    </View>
  );
}
```

Without a target, the zoom animates to fill the entire destination screen.

## Custom Alignment Rectangle

For manual control over where the zoom lands on the destination, use `alignmentRect` instead of `Link.AppleZoomTarget`:

```tsx
<Link.AppleZoom alignmentRect={{ x: 0, y: 0, width: 200, height: 300 }}>
  <Image source={{ uri: "https://example.com/thumb.jpg" }} />
</Link.AppleZoom>
```

Coordinates are in the destination screen's coordinate space. Prefer `Link.AppleZoomTarget` when possible — use `alignmentRect` only when the target element isn't available as a React component.

## Controlling Dismissal

Zoom screens support interactive dismissal gestures by default (pinch, swipe down when scrolled to top, swipe from leading edge). Use `usePreventZoomTransitionDismissal` on the destination screen to control this.

### Disable all dismissal gestures

```tsx
import { usePreventZoomTransitionDismissal } from "expo-router";

export default function PhotoScreen() {
  usePreventZoomTransitionDismissal();
  return <Image source={{ uri: "https://example.com/full.jpg" }} />;
}
```

### Restrict dismissal to a specific area

Use `unstable_dismissalBoundsRect` to prevent conflicts with scrollable content:

```tsx
usePreventZoomTransitionDismissal({
  unstable_dismissalBoundsRect: {
    minX: 0,
    minY: 0,
    maxX: 300,
    maxY: 300,
  },
});
```

This is useful when the destination contains a zoomable scroll view — the system gives that scroll view precedence over the dismiss gesture.

## Combining with Link.Preview

Zoom transitions work alongside long-press previews:

```tsx
<Link href="/photo" asChild>
  <Link.Trigger withAppleZoom>
    <Pressable>
      <Image
        source={{ uri: "https://example.com/thumb.jpg" }}
        style={{ width: 120, height: 120 }}
      />
    </Pressable>
  </Link.Trigger>
  <Link.Preview />
</Link>
```

## Best Practices

**Good use cases:**
- Thumbnail → full image (gallery, profile photos)
- Card → detail screen with similar visual content
- Source and destination with similar aspect ratios

**Avoid:**
- Skinny full-width list rows as zoom sources — the transition looks unnatural
- Mismatched aspect ratios between source and destination without `alignmentRect`
- Using zoom with sheets or popovers — only works in Stack navigator
- Hiding the navigation bar — known issues with header visibility during transitions

**Tips:**
- Always provide a close or back button — dismissal gestures are not discoverable
- If the destination has a zoomable scroll view, use `unstable_dismissalBoundsRect` to avoid gesture conflicts
- Source view doesn't need to match the tap target — only the `Link.AppleZoom` wrapped element animates
- When source is unavailable (e.g., scrolled off screen), the transition zooms from the center of the screen

## References

- Expo Router Zoom Transitions: https://docs.expo.dev/router/advanced/zoom-transition/
- Link.AppleZoom API: https://docs.expo.dev/versions/v55.0.0/sdk/router/#linkapplezoom
- Apple UIKit Fluid Transitions: https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions
