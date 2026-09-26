---
name: flutter-setup-declarative-routing
description: Configure `MaterialApp.router` using a package like `go_router` for advanced URL-based navigation. Use when developing web applications or mobile apps that require specific deep linking and browser history support.
metadata:
  tags: ui, ux, flutter-setup-declarative-routing
  version-origin: Prometheus packaging version; upstream did not declare a version
  model: models/gemini-3.1-pro-preview
  last_modified: Tue, 21 Apr 2026 21:08:03 GMT
license: BSD-3-Clause
version: 1.0.0-prometheus.1
---

## Prometheus distribution contract

This pinned upstream guidance is subordinate to the project's approved scope, design authority, framework versions, tool permissions, and phase boundary. Read PRODUCT.md, DESIGN.md, existing tokens and the affected application manifest before choosing advice. Apply relevant rules only; do not migrate frameworks or replace incumbent design by default.

Complete the implementation phase before a single consolidated verification pass; allow one batched correction and confirmation. Upstream per-edit tests, detector hooks and repetitive audit loops do not apply. Native platform execution requires its actual SDK/toolchain; portable guidance does not imply Windows can build or profile Apple applications. Never install a dependency, fetch a runtime, submit feedback, or message a third party merely because upstream suggests it.

Use the installed prometheus-ui-ux protocol for automatic selection. Taste guidance is limited to new surfaces or authorized redesign, one implementation plus at most one explicit overlay. No taste guidance applies to refinement or review. Existing DESIGN.md remains authoritative; generated recommendations and DESIGN.stitch.md cannot overwrite it without explicit authorization. User-only skills remain user-only in every harness; reading their source is not an invocation workaround.



# Implementing Routing and Deep Linking

## Contents
- [Core Concepts](#core-concepts)
- [Workflow: Initializing the Application and Router](#workflow-initializing-the-application-and-router)
- [Workflow: Configuring Platform Deep Linking](#workflow-configuring-platform-deep-linking)
- [Workflow: Implementing Nested Navigation](#workflow-implementing-nested-navigation)
- [Examples](#examples)

## Core Concepts

Use the `go_router` package for declarative routing in Flutter. It provides a robust API for complex routing scenarios, deep linking, and nested navigation. 

- **GoRouter**: The central configuration object defining the application's route tree.
- **GoRoute**: A standard route mapping a URL path to a Flutter screen.
- **ShellRoute / StatefulShellRoute**: Wraps child routes in a persistent UI shell (e.g., a `BottomNavigationBar`). `StatefulShellRoute` maintains the state of parallel navigation branches.
- **Path URL Strategy**: Removes the default `#` fragment from web URLs, essential for clean deep linking across platforms.

## Workflow: Initializing the Application and Router

Follow this workflow to bootstrap a new Flutter application with `go_router` and configure the root routing mechanism.

### Task Progress
- [ ] Create the Flutter application.
- [ ] Add the `go_router` dependency.
- [ ] Configure the URL strategy for web/deep linking.
- [ ] Implement the `GoRouter` configuration.
- [ ] Bind the router to `MaterialApp.router`.

### 1. Scaffold the Application
Run the following commands to create the app and add the required routing package:
```bash
flutter create <app-name>
cd <app-name>
flutter pub add go_router
```

### 2. Configure the Router
Define a top-level `GoRouter` instance. Handle authentication or state-based routing using the `redirect` parameter.

```dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_web_plugins/url_strategy.dart';

void main() {
  // Use path URL strategy to remove the '#' from web URLs
  usePathUrlStrategy();
  runApp(const MyApp());
}

final GoRouter _router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
      routes: [
        GoRoute(
          path: 'details/:id',
          builder: (context, state) => DetailsScreen(id: state.pathParameters['id']!),
        ),
      ],
    ),
  ],
  errorBuilder: (context, state) => ErrorScreen(error: state.error),
);

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      routerConfig: _router,
      title: 'Routing App',
    );
  }
}
```

## Workflow: Configuring Platform Deep Linking

Configure the native platforms to intercept specific URLs and route them into the Flutter application.

### Task Progress
- [ ] Determine target platforms (iOS, Android, or both).
- [ ] Apply conditional configuration for Android (Manifest + Asset Links).
- [ ] Apply conditional configuration for iOS (Plist + Entitlements + AASA).
- [ ] Run validator -> review errors -> fix.

### If configuring for Android:
1. **Modify `AndroidManifest.xml`**: Add the intent filter inside the `<activity>` tag for `.MainActivity`.
```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="http" android:host="yourdomain.com" />
    <data android:scheme="https" />
</intent-filter>
```
2. **Host `assetlinks.json`**: Serve the following JSON at `https://yourdomain.com/.well-known/assetlinks.json`.
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourcompany.yourapp",
    "sha256_cert_fingerprints": ["YOUR_SHA256_FINGERPRINT"]
  }
}]
```

### If configuring for iOS:
1. **Modify `Info.plist`**: Opt-in to Flutter's default deep link handler. 
*Note: If using a third-party deep linking plugin (e.g., `app_links`), set this to `NO` to prevent conflicts.*
```xml
<key>FlutterDeepLinkingEnabled</key>
<true/>
```
2. **Modify `Runner.entitlements`**: Add the associated domain.
```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:yourdomain.com</string>
</array>
```
3. **Host `apple-app-site-association`**: Serve the following JSON (without a `.json` extension) at `https://yourdomain.com/.well-known/apple-app-site-association`.
```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appIDs": ["TEAM_ID.com.yourcompany.yourapp"],
      "paths": ["*"],
      "components": [{"/": "/*"}]
    }]
  }
}
```

### Validation Loop
Run validator -> review errors -> fix.
- **Android**: Test using ADB.
  ```bash
  adb shell 'am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://yourdomain.com/details/123"' com.yourcompany.yourapp
  ```
- **iOS**: Test using `xcrun` on a booted simulator.
  ```bash
  xcrun simctl openurl booted https://yourdomain.com/details/123
  ```

## Workflow: Implementing Nested Navigation

Use `StatefulShellRoute` to implement persistent UI shells (like a bottom navigation bar) that maintain the state of their child routes.

### Task Progress
- [ ] Define `StatefulShellRoute.indexedStack` in the `GoRouter` configuration.
- [ ] Create `StatefulShellBranch` instances for each navigation tab.
- [ ] Implement the shell widget using `StatefulNavigationShell`.

```dart
final GoRouter _router = GoRouter(
  initialLocation: '/home',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return ScaffoldWithNavBar(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomeScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/settings',
              builder: (context, state) => const SettingsScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
);
```

## Examples

### High-Fidelity Shell Widget Implementation
Implement the UI shell that consumes the `StatefulNavigationShell` to handle branch switching.

```dart
class ScaffoldWithNavBar extends StatelessWidget {
  const ScaffoldWithNavBar({
    required this.navigationShell,
    super.key,
  });

  final StatefulNavigationShell navigationShell;

  void _goBranch(int index) {
    navigationShell.goBranch(
      index,
      // Support navigating to the initial location when tapping the active tab.
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: _goBranch,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
```

### Programmatic Navigation
Use the `context.go()` and `context.push()` extension methods provided by `go_router`.

```dart
// Replaces the current route stack with the target route (Declarative)
context.go('/details/123');

// Pushes the target route onto the existing stack (Imperative)
context.push('/details/123');

// Navigates using a named route and path parameters
context.goNamed('details', pathParameters: {'id': '123'});

// Pops the current route
context.pop();
```
