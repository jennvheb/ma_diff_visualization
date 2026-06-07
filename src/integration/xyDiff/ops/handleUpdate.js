import {nearestDrawable} from "../../stableIds.js"
import {elementByRelIndexPath, indexPathForNodeRelative} from "../dom/pathUtils.js";
import {getDrawableId, mapOldDrawableToNew} from "../dom/signatures.js";
import {extractFinalTextFromNewDom, extractUText, getAttrOrNull, xmlName} from "./opUtils.js";
import {childElements, nearestElementNode} from "../dom/domUtils.js";
import {firstXmId, joinIndexPath} from "../xid/resolveByXid.js";
import {elementIndexForDomPos} from "../xid/resolveByParPos.js";

/**
 * check whether metadata collection decided the xid is a replacement
 * replacement: xydiff matched two different nodes as one node, but id+endpoint are not the same
 * so the visualization should show delete+insert
 *
 * @param state
 * @param xid
 * @returns {false|*}
 */
function isReplacementXid(state, xid) {
    return !!xid && state.replacementByXid?.has(String(xid));
}

/**
 * convert xydiff attribute updates into viewer-level update operations
 * handle replacement cases
 *
 * @param edit
 * @param ctx
 * @param state
 */
export function handleAttributeUpdate(edit, ctx, state) {
    const { baseOld, oldXidIndex, newDrawablesById } = ctx;


    const attr = edit.getAttribute("a") || "";
    const xid = edit.getAttribute("xid") || "";

    if (isReplacementXid(state, xid)) { // if xid is a replacement, emit delete+insert instead of update
        const repl = state.replacementByXid.get(String(xid));

        const oldEl = repl.oldId
            ? ctx.oldDrawablesById?.get?.(String(repl.oldId)) || null
            : null;

        const newEl = repl.newId
            ? ctx.newDrawablesById?.get?.(String(repl.newId)) || null
            : null;

        const oldPath = oldEl ? indexPathForNodeRelative(ctx.baseOld, oldEl) : null;
        const newPath = newEl ? indexPathForNodeRelative(ctx.baseNew, newEl) : null;

        const already = state.operations.some(o =>
            o.kind === "delete" &&
            o.oldPath === oldPath &&
            o.meta?.replacementXid === String(xid)
        );

        if (!already && oldPath && newPath) {

            state.operations.push({
                kind: "delete",
                oldPath,
                meta: { replacementXid: String(xid), replacedBy: repl.newId }
            });

            const newEl = elementByRelIndexPath(ctx.baseNew, newPath);
            const payload = newEl ? ctx.serializer.serializeToString(newEl) : null;

            state.operations.push({
                kind: "insert",
                newPath,
                payload,
                replacementForOldPath: oldPath
            });
        }

        return;
    }

    if (attr === "id") return; // ignore id updates, they are noise from xydiff and not meaningful visual changes

    let oldOwnerRel = "/?";
    let oldOwnerEl = null;

    if (xid && oldXidIndex) { // if xydiff emits attribute change on nested xml node, find the drawable owner
        const el = oldXidIndex.get(String(xid));
        oldOwnerEl = nearestDrawable(el) || el;
        const rel = oldOwnerEl ? indexPathForNodeRelative(ctx.baseOld, oldOwnerEl) : null;
        if (rel) oldOwnerRel = rel;
    }

    if (!oldOwnerEl || oldOwnerRel === "/?") {
        state.operations.push({
            kind: "update-attr",
            oldPath: oldOwnerRel,
            attr,
            oldValue: edit.getAttribute("ov") || "",
            newValue: edit.getAttribute("nv") || ""
        });
        return;
    }

    // verify against the new model
    // find the corresponding new node
    const oldId = getDrawableId(oldOwnerEl);
    const newOwnerEl = oldId ? mapOldDrawableToNew(oldOwnerEl, newDrawablesById) : null;

    if (!newOwnerEl) { // if not found, push update using raw xydiff old/new values for later processing
        state.operations.push({
            kind: "update-attr",
            oldPath: oldOwnerRel,
            attr,
            oldValue: edit.getAttribute("ov") || "",
            newValue: edit.getAttribute("nv") || ""
        });
        return;
    }

    // if found, compare actual old/new attributes:
    const realOld = getAttrOrNull(oldOwnerEl, attr) ?? "";
    const realNew = getAttrOrNull(newOwnerEl, attr) ?? "";

    if (realOld === realNew) { // if equal, skip, if different, push update
        return;
    }

    state.operations.push({
        kind: "update-attr",
        oldPath: oldOwnerRel,
        attr,
        oldValue: realOld,
        newValue: realNew
    });
}

/**
 * convert xydiff text updates into viewer-level update operations
 * handle replacement cases
 * important for nested cpee changes like labels, arguments, parameters, etc.
 *
 * @param edit
 * @param ctx
 * @param state
 */
export function handleTextUpdate(edit, ctx, state) {
    const { baseOld, baseNew, oldXidIndex, newXidIndex } = ctx;
    // first extract the text from text updates encoded by xydiff
    let newText = extractUText(edit);
    // if not found, extract if from the DOM
    if (newText != null) {
        const kids = childElements(edit);
        const hasTi = kids.some(e => xmlName(e) === "ti");
        if (hasTi) {
            const finalNew = extractFinalTextFromNewDom(edit, newXidIndex);
            if (finalNew != null) newText = finalNew;
        }
    }

    // if xydiff provides old node
    const oldxmId = firstXmId(edit.getAttribute("oldxm"));
    if (oldxmId && newText != null) {
        const raw = oldXidIndex.get(String(oldxmId));

        const targetEl = nearestElementNode(raw);
        const oldLeafRel = targetEl ? indexPathForNodeRelative(baseOld, targetEl) : null;


        if (oldLeafRel) {
            const ownerEl = nearestDrawable(targetEl);
            const ownerRel = ownerEl ? indexPathForNodeRelative(baseOld, ownerEl) : null;

            state.operations.push({
                kind: "update-text",
                oldPath: ownerRel || oldLeafRel,
                newValue: newText,
                meta: { leafPath: oldLeafRel }
            });
            return;
        }
    }

    // fallback: try by pos, par in the new tree to find the changed owner
    const par = edit.getAttribute("par");
    const pos = edit.getAttribute("pos");

    if (par && pos && newText != null) {
        const parentRaw = newXidIndex.get(String(par));
        // then match that owner by id in old tree
        if (parentRaw) {
            const parentRel = indexPathForNodeRelative(baseNew, parentRaw);
            const elemIdx = elementIndexForDomPos(parentRaw, Number(pos));
            const candidateRel = joinIndexPath(parentRel, elemIdx);

            const candidateEl = elementByRelIndexPath(baseNew, candidateRel);
            const ownerId = candidateEl?.getAttribute?.("id") || null;

            if (ownerId) {
                const oldMatch = baseOld.querySelector?.(`*[id="${String(ownerId).replace(/["\\]/g, "\\$&")}"]`);
                const oldOwnerRel = oldMatch ? indexPathForNodeRelative(baseOld, oldMatch) : null;

                if (oldOwnerRel) {
                    state.operations.push({
                        kind: "update-text",
                        oldPath: oldOwnerRel,
                        newValue: newText
                    });
                    return;
                }
            }
        }
    }
}