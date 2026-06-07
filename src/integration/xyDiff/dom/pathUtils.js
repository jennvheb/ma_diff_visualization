function segs(pathStr) {
    return String(pathStr || "").split("/").filter(Boolean).map(Number);
}

export function numericTail(pathStr) {
    const s = segs(pathStr);
    return s.length ? s[s.length - 1] : null;
}

export function sameDepth(a, b) {
    return segs(a).length === segs(b).length;
}

export function parentPath(pathStr) {
    const s = segs(pathStr);
    if (!s.length) return null;
    if (s.length === 1) return "/";
    return "/" + s.slice(0, -1).join("/");
}

/**
 * checks whether one path is inside another
 * important for detecting whether an edit is already covered by a larger deleted subtree
 *
 * @param child
 * @param ancestor
 * @returns {boolean|boolean}
 */
export function isDescendantPath(child, ancestor) {
    if (!child || !ancestor) return false;
    if (ancestor === "/") return true;
    return child === ancestor || child.startsWith(ancestor.replace(/\/+$/, "") + "/");
}

/**
 * find the deepest deleted ancestor that contains a path
 * useful to avoid showing redundant child deletes when the parent branch is already deleted
 *
 * @param path
 * @param deletedRoots
 * @returns {null}
 */
export function findContainingDeletedRoot(path, deletedRoots) {
    let best = null;
    for (const r of deletedRoots) {
        if (isDescendantPath(path, r)) {
            if (!best || r.length > best.length) best = r;
        }
    }
    return best;
}

/**
 * if path points too deep, trim upward until an existing element is found
 * important because xydiff may point to a low-level child that the viewer cannot directly color
 *
 * @param baseElem
 * @param relPath
 * @returns {*|string}
 */
export function trimRelPathToExistingElement(baseElem, relPath) {
    let s = segs(relPath);
    while (s.length) {
        const p = "/" + s.join("/");
        const el = elementByRelIndexPath(baseElem, p);
        if (el) return p;
        s = s.slice(0, -1);
    }
    return relPath;
}

/**
 * cimpute relative index path of a DOM node
 *
 * @param baseElem
 * @param node
 * @returns {string|null}
 */
export function indexPathForNodeRelative(baseElem, node) {
    if (!baseElem || !node) return null;

    // ensure node is within baseElem
    let within = false;
    for (let p = node; p; p = p.parentNode) {
        if (p === baseElem) { within = true; break; }
    }
    if (!within) return null;

    const indices = [];
    let cur = node;

    while (cur && cur !== baseElem) {
        const parent = cur.parentNode;
        if (!parent) break;

        let k = 0, idx = -1;
        for (let i = 0; i < parent.childNodes.length; i++) {
            const c = parent.childNodes[i];
            if (c.nodeType === 1) {
                if (c === cur) idx = k;
                k++;
            }
        }
        if (idx < 0) break;

        indices.push(idx);
        cur = parent;
    }

    indices.reverse();
    return "/" + indices.join("/");
}

/**
 * locate node from xydiff paths
 *
 * @param baseElem
 * @param relPath
 * @returns {*|null}
 */
export function elementByRelIndexPath(baseElem, relPath) {
    if (!baseElem || !relPath) return null;
    let node = baseElem;
    const s = segs(relPath);
    for (let i = 0; i < s.length; i++) {
        let k = -1, picked = null;
        for (let j = 0; j < node.childNodes.length; j++) {
            const c = node.childNodes[j];
            if (c.nodeType === 1) { k++; if (k === s[i]) { picked = c; break; } }
        }
        if (!picked) return null;
        node = picked;
    }
    return node;
}