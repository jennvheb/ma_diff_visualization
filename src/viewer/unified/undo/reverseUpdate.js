import {
    childElements,
    cloneIntoDoc,
    findElementByRebasedPath,
    getDslRoot,
    parseXml, replaceElement,
    resolveNodeRobust,
    serializeXml
} from "./xmlPatchUtils.js";
import {stampLogicalIds} from "../../../integration/stableIds.js";
import {indexPathFromAncestor} from "./reverseHelper.js";

/**
 * Returns ids present in new subtree but not old subtree
 * Used to detect extra descendants
 *
 * @param newIds
 * @param oldIds
 * @returns {*[]}
 */
function diffIds(newIds = [], oldIds = []) {
    const oldSet = new Set(oldIds || []);
    return (newIds || []).filter(id => id && !oldSet.has(id));
}

/**
 * reverts attributes only
 * used for updates
 *
 * @param sourceOldReal
 * @param targetNewReal
 */
function copyAttributesFromOldToNew(sourceOldReal, targetNewReal) {
    if (!sourceOldReal || !targetNewReal) return;

    const oldAttrs = new Map(
        Array.from(sourceOldReal.attributes || []).map(a => [a.name, a.value])
    );
    const newAttrNames = Array.from(targetNewReal.attributes || []).map(a => a.name);

    for (const name of newAttrNames) {
        if (!oldAttrs.has(name)) {
            targetNewReal.removeAttribute(name);
        }
    }

    for (const [name, value] of oldAttrs.entries()) {
        targetNewReal.setAttribute(name, value);
    }
}

/**
 * Undo update means:
 * replace or patch current NEW node with old version
 *
 * @param baselineOldXml
 * @param currentNewXml
 * @param op
 * @returns {string}
 */
export function reverseUpdate({ baselineOldXml, currentNewXml, op }) {
    const oldDoc = parseXml(baselineOldXml);
    const newDoc = parseXml(currentNewXml);

    const oldRoot = getDslRoot(oldDoc);
    const newRoot = getDslRoot(newDoc);

    if (!oldRoot || !newRoot) {
        throw new Error("reverseUpdate: missing DSL root");
    }

    // stamped lookup trees only
    const oldLookup = oldRoot.cloneNode(true);
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(oldLookup);
    stampLogicalIds(newLookup);

    // OLD lookup node
    const sourceOldLookup = resolveNodeRobust(oldLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidOld,
        canonicalPath: op.oldPath,
        rebasedPath: op.rebasedOldPath
    });

    if (!sourceOldLookup) {
        throw new Error(
            `reverseUpdate: could not find old source node in lookup tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }
    // find target new node
    let targetNewLookup = resolveNodeRobust(newLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidNew || op.sidOld,
        canonicalPath: op.newPath,
        rebasedPath: op.rebasedNewPath
    });

    // final fallback: use the structural position of the OLD lookup node
    // and recover the corresponding node in current NEW
    if (!targetNewLookup) {
        const oldLookupPath = indexPathFromAncestor(oldLookup, sourceOldLookup);
        if (oldLookupPath) {
            const candidate = findElementByRebasedPath(newLookup, oldLookupPath);

            // only accept if it still looks like the same kind of node
            if (
                candidate &&
                (!op.contentNew?.tag || candidate.localName === op.contentNew.tag) &&
                (!op.contentOld?.tag || candidate.localName === op.contentOld.tag)
            ) {
                targetNewLookup = candidate;
            }
        }
    }


    if (!targetNewLookup) {
        throw new Error(
            `reverseUpdate: could not find target node in NEW lookup tree (${op.sidNew || op.rebasedNewPath || op.newPath || "no-new-target"})`
        );
    }

    // map lookup nodes to XML nodes
    const oldRealPath = indexPathFromAncestor(oldLookup, sourceOldLookup);
    const newRealPath = indexPathFromAncestor(newLookup, targetNewLookup);

    if (!oldRealPath) {
        throw new Error("reverseUpdate: could not derive real OLD path from lookup node");
    }

    if (!newRealPath) {
        throw new Error("reverseUpdate: could not derive real NEW path from lookup node");
    }

    const sourceOldReal = findElementByRebasedPath(oldRoot, oldRealPath);
    const targetNewReal = findElementByRebasedPath(newRoot, newRealPath);

    if (!sourceOldReal) {
        throw new Error(
            `reverseUpdate: could not find old source node in real OLD tree (${oldRealPath})`
        );
    }

    if (!targetNewReal) {
        throw new Error(
            `reverseUpdate: could not find target node in real NEW tree (${newRealPath})`
        );
    }

    // hard guard: must still be the same kind of node
    if (op.contentOld?.tag && sourceOldReal.localName !== op.contentOld.tag) {
        throw new Error(
            `reverseUpdate: OLD tag mismatch (expected ${op.contentOld.tag}, got ${sourceOldReal.localName})`
        );
    }

    if (op.contentNew?.tag && targetNewReal.localName !== op.contentNew.tag) {
        throw new Error(
            `reverseUpdate: NEW tag mismatch (expected ${op.contentNew.tag}, got ${targetNewReal.localName})`
        );
    }
    // verify tags
    const attrChanges = op?.contentDiff?.attrChanges || [];
    const textChanged = !!op?.contentDiff?.textChanged;
    const childTagsChanged = !!op?.contentDiff?.childTagsChanged;

    const oldHasElementChildren = childElements(sourceOldReal).length > 0;
    const newHasElementChildren = childElements(targetNewReal).length > 0;
    // decide how much to revert
    const isPureRootAttrUpdate =
        attrChanges.length > 0 &&
        !textChanged &&
        !childTagsChanged;

    const isTrueTextOnlyNode =
        textChanged &&
        !childTagsChanged &&
        !oldHasElementChildren &&
        !newHasElementChildren;
    const extraNewIds = diffIds(op.subtreeIdsNew, op.subtreeIdsOld);

    /*
    If NEW contains extra descendants not in OLD, do not replace the whole subtree, because that could delete moved-in nodes
    Instead, revert attributes only
     */
    const hasForeignLiveDescendants = extraNewIds.length > 0;
    if (isPureRootAttrUpdate) {
        copyAttributesFromOldToNew(sourceOldReal, targetNewReal);
        return serializeXml(newDoc);
    }

    if (isTrueTextOnlyNode) {
        targetNewReal.textContent = sourceOldReal.textContent || "";
        return serializeXml(newDoc);
    }

    // If NEW contains extra descendants that are not part of OLD, do NOT replace the whole subtree, because that would delete moved-in children
    if (hasForeignLiveDescendants) {
        copyAttributesFromOldToNew(sourceOldReal, targetNewReal);
        return serializeXml(newDoc);
    }

    const replacement = cloneIntoDoc(sourceOldReal, newDoc); // Clone old node and replace new node

    if (!replacement) {
        throw new Error("reverseUpdate: could not clone old node for replacement");
    }

    replaceElement(targetNewReal, replacement);
    return serializeXml(newDoc);
}