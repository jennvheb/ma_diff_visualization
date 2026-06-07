import {getDslRoot, parseXml, removeElement, resolveNodeRobust, serializeXml} from "./xmlPatchUtils.js";
import {stampLogicalIds} from "../../../integration/stableIds.js";
import {findRealNodeByLookupNode} from "./reverseHelper.js";

/**
 * removes inserted node from current NEW
 * It stamps ids only on the lookup copy, not on the real tree
 * That avoids polluting actual XML with helper ids
 *
 * @param currentNewXml
 * @param op
 * @returns {string}
 */
export function reverseInsert({ currentNewXml, op }) {
    const newDoc = parseXml(currentNewXml);
    const newRoot = getDslRoot(newDoc);

    if (!newRoot) {
        throw new Error("reverseInsert: missing DSL root");
    }

    const newLookup = newRoot.cloneNode(true); // // clone root into lookup tree
    stampLogicalIds(newLookup); // stamp logical ids on lookup

    // resolve the inserted node in the stamped lookup tree
    const targetLookup = resolveNodeRobust(newLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidNew || op.sidOld,
        canonicalPath: op.newPath,
        rebasedPath: op.rebasedNewPath
    });

    if (!targetLookup) {
        throw new Error(
            `reverseInsert: could not find inserted node in lookup tree (${op.sidNew || op.sidOld || op.rebasedNewPath || op.newPath})`
        );
    }

    // map lookup node back to the corresponding real node
    const targetReal = findRealNodeByLookupNode(newRoot, newLookup, targetLookup);

    if (!targetReal) {
        throw new Error(
            `reverseInsert: could not resolve inserted node in real NEW tree (${op.sidNew || op.sidOld || op.rebasedNewPath || op.newPath})`
        );
    }

    removeElement(targetReal); // remove it
    return serializeXml(newDoc);
}