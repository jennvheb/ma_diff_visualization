import {isGatewayTagName, nearestDrawable, stampLogicalIds, tagName} from "../../integration/stableIds.js";
import {parentPath} from "./config.js";
import {bestMatchGatewayInNew, ghostifyId} from "./ids.js";
import {toSegs} from "./config.js";
import {reservePosition} from "./placement.js";
import {DIFF_BOUNDARY_TAGS} from "../../integration/tags.js";

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

export function atPath(root, pathStr, isXy = false) {
    if (!pathStr) return null;
    return isXy ? nodeAtPathDrawable(root, pathStr) : nodeAtPath(root, pathStr);
}


function drawableElementChildren(el) {
    return Array.from(el?.children || []).filter(n => n.nodeType === 1);
}

export function drawableChildrenOnly(el) {
    return drawableElementChildren(el)
        .map(nearestDrawable)
        .filter(Boolean);
}

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
export function findNearestExistingAncestorInUnified(op, unifiedRoot, oldRoot, newIndex) {
    let p = op.rebasedOldPath ? parentPath(op.rebasedOldPath) : null;

    while (p && p !== "") {
        const oldNode = nodeAtPath(oldRoot, p);
        const oldDrawable = nearestDrawable(oldNode);
        if (!oldDrawable) { p = parentPath(p); continue; }

        const pid = oldDrawable.getAttribute("id");

        // 1) direct id hit in NEW
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

export function topLevelDrawableOrder(root, max = 30) {
    const kids = Array.from(root.children || []).filter(n => n.nodeType === 1);
    const drawables = kids.map(nearestDrawable).filter(Boolean);
    return drawables.slice(0, max).map(d => d.getAttribute("id"));
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

export function recoverById(root, id) {
    if (!root || !id) return null;
    return root.querySelector(`*[id="${CSS.escape(id)}"]`);
}

function insertAtPathIndex(root, pathStr, nodeToInsert) {
    try {
        if (!pathStr) return false;

        const p = parentPath(pathStr);
        const segs = toSegs(pathStr);
        const lastIdx = segs.length ? segs[segs.length - 1] : null;
        if (p === "" || lastIdx == null) return false;

        const parent = nodeAtPath(root, p);
        if (!parent) {
            console.warn("[insertAtPathIndex] parent not found", { pathStr, parentPath: p });
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

function elementChildren(node) {
    return Array.from(node ? node.children : []).filter((n) => n.nodeType === 1);
}

export function findDrawableSiblingsInOld(ownerOld) {
    if (!ownerOld) return { prev: null, next: null };
    const parent = ownerOld.parentNode;
    if (!parent) return { prev: null, next: null };

    const kids = elementChildren(parent);
    const drawables = kids.map(nearestDrawable).filter(Boolean);

    let prev = null, next = null;
    for (let i = 0; i < drawables.length; i++) {
        if (drawables[i] === ownerOld) {
            prev = drawables[i - 1] || null;
            next = drawables[i + 1] || null;
            break;
        }
    }
    return { prev, next };
}

export function findAnchorInUnifiedById(root, logicalId) {
    if (!root || !logicalId) return null;
    return root.querySelector(`*[id="${CSS.escape(logicalId)}"]`);
}

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

function cloneFromNewByPath(newRoot, newPath) {
    const n = nodeAtPath(newRoot, newPath);
    return n ? n.cloneNode(true) : null;
}

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

// Build "OLD as it looked right before opIndex executes"
export function buildOldWorkUntil(opIndex, rawOps, oldRoot, newRoot) {
    const oldWork = oldRoot.cloneNode(true);
    // important so nearestDrawable & ids behave like your other trees
    stampLogicalIds(oldWork);

    for (let i = 0; i < opIndex; i++) {
        applyOpToOldWork(oldWork, rawOps[i], newRoot);
    }
    return oldWork;
}
