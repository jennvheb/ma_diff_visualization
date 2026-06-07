import {
    pushUpdateNode,
    escapeXmlAttr,
    findByIdOutsideSubtree
} from "./opUtils.js";
import {
    elementByRelIndexPath,
    findContainingDeletedRoot,
    indexPathForNodeRelative,
} from "../dom/pathUtils.js";
import {slotKeyFromParPos} from "../xid/resolveByParPos.js";
import {findDrawableRelPathBySignature, signatureForDrawable} from "../dom/signatures.js";
import {isStructuralRel} from "../dom/drawableUtils.js";
import {isCoveredByDelete} from "./cleanupOps.js";

/**
 * detects false moves caused by renames
 * if a moved element is involved in an id rename and old/new parent positions are nearly the same,
 * it treats the move as an artifact and drops it
 *
 * @param del
 * @param ins
 * @param baseOld
 * @param renamedNewIds
 * @param renamedIdPairs
 * @returns {boolean}
 */
function isRenameMoveArtifact(del, ins, baseOld, renamedNewIds, renamedIdPairs) {
    const movedEl = elementByRelIndexPath(baseOld, del.oldPath);
    const movedId = movedEl?.getAttribute?.("id") || null;

    const involvedInRename =
        movedId && (
            renamedNewIds.has(movedId) ||
            renamedIdPairs.has(movedId) ||
            [...renamedIdPairs.values()].includes(movedId)
        );

    if (!involvedInRename) return false;

    const oldPar = del.par;
    const newPar = ins.par;
    if (!oldPar || !newPar || String(oldPar) !== String(newPar)) return false;

    const oldPos = Number(del.pos);
    const newPos = Number(ins.pos);
    if (!Number.isFinite(oldPos) || !Number.isFinite(newPos)) return false;
    return Math.abs(oldPos - newPos) <= 1;


}

/**
 * sometimes the parser drops an XYDiff move because it looked like noise,
 * but the same old id clearly exists in a new different path
 * -> recover those moves
 *
 * @param ctx
 * @param state
 * @param droppedMoveCandidates
 * @param updatedOwnerPaths
 * @param updatedOwnerIds
 */
function addDroppedXmMoveRecoveries(ctx, state, droppedMoveCandidates, updatedOwnerPaths, updatedOwnerIds) {
    const { baseOld, baseNew, newDrawablesById } = ctx;
    const { operations } = state;

    const alreadyMovedIds = new Set(
        operations
            .filter(o => o.kind === "move" || o.kind === "moveupdate")
            .map(o => elementByRelIndexPath(baseOld, o.oldPath)?.getAttribute?.("id"))
            .filter(Boolean)
            .map(String)
    );

    for (const { xmKey, del, ins, reason } of droppedMoveCandidates) {
        if (reason === "same-parent-adjacent-shift") continue;

        const oldEl = elementByRelIndexPath(baseOld, del.oldPath);
        const oldId = oldEl?.getAttribute?.("id");
        if (!oldId || alreadyMovedIds.has(String(oldId))) continue;

        const newEl = newDrawablesById.get(String(oldId));
        if (!newEl) continue;

        const realNewPath = indexPathForNodeRelative(baseNew, newEl);
        if (!realNewPath || realNewPath === del.oldPath) continue;

        const meaningful =
            updatedOwnerPaths.has(del.oldPath) ||
            updatedOwnerIds.has(String(oldId));

        operations.push({
            kind: meaningful ? "moveupdate" : "move",
            oldPath: del.oldPath,
            newPath: realNewPath,
            recoveredFromDroppedXmMove: true
        });

        alreadyMovedIds.add(String(oldId));
    }
}

/**
 * combines pending move-delete and move-insert parts into real move or moveupdate operations
 *
 * @param ctx
 * @param state
 */
export function pairMoves(ctx, state) {
    const {
        baseOld,
        baseNew,
        oldXidIndex,
        newXidIndex,
        newDrawablesById
    } = ctx;

    const droppedMoveCandidates = [];

    const { operations, pendingMoveDeletes, pendingMoveInserts } = state;
    // identify nodes that were updated
    // if the same node also moved, then final operation should be
    // moveupdate instead of separate move + update
    const updatedOwnerPaths = new Set(
        operations
            .filter(o =>
                (o.kind === "update-attr" || o.kind === "update-node" || o.kind === "update-text")
                && o.oldPath && o.oldPath !== "/?"
            )
            .map(o => o.oldPath)
    );

    const updatedOwnerIds = new Set();
    for (const p of updatedOwnerPaths) {
        const el = elementByRelIndexPath(baseOld, p);
        const id = el?.getAttribute?.("id");
        if (id) updatedOwnerIds.add(String(id));
    }

    // don't emit moves for nodes inside a deleted subtree
    const deletedRoots = operations
        .filter(o => o.kind === "delete" && o.oldPath && o.oldPath !== "/?")
        .map(o => o.oldPath);

    // loop over pending move deletes, try to find corresponding move-insert with same xmKey
    for (const [xmKey, del] of pendingMoveDeletes.entries()) {
        const ins = pendingMoveInserts.get(xmKey);

        // if only delete side exists, treat as delete
        if (!ins) {
            operations.push({ kind: "delete", oldPath: del.oldPath });
            continue;
        }
        // not a real move if old and new slot are the same, emit an update and drop the move
        const oldSlot = slotKeyFromParPos(oldXidIndex, baseOld, del.par, del.pos);
        const newSlot = slotKeyFromParPos(newXidIndex, baseNew, ins.par, ins.pos);

        if (oldSlot && newSlot && oldSlot === newSlot) {
            pushUpdateNode(
                operations,
                baseOld,
                del.oldPath,
                `<_moved_in_place xm="${escapeXmlAttr(xmKey)}"/>`
            );
            droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-path" });
            pendingMoveInserts.delete(xmKey);
            continue;
        }

        // resolve the new path
        const newPathDirect = ins?.newPath || null;
        const sOld = signatureForDrawable(baseOld, del.oldPath);
        const newPathBySig = (!newPathDirect && sOld)
            ? findDrawableRelPathBySignature(baseNew, sOld)
            : null;
        const chosenNewPath = newPathDirect || newPathBySig;

        const oldPar = del.par ? String(del.par) : null;
        const newPar = ins.par ? String(ins.par) : null;

        if (oldPar && newPar && oldPar === newPar) {
            const oldPos = Number(del.pos);
            const newPos = Number(ins.pos);

            if (Number.isFinite(oldPos) && Number.isFinite(newPos)) {
                const oldEl = elementByRelIndexPath(baseOld, del.oldPath);
                const oldId = oldEl?.getAttribute?.("id") || null;
                const newEl = elementByRelIndexPath(baseNew, chosenNewPath);
                const newId = newEl?.getAttribute?.("id") || null;

                // Same parent + adjacent index shift of the same node
                // Usually caused by insertion/deletion before it, not a semantic move
                if (oldId && newId && oldId === newId && Math.abs(oldPos - newPos) === 1) {
                    droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-parent-adjacent-shift" });
                    pendingMoveInserts.delete(xmKey);
                    continue;
                }
            }
        }

        // drop rename artifacts
        if (isRenameMoveArtifact(del, ins, baseOld, state.renamedNewIds, state.renamedIdPairs)) {
            droppedMoveCandidates.push({
                xmKey,
                del,
                ins,
                reason: "rename"
            });
            pendingMoveInserts.delete(xmKey);
            continue;
        }

        // check whether renamed new id already exists elsewhere outside a deleted subtree and emit delete instead of move if yes
        {
            const oldEl = elementByRelIndexPath(baseOld, del.oldPath);
            const ovId = oldEl?.getAttribute?.("id") || null;

            let nvId = null;
            if (ovId) {
                for (const [nv, ov] of state.renamedIdPairs.entries()) {
                    if (ov === ovId) {
                        nvId = nv;
                        break;
                    }
                }
            }

            if (nvId) {
                const delRoot = findContainingDeletedRoot(del.oldPath, deletedRoots);
                const existingElsewhere = findByIdOutsideSubtree(baseOld, nvId, delRoot);

                if (existingElsewhere) {
                    if (isCoveredByDelete(del.oldPath, deletedRoots)) {
                    } else {
                        operations.push({ kind: "delete", oldPath: del.oldPath });
                    }
                    droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-path" });
                    pendingMoveInserts.delete(xmKey);
                    continue;
                }
            }
        }
        // don't emit a move if the node is not a drawable element
        if (!chosenNewPath || !isStructuralRel(baseOld, del.oldPath) || !isStructuralRel(baseNew, chosenNewPath)) {

            if (isCoveredByDelete(del.oldPath, deletedRoots)) {
            } else {
                operations.push({ kind: "delete", oldPath: del.oldPath });
            }
            droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-path" });
            pendingMoveInserts.delete(xmKey);
            continue;
        }

        const oldEl = elementByRelIndexPath(baseOld, del.oldPath);
        const oldId = oldEl?.getAttribute?.("id") || null;
        let finalNewPath = chosenNewPath;
        // use the new path to correct xydiffs moved path (sometimes paths need to be corrected due to ghosts/relative paths, etc.)
        if (oldId) {
            const mappedNewEl = newDrawablesById.get(String(oldId)) || null;

            if (mappedNewEl) {
                const realNewRel = indexPathForNodeRelative(baseNew, mappedNewEl);


                if (realNewRel && chosenNewPath && realNewRel !== chosenNewPath) {
                    finalNewPath = realNewRel;
                }

                if (realNewRel && realNewRel === del.oldPath) {
                    droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-path" });
                    pendingMoveInserts.delete(xmKey);
                    continue;
                }
            }
        }

        // if old/new paths differ
        if ((del.oldPath || "") !== (finalNewPath || "")) {
            const movedOldPath = del.oldPath;
            const movedOldEl = elementByRelIndexPath(baseOld, movedOldPath);
            const movedOldId = movedOldEl?.getAttribute?.("id") || null;

            const meaningful =
                updatedOwnerPaths.has(movedOldPath) ||
                (movedOldId && updatedOwnerIds.has(String(movedOldId)));
            // if the update is meaningful (not noise) then emit a moveupdate else emit a move
            if (meaningful) {
                for (let i = operations.length - 1; i >= 0; i--) {
                    const o = operations[i];
                    if (!(o.kind === "update-attr" || o.kind === "update-node" || o.kind === "update-text")) continue;

                    if (o.oldPath === movedOldPath) {
                        operations.splice(i, 1);
                        continue;
                    }

                    if (movedOldId) {
                        const oEl = elementByRelIndexPath(baseOld, o.oldPath);
                        const oId = oEl?.getAttribute?.("id") || null;
                        if (oId && String(oId) === String(movedOldId)) {
                            operations.splice(i, 1);
                        }
                    }
                }
            }

            console.error("PAIR MOVE EMIT FULL", {
                xmKey,
                del,
                ins,
                oldPath: del.oldPath,
                chosenNewPath,
                finalNewPath,
                oldId,
            });

            operations.push({
                kind: meaningful ? "moveupdate" : "move",
                oldPath: del.oldPath,
                newPath: finalNewPath,
                newPayload: meaningful ? ins.payload : null
            });
        } else {
            droppedMoveCandidates.push({
                xmKey,
                del,
                ins,
                reason: "same-path"
            });
        }

        pendingMoveInserts.delete(xmKey);
    }

    addDroppedXmMoveRecoveries(
        ctx,
        state,
        droppedMoveCandidates,
        updatedOwnerPaths,
        updatedOwnerIds
    );

    // remaining unpaired inserts -> treat as inserts
    for (const [, ins] of pendingMoveInserts.entries()) {
        operations.push({ kind: "insert", newPath: ins.newPath, payload: null });
    }
}
