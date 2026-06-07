import {
    childElements, cloneIntoDoc,
    findElementByRebasedPath,
    getDslRoot, getLastPathIndex,
    getParentPath, insertElementAt,
    parseXml,
    resolveNodeRobust,
    serializeXml
} from "./xmlPatchUtils.js";
import {stampLogicalIds} from "../../../integration/stableIds.js";
import {
    findAnchorByOldSiblings, findElementById,
    findRealNodeByLookupNode,
    indexPathFromAncestor,
    resolveClosestExistingAncestor
} from "./reverseHelper.js";

/**
 * Used for pruning restored subtrees (when an element was already moved elsewhere)
 * @param root
 * @returns {unknown[]|*[]}
 */
function allElementsWithId(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll?.("*[id]") || []);
}

/**
 * When restoring a deleted subtree from OLD, some descendants may already exist elsewhere in current NEW because they were moved
 * This removes descendants from the restored clone if their id already exists in current NEW
 * To avoid duplicating moved/surviving nodes
 *
 * @param cloneRoot
 * @param currentNewRoot
 */
function pruneCloneDescendantsAlreadyPresent(cloneRoot, currentNewRoot) {
    if (!cloneRoot || !currentNewRoot) return;

    const descendants = allElementsWithId(cloneRoot);

    for (const el of descendants) {
        // do not prune the root element of the restored subtree itself
        if (el === cloneRoot) continue;

        const id = el.getAttribute("id");
        if (!id) continue;

        // if that id already exists somewhere in current NEW, this descendant has survived/moved elsewhere already
        const existing = findElementById(currentNewRoot, id);
        if (existing) {
            el.parentNode?.removeChild(el);
        }
    }
}

/**
 * Undo delete means:
 * copy deleted node from baseline OLD
 * insert it into current NEW
 *
 * @param baselineOldXml
 * @param currentNewXml
 * @param op
 * @returns {string}
 */
export function reverseDelete({ baselineOldXml, currentNewXml, op }) {
    const oldDoc = parseXml(baselineOldXml);
    const newDoc = parseXml(currentNewXml);

    const oldRoot = getDslRoot(oldDoc);
    const newRoot = getDslRoot(newDoc);

    if (!oldRoot || !newRoot) {
        throw new Error("reverseDelete: missing DSL root");
    }

    // stamped lookup copies only
    const oldLookup = oldRoot.cloneNode(true);
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(oldLookup);
    stampLogicalIds(newLookup);

    // find deleted node in stamped OLD lookup tree
    const sourceOldLookup = resolveNodeRobust(oldLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidOld,
        canonicalPath: op.oldPath,
        rebasedPath: op.rebasedOldPath
    });

    if (!sourceOldLookup) {
        throw new Error(
            `reverseDelete: could not find old source node in lookup tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    // map that exact lookup node to the real OLD tree
    const sourceOldReal = findRealNodeByLookupNode(oldRoot, oldLookup, sourceOldLookup);

    if (!sourceOldReal) {
        throw new Error(
            `reverseDelete: could not map old lookup node to real OLD tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    const oldParentLookup = sourceOldLookup.parentNode;
    if (!oldParentLookup || oldParentLookup.nodeType !== 1) {
        throw new Error("reverseDelete: source old parent missing");
    }

    const clone = cloneIntoDoc(sourceOldReal, newDoc); // clone it into new document
    pruneCloneDescendantsAlreadyPresent(clone, newRoot); // 6.	prune descendants already present in NEW

    // several placement strategies:
    if (op.realizeParentPath && Number.isInteger(op.realizeIndex)) {
        const parent = findElementByRebasedPath(newRoot, op.realizeParentPath);

        if (parent) {
            insertElementAt(parent, clone, op.realizeIndex);
            return serializeXml(newDoc);
        }
    }

    // anchor relative to OLD siblings, but insert into current NEW
    const anchor = findAnchorByOldSiblings(oldParentLookup, sourceOldLookup, newLookup, newRoot);
    // Find surviving next/previous sibling
    if (anchor?.mode === "before" && anchor.ref && anchor.parent) {
        anchor.parent.insertBefore(clone, anchor.ref);
        return serializeXml(newDoc);
    }

    if (anchor?.mode === "after" && anchor.ref && anchor.parent) {
        if (anchor.ref.nextSibling) {
            anchor.parent.insertBefore(clone, anchor.ref.nextSibling);
        } else {
            anchor.parent.appendChild(clone);
        }
        return serializeXml(newDoc);
    }

    if (op.realizeReplacesPath) {
        const parentPath = getParentPath(op.realizeReplacesPath);
        const index = getLastPathIndex(op.realizeReplacesPath);
        const parent = parentPath ? findElementByRebasedPath(newRoot, parentPath) : null;

        if (parent && Number.isInteger(index)) {
            const kids = Array.from(parent.children || []);
            const ref = kids[index] || null;

            if (ref) parent.insertBefore(clone, ref);
            else parent.appendChild(clone);
            return serializeXml(newDoc);
        }
    }


    // fallback: restore under closest surviving ancestor
    const oldParentRealPath = indexPathFromAncestor(oldLookup, oldParentLookup);

    let targetParent =
        oldParentRealPath
            ? findElementByRebasedPath(newRoot, oldParentRealPath)
            : null;

    if (!targetParent) {
        targetParent = resolveClosestExistingAncestor(
            newRoot,
            oldParentRealPath
        );
    }

    if (!targetParent) {
        targetParent = newRoot;
    }

    const oldKids = childElements(oldParentLookup);
    const sourceIndex = oldKids.indexOf(sourceOldLookup);

    insertElementAt(
        targetParent,
        clone,
        (sourceIndex >= 0 ? sourceIndex : 0) + 1
    );

    return serializeXml(newDoc);
}