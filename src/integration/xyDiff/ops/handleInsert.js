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
    findOldRelById,
    isTextOnlyInsert,
    ownerOldPathForNewInsert,
    pushUpdateNode,
    textContentTrimmed
} from "./opUtils.js";
import {buildXyDiffXidIndex} from "../xid/xidMap.js";
import {NON_STRUCTURAL_MOVE_TAGS} from "../../tags.js";

function isOwnerPartOfPendingMove(state, ownerOldPath) {
    if (!ownerOldPath) return false;

    for (const del of state.pendingMoveDeletes.values()) {
        if (!del?.oldPath) continue;
        if (del.oldPath === ownerOldPath) return true;
    }

    return false;
}

function isIdInRename(id, state) {
    if (!id) return false;

    return (
        state.renamedNewIds?.has(String(id)) ||
        state.renamedIdPairs?.has(String(id)) ||
        [...(state.renamedIdPairs?.values?.() || [])].includes(String(id))
    );
}

function findDeleteOpByOldId(operations, baseOld, id) {
    if (!id) return null;

    return operations.find(o => {
        if (o.kind !== "delete" || !o.oldPath) return false;

        const oldEl = elementByRelIndexPath(baseOld, o.oldPath);
        const oldId = oldEl?.getAttribute?.("id") || null;

        return oldId && String(oldId) === String(id);
    }) || null;
}

export function handleInsert(edit, ctx, state) {
    const { baseOld, baseNew, newXidIndex, newDom, serializer } = ctx;

    const isMove = edit.getAttribute("move") === "yes";
    const xmRaw = edit.getAttribute("xm");
    const xmId = firstXmId(xmRaw);

    console.error(
        "INSERT DATA",
        "move=", isMove,
        "par=", edit.getAttribute("par"),
        "pos=", edit.getAttribute("pos"),
        "xm=", xmRaw,
        "xmId=", xmId
    );

    const insertedNode = firstElementChild(edit);

    if (insertedNode && payloadIsShiftingOnly(insertedNode)) {
        console.error("SKIP SHIFTING-ONLY INSERT", {
            newPath: resolveNewPathForInsert(edit, baseNew, newXidIndex),
            tag: (insertedNode.localName || insertedNode.tagName || "").toLowerCase()
        });
        return;
    }

    if (!isMove && insertedNode) {
        const tag = (insertedNode.localName || insertedNode.tagName || "").toLowerCase();
        if (tag === "arguments") {
            console.error("SKIP INSERT arguments", {
                newPath: resolveNewPathForInsert(edit, baseNew, newXidIndex),
                par: edit.getAttribute("par"),
                pos: edit.getAttribute("pos"),
                xm: edit.getAttribute("xm")
            });
            return;
        }
    }

    const payload = insertedNode ? serializer.serializeToString(insertedNode) : null;

    if (payload) {
        const tag = insertedNode ? (insertedNode.localName || insertedNode.tagName) : null;
        console.error("INS PAYLOAD TAG", tag);
        console.error("INS PAYLOAD XML", payload.slice(0, 500));
    }

    if (isMove) {
        const xmKey = normalizeXmKey(edit.getAttribute("xm"));
        const xmIdMove = firstXmId(edit.getAttribute("xm"));
        const rawTag = xidElTag(newXidIndex, xmIdMove);

        if (rawTag && NON_STRUCTURAL_MOVE_TAGS.has(rawTag)) {
            console.error("SKIP MOVE-INSERT NON-STRUCTURAL RAW TAG", {
                xmId: xmIdMove,
                rawTag,
                xm: edit.getAttribute("xm")
            });
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

            console.error("MOVE-INSERT STORED", xmKey, "newPath=", newOwnerPath, "xmId=", xmIdMove, "rawTag=", rawTag);
            return;
        }

        console.error("MOVE-INSERT FAILED", xmKey, {
            xmId: xmIdMove,
            par: edit.getAttribute("par"),
            pos: edit.getAttribute("pos")
        });
        return;
    }

    let newPath =
        resolveNewPathForInsert(edit, baseNew, newXidIndex) ||
        resolveRelPathByXid(newXidIndex, baseNew, firstXmId(edit.getAttribute("xm")), { snapIfNotDrawable: false }) ||
        "/?";

    const before = newPath;
    const exists = elementByRelIndexPath(baseNew, newPath);
    if (!exists) newPath = trimRelPathToExistingElement(baseNew, newPath);

    console.error("[INS NEWPATH]", { before, after: newPath, exists: !!exists });

    newPath = trimRelPathToExistingElement(baseNew, newPath);

    if (payload) {
        const payloadId = insertedNode?.getAttribute?.("id") || null;

        if (payloadId) {
            const oldRel = findOldRelById(baseOld, payloadId);

            if (oldRel && !isIdInRename(payloadId, state)) {
                const oldPath = snapRelPathToDrawable(baseOld, oldRel);

                const matchingDelete = findDeleteOpByOldId(
                    state.operations,
                    baseOld,
                    payloadId
                );

                if (matchingDelete) {
                    const moveOldPath = matchingDelete.oldPath || oldPath;

                    console.error("same id delete+insert", {
                        id: payloadId,
                        oldPath,
                        deletedPath: matchingDelete.oldPath,
                        moveOldPath,
                        newPath
                    });

                    const deleteIdx = state.operations.indexOf(matchingDelete);
                    if (deleteIdx >= 0) state.operations.splice(deleteIdx, 1);

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

                if (oldPath && newPath && oldPath !== newPath) {
                    console.error("same id delete+insert becomes move paths don't match", {
                        id: payloadId,
                        oldPath,
                        newPath
                    });

                    state.operations.push({
                        kind: "move",
                        oldPath,
                        newPath
                    });

                    return;
                }

                console.error("fallback same id becomes update", {
                    id: payloadId,
                    oldPath,
                    newPath
                });

                pushUpdateNode(
                    state.operations,
                    baseOld,
                    oldPath,
                    payload
                );

                return;
            }
        }

        if (isTextOnlyInsert(edit)) {
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

        const payloadIsDrawable = payloadTag && isDrawableTagName(payloadTag);

        if (!payloadIsDrawable) {
            let ownerOldPath = ownerOldPathForNewInsert(baseOld, baseNew, newPath);

            console.error("[NON-DRAWABLE INSERT -> UPDATE-NODE OWNER]", {
                newPath,
                ownerOldPath
            });

            if (!ownerOldPath) {
                const ownerNewRel = snapRelPathToDrawable(baseNew, newPath);
                if (ownerNewRel && ownerNewRel !== "/?") {
                    ownerOldPath = ownerNewRel;
                }
            }

            if (ownerOldPath) {
                const skipBecausePendingMove = isOwnerPartOfPendingMove(state, ownerOldPath);

                console.error("owner debug", {
                    newPath,
                    ownerOldPath_raw: ownerOldPath,
                    ownerOldTag: elementByRelIndexPath(baseOld, ownerOldPath)?.localName || null,
                    skipBecausePendingMove
                });

                if (!skipBecausePendingMove) {
                    pushUpdateNode(state.operations, baseOld, ownerOldPath, payload);
                    return;
                }
            }
        }

        state.operations.push({ kind: "insert", newPath, payload });
    }
}
