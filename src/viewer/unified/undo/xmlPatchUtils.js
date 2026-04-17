const XML_NS = "http://cpee.org/ns/description/1.0";

export function parseXml(xmlString) {
    return new DOMParser().parseFromString(xmlString, "text/xml");
}

export function serializeXml(doc) {
    return new XMLSerializer().serializeToString(doc);
}

export function getDslRoot(doc) {
    if (!doc) return null;

    const root = doc.documentElement;
    if (root?.localName === "description") return root;

    const hits = doc.getElementsByTagNameNS?.(XML_NS, "description");
    if (hits && hits.length) return hits[0];

    const fallback = doc.getElementsByTagName?.("description");
    return fallback?.[0] || null;
}

export function childElements(node) {
    return Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
}

export function elementChildrenByTag(node, tagName) {
    return childElements(node).filter(el => el.localName === tagName);
}

export function findElementById(root, id) {
    if (!root || !id) return null;
    return root.querySelector?.(`*[id="${CSS.escape(id)}"]`) || null;
}

export function findElementByRebasedPath(root, path) {
    if (!root || !path) return null;
    const segs = String(path).split("/").filter(Boolean).map(Number);
    let cur = root;

    for (const seg of segs) {
        const kids = childElements(cur);
        cur = kids[seg] || null;
        if (!cur) return null;
    }
    return cur;
}

export function getParentPath(path) {
    const segs = String(path || "").split("/").filter(Boolean);
    if (!segs.length) return null;
    return "/" + segs.slice(0, -1).join("/");
}

export function getLastPathIndex(path) {
    const segs = String(path || "").split("/").filter(Boolean);
    if (!segs.length) return null;
    return Number(segs[segs.length - 1]);
}

export function cloneIntoDoc(node, targetDoc) {
    if (!node || !targetDoc) return null;
    return targetDoc.importNode
        ? targetDoc.importNode(node, true)
        : node.cloneNode(true);
}

export function replaceElement(targetEl, replacementEl) {
    if (!targetEl || !replacementEl || !targetEl.parentNode) return false;
    targetEl.parentNode.replaceChild(replacementEl, targetEl);
    return true;
}

export function removeElement(el) {
    if (!el || !el.parentNode) return false;
    el.parentNode.removeChild(el);
    return true;
}

// Insert before the 1-based element index within the parent. If index is larger than the number of children + 1, append.
export function insertElementAt(parentEl, childEl, oneBasedIndex) {
    if (!parentEl || !childEl) return false;

    const kids = childElements(parentEl);
    const idx0 = Math.max(0, (Number(oneBasedIndex) || 1) - 1);

    if (idx0 >= kids.length) {
        parentEl.appendChild(childEl);
        return true;
    }

    parentEl.insertBefore(childEl, kids[idx0]);
    return true;
}

export function resolveNodeById(root, id) {
    return findElementById(root, id);
}

export function resolveNodeByPath(root, path) {
    return findElementByRebasedPath(root, path);
}

// try ID first, then path. Keep this only for places where that fallback is really intended.
export function resolveNode(root, { id, path }) {
    return resolveNodeById(root, id) || resolveNodeByPath(root, path);
}

export function resolveNodeRobust(root, {
    realId,
    sid,
    canonicalPath,
    rebasedPath
}) {
    return (
        resolveNodeById(root, realId) ||
        resolveNodeById(root, sid) ||
        resolveNodeByPath(root, canonicalPath) ||
        resolveNodeByPath(root, rebasedPath) ||
        null
    );
}