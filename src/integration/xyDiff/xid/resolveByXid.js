import {snapRelPathToDrawable} from "../dom/drawableUtils.js";
import {indexPathForNodeRelative} from "../dom/pathUtils.js";
import {DIFF_BOUNDARY_TAGS} from "../../tags.js";
import {nearestDrawable} from "../../stableIds.js";

/**
 * extracts the first numeric id from a xm value
 * used to locate nodes, paths, owner, ops
 * as a representative node
 *
 * @param xm
 * @returns {string|null}
 */
export function firstXmId(xm) {
    if (!xm) return null;
    const s = String(xm);
    const m = s.match(/(\d+)(?:-\d+)?/);
    return m ? m[1] : null;
}

/**
 * keep the whole xm string as the key
 * because a move can refer to a range: using only the first id could incorrectly merge different moves
 *
 * @param xmRaw
 * @returns {string|null}
 */
export function normalizeXmKey(xmRaw) {
    // xmRaw looks like "(53)" or "(18-38;54-68;70)"
    // use the entire normalized string as the key (NOT firstXmId!)
    const s = String(xmRaw || "").trim();
    return s || null;
}

/**
 * gets the tag name of the element identified by an XID
 * used to ignore non-structural moved things
 *
 * @param xidIndex
 * @param xmId
 * @returns {string|null}
 */
export function xidElTag(xidIndex, xmId) {
    if (!xidIndex || !xmId) return null;
    const el = xidIndex.get(String(xmId));
    if (!el || el.nodeType !== 1) return null;
    return (el.localName || el.tagName || "").toLowerCase();
}

/**
 * Finds the node by XID, then climbs to nearest drawable ancestor
 * Used for move resolution
 *
 * @param xidIndex
 * @param baseElem
 * @param xmId
 * @returns {string|null}
 */
export function resolveRelPathByXidForMove(xidIndex, baseElem, xmId) {
    if (!xmId || !xidIndex) return null;

    const raw = xidIndex.get(String(xmId));
    if (!raw) return null;

    const owner = nearestDrawable(raw);
    if (!owner) return null;

    return indexPathForNodeRelative(baseElem, owner);
}

/**
 * General XID-to-path resolver
 * If snapIfNotDrawable is true and the XID points to a non-drawable XML node, it snaps upward to the drawable owner
 * Used as fallback for inserts/deletes/updates
 *
 * @param xidIndex
 * @param baseElem
 * @param xid
 * @param snapIfNotDrawable
 * @returns {*|null}
 */
export function resolveRelPathByXid(xidIndex, baseElem, xid, { snapIfNotDrawable = true } = {}) {
    if (!xid || !xidIndex) return null;

    const el = xidIndex.get(String(xid));
    if (!el) return null;

    let rel = indexPathForNodeRelative(baseElem, el);
    if (!rel) return null;

    if (snapIfNotDrawable) {
        const tag = (el.localName || el.tagName || "").toLowerCase();
        if (!DIFF_BOUNDARY_TAGS.has(tag)) {
            rel = snapRelPathToDrawable(baseElem, rel);
        }
    }
    return rel;
}

/**
 * Combines /5/1 + 2 -> /5/1/2
 *
 * @param parentRel
 * @param childIdx
 * @returns {string}
 */
export function joinIndexPath(parentRel, childIdx) {
    const p = String(parentRel || "").replace(/\/+$/, "");
    return (p ? p : "") + "/" + String(childIdx);
}