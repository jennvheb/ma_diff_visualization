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
import {indexPathForNodeRelative} from "../../integration/xyDiff/dom/pathUtils.js";

const BRANCH_CONTAINER_TAGS = new Set([
    "alternative",
    "otherwise",
    "parallel_branch"
]);

function placeMoveGhostAtOldSourceSlot(op, unifiedRoot, ctx, ghost) {
    const oldPath = op.rebasedOldPath || op.oldPath;
    if (!oldPath) return false;

    const container = findOldSourceParentContainerForGhost(
        op,
        unifiedRoot,
        ctx.oldRoot,
        ctx.newGatewayIndex
    );

    if (!container) return false;

    const desiredIdx =
        parentPath(oldPath) === "/"
            ? adjustedTopLevelXySlot(ctx.oldRoot, oldPath)
            : lastSeg(oldPath);

    const kids = elementChildrenOnly(container);

    if (kids[desiredIdx]) {
        container.insertBefore(ghost, kids[desiredIdx]);
    } else {
        container.appendChild(ghost);
    }

    console.log("MOVE GHOST placed at old source slot", {
        sidOld: op.sidOld,
        oldPath,
        desiredIdx,
        containerTag: tagName(container),
        ghostId: ghost.getAttribute("id")
    });

    return true;
}


function adjustedTopLevelXySlot(oldRoot, oldPath) {
    const idx = lastSeg(oldPath);

    const init = Array.from(oldRoot.childNodes || [])
        .filter(n => n.nodeType === 1)
        .findIndex(n => n.getAttribute?.("id") === "init");

    if (init >= 0 && init < idx) {
        return idx - 1;
    }

    return idx;
}
function elementChildrenOnly(el) {
    return Array.from(el?.childNodes || []).filter(n => n.nodeType === 1);
}
function isBranchContainer(elOrTag) {
    const t = typeof elOrTag === "string"
        ? elOrTag
        : tagName(elOrTag);

    return BRANCH_CONTAINER_TAGS.has(t);
}

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
        const direct = findAnchorInUnifiedById(unifiedRoot, oldGatewayId);
        if (direct) return direct;
    }

    // fallback: gateway id changed, use existing gateway matcher.
    if (Array.isArray(newGatewayIndex)) {
        const parentDrawable = nearestDrawable(oldGateway.parentNode);
        const parentId = parentDrawable?.getAttribute?.("id") || "root";

        const bestId = bestMatchGatewayInNew(
            oldGateway,
            parentId,
            newGatewayIndex
        );

        if (bestId) {
            const matched = findAnchorInUnifiedById(unifiedRoot, bestId);
            if (matched) return matched;
        }
    }

    return null;
}

function tryPlaceDeletedBranchInsideSurvivingGateway(op, unifiedRoot, ctx, ghost) {
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

    console.error("PLACE DELETED BRANCH GHOST INSIDE SURVIVING GATEWAY", {
        oldPath: op.oldPath,
        rebasedOldPath: op.rebasedOldPath,
        branchTag: op.oldNodeTag,
        ghostId: ghost.getAttribute("id"),
        containerId: container.getAttribute?.("id") || null,
        containerTag: tagName(container),
        desiredIdx,
        reservedIdx: idx
    });

    return true;
}

function replacementInsertForOldPath(oldPath, ctx) {
    if (!oldPath || !Array.isArray(ctx?.ops)) return null;

    return ctx.ops.find(o =>
        o.type === "insert" &&
        (o.newPath === oldPath || o.rebasedNewPath === oldPath) &&
        o.sidNew
    ) || null;
}

function replacementIdForOldPath(oldPath, ctx) {
    return replacementInsertForOldPath(oldPath, ctx)?.sidNew || null;
}
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

function findVisibleOldSiblingAnchor(
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
            const anchor = findAnchorInUnifiedById(unifiedRoot, aid);
            if (anchor) {
                return { anchor, oldSibling, direction };
            }
        }
    }

    return null;
}
function tryPlaceReplacementDeleteGhost(op, unifiedRoot, ctx, ghost) {
    if (!op?.oldPath) return false;

    const oldNode = recoverByPath(ctx.oldRoot, op.oldPath);
    const newNode = recoverByPath(ctx.newRoot, op.oldPath);

    const oldId = oldNode?.getAttribute?.("id") || null;
    const newId = newNode?.getAttribute?.("id") || null;

    if (!oldId || !newId || oldId === newId) return false;

    const replacementAnchor = findAnchorInUnifiedById(unifiedRoot, newId);
    if (!replacementAnchor) return false;

    const p = replacementAnchor.parentNode || unifiedRoot;
    p.insertBefore(ghost, replacementAnchor);

    console.error("PLACE DELETE BEFORE REPLACEMENT", {
        oldPath: op.oldPath,
        oldId,
        replacementId: newId
    });

    return true;
}

function tryPlaceByOldNeighborsPreferMoveGhost(
    unifiedRoot,
    ownerOld,
    ghost,
    movedOldIds,
    deletedOldIds,
    oldRoot,
    ghostKind,
    ctx
) {    const parent = ownerOld?.parentNode;
    if (!parent) return false;

    const siblings = drawableChildrenOnly(parent);
    const myIdx = siblings.indexOf(ownerOld);

    if (myIdx < 0) return false;

    // Prefer previous stable/placed sibling.
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

        const oldSiblingPath = indexPathForNodeRelative(oldRoot, found.oldSibling);
        const replId = replacementIdForOldPath(oldSiblingPath, ctx);
        const replAnchor = replId ? findAnchorInUnifiedById(unifiedRoot, replId) : null;

        console.error("PLACE AFTER PREVIOUS", {
            ghostId: ghost.getAttribute("id"),
            ghostKind,
            previousOldId: found.oldSibling?.getAttribute?.("id") || null,
            previousAnchorId: found.anchor?.getAttribute?.("id") || null,
            replId,
            replAnchorFound: !!replAnchor
        });

        if (found.anchor.nextSibling) p.insertBefore(ghost, found.anchor.nextSibling);
        else p.appendChild(ghost);
        return true;
    }

    // Then try next stable/placed sibling.
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
        return true;
    }

    return false;
}

function recoverByPath(root, path) {
    if (!root || !path || path === "/") return root;

    const segs = String(path).split("/").filter(Boolean).map(Number);
    let cur = root;

    for (const idx of segs) {
        const kids = Array.from(cur.childNodes || []).filter(n => n.nodeType === 1);
        cur = kids[idx] || null;
        if (!cur) return null;
    }

    return cur;
}
function findSamePathParentContainer(op, unifiedRoot, oldRoot) {
    const oldPath = op.rebasedOldPath || op.oldPath;
    if (!oldPath) return null;

    const pp = parentPath(oldPath);

    const oldParent = recoverByPath(oldRoot, pp);
    const unifiedParent = recoverByPath(unifiedRoot, pp);

    if (
        oldParent &&
        unifiedParent &&
        tagName(oldParent) === tagName(unifiedParent)
    ) {
        return unifiedParent;
    }

    return null;
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

function findOldSourceParentContainerForGhost(op, unifiedRoot, oldRoot, newGatewayIndex) {
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
        const direct = findAnchorInUnifiedById(unifiedRoot, oldParentId);
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
            ? findAnchorInUnifiedById(unifiedRoot, oldGatewayId)
            : null;

        if (!newGateway && oldGateway && Array.isArray(newGatewayIndex)) {
            const parentDrawable = nearestDrawable(oldGateway.parentNode);
            const parentId = parentDrawable?.getAttribute?.("id") || "root";
            const bestId = bestMatchGatewayInNew(oldGateway, parentId, newGatewayIndex);
            if (bestId) newGateway = findAnchorInUnifiedById(unifiedRoot, bestId);
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
        return;
    }

    const ghost = cloneSource.cloneNode(true);
    ghost.setAttribute("_ghost", ghostKind);
    prefixDrawableIdsInSubtree(ghost, ghostKind);

    //
    // XYDiff placement: XYDiff oldPath values are static OLD paths.
    // --> So for delete/move ghosts, keep them in their OLD source area.
    // =/= CpeeDiff dynamic/fuzzy placement
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

            console.log("XY GHOST parentGhostPlacement", okParentGhost);
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

                const kids = elementChildrenOnly(container);

                if (kids[desiredIdx]) {
                    container.insertBefore(ghost, kids[desiredIdx]);
                } else {
                    container.appendChild(ghost);
                }

                return;
            }
        }

        const okNeighbor = tryPlaceByOldNeighborsPreferMoveGhost(
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
        const okReplacement = tryPlaceReplacementDeleteGhost(
            {
                ...op,
                oldPath: op.rebasedOldPath || op.oldPath
            },
            unifiedRoot,
            ctx,
            ghost
        );

        if (okReplacement) return;

        const okNei = tryPlaceByOldNeighborsPreferMoveGhost(
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

        console.log("GHOST parentGhostPlacement", okParentGhost);
        if (okParentGhost) return;

        const container = findNearestExistingAncestorInUnified(
            op,
            unifiedRoot,
            ctx.oldRoot,
            newGatewayIndex
        );

        console.log("GHOST nearestAncestorContainer", container ? {
            tag: tagName(container),
            id: container.getAttribute("id")
        } : null);

        if (container) {
            const ok = insertIntoContainerAtOldIndex(container, ghost, ownerOld);

            console.log("containerInsertAtOldIndex", ok, {
                oldIdx: indexAmongDrawableSiblings(ownerOld),
                containerId: container.getAttribute("id"),
                containerTag: tagName(container)
            });

            return;
        }

        const ownerParentPath = parentPath(op.rebasedOldPath || op.oldPath);
        const isTopLevelDelete = ownerParentPath === "/";
/*
        if (isTopLevelDelete) {
            const okNei = tryPlaceByOldNeighborsPreferMoveGhost(
                unifiedRoot,
                ownerOld,
                ghost,
                ctx.movedOldIds,
                ctx.deletedOldIds
            );

            if (okNei) {
                console.log("GHOST placedBy=topLevelNeighbor", {
                    ghostId: ghost.getAttribute("id"),
                    unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
                });
                return;
            }

            const okIdx = insertIntoContainerAtOldIndex(
                unifiedRoot,
                ghost,
                ownerOld
            );

            console.log("GHOST topLevel oldIndexFallback", okIdx, {
                ghostId: ghost.getAttribute("id"),
                oldIdx: indexAmongDrawableSiblings(ownerOld),
                unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
            });

            return;
        }*/

        const ok = insertIntoContainerAtOldIndex(unifiedRoot, ghost, ownerOld);
        console.log("rootInsertAtOldIndex", ok);
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
            ? findAnchorInUnifiedById(unifiedRoot, replacementId)
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

        console.log(`GHOST ${ghostKind} sameIdPlacement`, okSame);
        if (okSame) return;
    }

    // Final move fallback
    if (ghostKind === "move") {
        const okIdx = insertIntoContainerAtOldIndex(unifiedRoot, ghost, ownerOld);

        console.log("GHOST move root oldIndexFallback", okIdx, {
            ghostId: ghost.getAttribute("id"),
            oldIdx: indexAmongDrawableSiblings(ownerOld),
            unifiedTopAfter: topLevelDrawableOrder(unifiedRoot, 25),
        });

        if (okIdx) return;
    }

    console.warn("GHOST ALL placement strategies failed -> fallback append to unifiedRoot", {
        ghostId: ghost.getAttribute("id"),
        ghostKind
    });

    unifiedRoot.appendChild(ghost);
}