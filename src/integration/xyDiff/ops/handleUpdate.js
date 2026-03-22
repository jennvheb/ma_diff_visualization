import {nearestDrawableAncestor} from "../dom/drawableUtils.js";
import {elementByRelIndexPath, indexPathForNodeRelative} from "../dom/pathUtils.js";
import {getDrawableId, mapOldDrawableToNew} from "../dom/signatures.js";
import {extractFinalTextFromNewDom, extractUText, getAttrOrNull, localBareName} from "./opUtils.js";
import {childElements, nearestElementNode} from "../dom/domUtils.js";
import {firstXmId, joinIndexPath} from "../xid/resolveByXid.js";
import {elementIndexForDomPos} from "../xid/resolveByParPos.js";


export function handleAttributeUpdate(edit, ctx, state) {
    const { baseOld, oldXidIndex, newDrawablesById } = ctx;


    const attr = edit.getAttribute("a") || "";
    const xid = edit.getAttribute("xid") || "";

    if (attr === "id") return;

    let oldOwnerRel = "/?";
    let oldOwnerEl = null;

    if (xid && oldXidIndex) {
        const el = oldXidIndex.get(String(xid));
        oldOwnerEl = nearestDrawableAncestor(el) || el;
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

    const oldId = getDrawableId(oldOwnerEl);
    const newOwnerEl = oldId ? mapOldDrawableToNew(oldOwnerEl, newDrawablesById) : null;

    if (!newOwnerEl) {
        state.operations.push({
            kind: "update-attr",
            oldPath: oldOwnerRel,
            attr,
            oldValue: edit.getAttribute("ov") || "",
            newValue: edit.getAttribute("nv") || ""
        });
        return;
    }

    const realOld = getAttrOrNull(oldOwnerEl, attr) ?? "";
    const realNew = getAttrOrNull(newOwnerEl, attr) ?? "";

    if (realOld === realNew) {
        console.error("DROP AU - NO CHANGE", { attr, oldOwnerRel, realOld });
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

export function handleTextUpdate(edit, ctx, state) {
    const { baseOld, baseNew, oldXidIndex, newXidIndex } = ctx;

    let newText = extractUText(edit);

    if (newText != null) {
        const kids = childElements(edit);
        const hasTi = kids.some(e => localBareName(e) === "ti");
        if (hasTi) {
            const finalNew = extractFinalTextFromNewDom(edit, newXidIndex);
            if (finalNew != null) newText = finalNew;
        }
    }

    console.error("UPDATE DATA", {
        oldxm: edit.getAttribute("oldxm"),
        newxm: edit.getAttribute("newxm"),
        par: edit.getAttribute("par"),
        pos: edit.getAttribute("pos"),
        newText
    });

    const oldxmId = firstXmId(edit.getAttribute("oldxm"));
    if (oldxmId && newText != null) {
        const raw = oldXidIndex.get(String(oldxmId));

        const targetEl = nearestElementNode(raw);
        const oldLeafRel = targetEl ? indexPathForNodeRelative(baseOld, targetEl) : null;

        console.error("UPDATE RESOLVE", {
            oldxmId,
            rawType: raw?.nodeType,
            targetTag: (targetEl?.localName || targetEl?.tagName || null),
            oldLeafRel
        });

        if (oldLeafRel) {
            const ownerEl = nearestDrawableAncestor(targetEl);
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

    const par = edit.getAttribute("par");
    const pos = edit.getAttribute("pos");

    if (par && pos && newText != null) {
        const parentRaw = newXidIndex.get(String(par));

        if (parentRaw) {
            const parentRel = indexPathForNodeRelative(baseNew, parentRaw);
            const elemIdx = elementIndexForDomPos(parentRaw, Number(pos));
            const candidateRel = joinIndexPath(parentRel, elemIdx);

            const candidateEl = elementByRelIndexPath(baseNew, candidateRel);
            const ownerId = candidateEl?.getAttribute?.("id") || null;

            console.error("UPDATE RESOLVE FALLBACK", {
                candidateRel,
                candidateTag: (candidateEl?.localName || candidateEl?.tagName || null),
                ownerId
            });

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