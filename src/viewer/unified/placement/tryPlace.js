import {drawableChildrenOnly, findById, indexAmongDrawableSiblings} from "../xml.js";
import {
    adjustedTopLevelXySlot,
    findOldSourceParentContainerForGhost, findVisibleOldSiblingAnchor,
    recoverByPath,
    stampRealizePlacement
} from "./placementHelpers.js";
import {isGatewayTagName, nearestDrawable, tagName} from "../../../integration/stableIds.js";
import {bestMatchGatewayInNew} from "../ids.js";
import {lastSeg, parentPath} from "../config.js";
import {reservePosition} from "./placementState.js";
import {childElements} from "../undo/xmlPatchUtils.js";
import {indexPathForNodeRelative} from "../../../integration/xyDiff/dom/pathUtils.js";

const BRANCH_CONTAINER_TAGS = new Set([
    "alternative",
    "otherwise",
    "parallel_branch"
]);

/**
 * finds the gateway anchor even if said gateway was modified too
 * by trying to map old gateway to new/unified gateway
 * and places ghost relative to that mapped gateway
 * @param oldGateway
 * @param unifiedRoot
 * @param ctx
 * @returns {*|null}
 */
function findGatewayAnchorInUnified(oldGateway, unifiedRoot, ctx) {
    if (!oldGateway || !isGatewayTagName(tagName(oldGateway))) return null;

    const oldId = oldGateway.getAttribute?.("id") || null;

    if (oldId) {
        const direct = findById(unifiedRoot, oldId);
        if (direct) return direct;
    }

    const parentDrawable = nearestDrawable(oldGateway.parentNode);
    const parentId = parentDrawable?.getAttribute?.("id") || "root";

    const bestId = bestMatchGatewayInNew(
        oldGateway,
        parentId,
        ctx.newGatewayIndex || []
    );

    return bestId ? findById(unifiedRoot, bestId) : null;
}

/**
 * places a move ghost at the old source position
 * finds the old parent container in the unified model,
 * computes desired index from old path, inserts ghost there,
 * and stores realization metadata
 *
 * @param op
 * @param unifiedRoot
 * @param ctx
 * @param ghost
 * @returns {boolean}
 */
export function placeMoveGhostAtOldSourceSlot(op, unifiedRoot, ctx, ghost) {
    const oldPath = op.rebasedOldPath || op.oldPath;
    if (!oldPath) return false;

    const container = findOldSourceParentContainerForGhost(
        op,
        unifiedRoot,
        ctx.oldRoot,
        ctx.newGatewayIndex
    );

    if (!container) return false;

    /* for CpeeDiff move ghosts, do not place into root just
    because the OLD parent path is top-level;
    it's too unstable after deletes/gateway updates*/
    if (!ctx.isXy && container === unifiedRoot) {
        return false;
    }

    const desiredIdx =
        parentPath(oldPath) === "/"
            ? adjustedTopLevelXySlot(ctx.oldRoot, oldPath)
            : lastSeg(oldPath);

    const kids = childElements(container);

    if (kids[desiredIdx]) {
        container.insertBefore(ghost, kids[desiredIdx]);
    } else {
        return false;
    }

    op.realizeParentPath = indexPathForNodeRelative(unifiedRoot, container);
    op.realizeIndex = childElements(container).indexOf(ghost);

    return true;
}

/**
 * Places a ghost relative to old siblings
 *
 * @param op
 * @param unifiedRoot
 * @param ownerOld
 * @param ghost
 * @param movedOldIds
 * @param deletedOldIds
 * @param oldRoot
 * @param ghostKind
 * @param ctx
 * @returns {boolean}
 */
export function tryPlaceByOldNeighborsPreferMoveGhost(
    op,
    unifiedRoot,
    ownerOld,
    ghost,
    movedOldIds,
    deletedOldIds,
    oldRoot,
    ghostKind,
    ctx
) {
    const parent = ownerOld?.parentNode;

    if (!parent) return false;

    const siblings = drawableChildrenOnly(parent);
    const myIdx = siblings.indexOf(ownerOld);

    if (myIdx < 0) return false;

    if (ghostKind === "move" || ghostKind === "delete") {
        const prev = siblings[myIdx - 1] || null;
        const next = siblings[myIdx + 1] || null;

        const prevGw = findGatewayAnchorInUnified(prev, unifiedRoot, ctx);
        if (prevGw) {
            const p = prevGw.parentNode || unifiedRoot;
            if (prevGw.nextSibling) p.insertBefore(ghost, prevGw.nextSibling);
            else p.appendChild(ghost);
            stampRealizePlacement(op, unifiedRoot, p, ghost);
            return true;
        }

        const nextGw = findGatewayAnchorInUnified(next, unifiedRoot, ctx);
        if (nextGw) {
            const p = nextGw.parentNode || unifiedRoot;
            p.insertBefore(ghost, nextGw);
            stampRealizePlacement(op, unifiedRoot, p, ghost);
            return true;
        }
    }

    // Prefer previous stable/placed sibling -> insert after it
    let found = findVisibleOldSiblingAnchor(
        unifiedRoot,
        siblings,
        myIdx,
        -1,
        movedOldIds,
        deletedOldIds,
        oldRoot,
        ctx
    );

    if (found?.anchor) {
        const p = found.anchor.parentNode || unifiedRoot;

        if (found.anchor.nextSibling) p.insertBefore(ghost, found.anchor.nextSibling);
        else p.appendChild(ghost);
        stampRealizePlacement(op, unifiedRoot, p, ghost);
        return true;
    }

    // Then try next stable/placed sibling -> insert before it
    found = findVisibleOldSiblingAnchor(
        unifiedRoot,
        siblings,
        myIdx,
        +1,
        movedOldIds,
        deletedOldIds,
        oldRoot,
        ctx
    );

    if (found?.anchor) {
        const p = found.anchor.parentNode || unifiedRoot;
        p.insertBefore(ghost, found.anchor);
        stampRealizePlacement(op, unifiedRoot, p, ghost);
        return true;
    }

    return false;
}

/**
 * Handles replacement case
 * places the delete ghost directly before the replacement anchor
 *
 * @param op
 * @param unifiedRoot
 * @param ctx
 * @param ghost
 * @returns {boolean}
 */
export function tryPlaceReplacementDeleteGhost(op, unifiedRoot, ctx, ghost) {
    if (!op?.oldPath) return false;

    const oldNode = recoverByPath(ctx.oldRoot, op.oldPath);
    const newNode = recoverByPath(ctx.newRoot, op.oldPath);

    const oldId = oldNode?.getAttribute?.("id") || null;
    const newId = newNode?.getAttribute?.("id") || null;

    if (!oldId || !newId || oldId === newId) return false;

    const replacementAnchor = findById(unifiedRoot, newId);
    if (!replacementAnchor) return false;

    const p = replacementAnchor.parentNode || unifiedRoot;
    p.insertBefore(ghost, replacementAnchor);

    stampRealizePlacement(op, unifiedRoot, p, ghost);

    return true;
}

function isBranchContainer(elOrTag) {
    const t = typeof elOrTag === "string"
        ? elOrTag
        : tagName(elOrTag);

    return BRANCH_CONTAINER_TAGS.has(t);
}

/**
 * If a deleted node is a branch container, find the corresponding surviving gateway in unified NEW
 *
 * @param op
 * @param unifiedRoot
 * @param oldRoot
 * @param newGatewayIndex
 * @returns {*|null}
 */
function findSurvivingParentGatewayForDeletedBranch(op, unifiedRoot, oldRoot, newGatewayIndex) {
    const oldPath = op.rebasedOldPath || op.oldPath;
    if (!oldPath) return null;

    const oldBranch = recoverByPath(oldRoot, oldPath);
    if (!oldBranch || !isBranchContainer(oldBranch)) return null;

    const oldGatewayPath = parentPath(oldPath);
    const oldGateway = recoverByPath(oldRoot, oldGatewayPath);
    if (!oldGateway || !isGatewayTagName(tagName(oldGateway))) return null;

    const oldGatewayId = oldGateway.getAttribute?.("id") || null;

    // same gateway id exists in unified NEW.
    if (oldGatewayId) {
        const direct = findById(unifiedRoot, oldGatewayId);
        if (direct) return direct;
    }

    // fallback: gateway id changed, use witnesses/structure
    if (Array.isArray(newGatewayIndex)) {
        const parentDrawable = nearestDrawable(oldGateway.parentNode);
        const parentId = parentDrawable?.getAttribute?.("id") || "root";

        const bestId = bestMatchGatewayInNew(
            oldGateway,
            parentId,
            newGatewayIndex
        );

        if (bestId) {
            const matched = findById(unifiedRoot, bestId);
            if (matched) return matched;
        }
    }

    return null;
}

/**
 * Uses previous function to place a deleted branch ghost inside its gateway
 * reserves an index and stamps placement metadata
 *
 * @param op
 * @param unifiedRoot
 * @param ctx
 * @param ghost
 * @returns {boolean}
 */
export function tryPlaceDeletedBranchInsideSurvivingGateway(op, unifiedRoot, ctx, ghost) {
    const container = findSurvivingParentGatewayForDeletedBranch(
        op,
        unifiedRoot,
        ctx.oldRoot,
        ctx.newGatewayIndex
    );

    if (!container) return false;

    const ownerOld = op.ownerOld;
    const desiredIdx = ownerOld ? indexAmongDrawableSiblings(ownerOld) : 0;

    const idx = reservePosition(container, desiredIdx);
    const kids = drawableChildrenOnly(container);

    if (kids[idx]) container.insertBefore(ghost, kids[idx]);
    else container.appendChild(ghost);

    stampRealizePlacement(op, unifiedRoot, container, ghost);

    return true;
}

/**
 * If a node with same id exists in unified tree, place ghost after it
 *
 * @param unifiedRoot
 * @param op
 * @param ghost
 * @param allowSameId
 * @returns {boolean}
 */
export function tryPlaceBySameId(unifiedRoot, op, ghost, allowSameId) {
    if (!allowSameId) return false;
    if (!op.sidOld) return false;
    const a = findById(unifiedRoot, op.sidOld);
    if (!a) return false;

    const parent = a.parentNode || unifiedRoot;
    if (a.nextSibling) parent.insertBefore(ghost, a.nextSibling);
    else parent.appendChild(ghost);
    return true;
}