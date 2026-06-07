const {DOMParser} = await import("@xmldom/xmldom");

import {childElements} from "./dom/domUtils.js";

import {buildParseContext} from "./context/buildParseContext.js";
import {createParseState} from "./context/createParseState.js";

import {collectEditMetadata} from "./ops/collectEditMetadata.js";
import {handleInsert} from "./ops/handleInsert.js";
import {handleDelete} from "./ops/handleDelete.js";
import {handleAttributeUpdate, handleTextUpdate} from "./ops/handleUpdate.js";
import {pairMoves} from "./ops/pairMoves.js";
import {normalizeSemanticMoves} from "./ops/normalizeSemanticMoves.js";
import {dedupeOps} from "./ops/dedupeOps.js";
import {cleanupOps} from "./ops/cleanupOps.js";

import {emitDeltaXml} from "./emit/emitDeltaXml.js";

/**
 * find the <unit_delta> in the xydiff output
 *
 * @param doc
 * @returns {null}
 */
function findUnitDelta(doc) {
    let unitDelta = null;

    for (let i = 0; i < doc.childNodes.length; i++) {
        const n = doc.childNodes[i];
        if (n.nodeType === 1 && n.localName === "unit_delta") {
            unitDelta = n;
            break;
        }
    }

    if (!unitDelta && doc.documentElement?.localName === "unit_delta") {
        unitDelta = doc.documentElement;
    }

    return unitDelta;
}

/**
 * orchestrator for the entire XYDiff normalization pipeline
 * XYDiff parser entry point
 *
 * @param xyDiffXmlString
 * @param workDir
 * @returns {string}
 */
export function parseXyDiffToDelta(xyDiffXmlString, workDir) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xyDiffXmlString, "text/xml");

    const ctx = buildParseContext(workDir);
    const state = createParseState(); // Initializes operations, pending moves, rename metadata, etc.

    const unitDelta = findUnitDelta(doc);
    if (!unitDelta) return `<delta cost="0"/>`;

    // collect transaction nodes (xydiff groups edits in <t> nodes)
    const tNodes = [];
    for (const c of childElements(unitDelta)) {
        if (c.localName === "t") tNodes.push(c);
    }

    collectEditMetadata(tNodes, state); // detects id renames, endpoint changes, replacements, etc. this happens before handling operations

    for (const tNode of tNodes) { // process every edit to build state.opertions
        for (const edit of childElements(tNode)) {
            if (edit.localName === "i") {
                handleInsert(edit, ctx, state);
            } else if (edit.localName === "d") {
                handleDelete(edit, ctx, state);
            } else if (edit.localName === "au") {
                handleAttributeUpdate(edit, ctx, state);
            } else if (edit.localName === "u") {
                handleTextUpdate(edit, ctx, state);
            }
        }
    }

    pairMoves(ctx, state); // combine XYDiff move-delete/move-insert pairs into move or moveupdate

    const operationsNormalized = normalizeSemanticMoves({
        ops: state.operations,
        baseOld: ctx.baseOld,
        baseNew: ctx.baseNew
    }); // filters passive sibling shifts and fixes proxy/container moves

    const operationsFinal = dedupeOps(operationsNormalized); // remove duplicate ops
    const operationsClean = cleanupOps(operationsFinal); // remove child operations covered by deletes

    return emitDeltaXml(operationsClean); // emit normalized delta xml, custom delta is later passed to deltaxmltoops in computediffstate
}
