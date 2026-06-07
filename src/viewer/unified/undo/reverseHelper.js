import {childElements, findElementByRebasedPath} from "./xmlPatchUtils.js";

/**
 * If a path no longer exists, climb upward until a parent exists
 * Fallback when restoring deleted/moved nodes into a partially changed current tree
 *
 * @param root
 * @param path
 * @returns {*|null}
 */
export function resolveClosestExistingAncestor(root, path) {
    if (!root || !path) return null;

    const segs = String(path).split("/").filter(Boolean);

    while (segs.length) {
        const candidate = "/" + segs.join("/");
        const el = findElementByRebasedPath(root, candidate);
        if (el) return el;
        segs.pop();
    }

    return root;
}

/**
 * Computes numeric path from root to node
 * Inverse of resolveElementByNumericPath
 *
 * @param root
 * @param node
 * @returns {string|null}
 */
export function indexPathFromAncestor(root, node) {
    if (!root || !node) return null;
    if (root === node) return "/";

    const segs = [];
    let cur = node;

    while (cur && cur !== root) {
        const parent = cur.parentNode;
        if (!parent || parent.nodeType !== 1) return null;

        const kids = childElements(parent);
        const idx = kids.indexOf(cur);
        if (idx < 0) return null;

        segs.push(idx);
        cur = parent;
    }

    if (cur !== root) return null;
    return "/" + segs.reverse().join("/");
}

/**
 * Maps a node from a stamped lookup tree back to the real unstamped tree by numeric path
 * -> lookup tree may contain synthetic ids, but real tree should remain clean
 *
 * @param realRoot
 * @param lookupRoot
 * @param lookupNode
 * @returns {*|null}
 */
export function findRealNodeByLookupNode(realRoot, lookupRoot, lookupNode) {
    const p = indexPathFromAncestor(lookupRoot, lookupNode);
    if (!p) return null;
    return findElementByRebasedPath(realRoot, p);
}

export function findElementById(root, id) {
    if (!root || !id) return null;
    return root.querySelector?.(`*[id="${CSS.escape(id)}"]`) || null;
}

/**
 * Used when restoring a deleted/moved node
 * looks at the deleted node’s siblings in OLD and tries to find surviving siblings in current NEW
 * places restored nodes in a reasonable original position even if paths shifted
 *
 * @param oldParentLookup
 * @param sourceOldLookup
 * @param newLookup
 * @param newRoot
 * @returns {{mode: string, parent: (*|(() => (Node | null))|ParentNode|ActiveX.IXMLDOMNode), ref: ({parentNode}|*)}|null}
 */
export function findAnchorByOldSiblings(oldParentLookup, sourceOldLookup, newLookup, newRoot) {
    const oldKids = childElements(oldParentLookup);
    const oldIndex = oldKids.indexOf(sourceOldLookup);
    if (oldIndex < 0) return null;

    // try next sibling first and insert before it
    for (let i = oldIndex + 1; i < oldKids.length; i++) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId) continue;

        const lookupMatch = findElementById(newLookup, sibId);
        if (!lookupMatch) continue;

        const realMatch = findElementById(newRoot, sibId);
        if (!realMatch || !realMatch.parentNode) continue;

        return {
            mode: "before",
            ref: realMatch,
            parent: realMatch.parentNode
        };
    }

    // then previous sibling, insert after it
    for (let i = oldIndex - 1; i >= 0; i--) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId) continue;

        const lookupMatch = findElementById(newLookup, sibId);
        if (!lookupMatch) continue;

        const realMatch = findElementById(newRoot, sibId);
        if (!realMatch || !realMatch.parentNode) continue;

        return {
            mode: "after",
            ref: realMatch,
            parent: realMatch.parentNode
        };
    }

    return null;
}