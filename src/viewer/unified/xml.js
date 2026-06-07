import {isGatewayTagName, nearestDrawable, stampLogicalIds, tagName} from "../../integration/stableIds.js";
import {parentPath} from "./config.js";
import {bestMatchGatewayInNew, ghostifyId} from "./ids.js";
import {toSegs} from "./config.js";
import {DIFF_BOUNDARY_TAGS} from "../../integration/tags.js";
import {reservePosition} from "./placement/placementState.js";

/**
 * Resolves a path by counting only drawable children
 * mainly for XYDiff because XYDiff paths are often normalized to drawable/process-level paths
 * @param root
 * @param pathStr
 * @returns {*|null}
 */
function nodeAtPathDrawable(root, pathStr) {
    const segs = toSegs(pathStr);
    let cur = root;

    for (const idx of segs) {
        if (!cur) return null;

        // step through DRAWABLE children only
        const kids = drawableChildrenOnly(cur);
        cur = kids[idx] || null;
    }
    return cur;
}

/**
 * Chooses path resolution mode
 * XYDiff -> drawable path interpretation
 * CpeeDiff -> normal XML element path interpretation
 *
 * @param root
 * @param pathStr
 * @param isXy
 * @returns {*|null}
 */
export function atPath(root, pathStr, isXy = false) {
    if (!pathStr) return null;
    return isXy ? nodeAtPathDrawable(root, pathStr) : nodeAtPath(root, pathStr);
}

function drawableElementChildren(el) {
    return Array.from(el?.children || []).filter(n => n.nodeType === 1);
}

/**
 * Maps children to nearest drawable elements and filters nulls
 * helps ignore XML detail nodes when placing ghosts among process elements
 *
 * @param el
 * @returns {unknown[]}
 */
export function drawableChildrenOnly(el) {
    return drawableElementChildren(el)
        .map(nearestDrawable)
        .filter(Boolean);
}

/**
 * Finds the index of a drawable node among drawable siblings
 * Used for placing ghosts at the old visual position
 * @param oldDrawable
 * @returns {number}
 */
export function indexAmongDrawableSiblings(oldDrawable) {
    const parent = oldDrawable?.parentNode;
    if (!parent) return -1;

    const sibs = drawableChildrenOnly(parent);
    for (let i = 0; i < sibs.length; i++) {
        if (sibs[i] === oldDrawable) return i;
    }
    return -1;
}

/**
 * Insert ghost into `container` at the position the OLD drawable had among its siblings
 * under its OLD parent.
 *
 * This preserves "branch slot" for deleted branches.
 */
export function insertIntoContainerAtOldIndex(container, ghost, oldDrawable) {
    if (!container || !ghost || !oldDrawable) return false;

    // Where was this drawable under its OLD parent?
    const oldIdx = indexAmongDrawableSiblings(oldDrawable);
    if (oldIdx < 0) {
        // fallback to append if we can't compute
        container.appendChild(ghost);
        return true;
    }

    // Drawables currently present in the NEW container
    const newKids = drawableChildrenOnly(container);

    // Clamp index into [0..len]
    const idx = Math.max(0, Math.min(oldIdx, newKids.length));

    // Insert before the drawable currently at that index
    const ref = newKids[idx] || null;
    if (ref) container.insertBefore(ghost, ref);
    else container.appendChild(ghost);

    return true;
}

/**
 * Same idea, but uses reservePosition() to avoid multiple ghosts using the same slot
 * especially useful for XYDiff ghost placement
 *
 * @param container
 * @param ghost
 * @param oldDrawable
 * @returns {boolean}
 */
export function insertIntoContainerAtReservedOldIndex(container, ghost, oldDrawable) {
    if (!container || !ghost || !oldDrawable) return false;

    const oldIdx = indexAmongDrawableSiblings(oldDrawable);
    if (oldIdx < 0) {
        container.appendChild(ghost);
        return true;
    }

    const idx = reservePosition(container, oldIdx);
    const newKids = drawableChildrenOnly(container);
    const ref = newKids[idx] || null;

    if (ref) container.insertBefore(ghost, ref);
    else container.appendChild(ghost);

    return true;
}

/**
 * If the parent was also deleted, place the child ghost inside the parent delete ghost
 *
 * @param op
 * @param unifiedRoot
 * @param oldRoot
 * @param ghost
 * @returns {boolean}
 */
export function tryPlaceInsideDeletedParentGhost(op, unifiedRoot, oldRoot, ghost) {
    // old parent drawable:
    const p = parentPath(op.rebasedOldPath || op.oldPath);
    if (!p) return false;

    const oldParentNode = nodeAtPath(oldRoot, p);
    const oldParentDrawable = nearestDrawable(oldParentNode);
    const oldParentId = oldParentDrawable?.getAttribute("id");
    if (!oldParentId) return false;

    const parentGhostId = ghostifyId("delete", oldParentId);
    const container = unifiedRoot.querySelector(`*[id="${CSS.escape(parentGhostId)}"]`);
    if (!container) return false;

    container.appendChild(ghost);
    return true;
}

/**
 * If exact old parent does not exist in unified NEW, walk upward until a surviving ancestor can be found
 *
 * @param op
 * @param unifiedRoot
 * @param oldRoot
 * @param newIndex
 * @returns {*|null}
 */
export function findNearestExistingAncestorInUnified(op, unifiedRoot, oldRoot, newIndex) {
    let p = op.rebasedOldPath ? parentPath(op.rebasedOldPath) : null;

    while (p && p !== "") {
        const oldNode = nodeAtPath(oldRoot, p);
        const oldDrawable = nearestDrawable(oldNode);
        if (!oldDrawable) { p = parentPath(p); continue; }

        const pid = oldDrawable.getAttribute("id");

        // 1) direct id hit in unified tree
        if (pid) {
            const inUnified = unifiedRoot.querySelector(`*[id="${CSS.escape(pid)}"]`);
            if (inUnified) return inUnified;

            // 1b) ancestor delete-ghost exists?
            const inDelGhost = unifiedRoot.querySelector(`*[id="${CSS.escape(ghostifyId("delete", pid))}"]`);
            if (inDelGhost) return inDelGhost;
        }

        // 2) gateway fuzzy match
        const isGw = isGatewayTagName(tagName(oldDrawable));
        if (isGw && Array.isArray(newIndex)) {
            const parentDrawable = nearestDrawable(oldDrawable.parentNode);
            const parentId = parentDrawable?.getAttribute("id") || "root";
            const bestId = bestMatchGatewayInNew(oldDrawable, parentId, newIndex);
            if (bestId) {
                const inUnified = unifiedRoot.querySelector(`*[id="${CSS.escape(bestId)}"]`);
                if (inUnified) return inUnified;
            }
        }

        p = parentPath(p);
    }
    return null;
}

export function nodeAtPath(root, pathStr) {
    const segs = toSegs(pathStr);
    let cur = root;
    for (const idx of segs) {
        if (!cur) return null;
        const kids = Array.from(cur.children).filter((n) => n.nodeType === 1);
        cur = kids[idx] || null;
    }
    return cur;
}

export function findById(root, id) {
    if (!root || !id) return null;
    return root.querySelector(`*[id="${CSS.escape(id)}"]`);
}

/**
 * Internal helper used by dynamic tree simulation
 * Inserts a node into root at numeric path position
 *
 * @param root
 * @param pathStr
 * @param nodeToInsert
 * @returns {boolean}
 */
function insertAtPathIndex(root, pathStr, nodeToInsert) {
    try {
        if (!pathStr) return false;

        const p = parentPath(pathStr);
        const segs = toSegs(pathStr);
        const lastIdx = segs.length ? segs[segs.length - 1] : null;
        if (p === "" || lastIdx == null) return false;

        const parent = nodeAtPath(root, p);
        if (!parent) {
            return false;
        }

        const kids = Array.from(parent.children).filter(n => n.nodeType === 1);
        const ref = kids[lastIdx] || null;

        if (ref) parent.insertBefore(nodeToInsert, ref);
        else parent.appendChild(nodeToInsert);

        return true;
    } catch (e) {
        console.error("[insertAtPathIndex] exception", e, { pathStr });
        return false;
    }
}

/**
 * Collects ids of all drawable descendants
 * Those are later needed for coloring, clicks, and undo
 *
 * @param rootNode
 * @returns {*[]}
 */
export function collectDrawableIdsXML(rootNode) {
    const ids = [];
    if (!rootNode) return ids;

    function walk(n) {
        if (!n || n.nodeType !== 1) return;
        const t = tagName(n);
        if (DIFF_BOUNDARY_TAGS.has(t)) {
            const id = n.getAttribute("id");
            if (id) ids.push(id);
        }
        for (const k of Array.from(n.children || [])) walk(k);
    }

    walk(rootNode);
    return ids;
}

/**
 * Removes a node from a tree by path
 * Used only for simulating old tree state
 *
 * @param root
 * @param pathStr
 * @returns {unknown|null}
 */
function removeAtPath(root, pathStr) {
    const p = parentPath(pathStr);
    const segs = toSegs(pathStr);
    const lastIdx = segs.length ? segs[segs.length - 1] : null;
    if (!p || lastIdx == null) return null;

    const parent = nodeAtPath(root, p);
    if (!parent) return null;

    const kids = Array.from(parent.children).filter(n => n.nodeType === 1);
    const victim = kids[lastIdx] || null;
    if (!victim) return null;

    parent.removeChild(victim);
    return victim;
}

/**
 * Clones a node from final NEW
 * Used when simulating an insert into the old working tree
 *
 * @param newRoot
 * @param newPath
 * @returns {*|null}
 */
function cloneFromNewByPath(newRoot, newPath) {
    const n = nodeAtPath(newRoot, newPath);
    return n ? n.cloneNode(true) : null;
}

/**
 * Apply one structural operation to a copy of OLD
 *
 * @param oldWork
 * @param op
 * @param newRoot
 */
function applyOpToOldWork(oldWork, op, newRoot) {
    if (!op) return;

    // UPDATE: does not change structure -> ignore
    if (op.type === "update") return;

    if (op.type === "insert" && op.newPath) {
        const ins = cloneFromNewByPath(newRoot, op.newPath);
        if (ins) insertAtPathIndex(oldWork, op.newPath, ins);
        return;
    }

    if (op.type === "delete" && op.oldPath) {
        removeAtPath(oldWork, op.oldPath);
        return;
    }

    if ((op.type === "move" || op.type === "moveupdate") && op.oldPath && op.newPath) {
        const moved = removeAtPath(oldWork, op.oldPath);
        if (moved) insertAtPathIndex(oldWork, op.newPath, moved);
        return;
    }
}

/**
 * Build "OLD as it looked right before opIndex executes"
 * important for CpeeDiff because some paths refer to a dynamic intermediate tree, not the original OLD tree
 *
 * @param opIndex
 * @param rawOps
 * @param oldRoot
 * @param newRoot
 * @returns {*|ActiveX.IXMLDOMNode|Node}
 */
export function buildOldWorkUntil(opIndex, rawOps, oldRoot, newRoot) {
    const oldWork = oldRoot.cloneNode(true);
    // important so nearestDrawable & ids behave like your other trees
    stampLogicalIds(oldWork);

    for (let i = 0; i < opIndex; i++) {
        applyOpToOldWork(oldWork, rawOps[i], newRoot);
    }
    return oldWork;
}
