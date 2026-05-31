import {
    pushUpdateNode,
    escapeXmlAttr,
    findByIdOutsideSubtree
} from "./opUtils.js";
import {
    elementByRelIndexPath,
    findContainingDeletedRoot,
    indexPathForNodeRelative,
    isCoveredByDelete
} from "../dom/pathUtils.js";
import {slotKeyFromParPos} from "../xid/resolveByParPos.js";
import {findDrawableRelPathBySignature, signatureForDrawable} from "../dom/signatures.js";
import {isStructuralRel} from "../dom/drawableUtils.js";

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
    if (Math.abs(oldPos - newPos) > 1) return false;

    return true;
}

function pathParent(p) {
    const parts = String(p || "").split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/");
}

function pathLastIndex(p) {
    const parts = String(p || "").split("/").filter(Boolean);
    return Number(parts[parts.length - 1]);
}

function isSameParentIndexShift(oldPath, newPath) {
    if (pathParent(oldPath) !== pathParent(newPath)) return false;

    const oi = pathLastIndex(oldPath);
    const ni = pathLastIndex(newPath);

    return Number.isFinite(oi) && Number.isFinite(ni) && oi !== ni;
}

function hasInsertBeforeOrAtSiblingSlot(operations, parent, newIndex) {
    return operations.some(o => {
        if (o.kind !== "insert" || !o.newPath) return false;
        if (pathParent(o.newPath) !== parent) return false;

        const ii = pathLastIndex(o.newPath);
        return Number.isFinite(ii) && ii <= newIndex;
    });
}

function isPassiveSiblingShiftByInsert(operations, oldPath, newPath) {
    if (!isSameParentIndexShift(oldPath, newPath)) return false;

    const parent = pathParent(newPath);
    const newIndex = pathLastIndex(newPath);

    return hasInsertBeforeOrAtSiblingSlot(operations, parent, newIndex);
}

function sameParentMove(o) {
    return pathParent(o.oldPath) === pathParent(o.newPath);
}

function collectStructuralById(root, baseRoot) {
    const out = new Map();

    function walk(node) {
        if (!node || node.nodeType !== 1) return;

        const id = node.getAttribute?.("id");
        if (id) {
            const p = indexPathForNodeRelative(baseRoot, node);
            if (p && isStructuralRel(baseRoot, p)) {
                out.set(String(id), { node, path: p });
            }
        }

        for (const c of Array.from(node.childNodes || [])) {
            walk(c);
        }
    }

    walk(root);
    return out;
}

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

        console.error("recover dropped xm move", {
            xmKey,
            reason,
            id: oldId,
            oldPath: del.oldPath,
            newPath: realNewPath,
            chosenNewPathWas: ins?.newPath,
            meaningful
        });

        operations.push({
            kind: meaningful ? "moveupdate" : "move",
            oldPath: del.oldPath,
            newPath: realNewPath,
            recoveredFromDroppedXmMove: true
        });

        alreadyMovedIds.add(String(oldId));
    }
}
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

    const deletedRoots = operations
        .filter(o => o.kind === "delete" && o.oldPath && o.oldPath !== "/?")
        .map(o => o.oldPath);

    for (const [xmKey, del] of pendingMoveDeletes.entries()) {
        const ins = pendingMoveInserts.get(xmKey);

        if (!ins) {
            operations.push({ kind: "delete", oldPath: del.oldPath });
            continue;
        }

        const oldSlot = slotKeyFromParPos(oldXidIndex, baseOld, del.par, del.pos);
        const newSlot = slotKeyFromParPos(newXidIndex, baseNew, ins.par, ins.pos);

        if (oldSlot && newSlot && oldSlot === newSlot) {
            console.error("MOVE->UPDATE same-slot", { xmKey, oldSlot });

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

        const newPathDirect = ins?.newPath || null;
        const sOld = signatureForDrawable(baseOld, del.oldPath);
        const newPathBySig = (!newPathDirect && sOld)
            ? findDrawableRelPathBySignature(baseNew, sOld)
            : null;
        const chosenNewPath = newPathDirect || newPathBySig;

        if (isRenameMoveArtifact(del, ins, baseOld, state.renamedNewIds, state.renamedIdPairs)) {
            console.error("DROP MOVE - RENAME", {
                xmKey,
                oldPath: del.oldPath,
                par: del.par,
                oldPos: del.pos,
                newPos: ins.pos
            });

            droppedMoveCandidates.push({
                xmKey,
                del,
                ins,
                reason: "rename"
            });
            pendingMoveInserts.delete(xmKey);
            continue;
        }

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
                    const existingRel = indexPathForNodeRelative(baseOld, existingElsewhere);

                    console.error("DROP MOVE - RENAME ID COLLISION", {
                        xmKey,
                        oldPath: del.oldPath,
                        deletedRoot: delRoot,
                        renamedFrom: ovId,
                        renamedTo: nvId,
                        existingElsewhereRel: existingRel,
                        chosenNewPath
                    });

                    if (isCoveredByDelete(del.oldPath, deletedRoots)) {
                        console.error("SKIP CHILD DELETE - COVERED BY ANCESTOR DELETE", {
                            xmKey,
                            child: del.oldPath,
                            by: findContainingDeletedRoot(del.oldPath, deletedRoots)
                        });
                    } else {
                        operations.push({ kind: "delete", oldPath: del.oldPath });
                    }
                    droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-path" });
                    pendingMoveInserts.delete(xmKey);
                    continue;
                }
            }
        }

        if (!chosenNewPath || !isStructuralRel(baseOld, del.oldPath) || !isStructuralRel(baseNew, chosenNewPath)) {
            console.error("DROP MOVE - NON-STRUCTURAL", { xmKey, oldPath: del.oldPath, chosenNewPath });

            if (isCoveredByDelete(del.oldPath, deletedRoots)) {
                console.error("SKIP CHILD DELETE - COVERED BY ANCESTOR DELETE", {
                    xmKey,
                    child: del.oldPath,
                    by: findContainingDeletedRoot(del.oldPath, deletedRoots)
                });
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

        if (oldId) {
            const mappedNewEl = newDrawablesById.get(String(oldId)) || null;

            if (mappedNewEl) {
                const realNewRel = indexPathForNodeRelative(baseNew, mappedNewEl);


                if (realNewRel && chosenNewPath && realNewRel !== chosenNewPath) {
                    console.error("MOVE TARGET OVERRIDDEN", { xmKey, chosenNewPath, realNewRel });
                    finalNewPath = realNewRel;
                }

                if (realNewRel && realNewRel === del.oldPath) {
                    console.error("DROP MOVE - SAME LOCATION", { xmKey, oldPath: del.oldPath });

                 /*   pushUpdateNode(
                        operations,
                        baseOld,
                        del.oldPath,
                        `<_moved_noise xm="${escapeXmlAttr(xmKey)}"/>`
                    );*/
                    droppedMoveCandidates.push({ xmKey, del, ins, reason: "same-path" });
                    pendingMoveInserts.delete(xmKey);
                    continue;
                }
            }
        }

        if ((del.oldPath || "") !== (finalNewPath || "")) {
            const movedOldPath = del.oldPath;
            const movedOldEl = elementByRelIndexPath(baseOld, movedOldPath);
            const movedOldId = movedOldEl?.getAttribute?.("id") || null;

            const meaningful =
                updatedOwnerPaths.has(movedOldPath) ||
                (movedOldId && updatedOwnerIds.has(String(movedOldId)));

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
            const dbgOldEl = elementByRelIndexPath(baseOld, del.oldPath);
            const dbgNewEl = elementByRelIndexPath(baseNew, finalNewPath);

            console.error("PAIR MOVE EMIT", {
                xmKey,
                oldPath: del.oldPath,
                newPath: finalNewPath,
                oldTag: dbgOldEl?.localName || null,
                oldId: dbgOldEl?.getAttribute?.("id") || null,
                newTag: dbgNewEl?.localName || null,
                newId: dbgNewEl?.getAttribute?.("id") || null,
                meaningful
            });

            operations.push({
                kind: meaningful ? "moveupdate" : "move",
                oldPath: del.oldPath,
                newPath: finalNewPath,
                newPayload: meaningful ? ins.payload : null
            });
        } else {
            console.error("DROP MOVE - SAME PATH", { xmKey, oldPath: del.oldPath, chosenNewPath });

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
    for (const [, ins] of pendingMoveInserts.entries()) {
        operations.push({ kind: "insert", newPath: ins.newPath, payload: null });
    }
}
