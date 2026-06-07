/**
 * returns element children of a node like parameters, annotations, etc.
 */
export function childElements(node) {
    const out = [];
    for (let i = 0; i < node.childNodes.length; i++) {
        const c = node.childNodes[i];
        if (c.nodeType === 1) out.push(c);
    }
    return out;
}

/**
 * return first element child of a node, useful for extracting payload nodes
 *
 * @param node
 * @returns {*|null}
 */
export function firstElementChild(node) {
    for (let i = 0; i < node.childNodes.length; i++) {
        const c = node.childNodes[i];
        if (c.nodeType === 1) return c;
    }
    return null;
}

/**
 * walk upwards until the nearest element node is found
 * xydiff may point to non-element nodes (e.g. text nodes) but visualization needs an xml element
 * @param node
 * @returns {*|null}
 */
export function nearestElementNode(node) {
    let cur = node;
    while (cur) {
        const el = cur;
        if (el && el.nodeType === 1) return el;
        cur = cur.parentNode;
    }
    return null;
}

/**
 * searches the tree under root und return the first element that matches the id
 *
 * @param root
 * @param id
 * @returns {{getAttribute}|*|null}
 */
export function findFirstElementById(root, id) {
    if (!root) return null;
    const stack = [root];
    while (stack.length) {
        const n = stack.pop();
        if (n?.nodeType === 1) {
            if (n.getAttribute && n.getAttribute("id") === String(id)) return n;
            for (let i = n.childNodes.length - 1; i >= 0; i--) {
                const c = n.childNodes[i];
                if (c?.nodeType === 1) stack.push(c);
            }
        }
    }
    return null;
}

/**
 * collects all nodes under a branch or subtree
 * used for branch deletes/inserts/moves because a whole deleted branch may contain many cpee nodes
 *
 * @param root
 * @param limit
 * @returns {*[]}
 */
export function collectDescendantIds(root, limit = 50) {
    const ids = [];
    if (!root) return ids;
    const stack = [root];
    while (stack.length && ids.length < limit) {
        const n = stack.pop();
        if (n?.nodeType === 1) {
            const id = n.getAttribute?.("id");
            if (id) ids.push(String(id));
            for (let i = n.childNodes.length - 1; i >= 0; i--) {
                const c = n.childNodes[i];
                if (c?.nodeType === 1) stack.push(c);
            }
        }
    }
    return ids;
}

/**
 * collect all nodes of the document in postorder traversal (from leaves to parents)
 * important for mapping
 *
 * @param doc
 * @returns {*[]}
 */
export function collectNodesPostorder(doc) {
    const out = [];
    const isWhitespaceText = (n) =>
        n && n.nodeType === 3 && String(n.nodeValue || "").trim() === "";

    function visit(node) {
        if (!node) return;

        if (node.nodeType === 1) {
            // postorder: children first (in document order)
            for (let i = 0; i < node.childNodes.length; i++) {
                const c = node.childNodes[i];
                if (c.nodeType === 1) {
                    visit(c);
                } else if (c.nodeType === 3 && !isWhitespaceText(c)) {
                    out.push(c); // text nodes are included (non-whitespace)
                }
                // ignore attributes and comments
            }
            out.push(node); // element last
            return;
        }

        if (node.nodeType === 3 && !isWhitespaceText(node)) {
            out.push(node);
        }
    }

    visit(doc.documentElement);
    return out;
}