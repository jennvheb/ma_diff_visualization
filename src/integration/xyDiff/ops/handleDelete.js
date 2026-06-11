import {
    pushUpdateNode,
    resolveDeleteFromRename,
    resolveOldPathByDeletePayload,
    textContentTrimmed
} from "./opUtils.js";
import {firstXmId, normalizeXmKey, resolveRelPathByXidForMove, xidElTag} from "../xid/resolveByXid.js";
import {DIFF_BOUNDARY_TAGS, NON_STRUCTURAL_MOVE_TAGS} from "../../tags.js";
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

/**
 * converts xydiff delete edits into either delete, update-node or pending move-delete entries
 * xydiff deletes do not always mean that a real process node was deleted
 *
 * @param edit
 * @param ctx
 * @param state
 */
export function handleDelete(edit, ctx, state) {
    const { workDir, oldDom, baseOld, baseNew, oldXidIndex } = ctx;

    const isMove = edit.getAttribute("move") === "yes";

    if (isMove) {
        const xmRaw = edit.getAttribute("xm"); // identifies the moved node or moved subtree
        const xmKey = normalizeXmKey(xmRaw);
        const xmId = firstXmId(xmRaw);
        const rawTag = xidElTag(oldXidIndex, xmId);

        if (rawTag && NON_STRUCTURAL_MOVE_TAGS.has(rawTag)) { // if a non-structural node moved (layout, metadata child nodes), ignore it
            return;
        }

        const oldPath =
            resolveMoveObjectRelByParPos(oldXidIndex, baseOld, edit.getAttribute("par"), edit.getAttribute("pos"))
            || resolveRelPathByXidForMove(oldXidIndex, baseOld, xmId); // resolve old path by parent/position or by xid

        if (xmKey && oldPath) { // store the oldpath and node until it may be combined if matching move-insert can be found later
            state.pendingMoveDeletes.set(xmKey, {
                oldPath,
                xmId,
                rawTag,
                par: edit.getAttribute("par"),
                pos: edit.getAttribute("pos"),
                payload: firstElementChild(edit) ? ctx.serializer.serializeToString(firstElementChild(edit)) : null
            });
            return;
        }
    }

    const payloadEl = firstElementChild(edit);
    if (!isMove && !payloadEl && textContentTrimmed(edit).length > 0) {
        const ownerOldPath =
            resolveDrawableOwnerRelPathByParPos(
                oldXidIndex,
                baseOld,
                edit.getAttribute("par"),
                edit.getAttribute("pos")
            )
            || snapRelPathToDrawable(
                baseOld,
                resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex) || "/?"
            );

        if (ownerOldPath && ownerOldPath !== "/?") {
            pushUpdateNode(state.operations, baseOld, ownerOldPath, `<_text_deleted/>`);
        }

        return;
    }

    if (payloadEl && payloadIsShiftingOnly(payloadEl)) {
        return;
    }

    // if only arguments were deleted, don't visualize the whole task as delete, instead flag it as update
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
        // if deleted payload is a full drawable node then first check the rename logic, as sometimes xydiff reports confusing edits due to id rename/replacements
        const rewritten = resolveDeleteFromRename(
            baseOld,
            baseNew,
            payloadEl,
            state.renamedIdPairs
        );

        if (rewritten) {
            state.operations.push({
                kind: "delete",
                oldPath: rewritten.oldRel
            });
            return;
        }
    }

    // if deleted payload is not a process node, then it is probably an internal update
    if (!isMove && payloadEl && !payloadHasStructuralTags(payloadEl)) {
        if (payloadContainsShifting(payloadEl)) {
            return;
        }

        const ownerOldPath =
            resolveDrawableOwnerRelPathByParPos(oldXidIndex, baseOld, edit.getAttribute("par"), edit.getAttribute("pos"))
            || snapRelPathToDrawable(
                baseOld,
                resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex) || "/?"
            );

        if (ownerOldPath && ownerOldPath !== "/?") {
            const tag = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();
            pushUpdateNode(state.operations, baseOld, ownerOldPath, `<_child_deleted tag="${tag}"/>`);
            return;
        }
    }

    if (!isMove && payloadEl) {
        const pOld = resolveOldPathByDeletePayload(baseOld, payloadEl);
        if (pOld) {
            state.operations.push({ kind: "delete", oldPath: pOld });
            return;
        }
    }

    // final fallback: resolve xydiff path/xid and snap to drawable node
    let oldPath = resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex) || "/?";
    oldPath = snapRelPathToDrawable(baseOld, oldPath);


    state.operations.push({ kind: "delete", oldPath });
}
