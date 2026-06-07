import {BRANCH_CONTAINER_TAGS, DIFF_BOUNDARY_TAGS, GATEWAY_TAGS} from "../../tags.js";
import {elementByRelIndexPath, indexPathForNodeRelative} from "../dom/pathUtils.js";
import {firstXmId, joinIndexPath} from "./resolveByXid.js";
import {nearestDrawable} from "../../stableIds.js"

/**
 * map xydiff position to element-only index path as
 * xydiff positions are based on the DOM child list, which may include text nodes
 * the visualization paths only count element nodes
 *
 * @param parentElem
 * @param pos1Based
 * @returns {number}
 */
export function elementIndexForDomPos(parentElem, pos1Based) {
    // map xydiff "pos" to element-only index (no text nodes that are whitespace-only)
    const target = Number(pos1Based) - 1;
    if (!Number.isFinite(target) || target < 0) return 0;

    const isWhitespaceText = (n) =>
        n && n.nodeType === 3 && String(n.nodeValue || "").trim() === "";

    let logicalIdx = -1; // counts elems + non-ws text
    let elemIdx = -1; // counts elems only

    for (let i = 0; i < parentElem.childNodes.length; i++) {
        const n = parentElem.childNodes[i];

        if (n.nodeType === 1) {
            logicalIdx++;
            elemIdx++;
            if (logicalIdx === target) return elemIdx;
        } else if (n.nodeType === 3 && !isWhitespaceText(n)) {
            logicalIdx++;
            // text belongs to the current element position; return the last element index
            if (logicalIdx === target) return Math.max(0, elemIdx);
        }
    }

    // if pos points past end, clamp to append position (last element index + 1)
    return Math.max(0, elemIdx + 1);
}

/**
 * resolve relative element-index path for a par (xid of parent node)/ pos (position in parents child list) pair
 *
 * @param xidIndex
 * @param baseRoot
 * @param par
 * @param pos
 * @returns {string|null}
 */
function resolveRelPathByParPos(xidIndex, baseRoot, par, pos) {
    if (!xidIndex || !par || pos == null) return null;
    // find parent element by XID
    const parentEl = xidIndex.get(String(par));
    if (!parentEl) return null;
    // compute parent relative path
    const parentRel = indexPathForNodeRelative(baseRoot, parentEl);
    if (!parentRel) return null;
    // convert pos to element index
    const elemIdx = elementIndexForDomPos(parentEl, Number(pos));
    if (elemIdx == null || Number.isNaN(elemIdx)) return null;
    // join parent path and child index
    return joinIndexPath(parentRel, elemIdx);
}

/**
 * used specifically for moves
 *  resolves the child at par/pos
 *  then tries to return the actual moved object
 *
 * @param xidIndex
 * @param baseRoot
 * @param par
 * @param pos
 * @returns {string|null}
 */
export function resolveMoveObjectRelByParPos(xidIndex, baseRoot, par, pos) {
    if (!xidIndex || !par || pos == null) return null;

    const parentEl  = xidIndex.get(String(par));
    if (!parentEl) return null;

    const parentRel = indexPathForNodeRelative(baseRoot, parentEl);
    if (!parentRel) return null;

    const elemIdx   = elementIndexForDomPos(parentEl, Number(pos));
    const childRel  = joinIndexPath(parentRel, elemIdx);

    const childNode = elementByRelIndexPath(baseRoot, childRel);
    if (!childNode) return null;
    // if the child is already a process-relevant element, return it
    const childTag = (childNode.localName || childNode.tagName || "").toLowerCase();
    if (GATEWAY_TAGS.has(childTag) || BRANCH_CONTAINER_TAGS.has(childTag) || DIFF_BOUNDARY_TAGS.has(childTag)) {
        return indexPathForNodeRelative(baseRoot, childNode);
    }
    // otherwise climb it upwards to gateway/branch owner
    let cur = childNode;
    while (cur) {
        const el = cur;
        if (!el) break;
        const t = (el.localName || el.tagName || "").toLowerCase();
        if (GATEWAY_TAGS.has(t) || BRANCH_CONTAINER_TAGS.has(t)) return indexPathForNodeRelative(baseRoot, el);
        cur = el.parentNode;
    }
    // fallback: movement of a nested element is assigned to nearest visible process element
    const owner = nearestDrawable(childNode);
    return owner ? indexPathForNodeRelative(baseRoot, owner)
        : indexPathForNodeRelative(baseRoot, childNode);
}

// highlight the drawable owner (resolve the node by par/pos and then climb up) not the hidden child
export function resolveDrawableOwnerRelPathByParPos(xidIndex, baseRoot, par, pos) {
    const rel = resolveRelPathByParPos(xidIndex, baseRoot, par, pos);
    if (!rel) return null;

    const node = elementByRelIndexPath(baseRoot, rel);
    if (!node) return null;

    const owner = nearestDrawable(node) || node;
    const ownerRel = indexPathForNodeRelative(baseRoot, owner);
    return ownerRel || rel;
}

/**
 * create a stable-ish slot identifier from parent and position
 * used in pairMoves() to detect whether a move delete/insert is in the same slot
 * if same old slot and new slot: probably not a real move
 *
 * @param xidIndex
 * @param baseRoot
 * @param par
 * @param pos
 * @returns {string|null}
 */
export function slotKeyFromParPos(xidIndex, baseRoot, par, pos) {
    if (!xidIndex || !par || !pos) return null;

    const parentEl  = xidIndex.get(String(par));
    if (!parentEl) return null;

    const parentRel = indexPathForNodeRelative(baseRoot, parentEl);
    if (!parentRel) return null;

    const elemIdx = elementIndexForDomPos(parentEl, Number(pos));

    // prefer stable parent ID if it exists
    const pid = parentEl.getAttribute?.("id");
    const parentKey = pid ? `id:${pid}` : `path:${parentRel}`;

    return `${parentKey}@${elemIdx}`;
}

/**
 * resolves where an insert ended up in the new tree
 *
 * @param edit
 * @param baseNew
 * @param newXidIndex
 * @returns {string}
 */
export function resolveNewPathForInsert(edit, baseNew, newXidIndex) {
    if (!newXidIndex) return "/?";

    const par = edit.getAttribute("par");
    const pos = edit.getAttribute("pos");

    // prefer par/pos (best for placement)
    if (par && pos) {
        const parentElem = newXidIndex.get(String(par));
        if (parentElem) {
            const parentRel = indexPathForNodeRelative(baseNew, parentElem);
            if (parentRel) {
                const elemIdx = elementIndexForDomPos(parentElem, Number(pos));
                return joinIndexPath(parentRel, elemIdx);
            }
        }
    }

    // fallback: xm (points at moved/inserted node id)
    const xmId = firstXmId(edit.getAttribute("xm"));
    if (xmId) {
        const el = newXidIndex.get(String(xmId));
        const rel = el ? indexPathForNodeRelative(baseNew, el) : null;
        if (rel) return rel;
    }

    // fallback: id/xid attribute if present
    const nodeId = edit.getAttribute("id") || edit.getAttribute("xid");
    if (nodeId) {
        const el = newXidIndex.get(String(nodeId));
        const rel = el ? indexPathForNodeRelative(baseNew, el) : null;
        if (rel) return rel;
    }

    return "/?";
}

/**
 * resolves where a delete/update occurred in the old tree
 * fallback resolver when payload-based resolution fails
 *
 * @param edit
 * @param workDir
 * @param oldDom
 * @param baseOld
 * @param oldXidIndex
 * @returns {string|string}
 */
export function resolveOldPathForDeleteOrUpdate(edit, workDir, oldDom, baseOld, oldXidIndex) {
    // oldXidIndex is: xid -> node (built from the compressed xidmap expr)
    if (!oldXidIndex) return "/?";

    // attribute-anchored (works for <au a="cancel"...> etc) update: search in old tree for element with old value
    const a = edit.getAttribute("a");
    const ov = edit.getAttribute("ov");
    if (a && ov) {
        let hit = null;
        (function walk(node) {
            if (!node || hit) return;
            if (node.nodeType === 1) {
                const val = node.getAttribute && node.getAttribute(a);
                if (val === ov) { hit = node; return; }
                for (let i = 0; i < node.childNodes.length; i++) {
                    const c = node.childNodes[i];
                    if (c.nodeType === 1) walk(c);
                }
            }
        })(baseOld);

        if (hit) {
            const rel = indexPathForNodeRelative(baseOld, hit);
            if (rel) return rel;
        }
    }

    // direct xid/id field if present
    const nodeId = edit.getAttribute("id") || edit.getAttribute("xid");
    if (nodeId) {
        const el = oldXidIndex.get(String(nodeId));
        const rel = el ? indexPathForNodeRelative(baseOld, el) : null;
        if (rel) return rel;
    }

    // par/pos placement
    const par = edit.getAttribute("par");
    const pos = edit.getAttribute("pos");
    if (par && pos) {
        const parentEl = oldXidIndex.get(String(par));
        if (parentEl) {
            const parentRel = indexPathForNodeRelative(baseOld, parentEl);
            if (parentRel) {
                const elemIdx = elementIndexForDomPos(parentEl, Number(pos));
                return joinIndexPath(parentRel, elemIdx);
            }
        }
    }

    // fallback: xm first id -> node
    const xmId = firstXmId(edit.getAttribute("xm"));
    if (xmId) {
        const el = oldXidIndex.get(String(xmId));
        const rel = el ? indexPathForNodeRelative(baseOld, el) : null;
        if (rel) return rel;
    }

    return nodeId ? `/xid${nodeId}` : "/?";
}