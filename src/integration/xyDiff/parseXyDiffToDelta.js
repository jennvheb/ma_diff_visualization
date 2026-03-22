const {DOMParser} = await import("@xmldom/xmldom");

import {childElements} from "./dom/domUtils.js";
import {elementByRelIndexPath} from "./dom/pathUtils.js";

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

export function parseXyDiffToDelta(xyDiffXmlString, workDir) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xyDiffXmlString, "text/xml");

    const ctx = buildParseContext(workDir);
    const state = createParseState();

    const unitDelta = findUnitDelta(doc);
    if (!unitDelta) return `<delta cost="0"/>`;

    const tNodes = [];
    for (const c of childElements(unitDelta)) {
        if (c.localName === "t") tNodes.push(c);
    }

    collectEditMetadata(tNodes, state);

    for (const tNode of tNodes) {
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

    pairMoves(ctx, state);

    const operationsNormalized = normalizeSemanticMoves({
        ops: state.operations,
        baseOld: ctx.baseOld,
        baseNew: ctx.baseNew,
        renamedIdPairs: state.renamedIdPairs,
        renamedNewIds: state.renamedNewIds
    });

    const operationsFinal = dedupeOps(operationsNormalized);
    const operationsClean = cleanupOps(operationsFinal);

    return emitDeltaXml(operationsClean, ctx.baseOld, elementByRelIndexPath);
}
