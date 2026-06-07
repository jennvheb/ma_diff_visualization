import {
    elementByRelIndexPath,
    indexPathForNodeRelative,
    trimRelPathToExistingElement,
    parentPath
} from "../dom/pathUtils.js";

import {nearestDrawable} from "../../stableIds.js";

import {
    childElements,
    findFirstElementById,
    collectDescendantIds
} from "../dom/domUtils.js";

import {
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

/**
 * safely read an attribute
 *
 * @param el
 * @param attr
 * @returns {null|string}
 */
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

/**
 * snap path to drawable node
 * this is how deep xml changes become updates on visible process elements
 *
 * @param operations
 * @param baseOld
 * @param oldPath
 * @param payload
 */
export function pushUpdateNode(operations, baseOld, oldPath, payload) {
    const snapped = snapRelPathToDrawable(baseOld, oldPath);

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

/**
 * finds an id, but ignores it if it lies inside a deleted subtree
 *
 * @param baseElem
 * @param id
 * @param excludedRootRel
 * @returns {null|{getAttribute}|*}
 */
export function findByIdOutsideSubtree(baseElem, id, excludedRootRel) {
    if (!baseElem || !id) return null;
    const hit = findFirstElementById(baseElem, id);
    if (!hit) return null;

    if (!excludedRootRel || excludedRootRel === "/") return hit;

    const hitRel = indexPathForNodeRelative(baseElem, hit);
    if (!hitRel) return hit;

    return isDescendantPath(hitRel, excludedRootRel) ? null : hit;
}

/**
 * handles delete payloads caused by renames
 * prevents wrong deletion paths when XYDiff payload carries the new id but old node is needed
 *
 * @param baseOld
 * @param baseNew
 * @param payloadEl
 * @param renamedIdPairs
 * @returns {{payloadId: (*|string), newRel: string, oldRel: (*|string), oldId: *}|null}
 */
export function resolveDeleteFromRename(baseOld, baseNew, payloadEl, renamedIdPairs) {
    if (!payloadEl) return null;
    // read payload id
    const payloadId = payloadEl.getAttribute?.("id") || null;
    if (!payloadId) return null;
    // map new id -> old id using renamedIdPairs
    const oldId = renamedIdPairs.get(String(payloadId));
    if (!oldId) return null;

    const oldRel = findRelById(baseOld, oldId);
    const newRel = findRelById(baseNew, payloadId);

    if (!oldRel || !newRel) return null;
    // find old/new paths
    const oldEl = elementByRelIndexPath(baseOld, oldRel);
    const newEl = elementByRelIndexPath(baseNew, newRel);
    if (!oldEl || !newEl) return null;
    // checks same tag
    if (tagName(oldEl) !== tagName(newEl)) return null;
    // check guard signatures
    const oldSig = drawableGuardSignature(oldEl);
    const newSig = drawableGuardSignature(newEl);

    if (oldSig && newSig && oldSig !== newSig) return null;
    // return olf logical path
    return {
        oldId,
        payloadId,
        oldRel: snapRelPathToDrawable(baseOld, oldRel),
        newRel
    };
}

/**
 * given an insert path in the new tree, find the corresponding owner in old tree
 * used when a non-drawable child was inserted
 * the visual owner should be a task/gateway in the old tree
 *
 * @param baseOld
 * @param baseNew
 * @param newPath
 * @returns {*|string|null}
 */
export function ownerOldPathForNewInsert(baseOld, baseNew, newPath) {
    if (!newPath) return null;

    const curPath = trimRelPathToExistingElement(baseNew, newPath);
    const insertedAt = elementByRelIndexPath(baseNew, curPath);
    if (!insertedAt) return null;

    const branch = nearestBranchContainer(insertedAt);
    const nnearestDrawable = nearestDrawable(insertedAt);

    let ownerNew = null;
    // try nearest branch/drawable owner in new tree
    if (branch) {
        if (isWithinConditionSubtree(branch, insertedAt)) {
            ownerNew = branch;
        } else {
            ownerNew = nnearestDrawable || branch;
        }
    } else {
        ownerNew = nnearestDrawable;
    }

    if (!ownerNew) return null;

    // try match by id in old tree
    let candidateOldRel = null;
    const ownerId = ownerNew.getAttribute?.("id") || null;
    if (ownerId) candidateOldRel = findRelById(baseOld, ownerId);
    // fallback to same/parent path existing in old tree
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
    // snap to drawable
    return snapRelPathToDrawable(baseOld, candidateOldRel);
}

/**
 * given a delete payload, find where that payload existed in the old tree
 *
 * @param baseOld
 * @param payloadEl
 * @returns {*|string|null}
 */
export function resolveOldPathByDeletePayload(baseOld, payloadEl) {
    if (!baseOld || !payloadEl) return null;

    const tag = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();
    // try payload id
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

    // try descendant id
    const ids = collectDescendantIds(payloadEl, 50);
    for (const id of ids) {
        const hit = findFirstElementById(baseOld, id);
        if (!hit) continue;

        let cur = hit;
        while (cur && cur !== baseOld) {
            // try matching ancestor tag
            const curTag = (cur.localName || cur.tagName || "").toLowerCase();
            if (curTag === tag) {
                const rel = indexPathForNodeRelative(baseOld, cur);
                if (rel) return snapRelPathToDrawable(baseOld, rel);
                break;
            }
            cur = cur.parentNode;
        }

        // try nearest drawable owner
        const owner = nearestDrawable(hit);
        if (owner) {
            const rel = indexPathForNodeRelative(baseOld, owner);
            if (rel) return rel;
        }
    }

    return null;
}

/**
 * return XML name without namespace prefix ("xy:")
 * @param el
 * @returns {string}
 */
export function xmlName(el) {
    const n = String(el?.localName || el?.tagName || "").toLowerCase();
    return n.includes(":") ? n.split(":").pop() : n;
}

/**
 * extract new text from xydiff update node
 * handles child nodes
 *
 * @param editU
 * @returns {{length}|*|string|string|null}
 */
export function extractUText(editU) {
    if (!editU) return null;

    const kids = childElements(editU);

    const tr = kids.find(e => xmlName(e) === "tr");
    if (tr) {
        const t = textContentTrimmed(tr);
        return t.length ? t : "";
    }

    const tis = kids.filter(e => xmlName(e) === "ti");
    if (tis.length) {
        const t = tis.map(textContentTrimmed).join("");
        return t.length ? t : "";
    }

    return null;
}

/**
 * use newxm to find the final text in the new DOM
 * useful when xydiff update encoding is only partial and
 * the actual final value is easier to read from the new tree
 *
 * @param editU
 * @param newXidIndex
 * @returns {string|null}
 */
export function extractFinalTextFromNewDom(editU, newXidIndex) {
    const newxmId = firstXmId(editU.getAttribute("newxm"));
    if (!newxmId) return null;

    const raw = newXidIndex?.get(String(newxmId));
    if (!raw) return null;

    if (raw.nodeType === 3) return textContentTrimmed(raw);

    return raw ? textContentTrimmed(raw) : null;
}
