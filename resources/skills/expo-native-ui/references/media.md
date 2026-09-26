# Media

## Camera

- Hide navigation headers when there's a full screen camera
- Ensure to flip the camera with `mirror` to emulate social apps
- Use liquid glass buttons on cameras
- Icons: `arrow.triangle.2.circlepath` (flip), `photo` (gallery), `bolt` (flash)
- Gate the camera behind an explanation screen with a Grant button (as below) — never fire the permission prompt on mount
- Lazily request media library permission (at first save/pick)

The example uses the `GlassButton` helper defined in `visual-effects.md` (Glass Buttons section).

```tsx
import React, { useRef, useState } from "react";
import { View, Pressable, Text } from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { colors } from "@/theme/colors";
import { GlassView } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function Camera({ onPicture }: { onPicture: (uri: string) => Promise<void> }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [type, setType] = useState<CameraType>("back");
  const { bottom } = useSafeAreaInsets();

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.systemBackground }}>
        <Text style={{ color: colors.label, padding: 16 }}>Camera access is required</Text>
        <GlassView isInteractive tintColor={colors.systemBlue} style={{ borderRadius: 12 }}>
          <Pressable onPress={requestPermission} style={{ padding: 12, borderRadius: 12 }}>
            <Text style={{ color: "white" }}>Grant Permission</Text>
          </Pressable>
        </GlassView>
      </View>
    );
  }

  const takePhoto = async () => {
    await Haptics.selectionAsync();
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    await onPicture(photo.uri);
  };

  const selectPhoto = async () => {
    await Haptics.selectionAsync();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      await onPicture(result.assets[0].uri);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView ref={cameraRef} mirror style={{ flex: 1 }} facing={type} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: bottom, gap: 16, alignItems: "center" }}>
        <GlassView isInteractive style={{ padding: 8, borderRadius: 99 }}>
          <Pressable onPress={takePhoto} style={{ width: 64, height: 64, borderRadius: 99, backgroundColor: "white" }} />
        </GlassView>
        <View style={{ flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 8 }}>
          <GlassButton onPress={selectPhoto} icon="photo" />
          <GlassButton onPress={() => setType(t => t === "back" ? "front" : "back")} icon="arrow.triangle.2.circlepath" />
        </View>
      </View>
    </View>
  );
}
```

## Audio Playback

Use `expo-audio` not `expo-av`:

```tsx
import { useAudioPlayer } from 'expo-audio';

const player = useAudioPlayer({ uri: 'https://stream.nightride.fm/rektory.mp3' });

<Button title="Play" onPress={() => player.play()} />
```

## Audio Recording (Microphone)

```tsx
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorderState,
} from 'expo-audio';
import { Alert, Button } from 'react-native';

function App() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  // Request the microphone on first record, not on mount — no prompt before user intent
  const record = async () => {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      Alert.alert('Permission to access microphone was denied');
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
  };

  const stop = () => audioRecorder.stop();

  return (
    <Button
      title={recorderState.isRecording ? 'Stop' : 'Start'}
      onPress={recorderState.isRecording ? stop : record}
    />
  );
}
```

## Video Playback

Use `expo-video` not `expo-av`:

```tsx
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';

const videoSource = 'https://example.com/video.mp4';

const player = useVideoPlayer(videoSource, player => {
  player.loop = true;
  player.play();
});

const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

<VideoView player={player} fullscreenOptions={{}} allowsPictureInPicture />
```

VideoView options:
- `allowsPictureInPicture`: boolean
- `contentFit`: 'contain' | 'cover' | 'fill'
- `nativeControls`: boolean
- `playsInline`: boolean
- `startsPictureInPictureAutomatically`: boolean

## Saving Media

```tsx
import * as MediaLibrary from "expo-media-library";

const { granted } = await MediaLibrary.requestPermissionsAsync();
if (granted) {
  await MediaLibrary.saveToLibraryAsync(uri);
}
```

### Saving Base64 Images

`MediaLibrary.saveToLibraryAsync` only accepts local file paths. Save base64 strings to disk first:

```tsx
import { File, Paths } from "expo-file-system/next";

function base64ToLocalUri(base64: string, filename?: string) {
  if (!filename) {
    const match = base64.match(/^data:(image\/[a-zA-Z]+);base64,/);
    const ext = match ? match[1].split("/")[1] : "jpg";
    filename = `generated-${Date.now()}.${ext}`;
  }

  if (base64.startsWith("data:")) base64 = base64.split(",")[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

  const f = new File(Paths.cache, filename);
  f.create({ overwrite: true });
  f.write(bytes);
  return f.uri;
}
```
