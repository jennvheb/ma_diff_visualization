import {
    firstXmId,
    normalizeXmKey,
    resolveRelPathByXid,
    resolveRelPathByXidForMove,
    xidElTag
} from "../xid/resolveByXid.js";
import {firstElementChild} from "../dom/domUtils.js";
import {isDrawableTagName, payloadIsShiftingOnly, snapRelPathToDrawable} from "../dom/drawableUtils.js";
import {resolveMoveObjectRelByParPos, resolveNewPathForInsert} from "../xid/resolveByParPos.js";
import {elementByRelIndexPath, indexPathForNodeRelative, trimRelPathToExistingElement} from "../dom/pathUtils.js";
import {
    findRelById,
    isTextOnlyInsert,
    ownerOldPathForNewInsert,
    pushUpdateNode,
    textContentTrimmed
} from "./opUtils.js";
import {buildXyDiffXidIndex} from "../xid/xidMap.js";
import {NON_STRUCTURAL_MOVE_TAGS} from "../../tags.js";

/**
 * checks whether an internal insert belongs to a node that is already being moved
 * avoids creating false updates inside a moved subtree
 *
 * @param state
 * @param ownerOldPath
 * @returns {boolean}
 */
function isOwnerPartOfPendingMove(state, ownerOldPath) {
    if (!ownerOldPath) return false;

    for (const del of state.pendingMoveDeletes.values()) {
        if (!del?.oldPath) continue;
        if (del.oldPath === ownerOldPath) return true;
    }

    return false;
}

/**
 * checks whether an id is involved in rename tracking
 * used to avoid turning rename artifacts into moves/updates incorrectly
 *
 * @param id
 * @param state
 * @returns {*|boolean|boolean}
 */
function isIdInRename(id, state) {
    if (!id) return false;

    return (
        state.renamedNewIds?.has(String(id)) ||
        state.renamedIdPairs?.has(String(id)) ||
        [...(state.renamedIdPairs?.values?.() || [])].includes(String(id))
    );
}

/**
 * searches existing delete operations for a deleted node with a certain id
 *
 * @param operations
 * @param baseOld
 * @param id
 * @returns {*|null}
 */
function findDeleteOpByOldId(operations, baseOld, id) {
    if (!id) return null;

    return operations.find(o => {
        if (o.kind !== "delete" || !o.oldPath) return false;

        const oldEl = elementByRelIndexPath(baseOld, o.oldPath);
        const oldId = oldEl?.getAttribute?.("id") || null;

        return oldId && String(oldId) === String(id);
    }) || null;
}

/**
 * converts XYDiff insert edits into either insert, update-node, update-text, move, or pending move-insert entries
 * insert does not always mean real inserted process node
 *
 * @param edit
 * @param ctx
 * @param state
 */
export function handleInsert(edit, ctx, state) {
    const { baseOld, baseNew, newXidIndex, newDom, serializer } = ctx;

    const isMove = edit.getAttribute("move") === "yes";

    const insertedNode = firstElementChild(edit);

    if (insertedNode && payloadIsShiftingOnly(insertedNode)) {
        return;
    }

    if (!isMove && insertedNode) {
        const tag = (insertedNode.localName || insertedNode.tagName || "").toLowerCase();
        if (tag === "arguments") { // argument changes are handled as updates not inserts
            return;
        }
    }

    const payload = insertedNode ? serializer.serializeToString(insertedNode) : null;

    if (isMove) { // similar behavior to delete move, so they can be later combined to move in pairmoves()
        const xmKey = normalizeXmKey(edit.getAttribute("xm"));
        const xmIdMove = firstXmId(edit.getAttribute("xm"));
        const rawTag = xidElTag(newXidIndex, xmIdMove);

        if (rawTag && NON_STRUCTURAL_MOVE_TAGS.has(rawTag)) {
            return;
        }

        const newOwnerPath =
            resolveMoveObjectRelByParPos(newXidIndex, baseNew, edit.getAttribute("par"), edit.getAttribute("pos"))
            || resolveRelPathByXidForMove(newXidIndex, baseNew, xmIdMove);

        if (xmKey && newOwnerPath) {
            state.pendingMoveInserts.set(xmKey, {
                newPath: newOwnerPath,
                xmId: xmIdMove,
                rawTag,
                par: edit.getAttribute("par"),
                pos: edit.getAttribute("pos"),
                payload
            });
            return;
        }
        return;
    }

    let newPath =
        resolveNewPathForInsert(edit, baseNew, newXidIndex) ||
        resolveRelPathByXid(newXidIndex, baseNew, firstXmId(edit.getAttribute("xm")), { snapIfNotDrawable: false }) ||
        "/?";

    const exists = elementByRelIndexPath(baseNew, newPath);
    if (!exists) newPath = trimRelPathToExistingElement(baseNew, newPath); // make sure newPath points to an existing element in the new tree

    newPath = trimRelPathToExistingElement(baseNew, newPath);

    if (payload) {
        const payloadId = insertedNode?.getAttribute?.("id") || null;

        if (payloadId) {
            const oldRel = findRelById(baseOld, payloadId); // if inserted payload has an id, check whether it already existed

            if (oldRel && !isIdInRename(payloadId, state)) { // but skip it for renamed ids (e.g. xydiff emits au id change from a1 to a2, then seeing a2 in new should not become move a2
                const oldPath = snapRelPathToDrawable(baseOld, oldRel);

                const matchingDelete = findDeleteOpByOldId(
                    state.operations,
                    baseOld,
                    payloadId
                );

                if (matchingDelete) { // same id was deleted before -> delete+insert becomes move/update
                    const moveOldPath = matchingDelete.oldPath || oldPath;


                    const deleteIdx = state.operations.indexOf(matchingDelete);
                    if (deleteIdx >= 0) state.operations.splice(deleteIdx, 1);
                    // if path changed of same id: move
                    if (moveOldPath && newPath && moveOldPath !== newPath) {
                        console.error("same id delete+insert becomes move", {
                            id: payloadId,
                            oldPath: moveOldPath,
                            newPath
                        });

                        state.operations.push({
                            kind: "move",
                            oldPath: moveOldPath,
                            newPath
                        });

                        return;
                    }
                    // if path did not change of same id: update
                    console.error("same id delete insert becomes update", {
                        id: payloadId,
                        oldPath: moveOldPath,
                        newPath
                    });

                    pushUpdateNode(
                        state.operations,
                        baseOld,
                        moveOldPath,
                        payload
                    );

                    return;
                }
                // same id exists in old but there was no delete operation
                if (oldPath && newPath && oldPath !== newPath) {
                    state.operations.push({
                        kind: "move",
                        oldPath,
                        newPath
                    });
                    return;
                }

                pushUpdateNode(
                    state.operations,
                    baseOld,
                    oldPath,
                    payload
                );

                return;
            }
        }

        if (isTextOnlyInsert(edit)) { // text only inserts become text updates
            const xidPreorderNew = buildXyDiffXidIndex(newDom);
            const parId = edit.getAttribute("par");
            const parentElem = xidPreorderNew.get(String(parId));

            if (parentElem) {
                let parentRel = indexPathForNodeRelative(baseNew, parentElem);
                if (parentRel) {
                    parentRel = snapRelPathToDrawable(baseNew, parentRel);
                    state.operations.push({
                        kind: "update-text",
                        oldPath: parentRel,
                        newValue: textContentTrimmed(edit)
                    });
                    return;
                }
            }
        }
    }

    if (payload) {
        const payloadTag =
            insertedNode ? (insertedNode.localName || insertedNode.tagName || "").toLowerCase() : null;

        const payloadIsDrawable = payloadTag && isDrawableTagName(payloadTag); // non-drawable inserted payload becomes update

        if (!payloadIsDrawable) {
            let ownerOldPath = ownerOldPathForNewInsert(baseOld, baseNew, newPath);

            if (!ownerOldPath) {
                const ownerNewRel = snapRelPathToDrawable(baseNew, newPath);
                if (ownerNewRel && ownerNewRel !== "/?") {
                    ownerOldPath = ownerNewRel;
                }
            }

            if (ownerOldPath) { // but skip the update if its part of a move (used to prevent false move+update noise)
                const skipBecausePendingMove = isOwnerPartOfPendingMove(state, ownerOldPath);

                if (!skipBecausePendingMove) {
                    pushUpdateNode(state.operations, baseOld, ownerOldPath, payload);
                    return;
                }
            }
        }
        // final fallback: real insert
        state.operations.push({ kind: "insert", newPath, payload });
    }
}
