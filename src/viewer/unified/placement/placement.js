import {isGatewayTagName, nearestDrawable, tagName} from "../../../integration/stableIds.js";
import {bestMatchGatewayInNew, isSyntheticGw, prefixDrawableIdsInSubtree} from "../ids.js";
import {
    findNearestExistingAncestorInUnified,
    insertIntoContainerAtOldIndex,
    insertIntoContainerAtReservedOldIndex, findById, tryPlaceInsideDeletedParentGhost
} from "../xml.js";
import {parentPath} from "../config.js";
import {lastSeg} from "../config.js";
import {childElements} from "../undo/xmlPatchUtils.js";
import {
    adjustedTopLevelXySlot,
    findOldSourceParentContainerForGhost, replacementInsertForOldPath
} from "./placementHelpers.js";
import {
    placeMoveGhostAtOldSourceSlot,
    tryPlaceByOldNeighborsPreferMoveGhost, tryPlaceBySameId,
    tryPlaceDeletedBranchInsideSurvivingGateway,
    tryPlaceReplacementDeleteGhost
} from "./tryPlace.js";

/**
 * main function, inserts ghosts
 *
 * @param op
 * @param unifiedRoot
 * @param ctx
 * @param options
 */
export function insertGhost(op, unifiedRoot, ctx, options = {}) {
    const { oldRoot, newGatewayIndex } = ctx;
    const { ghostKind = "delete", skipSameIdAnchor = false } = options;

    let ownerOld = op.ownerOld;

    if (!ctx.isXy) {
        ownerOld =
            ghostKind === "move" && op.ownerOldDynamic
                ? op.ownerOldDynamic
                : op.ownerOld;
    }

    let cloneSource = ownerOld;

    if (ghostKind === "move" && !ctx.isXy && op.sidOld) {
        const staticOldById = findById(oldRoot, op.sidOld);
        if (staticOldById) cloneSource = staticOldById;
    }

    if (!ownerOld || !cloneSource) {
        console.warn("GHOST ownerOld/cloneSource missing -> cannot create ghost");
        return;
    }
    // clone and ghostify
    const ghost = cloneSource.cloneNode(true);
    ghost.setAttribute("_ghost", ghostKind);
    prefixDrawableIdsInSubtree(ghost, ghostKind);

    //
    // XYDiff placement: XYDiff oldPath values are static OLD paths.
    // --> So for delete/move ghosts, keep them in their OLD source area.
    // =/= CpeeDiff dynamic/fuzzy placement
    // XYDiff placement is stricter because old paths are static and should represent source positions
    //
    if (ctx.isXy && (ghostKind === "move" || ghostKind === "delete")) {
        if (ghostKind === "delete") {
            const okReplacement = tryPlaceReplacementDeleteGhost(
                op,
                unifiedRoot,
                ctx,
                ghost
            );

            if (okReplacement) return;
        }
        if (ghostKind === "delete") {
            const okParentGhost = tryPlaceInsideDeletedParentGhost(
                op,
                unifiedRoot,
                ctx.oldRoot,
                ghost
            );

            if (okParentGhost) return;
        }

        // For XY moves, oldPath is static and should define the source slot.
        if (ctx.isXy && ghostKind === "move") {
            const container = findOldSourceParentContainerForGhost(
                op,
                unifiedRoot,
                ctx.oldRoot,
                newGatewayIndex
            );

            if (container) {
                const oldPath = op.rebasedOldPath || op.oldPath;
                const desiredIdx =
                    parentPath(oldPath) === "/"
                        ? adjustedTopLevelXySlot(ctx.oldRoot, oldPath)
                        : lastSeg(oldPath);

                const kids = childElements(container);

                if (kids[desiredIdx]) {
                    container.insertBefore(ghost, kids[desiredIdx]);
                } else {
                    container.appendChild(ghost);
                }

                return;
            }
        }

        const okNeighbor = tryPlaceByOldNeighborsPreferMoveGhost(
            op,
            unifiedRoot,
            ownerOld,
            ghost,
            ctx.movedOldIds,
            ctx.deletedOldIds,
            ctx.oldRoot,
            ghostKind,
            ctx
        );

        if (okNeighbor) return;

        const container = findOldSourceParentContainerForGhost(
            op,
            unifiedRoot,
            ctx.oldRoot,
            newGatewayIndex
        );

        if (container) {
            const ok = insertIntoContainerAtReservedOldIndex(
                container,
                ghost,
                ownerOld
            );

            if (ok) return;
        }

        if (ghostKind === "delete") {
            const okDeletedBranch = tryPlaceDeletedBranchInsideSurvivingGateway(
                op,
                unifiedRoot,
                ctx,
                ghost
            );

            if (okDeletedBranch) return;
        }

        console.warn("XY ghost could not be placed; not appending", {
            ghostKind,
            sidOld: op.sidOld,
            oldPath: op.oldPath,
            rebasedOldPath: op.rebasedOldPath
        });

        return;
    }

    // CpeeDiff / original delete placement
    if (ghostKind === "delete") {
        const originalOldPath = op.oldPath;
        op.oldPath = op.rebasedOldPath || op.oldPath;

        const okReplacement = tryPlaceReplacementDeleteGhost(
            op,
            unifiedRoot,
            ctx,
            ghost
        );

        op.oldPath = originalOldPath;

        if (okReplacement) return;

        const okNei = tryPlaceByOldNeighborsPreferMoveGhost(
            op,
            unifiedRoot,
            ownerOld,
            ghost,
            ctx.movedOldIds,
            ctx.deletedOldIds,
            ctx.oldRoot,
            ghostKind,
            ctx
        );

        if (okNei) return;
        const okParentGhost = tryPlaceInsideDeletedParentGhost(
            op,
            unifiedRoot,
            ctx.oldRoot,
            ghost
        );

        if (okParentGhost) return;

        const container = findNearestExistingAncestorInUnified(
            op,
            unifiedRoot,
            ctx.oldRoot,
            newGatewayIndex
        );

        if (container) {
            return;
        }
        return;
    }

    // CpeeDiff / original move placement
    if (ghostKind === "move") {
        const okSourceSlot = placeMoveGhostAtOldSourceSlot(
            op,
            unifiedRoot,
            ctx,
            ghost
        );

        if (okSourceSlot) return;

        const okNei = tryPlaceByOldNeighborsPreferMoveGhost(
            op,
            unifiedRoot,
            ownerOld,
            ghost,
            ctx.movedOldIds,
            ctx.deletedOldIds,
            ctx.oldRoot,
            ghostKind,
            ctx
        );

        if (okNei) return;
        const oldSourceContainer = findOldSourceParentContainerForGhost(
            op,
            unifiedRoot,
            ctx.oldRoot,
            newGatewayIndex
        );

        if (oldSourceContainer) {
            const ok = insertIntoContainerAtOldIndex(
                oldSourceContainer,
                ghost,
                ownerOld
            );

            if (ok) return;
        }
        const oldSlotPath = op.rebasedOldPath || op.oldPath;
        const replacementOp = replacementInsertForOldPath(oldSlotPath, ctx);
        const replacementId = replacementOp?.sidNew || null;
        const replacementAnchor = replacementId
            ? findById(unifiedRoot, replacementId)
            : null;

        if (replacementAnchor) {
            const p = replacementAnchor.parentNode || unifiedRoot;

            const moveIdx = op.deltaIndex ?? Infinity;
            const insertIdx = replacementOp.deltaIndex ?? Infinity;

            if (moveIdx < insertIdx) {
                p.insertBefore(ghost, replacementAnchor);
            } else {
                if (replacementAnchor.nextSibling) {
                    p.insertBefore(ghost, replacementAnchor.nextSibling);
                } else {
                    p.appendChild(ghost);
                }
            }

            return;
        }
        const src = ownerOld;
        let cur = src?.parentNode || null;
        let placed = false;

        while (cur && cur.nodeType === 1 && !placed) {
            const d = nearestDrawable(cur);
            if (!d) {
                cur = cur.parentNode;
                continue;
            }

            const did = d.getAttribute("id");

            if (did) {
                const cont = unifiedRoot.querySelector(`*[id="${CSS.escape(did)}"]`);

                if (cont) {
                    placed = insertIntoContainerAtOldIndex(cont, ghost, src);

                    break;
                }
            }

            if (isGatewayTagName(tagName(d)) && Array.isArray(newGatewayIndex)) {
                const parentDrawable = nearestDrawable(d.parentNode);
                const parentId = parentDrawable?.getAttribute("id") || "root";
                const bestId = bestMatchGatewayInNew(d, parentId, newGatewayIndex);

                if (bestId) {
                    const cont = unifiedRoot.querySelector(`*[id="${CSS.escape(bestId)}"]`);

                    if (cont) {
                        placed = insertIntoContainerAtOldIndex(cont, ghost, src);
                        break;
                    }
                }
            }

            cur = d.parentNode;
        }

        if (placed) return;
    }

    // Same-id fallback
    if (!skipSameIdAnchor) {
        const allowSameId = !!op.sidOld && !isSyntheticGw(op.sidOld);
        const okSame = tryPlaceBySameId(unifiedRoot, op, ghost, allowSameId);
        if (okSame) return;
    }

    // Final move fallback
    if (ghostKind === "move") {
        const okIdx = insertIntoContainerAtOldIndex(unifiedRoot, ghost, ownerOld);

        if (okIdx) return;
    }

    unifiedRoot.appendChild(ghost);
}