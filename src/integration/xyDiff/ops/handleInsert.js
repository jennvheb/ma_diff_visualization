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
            if (oldRel) {
                pushUpdateNode(
                    state.operations,
                    baseOld,
                    snapRelPathToDrawable(baseOld, oldRel),
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
                console.error("[OWNER DEBUG]", {
                    newPath,
                    ownerOldPath_raw: ownerOldPath,
                    ownerOldTag: elementByRelIndexPath(baseOld, ownerOldPath)?.localName || null
                });
                pushUpdateNode(state.operations, baseOld, ownerOldPath, payload);
                return;
            }
        }

        state.operations.push({ kind: "insert", newPath, payload });
    }
}
