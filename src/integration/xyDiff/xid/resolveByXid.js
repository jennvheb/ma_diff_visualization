import {nearestDrawableAncestor, snapRelPathToDrawable} from "../dom/drawableUtils.js";
import {indexPathForNodeRelative} from "../dom/pathUtils.js";
import {DIFF_BOUNDARY_TAGS} from "../../tags.js";


export function firstXmId(xm) {
    if (!xm) return null;
    const s = String(xm);
    const m = s.match(/(\d+)(?:-\d+)?/);
    return m ? m[1] : null;
}

export function normalizeXmKey(xmRaw) {
    // xmRaw looks like "(53)" or "(18-38;54-68;70)"
    // use the entire normalized string as the key (NOT firstXmId!)
    const s = String(xmRaw || "").trim();
    return s || null;
}

export function xidElTag(xidIndex, xmId) {
    if (!xidIndex || !xmId) return null;
    const el = xidIndex.get(String(xmId));
    if (!el || el.nodeType !== 1) return null;
    return (el.localName || el.tagName || "").toLowerCase();
}

// xmId -> owning drawable/gateway rel path in the given baseElem
export function resolveRelPathByXidForMove(xidIndex, baseElem, xmId) {
    if (!xmId || !xidIndex) return null;

    const raw = xidIndex.get(String(xmId));
    if (!raw) return null;

    const owner = nearestDrawableAncestor(raw);
    if (!owner) return null;

    return indexPathForNodeRelative(baseElem, owner);
}

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

export function joinIndexPath(parentRel, childIdx) {
    const p = String(parentRel || "").replace(/\/+$/, "");
    return (p ? p : "") + "/" + String(childIdx);
}