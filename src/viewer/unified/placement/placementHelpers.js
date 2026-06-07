import {childElements} from "../undo/xmlPatchUtils.js";
import {indexPathForNodeRelative} from "../../../integration/xyDiff/dom/pathUtils.js";
import {lastSeg, parentPath} from "../config.js";
import {drawableChildrenOnly, findById, indexAmongDrawableSiblings} from "../xml.js";
import {nearestDrawable, tagName} from "../../../integration/stableIds.js";
import {bestMatchGatewayInNew, ghostifyId} from "../ids.js";

/**
 * Finds an insert operation at the same path as an old deletion
 * Used for replacement cases
 *
 * @param oldPath
 * @param ctx
 * @returns {*|null}
 */
export function replacementInsertForOldPath(oldPath, ctx) {
    if (!oldPath || !Array.isArray(ctx?.ops)) return null;

    return ctx.ops.find(o =>
        o.type === "insert" &&
        (o.newPath === oldPath || o.rebasedNewPath === oldPath) &&
        o.sidNew
    ) || null;
}

/**
 * Returns the replacement inserted node id
 *
 * @param oldPath
 * @param ctx
 * @returns {*|null}
 */
function replacementIdForOldPath(oldPath, ctx) {
    return replacementInsertForOldPath(oldPath, ctx)?.sidNew || null;
}

/**
 * Given an old sibling, returns possible ids to find its visual anchor in unified NEW
 * needed because old sibling may no longer exist as itself; it may be moved/deleted/replaced
 *
 * @param sibling
 * @param movedOldIds
 * @param deletedOldIds
 * @param oldRoot
 * @param ctx
 * @returns {*[]}
 */
function oldSiblingAnchorIds(sibling, movedOldIds, deletedOldIds, oldRoot, ctx) {
    const oldId = sibling?.getAttribute?.("id");
    if (!oldId) return [];

    const oldPath = indexPathForNodeRelative(oldRoot, sibling);
    const replId = replacementIdForOldPath(oldPath, ctx);

    const ids = [];

    // Replacement case
    // For deleted nodes, prefer the replacement anchor first.
    if (deletedOldIds?.has?.(oldId)) {
        if (replId) ids.push(replId);
        ids.push(ghostifyId("delete", oldId));
        ids.push(oldId);
        return [...new Set(ids)];
    }

    // Moved sibling case
    // IMPORTANT: do NOT use same-path replacement here,
    if (movedOldIds?.has?.(oldId)) {
        ids.push(ghostifyId("move", oldId));
        ids.push(oldId);
        return [...new Set(ids)];
    }

    if (replId) ids.push(replId);
    ids.push(oldId);

    return [...new Set(ids)];
}
/**
 * Finds the container in unified NEW that corresponds to the old parent of the ghost
 *
 * @param op
 * @param unifiedRoot
 * @param oldRoot
 * @param newGatewayIndex
 * @returns {unknown|null}
 */
export function findOldSourceParentContainerForGhost(op, unifiedRoot, oldRoot, newGatewayIndex) {
    const oldPath = op.rebasedOldPath || op.oldPath;
    if (!oldPath) return null;

    const oldParentPath = parentPath(oldPath);

    // top-level old source: place relative to unifiedRoot itself
    if (oldParentPath === "/" || oldParentPath === "") {
        return unifiedRoot;
    }

    const oldParent = recoverByPath(oldRoot, oldParentPath);
    if (!oldParent) return null;

    const oldParentId = oldParent.getAttribute?.("id") || null;

    // direct id match
    if (oldParentId) {
        const direct = findById(unifiedRoot, oldParentId);
        if (direct) return direct;
    }

    // if parent is a branch container, map via its owning gateway + branch index
    const oldParentTag = tagName(oldParent);
    if (
        oldParentTag === "parallel_branch" ||
        oldParentTag === "alternative" ||
        oldParentTag === "otherwise"
    ) {
        const oldGateway = nearestDrawable(oldParent.parentNode);
        const oldGatewayId = oldGateway?.getAttribute?.("id") || null;

        let newGateway = oldGatewayId
            ? findById(unifiedRoot, oldGatewayId)
            : null;

        if (!newGateway && oldGateway && Array.isArray(newGatewayIndex)) {
            const parentDrawable = nearestDrawable(oldGateway.parentNode);
            const parentId = parentDrawable?.getAttribute?.("id") || "root";
            const bestId = bestMatchGatewayInNew(oldGateway, parentId, newGatewayIndex);
            if (bestId) newGateway = findById(unifiedRoot, bestId);
        }

        if (newGateway) {
            const oldBranchIdx = indexAmongDrawableSiblings(oldParent);
            const candidates = drawableChildrenOnly(newGateway)
                .filter(el => tagName(el) === oldParentTag);

            return candidates[oldBranchIdx] || null;
        }
    }

    return null;
}

/**
 * Searches previous or next old siblings and tries to find their visible anchor in unified NEW
 * Used for placement by neighborhood
 *
 * @param unifiedRoot
 * @param siblings
 * @param startIdx
 * @param direction
 * @param movedOldIds
 * @param deletedOldIds
 * @param oldRoot
 * @param ctx
 * @returns {{anchor, oldSibling: *, direction}|null}
 */
export function findVisibleOldSiblingAnchor(
    unifiedRoot,
    siblings,
    startIdx,
    direction,
    movedOldIds,
    deletedOldIds,
    oldRoot,
    ctx
) {
    for (
        let i = startIdx + direction;
        i >= 0 && i < siblings.length;
        i += direction
    ) {
        const oldSibling = siblings[i];

        for (const aid of oldSiblingAnchorIds(
            oldSibling,
            movedOldIds,
            deletedOldIds,
            oldRoot,
            ctx
        )) {
            const anchor = findById(unifiedRoot, aid);
            if (anchor) {
                return { anchor, oldSibling, direction };
            }
        }
    }

    return null;
}

/**
 * XYDiff-specific correction for top-level placement
 * if the top-level init task exists before the old path, it subtracts 1
 *
 * @param oldRoot
 * @param oldPath
 * @returns {number|null|*}
 */
export function adjustedTopLevelXySlot(oldRoot, oldPath) {
    const idx = lastSeg(oldPath);

    const init = Array.from(oldRoot.childNodes || [])
        .filter(n => n.nodeType === 1)
        .findIndex(n => n.getAttribute?.("id") === "init");

    if (init >= 0 && init < idx) {
        return idx - 1;
    }

    return idx;
}

export function recoverByPath(root, path) {
    if (!root || !path || path === "/") return root;

    const segs = String(path).split("/").filter(Boolean).map(Number);
    let cur = root;

    for (const idx of segs) {
        const kids = childElements(cur);
        cur = kids[idx] || null;
        if (!cur) return null;
    }

    return cur;
}

/**
 * Stores where a ghost was actually inserted
 * important for undo
 *
 * @param op
 * @param unifiedRoot
 * @param container
 * @param ghost
 */
export function stampRealizePlacement(op, unifiedRoot, container, ghost) {
    op.realizeParentPath = indexPathForNodeRelative(unifiedRoot, container);
    op.realizeIndex = childElements(container).indexOf(ghost);
}