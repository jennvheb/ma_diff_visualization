import {
    dumpAttrs,
    pushUpdateNode,
    resolveDeleteOldLogicalNodeFromRenamePayload,
    resolveOldPathByDeletePayload
} from "./opUtils.js";
import {firstXmId, normalizeXmKey, resolveRelPathByXidForMove, xidElTag} from "../xid/resolveByXid.js";
import {NON_STRUCTURAL_MOVE_TAGS} from "../../tags.js";
import {
    resolveDrawableOwnerRelPathByParPos,
    resolveMoveObjectRelByParPos,
    resolveOldPathForDeleteOrUpdate
} from "../xid/resolveByParPos.js";
import {firstElementChild} from "../dom/domUtils.js";
import {
    payloadContainsShifting,
    payloadHasStructuralTags,
    payloadIsShiftingOnly,
    snapRelPathToDrawable
} from "../dom/drawableUtils.js";
import {elementByRelIndexPath} from "../dom/pathUtils.js";


export function handleDelete(edit, ctx, state) {
    const { workDir, oldDom, baseOld, baseNew, oldXidIndex } = ctx;

    console.error("XYDIFF EDIT", edit.localName, dumpAttrs(edit));

    const isMove = edit.getAttribute("move") === "yes";

    if (isMove) {
        const xmRaw = edit.getAttribute("xm");
        const xmKey = normalizeXmKey(xmRaw);
        const xmId = firstXmId(xmRaw);
        const rawTag = xidElTag(oldXidIndex, xmId);

        if (rawTag && NON_STRUCTURAL_MOVE_TAGS.has(rawTag)) {
            console.error("SKIP MOVE-DELETE NON-STRUCTURAL TAG", {
                xmId,
                rawTag,
                xm: edit.getAttribute("xm")
            });
            return;
        }

        const oldPath =
            resolveMoveObjectRelByParPos(oldXidIndex, baseOld, edit.getAttribute("par"), edit.getAttribute("pos"))
            || resolveRelPathByXidForMove(oldXidIndex, baseOld, xmId);

        if (xmKey && oldPath) {
            state.pendingMoveDeletes.set(xmKey, {
                oldPath,
                xmId,
                rawTag,
                par: edit.getAttribute("par"),
                pos: edit.getAttribute("pos"),
                payload: firstElementChild(edit) ? ctx.serializer.serializeToString(firstElementChild(edit)) : null
            });

            console.error("MOVE-DELETE STORED:", xmKey, "oldPath=", oldPath, "xmId=", xmId, "rawTag=", rawTag);
            return;
        }
    }

    const payloadEl = firstElementChild(edit);

    if (payloadEl && payloadIsShiftingOnly(payloadEl)) {
        console.error("SKIP SHIFTING DELETE:", {
            oldPathGuess: resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex)
        });
        return;
    }

    if (!isMove && payloadEl) {
        const payloadTag = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();

        if (payloadTag === "arguments") {
            const ownerOldPath =
                resolveDrawableOwnerRelPathByParPos(oldXidIndex, baseOld, edit.getAttribute("par"), edit.getAttribute("pos"))
                || "/?";

            if (ownerOldPath && ownerOldPath !== "/?") {
                pushUpdateNode(state.operations, baseOld, ownerOldPath, `<_arguments_changed/>`);
            }
            return;
        }
    }

    const payloadId = payloadEl?.getAttribute?.("id") || null;
    const payloadTag = (payloadEl?.localName || payloadEl?.tagName || "").toLowerCase();
    const payloadIsDrawable = payloadTag && DIFF_BOUNDARY_TAGS.has(payloadTag);

    if (!isMove && payloadId && payloadIsDrawable) {
        const rewritten = resolveDeleteOldLogicalNodeFromRenamePayload(
            baseOld,
            baseNew,
            payloadEl,
            state.renamedIdPairs
        );

        if (rewritten) {
            console.error("REWRITE DELETE - RENAME PAYLOAD TO OLD LOGICAL NODE:", {
                payloadId: rewritten.payloadId,
                oldId: rewritten.oldId,
                oldRel: rewritten.oldRel,
                newRel: rewritten.newRel
            });

            state.operations.push({
                kind: "delete",
                oldPath: rewritten.oldRel
            });
            return;
        }
    }

    if (!isMove && payloadEl && !payloadHasStructuralTags(payloadEl)) {
        if (payloadContainsShifting(payloadEl)) {
            console.error("SKIP SHIFTING DELETE TO UPDATE:");
            return;
        }

        const payloadTagLocal = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();

        const ownerOldPath =
            resolveDrawableOwnerRelPathByParPos(oldXidIndex, baseOld, edit.getAttribute("par"), edit.getAttribute("pos"))
            || snapRelPathToDrawable(
                baseOld,
                resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex) || "/?"
            );

        if (ownerOldPath && ownerOldPath !== "/?") {
            const tag = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();
            pushUpdateNode(state.operations, baseOld, ownerOldPath, `<_child_deleted tag="${tag}"/>`);
            console.error("DELETE TO UPDATE (no structural tags)", { tag: payloadTagLocal, ownerOldPath });
            return;
        }
    }

    if (!isMove && payloadEl) {
        const pOld = resolveOldPathByDeletePayload(baseOld, payloadEl);
        if (pOld) {
            console.error("DELETE RESOLVE BY PAYLOAD", {
                payloadTag: payloadEl.localName,
                oldPath: pOld,
                oldTag: elementByRelIndexPath(baseOld, pOld)?.localName || null,
                oldId: elementByRelIndexPath(baseOld, pOld)?.getAttribute?.("id") || null
            });

            state.operations.push({ kind: "delete", oldPath: pOld });
            return;
        }
    }

    let oldPath = resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex) || "/?";
    oldPath = snapRelPathToDrawable(baseOld, oldPath);

    console.error("DELETE RESOLVE:", {
        oldPath,
        payloadTag: payloadEl?.localName || null,
        payloadId: payloadId || null,
        oldTag: elementByRelIndexPath(baseOld, oldPath)?.localName || null,
        oldId: elementByRelIndexPath(baseOld, oldPath)?.getAttribute?.("id") || null
    });

    state.operations.push({ kind: "delete", oldPath });
}
