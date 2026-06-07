import {
    childElements,
    cloneIntoDoc,
    findElementByRebasedPath,
    getDslRoot, insertElementAt,
    parseXml,
    resolveNodeRobust, serializeXml
} from "./xmlPatchUtils.js";
import {stampLogicalIds} from "../../../integration/stableIds.js";
import {
    findElementById,
    findRealNodeByLookupNode,
    indexPathFromAncestor,
    resolveClosestExistingAncestor
} from "./reverseHelper.js";

/**
 * same as above but excludes the moved node’s own id
 * Used for moves, because the node itself may still exist in NEW before/after removal
 *
 * @param oldParentLookup
 * @param sourceOldLookup
 * @param newLookup
 * @param newRoot
 * @param selfId
 * @returns {{mode: string, parent: (*|(() => (Node | null))|ParentNode|ActiveX.IXMLDOMNode), ref: ({parentNode}|*)}|null}
 */
function findAnchorByOldSiblingsExcludingSelf(oldParentLookup, sourceOldLookup, newLookup, newRoot, selfId) {
    const oldKids = childElements(oldParentLookup);
    const oldIndex = oldKids.indexOf(sourceOldLookup);
    if (oldIndex < 0) return null;

    // try next sibling first
    for (let i = oldIndex + 1; i < oldKids.length; i++) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId || sibId === selfId) continue;

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

    // then previous sibling
    for (let i = oldIndex - 1; i >= 0; i--) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId || sibId === selfId) continue;

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

/**
 * Undo move means:
 * remove node from moved/new location
 * restore it at old location
 *
 * @param baselineOldXml
 * @param currentNewXml
 * @param op
 * @returns {string}
 */
export function reverseMove({ baselineOldXml, currentNewXml, op }) {
    const oldDoc = parseXml(baselineOldXml);
    const newDoc = parseXml(currentNewXml);

    const oldRoot = getDslRoot(oldDoc);
    const newRoot = getDslRoot(newDoc);

    if (!oldRoot || !newRoot) {
        throw new Error("reverseMove: missing DSL root");
    }

    // create stamped lookup copies
    const oldLookup = oldRoot.cloneNode(true);
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(oldLookup);
    stampLogicalIds(newLookup);

    // find source node in OLD lookup
    const sourceOldLookup = resolveNodeRobust(oldLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidOld,
        canonicalPath: op.oldPath,
        rebasedPath: op.rebasedOldPath
    });

    if (!sourceOldLookup) {
        throw new Error(
            `reverseMove: could not find old source node in lookup tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }
    // map to real OLD node
    const sourceOldReal = findRealNodeByLookupNode(oldRoot, oldLookup, sourceOldLookup);

    if (!sourceOldReal) {
        throw new Error(
            `reverseMove: could not map old source node to real OLD tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }
    // find moved node in NEW lookup
    const targetNewLookup = resolveNodeRobust(newLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidNew || op.sidOld,
        canonicalPath: op.newPath,
        rebasedPath: op.rebasedNewPath
    });

    if (!targetNewLookup) {
        throw new Error(
            `reverseMove: could not find moved node in NEW lookup tree (${op.sidNew || op.sidOld || op.rebasedNewPath || op.newPath})`
        );
    }
    // map to real NEW node
    const targetNewReal = findRealNodeByLookupNode(newRoot, newLookup, targetNewLookup);

    if (!targetNewReal) {
        throw new Error(
            `reverseMove: could not find moved node in real NEW tree (${op.sidNew || op.sidOld})`
        );
    }

    const oldParentLookup = sourceOldLookup.parentNode;
    if (!oldParentLookup || oldParentLookup.nodeType !== 1) {
        throw new Error("reverseMove: old parent missing");
    }
    // clone old node into new document
    const restored = cloneIntoDoc(sourceOldReal, newDoc);

    // remove current moved node
    if (targetNewReal.parentNode) {
        targetNewReal.parentNode.removeChild(targetNewReal);
    }
    if (op.realizeParentPath) {
        const parent = findElementByRebasedPath(newRoot, op.realizeParentPath);

        if (parent) {
            const before = op.realizeBeforeId
                ? findElementById(parent, op.realizeBeforeId)
                : null;

            const after = op.realizeAfterId
                ? findElementById(parent, op.realizeAfterId)
                : null;

            if (before && before.parentNode === parent) {
                parent.insertBefore(restored, before);
                return serializeXml(newDoc);
            }

            if (after && after.parentNode === parent) {
                if (after.nextSibling) parent.insertBefore(restored, after.nextSibling);
                else parent.appendChild(restored);
                return serializeXml(newDoc);
            }

            insertElementAt(parent, restored, op.realizeIndex);
            return serializeXml(newDoc);
        }
    }    // place restored clone by OLD sibling anchors at old position
    const newLookupAfterRemoval = newRoot.cloneNode(true);
    stampLogicalIds(newLookupAfterRemoval);

    // try several placement strategies:
    const anchor = findAnchorByOldSiblingsExcludingSelf(
        oldParentLookup,
        sourceOldLookup,
        newLookupAfterRemoval,
        newRoot,
        op.sidOld || op.sidNew || op.selfOldId || null
    );
    // Find surviving siblings from old parent and insert before/after them
    if (anchor?.mode === "before" && anchor.ref && anchor.parent) {
        anchor.parent.insertBefore(restored, anchor.ref);
        return serializeXml(newDoc);
    }

    if (anchor?.mode === "after" && anchor.ref && anchor.parent) {
        if (anchor.ref.nextSibling) {
            anchor.parent.insertBefore(restored, anchor.ref.nextSibling);
        } else {
            anchor.parent.appendChild(restored);
        }
        return serializeXml(newDoc);
    }

    // fallback: old parent path, then closest existing ancestor
    const oldParentPath = indexPathFromAncestor(oldLookup, oldParentLookup);
    let targetParent =
        oldParentPath ? findElementByRebasedPath(newRoot, oldParentPath) : null;

    if (!targetParent) {
        targetParent = resolveClosestExistingAncestor(newRoot, oldParentPath);
    }


    const oldIndex = childElements(oldParentLookup).indexOf(sourceOldLookup);
    insertElementAt(targetParent, restored, (oldIndex >= 0 ? oldIndex : 0) + 1);

    return serializeXml(newDoc);
}