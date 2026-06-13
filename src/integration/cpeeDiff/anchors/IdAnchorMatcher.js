import {DiffConfig} from '../../../../cpeediff/src/config/DiffConfig.js';
import {allowFallbackMatch} from "./anchorGuard.js";

const getId = (node) =>
    node?.attributes?.get?.('id') ?? null;

/**
 * match old/new nodes by CPEE id:
 */
export class IdAnchorMatcher {
    match(oldRoot, newRoot, matching) {
        const anchors = DiffConfig.MATCH_ANCHORS || [];
        const singleAnchor = anchors.length === 1 ? anchors[0] : null;

        if (
            !anchors.includes("id") &&
            !(singleAnchor === "endpoint" || singleAnchor === "label")
        ) {
            return;
        }

        // build lookup table for new model by extracting ids from the new model
        const newById = new Map();
        for (const v of newRoot.toPreOrderArray()) {
            const id = getId(v);
            if (!id) continue;
            newById.set(id, v);
        }
        // extract ids from the old model
        for (const vold of oldRoot.toPreOrderArray()) {
            const id = getId(vold);
            if (!id) continue;
            // get the node with the same id from the new model
            const vnew = newById.get(id);
            if (!vnew) continue;
            // if the node is already matched continue
            if (matching.isMatched(vold) || matching.isMatched(vnew)) continue;

            if (!allowFallbackMatch(vold, vnew)) continue;

            // otherwise there is a new matching
            matching.matchNew(vnew, vold);
        }
    }
}