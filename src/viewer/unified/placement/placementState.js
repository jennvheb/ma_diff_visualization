// XYDiff-only: per-container occupied insertion indices (by container id or by path)
const XY_SLOT_USED = new Map(); // key -> Set<number>

/**
 * generate a path from the containers position in the XML tree whenever it has no id
 *
 * @param el
 * @returns {string}
 */
function containerPathKey(el) {
    const segs = [];

    let cur = el;
    while (cur && cur.parentNode && cur.parentNode.nodeType === 1) {
        const parent = cur.parentNode;

        const siblings = Array.from(parent.children || [])
            .filter(n => n.nodeType === 1);

        const idx = siblings.indexOf(cur);

        segs.push(idx);
        cur = parent;
    }

    return "/" + segs.reverse().join("/");
}

/**
 * Returns stable key for slot reservation
 *
 * @param containerEl
 * @returns {*|string|string}
 */
function slotKeyForContainer(containerEl) {
    if (!containerEl) return "__root__";

    return (
        containerEl.getAttribute?.("id") ||
        `path:${containerPathKey(containerEl)}`
    );
}

/**
 * Prevents multiple ghosts from being inserted into the exact same container index
 * uses global map XY_SLOT_USED
 * If desired index is taken, it increments
 *
 * @param containerEl
 * @param desiredIdx
 * @returns {*}
 */
export function reservePosition(containerEl, desiredIdx) {
    const key = slotKeyForContainer(containerEl);
    if (!XY_SLOT_USED.has(key)) XY_SLOT_USED.set(key, new Set());
    const used = XY_SLOT_USED.get(key);

    let idx = desiredIdx;
    while (used.has(idx)) idx++;
    used.add(idx);
    return idx;
}

export function resetPlacementState() {
    XY_SLOT_USED.clear();
}