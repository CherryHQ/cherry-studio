# Material List-Detail Recipe

This recipe demonstrates how to create an adaptive list-detail layout using the `ListDetailSceneStrategy` from the Material 3 Adaptive library. This layout automatically adjusts to show one, two, or three panes depending on the available screen width.

## How it works

This example has three destinations: `ConversationList`, `ConversationDetail`, and `Profile`.

### `ListDetailSceneStrategy`

The key to this recipe is the `rememberListDetailSceneStrategy`, which provides the logic for the adaptive layout.

- **Pane Roles**: Each destination is assigned a role using metadata:

  - `ListDetailSceneStrategy.listPane()`: For the primary (list) content. This pane is always visible. A placeholder can be provided to be shown in the detail pane area when no detail content is selected.
  - `ListDetailSceneStrategy.detailPane()`: For the secondary (detail) content.
  - `ListDetailSceneStrategy.extraPane()`: For tertiary content.
- **Adaptive Layout** : The `ListDetailSceneStrategy` automatically handles the layout. On smaller screens, only one pane is shown at a time. On wider screens, it will show the list and detail panes side-by-side. On very wide screens, it can show all three panes: list, detail, and extra.

- **Navigation** : Navigation between the panes is handled by adding and removing destinations from the back stack as usual. The `ListDetailSceneStrategy` observes the back stack and adjusts the layout accordingly.

[![](https://developer.android.com/static/images/picto-icons/code.svg) Explore View the full recipe on GitHub.](https://github.com/android/nav3-recipes/tree/main/app/src/main/java/com/example/nav3recipes/material/listdetail)

```
package com.example.nav3recipes.material.listdetail

/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import com.example.nav3recipes.content.ContentBlue
import com.example.nav3recipes.content.ContentGreen
import com.example.nav3recipes.content.ContentRed
import com.example.nav3recipes.content.ContentYellow
import com.example.nav3recipes.ui.setEdgeToEdgeConfig
import kotlinx.serialization.Serializable

@Serializable
private object ConversationList : NavKey

@Serializable
private data class ConversationDetail(val id: String) : NavKey

@Serializable
private data object Profile : NavKey

class MaterialListDetailActivity : ComponentActivity() {

    @OptIn(ExperimentalMaterial3AdaptiveApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        setEdgeToEdgeConfig()
        super.onCreate(savedInstanceState)

        setContent {

            val backStack = rememberNavBackStack(ConversationList)

            // Override the defaults so that there isn't a horizontal space between the panes.
            // See b/418201867
            val windowAdaptiveInfo = currentWindowAdaptiveInfoV2()
            val directive = remember(windowAdaptiveInfo) {
                calculatePaneScaffoldDirective(windowAdaptiveInfo)
                    .copy(horizontalPartitionSpacerSize = 0.dp)
            }
            val listDetailStrategy = rememberListDetailSceneStrategy<NavKey>(directive = directive)

            NavDisplay(
                backStack = backStack,
                onBack = { backStack.removeLastOrNull() },
                sceneStrategies = listOf(listDetailStrategy),
                entryProvider = entryProvider {
                    entry<ConversationList>(
                        metadata = ListDetailSceneStrategy.listPane(
                            detailPlaceholder = {
                                ContentYellow("Choose a conversation from the list")
                            }
                        )
                    ) {
                        ContentRed("Welcome to Nav3") {
                            Button(onClick = dropUnlessResumed {
                                backStack.add(ConversationDetail("ABC"))
                            }) {
                                Text("View conversation")
                            }
                        }
                    }
                    entry<ConversationDetail>(
                        metadata = ListDetailSceneStrategy.detailPane()
                    ) { conversation ->
                        ContentBlue("Conversation ${conversation.id} ") {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Button(onClick = dropUnlessResumed {
                                    backStack.add(Profile)
                                }) {
                                    Text("View profile")
                                }
                            }
                        }
                    }
                    entry<Profile>(
                        metadata = ListDetailSceneStrategy.extraPane()
                    ) {
                        ContentGreen("Profile")
                    }
                }
            )
        }
    }
}
```