import {BRANCH_CONTAINER_TAGS, CONDITION_TAGS, DIFF_BOUNDARY_TAGS, STRUCTURAL_TAGS} from "../../tags.js";
import {elementByRelIndexPath, indexPathForNodeRelative, trimRelPathToExistingElement} from "./pathUtils.js";
import {childElements} from "./domUtils.js";
import {isGatewayTagName} from "../../stableIds.js";

// get the tagname (call, loop, etc)
export function tagName(el) {
    return (el?.localName || el?.tagName || "").toLowerCase();
}

// walk upwards from a node to find the nearest ancestor that is drawable, used for when the edits are deeply nested as the node is colored not the nested info
export function nearestDrawableAncestor(node) {
    let cur = node;
    while (cur) {
        const el = cur;
        if (!el || el.nodeType !== 1) break;

        const tag = tagName(el);
        if (DIFF_BOUNDARY_TAGS.has(tag)) return el;

        cur = el.parentNode;
    }
    return null;
}

// walk upwards to find the nearest ancestor that is a branch container for when an edit has been done there
export function nearestBranchContainer(node) {
    let cur = node;
    while (cur) {
        const el = cur;
        if (!el || el.nodeType !== 1) break;
        const tag = tagName(el);
        if (BRANCH_CONTAINER_TAGS.has(tag)) return el;
        cur = el.parentNode;
    }
    return null;
}


function findConditionRoot(branchEl) {
    const kids = childElements(branchEl);
    return kids.find(k => CONDITION_TAGS.has(tagName(k))) || null;
}

// this distinguishes if a change occured in the condition or in the body
export function isWithinConditionSubtree(branchEl, node) {
    const cond = findConditionRoot(branchEl);
    if (!cond) return false; // if no condition node, don't treat first child as condition
    for (let p = node; p; p = p.parentNode) {
        if (p === cond) return true;
        if (p === branchEl) return false;
    }
    return false;
}


export function nearestOwningGateway(node) {
    let cur = node;
    while (cur) {
        const el = cur;
        if (!el || el.nodeType !== 1) break;

        if (isGatewayTagName(tagName(el))) return el;

        cur = el.parentNode;
    }
    return null;
}

export function isDrawableTagName(tag) {
    return DIFF_BOUNDARY_TAGS.has(String(tag || "").toLowerCase());
}

export function drawableElAt(baseElem, relPath) {
    const el = elementByRelIndexPath(baseElem, relPath);
    if (!el) return null;
    const tag = tagName(el);
    if (!DIFF_BOUNDARY_TAGS.has(tag)) return null;
    return el;
}

function tagAtRel(baseElem, relPath) {
    const el = elementByRelIndexPath(baseElem, relPath);
    return tagName(el);
}

export function isStructuralRel(baseElem, relPath) {
    return STRUCTURAL_TAGS.has(tagAtRel(baseElem, relPath));
}

export function payloadHasStructuralTags(payloadEl) {
    if (!payloadEl) return false;

    const stack = [payloadEl];
    while (stack.length) {
        const n = stack.pop();
        if (n?.nodeType !== 1) continue;

        const tag = tagName(n);
        if (STRUCTURAL_TAGS.has(tag)) return true;

        for (let i = n.childNodes.length - 1; i >= 0; i--) {
            const c = n.childNodes[i];
            if (c?.nodeType === 1) stack.push(c);
        }
    }
    return false;
}

// if xydiff reports ONLY shifting edits then that is only internal to the xydiff because of structural changes not because an actual edit that happened; it should not be visualized
export function payloadIsShiftingOnly(payloadEl) {
    if (!payloadEl || payloadEl.nodeType !== 1) return false;

    const rootTag = tagName(payloadEl);

    // direct shifting subtree itself
    if (rootTag === "_shifting" || rootTag === "_shifting_type") return true;

    // annotations is shifting-only only if all element children are shifting-related
    if (rootTag === "annotations") {
        const kids = childElements(payloadEl);
        if (!kids.length) return false;

        return kids.every(k => {
            const t = tagName(k);
            return t === "_shifting" || t === "_shifting_type";
        });
    }

    return false;
}

// shifting appears somwhere in the payload; used to distinguish actual edits again (important for move+update)
export function payloadContainsShifting(payloadEl) {
    if (!payloadEl) return false;

    const stack = [payloadEl];
    while (stack.length) {
        const n = stack.pop();
        if (!n || n.nodeType !== 1) continue;

        const tag = tagName(n);
        if (tag === "_shifting" || tag === "_shifting_type") return true;

        for (let i = n.childNodes.length - 1; i >= 0; i--) {
            const c = n.childNodes[i];
            if (c && c.nodeType === 1) stack.push(c);
        }
    }
    return false;
}

// take a relative path (node starting from description root) and snap if to the nearest ancestor by trimming and resolving, climbing and computing drawable node's relative path
export function snapRelPathToDrawable(baseElem, relPath) {
    if (!baseElem || !relPath) return relPath;

    const trimmed = trimRelPathToExistingElement(baseElem, relPath);
    const target = elementByRelIndexPath(baseElem, trimmed);
    if (!target) return relPath;

    const drawable = nearestDrawableAncestor(target);
    if (!drawable) return relPath;

    return indexPathForNodeRelative(baseElem, drawable) || relPath;
}