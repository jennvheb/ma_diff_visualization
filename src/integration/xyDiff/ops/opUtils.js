import {
    elementByRelIndexPath,
    indexPathForNodeRelative,
    trimRelPathToExistingElement,
    parentPath
} from "../dom/pathUtils.js";

import {
    childElements,
    findFirstElementById,
    collectDescendantIds
} from "../dom/domUtils.js";

import {
    nearestDrawableAncestor,
    nearestBranchContainer,
    isWithinConditionSubtree,
    snapRelPathToDrawable,
    tagName,
} from "../dom/drawableUtils.js";

import {drawableGuardSignature,} from "../dom/signatures.js";
import {firstXmId} from "../xid/resolveByXid.js";

import {
    isDescendantPath
} from "../dom/pathUtils.js";

export function dumpAttrs(el) {
    const out = {};
    if (!el || !el.attributes) return out;
    for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes.item(i);
        out[a.name] = a.value;
    }
    return out;
}

export function textContentTrimmed(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
}

export function hasElementChildren(node) {
    for (let i = 0; i < node.childNodes.length; i++) {
        if (node.childNodes[i].nodeType === 1) return true;
    }
    return false;
}

export function isTextOnlyInsert(editI) {
    return !hasElementChildren(editI) && textContentTrimmed(editI).length > 0;
}

export function getAttrOrNull(el, attr) {
    if (!el || el.nodeType !== 1) return null;
    const v = el.getAttribute?.(attr);
    return v == null ? null : String(v);
}

export function escapeXmlAttr(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function pushUpdateNode(operations, baseOld, oldPath, payload) {
    const snapped = snapRelPathToDrawable(baseOld, oldPath);
    const el = elementByRelIndexPath(baseOld, snapped);

    console.error("UPDATE-NODE SNAPPED", {
        in: oldPath,
        out: snapped,
        tag: el?.localName || null,
        id: el?.getAttribute?.("id") || null
    });

    operations.push({
        kind: "update-node",
        oldPath: snapped,
        newPayload: payload
    });
}

export function findRelById(baseElem, id) {
    if (!id) return null;
    const hit = findFirstElementById(baseElem, id);
    return hit ? indexPathForNodeRelative(baseElem, hit) : null;
}

export function findOldRelById(baseOld, id) {
    if (!id) return null;
    const hit = findFirstElementById(baseOld, id);
    return hit ? indexPathForNodeRelative(baseOld, hit) : null;
}

export function findByIdOutsideSubtree(baseElem, id, excludedRootRel) {
    if (!baseElem || !id) return null;
    const hit = findFirstElementById(baseElem, id);
    if (!hit) return null;

    if (!excludedRootRel || excludedRootRel === "/") return hit;

    const hitRel = indexPathForNodeRelative(baseElem, hit);
    if (!hitRel) return hit;

    return isDescendantPath(hitRel, excludedRootRel) ? null : hit;
}

export function resolveDeleteOldLogicalNodeFromRenamePayload(baseOld, baseNew, payloadEl, renamedIdPairs) {
    if (!payloadEl) return null;

    const payloadId = payloadEl.getAttribute?.("id") || null;
    if (!payloadId) return null;

    const oldId = renamedIdPairs.get(String(payloadId));
    if (!oldId) return null;

    const oldRel = findRelById(baseOld, oldId);
    const newRel = findRelById(baseNew, payloadId);

    if (!oldRel || !newRel) return null;

    const oldEl = elementByRelIndexPath(baseOld, oldRel);
    const newEl = elementByRelIndexPath(baseNew, newRel);
    if (!oldEl || !newEl) return null;

    if (tagName(oldEl) !== tagName(newEl)) return null;

    const oldSig = drawableGuardSignature(oldEl);
    const newSig = drawableGuardSignature(newEl);

    if (oldSig && newSig && oldSig !== newSig) return null;

    return {
        oldId,
        payloadId,
        oldRel: snapRelPathToDrawable(baseOld, oldRel),
        newRel
    };
}

export function ownerOldPathForNewInsert(baseOld, baseNew, newPath) {
    if (!newPath) return null;

    const curPath = trimRelPathToExistingElement(baseNew, newPath);
    const insertedAt = elementByRelIndexPath(baseNew, curPath);
    if (!insertedAt) return null;

    const branch = nearestBranchContainer(insertedAt);
    const nearestDrawable = nearestDrawableAncestor(insertedAt);

    let ownerNew = null;

    if (branch) {
        if (isWithinConditionSubtree(branch, insertedAt)) {
            ownerNew = branch;
        } else {
            ownerNew = nearestDrawable || branch;
        }
    } else {
        ownerNew = nearestDrawable;
    }

    if (!ownerNew) return null;

    let candidateOldRel = null;
    const ownerId = ownerNew.getAttribute?.("id") || null;
    if (ownerId) candidateOldRel = findOldRelById(baseOld, ownerId);

    if (!candidateOldRel) {
        let relNewOwner = indexPathForNodeRelative(baseNew, ownerNew);
        while (relNewOwner && relNewOwner !== "/") {
            const oldAtSame = elementByRelIndexPath(baseOld, relNewOwner);
            if (oldAtSame) {
                candidateOldRel = relNewOwner;
                break;
            }
            relNewOwner = parentPath(relNewOwner);
        }
    }

    if (!candidateOldRel) return null;

    return snapRelPathToDrawable(baseOld, candidateOldRel);
}

export function resolveOldPathByDeletePayload(baseOld, payloadEl) {
    if (!baseOld || !payloadEl) return null;

    const tag = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();

    const pid = payloadEl.getAttribute?.("id");
    if (pid) {
        const hit = findFirstElementById(baseOld, pid);
        if (hit) {
            return snapRelPathToDrawable(
                baseOld,
                indexPathForNodeRelative(baseOld, hit)
            );
        }
    }

    const ids = collectDescendantIds(payloadEl, 50);
    for (const id of ids) {
        const hit = findFirstElementById(baseOld, id);
        if (!hit) continue;

        let cur = hit;
        while (cur && cur !== baseOld) {
            const curTag = (cur.localName || cur.tagName || "").toLowerCase();
            if (curTag === tag) {
                const rel = indexPathForNodeRelative(baseOld, cur);
                if (rel) return snapRelPathToDrawable(baseOld, rel);
                break;
            }
            cur = cur.parentNode;
        }

        const owner = nearestDrawableAncestor(hit);
        if (owner) {
            const rel = indexPathForNodeRelative(baseOld, owner);
            if (rel) return rel;
        }
    }

    return null;
}

export function localBareName(el) {
    const n = String(el?.localName || el?.tagName || "").toLowerCase();
    return n.includes(":") ? n.split(":").pop() : n;
}

export function extractUText(editU) {
    if (!editU) return null;

    const kids = childElements(editU);

    const tr = kids.find(e => localBareName(e) === "tr");
    if (tr) {
        const t = textContentTrimmed(tr);
        return t.length ? t : "";
    }

    const tis = kids.filter(e => localBareName(e) === "ti");
    if (tis.length) {
        const t = tis.map(textContentTrimmed).join("");
        return t.length ? t : "";
    }

    return null;
}

export function extractFinalTextFromNewDom(editU, newXidIndex) {
    const newxmId = firstXmId(editU.getAttribute("newxm"));
    if (!newxmId) return null;

    const raw = newXidIndex?.get(String(newxmId));
    if (!raw) return null;

    if (raw.nodeType === 3) return textContentTrimmed(raw);

    return raw ? textContentTrimmed(raw) : null;
}
