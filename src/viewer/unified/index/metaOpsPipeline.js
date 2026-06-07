import {firstKRealTaskIds, gatewayStructureSig, nearestDrawable, tagName} from "../../../integration/stableIds.js";
import {collectDrawableIdsXML, findById} from "../xml.js";
import {attachUpdateContent, mergeMoveAndUpdateOps} from "../normalize/normalizeUpdateContent.js";
import {indexPathForNodeRelative} from "../../../integration/xyDiff/dom/pathUtils.js";
import {normalizeOp} from "../normalize/normalizeOps.js";
import {parentPath} from "../config.js";
import {isStrictAncestorPath} from "../paths.js";

/**
 * cpeediff only
 * tries to recover additional moves inside an explicit move region when the same stable id exists inside the old moved subtree and the new moved subtree, but CpeeDiff did not emit that child as a move itself
 *
 * @param metaOps
 * @param oldRoot
 * @param newRoot
 * @param isXy
 * @returns {*|*[]}
 */
function recoverStableIdMovesForCpeeDiff(metaOps, oldRoot, newRoot, isXy) {
    if (isXy) return metaOps;

    const explicitMoves = metaOps.filter(op =>
        (op.type === "move" || op.type === "moveupdate") &&
        !op.recoveredFromStableId
    );

    if (!explicitMoves.length) {
        return metaOps;
    }

    const existingMoveIds = new Set(
        explicitMoves
            .map(op => op.sidOld)
            .filter(Boolean)
    );

    const deletedSelfIds = new Set(
        metaOps
            .filter(op => op.type === "delete")
            .map(op => op.sidOld)
            .filter(Boolean)
    );

    const insertedIds = new Set(
        metaOps
            .filter(op => op.type === "insert")
            .map(op => op.sidNew)
            .filter(Boolean)
    );

    const stableMoves = [];

    /*
     * Only recover stable-id moves inside explicit move regions.
     * Otherwise every path shift after a gateway/delete restructuring becomes
     * a fake move.
     */
    for (const moveOp of explicitMoves) {
        const oldMoveRoot = moveOp.ownerOld;
        const newMoveRoot = moveOp.ownerNew;

        if (!oldMoveRoot || !newMoveRoot) continue;

        const oldCandidates = Array.from(oldMoveRoot.getElementsByTagName("*"));

        for (const oldEl of oldCandidates) {
            const id = oldEl.getAttribute?.("id");
            if (!id || id.startsWith("__gw_")) continue;
            if (existingMoveIds.has(id)) continue;
            if (deletedSelfIds.has(id)) continue;
            if (insertedIds.has(id)) continue;

            const newEl = findById(newMoveRoot, id);
            if (!newEl) continue;

            const oldPath = indexPathForNodeRelative(oldRoot, oldEl);
            const newPath = indexPathForNodeRelative(newRoot, newEl);

            if (!oldPath || !newPath || oldPath === newPath) continue;

            stableMoves.push({
                type: "move",
                oldPath,
                newPath,
                rebasedOldPath: oldPath,
                rebasedNewPath: newPath,
                ownerOld: nearestDrawable(oldEl),
                ownerOldDynamic: null,
                ownerNew: nearestDrawable(newEl),
                sidOld: id,
                sidNew: id,
                mergeOwnerId: id,
                mergeOwnerPath: oldPath,
                oldNodeStatic: oldEl,
                oldNodeTag: tagName(oldEl),
                selfOldIsDrawable: true,
                selfOldId: id,
                subtreeIdsOld: collectDrawableIdsXML(oldEl),
                subtreeIdsNew: collectDrawableIdsXML(newEl),
                contentOld: null,
                contentNew: null,
                contentDiff: null,
                changeOccured: false,
                recoveredFromStableId: true
            });
        }
    }

    return [...metaOps, ...stableMoves];
}

function isMoveLike(op) {
    return op?.type === "move" || op?.type === "moveupdate";
}

function stableOpId(op) {
    return op?.sidOld || op?.sidNew || op?.selfOldId || null;
}

function isStrictDescendantPath(child, parent) {
    return !!child && !!parent && child !== parent && child.startsWith(parent + "/");
}

function parentCoversChildMove(parentOp, childOp) {
    if (!isMoveLike(parentOp) || !isMoveLike(childOp)) return false;
    if (parentOp === childOp) return false;

    const parentId = stableOpId(parentOp);
    const childId = stableOpId(childOp);

    // never compare the same op against itself logically
    if (parentId && childId && parentId === childId) return false;

    // strongest signal: subtree ids
    if (childId) {
        if ((parentOp.subtreeIdsOld || []).includes(childId)) return true;
        if ((parentOp.subtreeIdsNew || []).includes(childId)) return true;
    }

    // fallback: path containment
    const parentOld = parentOp.rebasedOldPath || parentOp.oldPath || null;
    const childOld = childOp.rebasedOldPath || childOp.oldPath || null;
    if (isStrictDescendantPath(childOld, parentOld)) return true;

    const parentNew = parentOp.rebasedNewPath || parentOp.newPath || null;
    const childNew = childOp.rebasedNewPath || childOp.newPath || null;
    if (isStrictDescendantPath(childNew, parentNew)) return true;
}

/**
 * removes move/moveupdate operations already covered by a parent move
 * uses subtree ids and path containment
 *
 * @param metaOps
 * @returns {*}
 */
function suppressNestedMoveOps(metaOps) {
    return metaOps.filter((op, i) => {
        if (!isMoveLike(op)) return true;

        const covered = metaOps.some((other, j) => {
            if (i === j) return false;
            return parentCoversChildMove(other, op);
        });

        if (covered) {
            return false;
        }

        return true;
    });
}

/**
 * turns raw diffOps into enriched metaOps
 *
 * So a raw op becomes an enriched op with rebased paths, old/new owners, stable ids, subtree ids, content snapshots, content diff, changeOccured flag
 * Then filters fake updates, merges move + update into moveupdate, recovers stable-id child moves,
 * suppresses nested moves, filters same-parent CpeeDiff shifts, computes movedOldIds and deletedOldIds, marks inserted-then-moved / covered-by-ancestor flags
 *
 * -> prepares the operation list for rendering, coloring, clicking, and undo
 *
 * @param oldRoot
 * @param newRoot
 * @param diffOps
 * @param isXy
 * @returns {{baseCtx: {newGatewayIndex: *[], newRoot, isXy, oldRoot}, deletedOldIds: Set<any>, movedOldIds: Set<any>, metaOps: *}}
 */
export function buildMetaOps({ oldRoot, newRoot, diffOps, isXy }) {
    function indexNewGateways(root) {
        const arr = [];
        root.querySelectorAll("loop, choose, parallel, otherwise, alternative, parallel_branch, stop")
            .forEach(gw => {
                const id = gw.getAttribute("id") || null;
                const parent = nearestDrawable(gw.parentNode);
                const pid = parent?.getAttribute("id") || "root";
                const witnesses = firstKRealTaskIds(gw, 3);
                const struct = gatewayStructureSig(gw);
                arr.push({ id, pid, witnesses, struct });
            });
        return arr;
    }

    const newGatewayIndex = indexNewGateways(newRoot);

    const baseCtx = {
        isXy,
        oldRoot,
        newRoot,
        newGatewayIndex,
    };

    let metaOps = diffOps.map((op, idx) => {
        const base = normalizeOp(op, idx, diffOps, baseCtx);

        const subtreeIdsOld = base.ownerOld ? collectDrawableIdsXML(base.ownerOld) : [];
        const subtreeIdsNew = base.ownerNew ? collectDrawableIdsXML(base.ownerNew) : [];

        const { contentOld, contentNew, contentDiff, changeOccured } =
            attachUpdateContent(base, baseCtx);

        return {
            ...base,
            deltaIndex: idx,
            subtreeIdsOld,
            subtreeIdsNew,
            contentOld,
            contentNew,
            contentDiff,
            changeOccured,
        };
    }).filter(op => {
        if (op.type === "update") return !!op.changeOccured;
        return true;
    });

    metaOps = mergeMoveAndUpdateOps(metaOps);
    metaOps = recoverStableIdMovesForCpeeDiff(metaOps, oldRoot, newRoot, isXy);
    metaOps = suppressNestedMoveOps(metaOps);
    if (!isXy) {
        metaOps = metaOps.filter(op => {
            if (op.type !== "move" && op.type !== "moveupdate") return true;

            const oldP = op.rebasedOldPath || op.oldPath;
            const newP = op.rebasedNewPath || op.newPath;

            // only index changed inside same parent = shift, not visual move
            if (oldP && newP && parentPath(oldP) === parentPath(newP)) {
                return false;
            }

            return true;
        });
    }

    const insertedNewIds = new Set();
    for (const op of metaOps) {
        if (op.type !== "insert") continue;
        if (op.sidNew) insertedNewIds.add(op.sidNew);
    }

    const movedOldIds = new Set();
    for (const op of metaOps) {
        if (!(op.type === "move" || op.type === "moveupdate")) continue;
        if (op.sidOld) movedOldIds.add(op.sidOld);
        for (const id of op.subtreeIdsOld || []) movedOldIds.add(id);
    }

    metaOps = metaOps.filter((op) => {
        if (op.type !== "delete") return true;
        if (op.selfOldIsDrawable && op.selfOldId && movedOldIds.has(op.selfOldId)) {
            return false;
        }
        return true;
    });

    metaOps = metaOps.map((op) => {
        if (!(op.type === "move" || op.type === "moveupdate")) return op;

        const insertedThenMoved =
            !!op.sidNew && insertedNewIds.has(op.sidNew) &&
            (!op.sidOld || !op.ownerOld);

        const myOldPath = op.rebasedOldPath || op.oldPath || "";

        const coveredByAncestorMoveGhost = metaOps.some((other) => {
            if (other === op) return false;
            if (!(other.type === "move" || other.type === "moveupdate")) return false;

            const otherOldPath = other.rebasedOldPath || other.oldPath || "";
            if (!otherOldPath || !myOldPath) return false;

            return isStrictAncestorPath(otherOldPath, myOldPath);
        });

        return {
            ...op,
            _insertedThenMoved: insertedThenMoved,
            _coveredByAncestorMoveGhost: coveredByAncestorMoveGhost,
        };
    });

    const deletedOldIds = new Set();
    for (const op of metaOps) {
        if (op.type !== "delete") continue;
        if (op.sidOld) deletedOldIds.add(op.sidOld);
        for (const id of op.subtreeIdsOld || []) deletedOldIds.add(id);
    }

    return {
        metaOps,
        baseCtx,
        movedOldIds,
        deletedOldIds
    };
}

