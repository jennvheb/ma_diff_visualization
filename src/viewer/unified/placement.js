import {isGatewayTagName, nearestDrawable, tagName} from "../../integration/stableIds.js";
import {bestMatchGatewayInNew, ghostifyId, isSyntheticGw, prefixDrawableIdsInSubtree} from "./ids.js";
import {
    drawableChildrenOnly,
    findAnchorInUnifiedById, findDrawableSiblingsInOld, findNearestExistingAncestorInUnified,
    indexAmongDrawableSiblings,
    insertIntoContainerAtOldIndex,
    insertIntoContainerAtReservedOldIndex, recoverById, topLevelDrawableOrder, tryPlaceInsideDeletedParentGhost
} from "./xml.js";
import {parentPath} from "./config.js";
import {lastSeg} from "./config.js";

function slotKeyForContainer(containerEl) {
    // stable key for the container in unified XML
    return containerEl?.getAttribute?.("id") || "__root__";
}

// XYDiff-only: per-container occupied insertion indices (by container id or by path)
const XY_SLOT_USED = new Map(); // key -> Set<number>

export function reservePosition(containerEl, desiredIdx) {
    const key = slotKeyForContainer(containerEl);
    if (!XY_SLOT_USED.has(key)) XY_SLOT_USED.set(key, new Set());
    const used = XY_SLOT_USED.get(key);

    let idx = desiredIdx;
    while (used.has(idx)) idx++;
    used.add(idx);
    return idx;
}

// placing delete ghosts, but neighbor was moved, so search for the move ghost
function tryPlaceByOldNeighborsPreferMoveGhost(unifiedRoot, ownerOld, ghost, movedOldIds, deletedOldIds) {
    const { prev, next } = findDrawableSiblingsInOld(ownerOld);

    const anchorIds = (d) => {
        const id = d?.getAttribute?.("id");
        if (!id) return [];

        const out = [];

        // if neighbor was deleted, its visible representative in unifiedRoot is the delete ghost
        if (deletedOldIds?.has?.(id)) out.push(ghostifyId("delete", id));

        // if neighbor was moved, prefer move ghost as the old location
        if (movedOldIds?.has?.(id)) out.push(ghostifyId("move", id));

        // fallback: try the real id (works if the neighbor still exists in NEW)
        out.push(id);

        // de-dupe
        return Array.from(new Set(out));
    };

    // prev first
    for (const aid of anchorIds(prev)) {
        const aPrev = findAnchorInUnifiedById(unifiedRoot, aid);
        if (aPrev) {
            const p = aPrev.parentNode || unifiedRoot;
            if (aPrev.nextSibling) p.insertBefore(ghost, aPrev.nextSibling);
            else p.appendChild(ghost);
            return true;
        }
    }

    // next
    for (const aid of anchorIds(next)) {
        const aNext = findAnchorInUnifiedById(unifiedRoot, aid);
        if (aNext) {
            (aNext.parentNode || unifiedRoot).insertBefore(ghost, aNext);
            return true;
        }
    }

    return false;
}


function tryPlaceBySameId(unifiedRoot, op, ghost, allowSameId) {
    if (!allowSameId) return false;
    if (!op.sidOld) return false;
    const a = findAnchorInUnifiedById(unifiedRoot, op.sidOld);
    if (!a) return false;

    const parent = a.parentNode || unifiedRoot;
    if (a.nextSibling) parent.insertBefore(ghost, a.nextSibling);
    else parent.appendChild(ghost);
    return true;
}

export function insertGhost(op, unifiedRoot, ctx, options = {}) {
    const { oldRoot, newGatewayIndex } = ctx;
    const { ghostKind = "delete", skipSameIdAnchor = false } = options;

    let ownerOld = op.ownerOld;
    if (!ctx.isXy) {
        ownerOld = (ghostKind === "move" && op.ownerOldDynamic) ? op.ownerOldDynamic : op.ownerOld;
    }

    // use dynamic owner only for placement, but static old node for clone content
    let cloneSource = ownerOld;
    if (ghostKind === "move" && !ctx.isXy && op.sidOld) {
        const staticOldById = recoverById(oldRoot, op.sidOld);
        if (staticOldById) cloneSource = staticOldById;
    }

    console.log("GHOST op", {
        ghostKind,
        sidOld: op.sidOld,
        rawOldPath: op.oldPath,
        rebasedOldPath: op.rebasedOldPath,
        ownerOldTag: ownerOld ? tagName(ownerOld) : null,
        ownerOldId: ownerOld?.getAttribute?.("id") || null,
        cloneSourceId: cloneSource?.getAttribute?.("id") || null
    });

    if (!ownerOld || !cloneSource) {
        console.warn("GHOST ownerOld/cloneSource missing -> cannot create ghost");
        console.groupEnd();
        return;
    }

    const ghost = cloneSource.cloneNode(true);
    ghost.setAttribute("_ghost", ghostKind);
    prefixDrawableIdsInSubtree(ghost, ghostKind);


    // finding nearest existing ancestor in unified
    if (ghostKind === "delete" && ctx.isXy) {
        const oldP = parentPath(op.rebasedOldPath || op.oldPath);
        const desired = lastSeg(op.rebasedOldPath || op.oldPath);

        // only for nested deletes
        if (oldP !== "/" && desired != null) {
            let container = findNearestExistingAncestorInUnified(op, unifiedRoot, ctx.oldRoot, newGatewayIndex) || null;

            if (container) {
                const idx = reservePosition(container, desired);
                const drawKids = drawableChildrenOnly(container);
                const ref = drawKids[idx] || null;
                if (ref) container.insertBefore(ghost, ref);
                else container.appendChild(ghost);
                return;
            }
        }
    }
    if (ghostKind === "delete") {
        // if parent is deleted too, place inside the parent's delete ghost
        const okParentGhost = tryPlaceInsideDeletedParentGhost(op, unifiedRoot, ctx.oldRoot, ghost);
        console.log("GHOST parentGhostPlacement", okParentGhost);
        if (okParentGhost) { console.groupEnd(); return; }

        const container = findNearestExistingAncestorInUnified(op, unifiedRoot, ctx.oldRoot, newGatewayIndex);
        console.log("GHOST nearestAncestorContainer", container ? {
            tag: tagName(container),
            id: container.getAttribute("id")
        } : null);

        if (container) {
            // IMPORTANT: keep OLD branch position
            const ok = ctx.isXy
                ? insertIntoContainerAtReservedOldIndex(container, ghost, ownerOld)
                : insertIntoContainerAtOldIndex(container, ghost, ownerOld);
            console.log("containerInsertAtOldIndex", ok, {
                oldIdx: indexAmongDrawableSiblings(ownerOld),
                containerId: container.getAttribute("id"),
                containerTag: tagName(container)
            });
            console.groupEnd();
            return;
        }
        if (!container) {
            const ownerParentPath = parentPath(op.rebasedOldPath || op.oldPath);
            const isTopLevelDelete = (ownerParentPath === "/");

            if (isTopLevelDelete) {
                const okNei = tryPlaceByOldNeighborsPreferMoveGhost(unifiedRoot, ownerOld, ghost, ctx.movedOldIds, ctx.deletedOldIds);

                if (okNei) {
                    console.log("GHOST placedBy=topLevelNeighbor", {
                        ghostId: ghost.getAttribute("id"),
                        unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
                    });
                    console.groupEnd();
                    return;
                }

                // fallback: preserve OLD top-level slot instead of appending
                const okIdx = ctx.isXy
                    ? insertIntoContainerAtReservedOldIndex(unifiedRoot, ghost, ownerOld)
                    : insertIntoContainerAtOldIndex(unifiedRoot, ghost, ownerOld);
                console.log("GHOST topLevel oldIndexFallback", okIdx, {
                    ghostId: ghost.getAttribute("id"),
                    oldIdx: indexAmongDrawableSiblings(ownerOld),
                    unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
                });
                console.groupEnd();
                return;
            }

            // non-top-level: oldIndex fallback is inside containers
            const ok = ctx.isXy
                ? insertIntoContainerAtReservedOldIndex(unifiedRoot, ghost, ownerOld)
                : insertIntoContainerAtOldIndex(unifiedRoot, ghost, ownerOld);
            console.log("rootInsertAtOldIndex", ok);
            console.groupEnd();
            return;
        }
    }

    // nearest existing ancestor in unified (move ghosts)
    if (ghostKind === "move") {
        // use OLD-DYNAMIC owner for moves (the "source location" before the move)
        const src = ownerOld;

        // walk upwards from the parent to find a container that exists in unified
        let cur = src?.parentNode || null;
        let placed = false;

        while (cur && cur.nodeType === 1 && !placed) {
            const d = nearestDrawable(cur);
            if (!d) { cur = cur.parentNode; continue; }

            const did = d.getAttribute("id");

            // direct id hit
            if (did) {
                const cont = unifiedRoot.querySelector(`*[id="${CSS.escape(did)}"]`);
                if (cont) {
                    placed = ctx.isXy
                        ? insertIntoContainerAtReservedOldIndex(cont, ghost, src)
                        : insertIntoContainerAtOldIndex(cont, ghost, src);
                    console.log("GHOST move nearestAncestorContainer (direct)", { did, placed });
                    break;
                }
            }

            // gateway match
            if (isGatewayTagName(tagName(d)) && Array.isArray(newGatewayIndex)) {
                const parentDrawable = nearestDrawable(d.parentNode);
                const parentId = parentDrawable?.getAttribute("id") || "root";
                const bestId = bestMatchGatewayInNew(d, parentId, newGatewayIndex);
                if (bestId) {
                    const cont = unifiedRoot.querySelector(`*[id="${CSS.escape(bestId)}"]`);
                    if (cont) {
                        placed = ctx.isXy
                            ? insertIntoContainerAtReservedOldIndex(cont, ghost, src)
                            : insertIntoContainerAtOldIndex(cont, ghost, src);
                        console.log("GHOST move nearestAncestorContainer", { bestId, placed });
                        break;
                    }
                }
            }

            cur = d.parentNode;
        }

        if (placed) { console.groupEnd(); return; }
    }




    // for cpeediff top-level move ghosts, prefer neighbor anchoring first
    if (ghostKind === "move" && !ctx.isXy) {
        const okNei = tryPlaceByOldNeighborsPreferMoveGhost(
            unifiedRoot,
            ownerOld,
            ghost,
            ctx.movedOldIds,
            ctx.deletedOldIds
        );
        console.log("move neighborPlacement", okNei);
        if (okNei) { console.groupEnd(); return; }
    }

    // same-id anchor (usually off for moves anyway)
    if (!skipSameIdAnchor) {
        const allowSameId = !!op.sidOld && !isSyntheticGw(op.sidOld);
        const okSame = tryPlaceBySameId(unifiedRoot, op, ghost, allowSameId);
        if (okSame) { console.groupEnd(); return; }
    }

    // only then fallback to old index
    if (ghostKind === "move") {
        const okIdx = ctx.isXy
            ? insertIntoContainerAtReservedOldIndex(unifiedRoot, ghost, ownerOld)
            : insertIntoContainerAtOldIndex(unifiedRoot, ghost, ownerOld);
        console.log("GHOST move root oldIndexFallback", okIdx, {
            ghostId: ghost.getAttribute("id"),
            oldIdx: indexAmongDrawableSiblings(ownerOld),
            unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
        });
        if (okIdx) { console.groupEnd(); return; }
    }
    console.log("GHOST placedBy=neighborAnchor", {
        ghostId: ghost.getAttribute("id"),
        unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
    });

    console.warn("GHOST ALL placement strategies failed -> fallback append to unifiedRoot");
    unifiedRoot.appendChild(ghost);
    console.groupEnd();
}
