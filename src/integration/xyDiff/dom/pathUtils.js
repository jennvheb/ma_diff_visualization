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

export function isDescendantPath(child, ancestor) {
    if (!child || !ancestor) return false;
    if (ancestor === "/") return true;
    return child === ancestor || child.startsWith(ancestor.replace(/\/+$/, "") + "/");
}

export function findContainingDeletedRoot(path, deletedRoots) {
    // pick the deepest deleted root that contains path (most specific)
    let best = null;
    for (const r of deletedRoots) {
        if (isDescendantPath(path, r)) {
            if (!best || r.length > best.length) best = r;
        }
    }
    return best;
}

export function isCoveredByDelete(path, deletedRoots) {
    if (!path) return false;

    for (const r of deletedRoots) {
        if (!r || r === path) continue; // ignore self
        if (isDescendantPath(path, r)) return true; // any strict ancestor delete covers it
    }
    return false;
}

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