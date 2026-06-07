const XML_NS = "http://cpee.org/ns/description/1.0";

/**
 * Parses XML string into DOM document
 *
 * @param xmlString
 * @returns {Document}
 */
export function parseXml(xmlString) {
    return new DOMParser().parseFromString(xmlString, "text/xml");
}

/**
 * Serializes DOM document back into XML string
 *
 * @param doc
 * @returns {string}
 */
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

/**
 * Finds element by id using CSS selector
 *
 * @param root
 * @param id
 * @returns {*|null}
 */
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

/**
 * Clones a node into another XML document
 *
 * @param node
 * @param targetDoc
 * @returns {*|null}
 */
export function cloneIntoDoc(node, targetDoc) {
    if (!node || !targetDoc) return null;
    return targetDoc.importNode
        ? targetDoc.importNode(node, true)
        : node.cloneNode(true);
}

/**
 * Replaces one XML element with another
 *
 * @param targetEl
 * @param replacementEl
 * @returns {boolean}
 */
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

/**
 * Insert before the 1-based element index within the parent
 * If index is larger than the number of children + 1, append
 *
 * @param parentEl
 * @param childEl
 * @param oneBasedIndex
 * @returns {boolean}
 */
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

/**
 * Tries multiple ways to find a node:
 * 1. real id
 * 2. stable/synthetic id
 * 3. canonical path
 * 4. rebased path
 * Useful because after edits, paths may shift or ids may be synthetic
 *
 * @param root
 * @param realId
 * @param sid
 * @param canonicalPath
 * @param rebasedPath
 * @returns {*|null}
 */
export function resolveNodeRobust(root, {
    realId,
    sid,
    canonicalPath,
    rebasedPath
}) {
    return (
        findElementById(root, realId) ||
        findElementById(root, sid) ||
        findElementByRebasedPath(root, canonicalPath) ||
        findElementByRebasedPath(root, rebasedPath) ||
        null
    );
}