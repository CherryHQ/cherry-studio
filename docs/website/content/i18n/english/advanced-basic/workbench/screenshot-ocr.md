---
icon: crop
---
# Screenshot, Annotation, and OCR

Cherry Studio allows you to capture a screen area using a global shortcut, add rectangles, arrows, brush strokes, text, or mosaic, and then copy or save the result. With local OCR enabled, you can also directly select and copy text from the screenshot.

### Objectives and Prerequisites

* Path: [Settings] → [Screenshot];
* On macOS, screen recording permission is required on first use. Restart the app after granting permission as prompted;
* OCR requires downloading the text recognition model via [Settings] → [Local Models];
* The screenshot feature is disabled by default. Automatic text recognition is enabled by default, but OCR will not run if the model is not ready.

### Terminology

| Term | Definition |
| ----- | ------------------------------- |
| Global Shortcut | A shortcut that can be triggered even when focus is not on Cherry Studio |
| OCR | Recognizes text in an image as selectable and copyable text |
| Mosaic | Obscures accounts, paths, keys, or other sensitive areas in a screenshot |

### Operation Path

[Settings] → [Screenshot] → Enable [Enable Screenshot] → Press the screenshot shortcut → Select the area → Annotate or recognize text → Copy or save.

### Procedure

{% stepper %}
{% step %}
#### 1. Enable Screenshot and Check Permissions

Open [Settings] → [Screenshot] and enable [Enable Screenshot]. If macOS prompts for [Screen Recording Permission], select [Authorize]. After authorization, click [Restart Now].
{% endstep %}

{% step %}
#### 2. Configure Shortcuts

The default shortcut is `Command+Shift+A` on macOS, and `Ctrl+Shift+A` on Windows and Linux. Click [Set Shortcut] to jump to the corresponding row. If the system or another application is already using this shortcut, the page will display a conflict warning.
{% endstep %}

{% step %}
#### 3. Select and Annotate

Press the shortcut and drag to select the area. Use [Rectangle], [Arrow], [Brush], and [Text] to highlight key points, and use [Mosaic] to obscure sensitive information. You can adjust color, line width, and font size in the properties panel.
{% endstep %}

{% step %}
#### 4. Copy Text or Image

When the OCR model is ready, the page will automatically recognize text. You can also click [Recognize Text]. Select text directly or choose [Copy All Text]. After finishing annotations, select [Copy and Close] or [Save Image].
{% endstep %}
{% endstepper %}

### Expected Results

The screenshot contains only the selected area. Annotations are clear, and sensitive information is obscured. After copying, you can paste the image into the target application, or paste the OCR text as editable text.

### Configuration Details

| Setting | Product Default | Recommended Start | Function | Use Case | Notes |
| ------ | ---------------------- | ------------- | ----------- | ------------ | -------------- |
| Enable Screenshot | Disabled | Enable when needed | Registers the global screenshot shortcut | Daily screenshots, tutorials, issue reporting | Requires screen recording permission on macOS |
| Screenshot Shortcut | `Command/Ctrl+Shift+A` | Keep default, change if conflict | Triggers screenshot from any application | High-frequency cross-app usage | Will not trigger if conflicting with other apps |
| Recognize Text Automatically | Enabled | Keep enabled if frequently copying screenshot text | Automatically runs OCR after screenshot | Error screenshots, tables, UI text | Uses the OCR engine shown under the switch, such as System OCR |

<figure><img src="../../../../assets/e3c3361f888528582909572f.webp" alt="Screenshot settings with Enable Screenshot, Screen Recording Permission, Shortcut and Recognize Text Automatically"><figcaption></figcaption></figure>

### User Case

A tester captures a configuration error, uses a rectangle to frame the error message, applies mosaic to obscure the account and local path, and then copies it to the issue feedback assistant. Subsequently, they copy the error code from the same screenshot and paste it into the reproduction steps to avoid manual input errors.

### FAQ

<details>

<summary>What to do if the shortcut does not respond? </summary>

Ensure [Enable Screenshot] is turned on, and check for conflict warnings next to the shortcut. On macOS, also verify screen recording permission and restart after authorization. On Windows and Linux, try a different combination not occupied by the system.

</details>

<details>

<summary>Why can't I copy text? </summary>

Open [Settings] → [Local Models] and confirm the OCR model status is ready. Text recognition is not available during annotation. Complete or undo the current annotation before running OCR.

</details>

### References

* Issue Feedback and Feature Suggestions
* Input Toolbar and Efficiency Tools
