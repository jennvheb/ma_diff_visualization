import {BRANCH_CONTAINER_TAGS, DIFF_BOUNDARY_TAGS, GATEWAY_TAGS} from "./tags.js";


export function tagName(n) {
    return (n?.localName || n?.tagName || "").toLowerCase();
}

export function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

export function isGatewayTagName(tag) {
    return GATEWAY_TAGS.has((tag || "").toLowerCase()) || BRANCH_CONTAINER_TAGS.has((tag || "").toLowerCase());
}

export function isRealTaskId(id) {
    return typeof id === "string"
        && id.length
        && !id.startsWith("__gw_")
        && !id.startsWith("__ghost_");
}

export function isRealTaskDrawable(el) {
    if (!el || el.nodeType !== 1) return false;
    const t = tagName(el);
    if (!(t === "call" || t === "manipulate" || t === "stop")) return false;
    const id = el.getAttribute?.("id");
    return isRealTaskId(id);
}

function elementChildren(node) {
    const out = [];
    const kids = node?.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c && c.nodeType === 1) out.push(c);
    }
    return out;
}

export function stableIdxAmongSameTag(node) {
    if (!node?.parentNode) return 0;
    const t = tagName(node);
    const sibs = elementChildren(node.parentNode);
    let k = 0;
    for (const s of sibs) {
        if (tagName(s) === t) {
            if (s === node) return k;
            k++;
        }
    }
    return 0;
}

// BFS for “nearby” tasks
export function firstKRealTaskIds(node, k = 3) {
    const out = [];
    if (!node || node.nodeType !== 1) return out;

    const q = [node];
    while (q.length && out.length < k) {
        const cur = q.shift();
        if (isRealTaskDrawable(cur)) out.push(cur.getAttribute("id"));

        const kids = elementChildren(cur);
        for (const c of kids) q.push(c);
    }
    return out;
}

// Manual descendant walk (no querySelectorAll)
function walkDesc(node, fn) {
    if (!node || node.nodeType !== 1) return;
    fn(node);
    const kids = elementChildren(node);
    for (const c of kids) walkDesc(c, fn);
}

export function gatewayStructureSig(gwEl) {
    if (!gwEl || gwEl.nodeType !== 1) return "";
    const t = tagName(gwEl);

    const childTags = elementChildren(gwEl).map(tagName).join(",");

    const counts = { call: 0, manipulate: 0, stop: 0 };
    walkDesc(gwEl, (n) => {
        const tt = tagName(n);
        if (tt === "call") counts.call++;
        else if (tt === "manipulate") counts.manipulate++;
        else if (tt === "stop") counts.stop++;
    });

    return `${t}::${childTags}::c${counts.call}-m${counts.manipulate}-s${counts.stop}`;
}

export function stableGatewayId(node, parentDrawableId) {
    const t = tagName(node);
    const pid = parentDrawableId || "root";

    const witnesses = firstKRealTaskIds(node, 3);
    if (witnesses.length) {
        return `__gw_${t}__${pid}__w_${hash32(witnesses.join("|"))}`;
    }

    const s = gatewayStructureSig(node);
    if (s) {
        return `__gw_${t}__${pid}__s_${hash32(s)}`;
    }

    const ord = stableIdxAmongSameTag(node);
    return `__gw_${t}__${pid}__o_${ord}`;
}

export function nearestDrawable(node) {
    let cur = node;
    while (cur && cur.nodeType === 1) {
        if (DIFF_BOUNDARY_TAGS.has(tagName(cur))) return cur;
        cur = cur.parentNode;
    }
    return null;
}

/**
 * Stamps stable ids onto gateways and onto any drawable lacking id.
 * - Keeps real task ids as-is.
 * - Assigns stable ids to gateways.
 */
export function stampLogicalIds(root) {
    function walk(node) {
        if (!node || node.nodeType !== 1) return;

        const t = tagName(node);
        if (DIFF_BOUNDARY_TAGS.has(t)) {
            const hasId = node.hasAttribute?.("id");
            const isGateway = isGatewayTagName(t);
            const isTask = (t === "call" || t === "manipulate" || t === "stop");

            const parentDrawable = nearestDrawable(node.parentNode);
            const pid = parentDrawable?.getAttribute?.("id") || "root";

            if (isTask && hasId && isRealTaskId(node.getAttribute("id"))) {
                // keep real ids
            } else if (isGateway || !hasId) {
                node.setAttribute("id", stableGatewayId(node, pid));
            }
        }

        const kids = elementChildren(node);
        for (const c of kids) walk(c);
    }

    walk(root);
}