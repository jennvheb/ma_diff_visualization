import {firstKRealTaskIds, gatewayStructureSig, hash32, tagName} from "../../integration/stableIds.js";
import {DIFF_BOUNDARY_TAGS} from "../../integration/tags.js";

export function ghostifyId(kind, id) {
    return `__ghost_${kind}__${id}`;
}

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

export function normalizeElementId(id) {
    if (!id) return id;
    return id.startsWith("ele-") ? id.slice(4) : id;
}

export function idVariants(id) {
    if (!id) return [];
    const norm = normalizeElementId(id);
    return Array.from(new Set([id, norm, "ele-" + norm]));
}


export function isGhostId(id, kind /* "delete"|"move" */) {
    return typeof id === "string" && id.startsWith(`__ghost_${kind}__`);
}

export function isSyntheticGw(id) {
    return typeof id === "string" && id.startsWith("__gw_");
}

function overlapScore(a = [], b = []) {
    const A = new Set(a), B = new Set(b);
    if (!A.size && !B.size) return 0;
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    const uni = A.size + B.size - inter;
    return uni ? inter / uni : 0;
}


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

        if (wScore === 0 && oldW.length === 0 && oldS && cand.struct) {
            if (hash32(oldS) === hash32(cand.struct)) score = 0.5 + parentBonus;
        }

        if (score > bestScore) {
            bestScore = score;
            bestId = cand.id;
        }
    }

    return bestScore >= 0.25 ? bestId : null;
}