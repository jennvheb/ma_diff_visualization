import {firstKRealTaskIds, gatewayStructureSig, hash32, tagName} from "../../integration/stableIds.js";
import {DIFF_BOUNDARY_TAGS} from "../../integration/tags.js";

/**
 * Creates ghost ids
 *
 * @param kind
 * @param id
 * @returns {string}
 */
export function ghostifyId(kind, id) {
    return `__ghost_${kind}__${id}`;
}

/**
 * Walks through a subtree and prefixes every drawable element id with a ghost id
 *
 * @param rootEl
 * @param kind
 */
export function prefixDrawableIdsInSubtree(rootEl, kind) {
    if (!rootEl) return;

    function walk(n) {
        if (!n || n.nodeType !== 1) return;
        const t = tagName(n);

        if (DIFF_BOUNDARY_TAGS.has(t) && n.hasAttribute("id")) {
            const orig = n.getAttribute("id");
            if (orig && !orig.startsWith("__ghost_")) {
                n.setAttribute("_orig_id", orig);
                n.setAttribute("id", ghostifyId(kind, orig));
            }
        }
        for (const c of Array.from(n.children || [])) walk(c);
    }

    walk(rootEl);
}

/**
 * removes CPEE layout/SVG prefix from ids
 *
 * @param id
 * @returns {*}
 */
export function normalizeElementId(id) {
    if (!id) return id;
    return id.startsWith("ele-") ? id.slice(4) : id;
}

/**
 * Returns all useful id variants
 * Used by colorization and click lookup so the code works regardless of whether SVG uses raw id or ele- id
 *
 * @param id
 * @returns {(*|string)[]|*[]}
 */
export function idVariants(id) {
    if (!id) return [];
    const norm = normalizeElementId(id);
    return Array.from(new Set([id, norm, "ele-" + norm]));
}

/**
 * Checks whether id is a ghost
 *
 * @param id
 * @param kind
 * @returns {boolean}
 */
export function isGhostId(id, kind /* "delete"|"move" */) {
    return typeof id === "string" && id.startsWith(`__ghost_${kind}__`);
}

/**
 * Checks whether an id is a synthetic gateway id
 *
 * @param id
 * @returns {boolean}
 */
export function isSyntheticGw(id) {
    return typeof id === "string" && id.startsWith("__gw_");
}

/**
 * Computes overlap between two id arrays
 * Used to compare gateway witness ids
 *
 * @param a
 * @param b
 * @returns {number|number}
 */
function overlapScore(a = [], b = []) {
    const A = new Set(a), B = new Set(b);
    if (!A.size && !B.size) return 0;
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    const uni = A.size + B.size - inter;
    return uni ? inter / uni : 0;
}


/**
 * Finds the best corresponding gateway in the new model
 * Gateways often do not have real CPEE ids
 * synthetic ids may differ if the structure changes
 * this tries to match old gateway to new gateway
 *
 * used to recover/match gateway identity when synthetic ids are unstable
 *
 * @param oldGw
 * @param oldParentDrawableId
 * @param newIndex
 * @returns {null}
 */
export function bestMatchGatewayInNew(oldGw, oldParentDrawableId, newIndex) {
    if (!oldGw) return null;
    const t = tagName(oldGw);
    const oldW = firstKRealTaskIds(oldGw, 3);
    const oldS = gatewayStructureSig(oldGw);

    let bestId = null;
    let bestScore = -1;

    for (const cand of newIndex) {
        // cand.id is the gateway id in NEW
        if (!cand.id) continue;

        // tag check by id prefix
        // compare oldGw tag against cand.id "__gw_<tag>__..."
        if (!String(cand.id).startsWith(`__gw_${t}__`)) continue;

        const parentBonus = (oldParentDrawableId && cand.pid === oldParentDrawableId) ? 0.15 : 0;
        const wScore = overlapScore(oldW, cand.witnesses);
        let score = wScore + parentBonus;
        // If no witness ids exist, compare structure hash
        if (wScore === 0 && oldW.length === 0 && oldS && cand.struct) {
            if (hash32(oldS) === hash32(cand.struct)) score = 0.5 + parentBonus;
        }
        // Return the best candidate id if score is high enough
        if (score > bestScore) {
            bestScore = score;
            bestId = cand.id;
        }
    }

    return bestScore >= 0.25 ? bestId : null;
}