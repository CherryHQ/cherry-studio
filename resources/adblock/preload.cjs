'use strict';

var electron = require('electron');

/*!
 * Copyright (c) 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const SCRIPT_ID = 'ghostery-adblocker-script';
const IGNORED_TAGS = new Set(['br', 'head', 'link', 'meta', 'script', 'style', 's']);
function debounce(fn, { waitFor, maxWait, }) {
    let delayedTimer;
    let maxWaitTimer;
    const clear = () => {
        clearTimeout(delayedTimer);
        clearTimeout(maxWaitTimer);
        delayedTimer = undefined;
        maxWaitTimer = undefined;
    };
    const run = () => {
        clear();
        fn();
    };
    return [
        () => {
            if (maxWaitTimer === undefined) {
                maxWaitTimer = setTimeout(run, maxWait);
            }
            clearTimeout(delayedTimer);
            delayedTimer = setTimeout(run, waitFor);
        },
        clear,
    ];
}
function isElement(node) {
    // https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType#node_type_constants
    return node.nodeType === 1; // Node.ELEMENT_NODE;
}
function getElementsFromMutations(mutations) {
    // Accumulate all nodes which were updated in `nodes`
    const elements = [];
    for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
            if (isElement(mutation.target)) {
                elements.push(mutation.target);
            }
        }
        else if (mutation.type === 'childList') {
            for (const addedNode of mutation.addedNodes) {
                if (isElement(addedNode) && addedNode.id !== SCRIPT_ID) {
                    elements.push(addedNode);
                }
            }
        }
    }
    return elements;
}
/**
 * WARNING: this function should be self-contained and not rely on any global
 * symbol. That constraint needs to be fulfilled because this function can
 * potentially be injected in content-script (e.g.: see PuppeteerBlocker for
 * more details).
 */
function extractFeaturesFromDOM(roots = [document.documentElement]) {
    // NOTE: This cannot be global as puppeteer needs to be able to serialize this function.
    const ignoredTags = new Set(['br', 'head', 'link', 'meta', 'script', 'style', 's']);
    const classes = new Set();
    const hrefs = new Set();
    const ids = new Set();
    const seenElements = new Set();
    for (const root of roots) {
        for (const element of [
            root,
            ...root.querySelectorAll('[id]:not(html):not(body),[class]:not(html):not(body),[href]:not(html):not(body)'),
        ]) {
            // If one of root belongs to another root which is parent node of the one, querySelectorAll can return duplicates.
            if (seenElements.has(element)) {
                continue;
            }
            seenElements.add(element);
            // Any conditions to filter this element out should be placed under this line:
            if (ignoredTags.has(element.nodeName.toLowerCase())) {
                continue;
            }
            // Update ids
            const id = element.getAttribute('id');
            if (typeof id === 'string') {
                ids.add(id);
            }
            // Update classes
            const classList = element.classList;
            for (const classEntry of classList) {
                classes.add(classEntry);
            }
            // Update href
            const href = element.getAttribute('href');
            if (typeof href === 'string') {
                hrefs.add(href);
            }
        }
    }
    return {
        classes: Array.from(classes),
        hrefs: Array.from(hrefs),
        ids: Array.from(ids),
    };
}
class DOMMonitor {
    constructor(cb) {
        this.cb = cb;
        this.knownIds = new Set();
        this.knownHrefs = new Set();
        this.knownClasses = new Set();
        this.observer = null;
    }
    queryAll(window) {
        this.cb({ type: 'elements', elements: [window.document.documentElement] });
        this.handleUpdatedNodes([window.document.documentElement]);
    }
    start(window) {
        if (this.observer === null && window.MutationObserver !== undefined) {
            const nodes = new Set();
            const handleUpdatedNodesCallback = () => {
                this.handleUpdatedNodes(Array.from(nodes));
                nodes.clear();
            };
            const [debouncedHandleUpdatedNodes, cancelHandleUpdatedNodes] = debounce(handleUpdatedNodesCallback, {
                waitFor: 25,
                maxWait: 1000,
            });
            this.observer = new window.MutationObserver((mutations) => {
                getElementsFromMutations(mutations).forEach(nodes.add, nodes);
                // Set a threshold to prevent websites continuously
                // causing DOM mutations making the set being filled up infinitely.
                if (nodes.size > 512) {
                    cancelHandleUpdatedNodes();
                    handleUpdatedNodesCallback();
                }
                else {
                    debouncedHandleUpdatedNodes();
                }
            });
            this.observer.observe(window.document.documentElement, {
                // Monitor some attributes
                attributes: true,
                attributeFilter: ['class', 'id', 'href'],
                childList: true,
                subtree: true,
            });
        }
    }
    stop() {
        if (this.observer !== null) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
    handleNewFeatures({ hrefs, ids, classes, }) {
        const newIds = [];
        const newClasses = [];
        const newHrefs = [];
        // Update ids
        for (const id of ids) {
            if (this.knownIds.has(id) === false) {
                newIds.push(id);
                this.knownIds.add(id);
            }
        }
        for (const cls of classes) {
            if (this.knownClasses.has(cls) === false) {
                newClasses.push(cls);
                this.knownClasses.add(cls);
            }
        }
        for (const href of hrefs) {
            if (this.knownHrefs.has(href) === false) {
                newHrefs.push(href);
                this.knownHrefs.add(href);
            }
        }
        if (newIds.length !== 0 || newClasses.length !== 0 || newHrefs.length !== 0) {
            this.cb({
                type: 'features',
                classes: newClasses,
                hrefs: newHrefs,
                ids: newIds,
            });
            return true;
        }
        return false;
    }
    handleUpdatedNodes(elements) {
        if (elements.length !== 0) {
            this.cb({
                type: 'elements',
                elements: elements.filter((e) => IGNORED_TAGS.has(e.nodeName.toLowerCase()) === false),
            });
            return this.handleNewFeatures(extractFeaturesFromDOM(elements));
        }
        return false;
    }
}

/*!
 * Copyright (c) 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
function injectCosmeticFilters(data) {
    return electron.ipcRenderer.invoke('@ghostery/adblocker/inject-cosmetic-filters', window.location.href, data);
}
if (window === window.top && window.location.href.startsWith('devtools://') === false) {
    (() => {
        let DOM_MONITOR = null;
        const unload = () => {
            if (DOM_MONITOR !== null) {
                DOM_MONITOR.stop();
                DOM_MONITOR = null;
            }
        };
        injectCosmeticFilters();
        // On DOMContentLoaded, start monitoring the DOM. This means that we will
        // first check which ids and classes exist in the DOM as a one-off operation;
        // this will allow the injection of selectors which have a chance to match.
        // We also register a MutationObserver which will monitor the addition of new
        // classes and ids, and might trigger extra filters on a per-need basis.
        window.addEventListener('DOMContentLoaded', () => {
            DOM_MONITOR = new DOMMonitor((update) => {
                if (update.type === 'features') {
                    injectCosmeticFilters({
                        ...update,
                    });
                }
            });
            DOM_MONITOR.queryAll(window);
            // Start observing mutations to detect new ids and classes which would
            // need to be hidden.
            electron.ipcRenderer
                .invoke('@ghostery/adblocker/is-mutation-observer-enabled')
                .then((enableMutationObserver) => enableMutationObserver && DOM_MONITOR?.start(window));
        }, { once: true, passive: true });
        window.addEventListener('unload', unload, { once: true, passive: true });
    })();
}
//# sourceMappingURL=index.cjs.map
