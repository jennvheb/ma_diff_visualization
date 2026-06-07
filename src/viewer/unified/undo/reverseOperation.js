import {reverseInsert} from "./reverseInsert.js";
import {reverseDelete} from "./reverseDelete.js";
import {reverseUpdate} from "./reverseUpdate.js";
import {reverseMove} from "./reverseMove.js";

/**
 * Applies multiple reverse operations sequentially
 *
 * @param baselineOldXml
 * @param currentNewXml
 * @param ops
 * @returns {string}
 */
export function reverseOperations({ baselineOldXml, currentNewXml, ops }) {
    let xml = currentNewXml;

    for (const op of ops) {
        xml = reverseOperation({
            baselineOldXml,
            currentNewXml: xml,
            op
        });
    }

    return xml;
}

/**
 * dispatcher
 * moveupdate is not handled here directly because undoController expands it into update + move
 *
 * @param baselineOldXml
 * @param currentNewXml
 * @param op
 * @returns {string}
 */
export function reverseOperation({ baselineOldXml, currentNewXml, op }) {
    if (!op?.type) {
        throw new Error("reverseOperation: missing op.type");
    }
    console.log("reverseOperation type =", op?.type, "op =", JSON.stringify(op, null, 2));

    switch (op.type) {
        case "insert":
            return reverseInsert({ currentNewXml, op });

        case "delete":
            return reverseDelete({ baselineOldXml, currentNewXml, op });

        case "update":
            return reverseUpdate({ baselineOldXml, currentNewXml, op });

        case "move":
            return reverseMove({ baselineOldXml, currentNewXml, op });

        default:
            throw new Error(`reverseOperation: unsupported op type for now: ${op.type}`);
    }
}