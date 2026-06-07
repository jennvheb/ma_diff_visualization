import {
    diffSummaries,
    isMeaningfulUpdate,
    snapshotForNode
} from "../snapshots.js";
import {findById} from "../xml.js";

/**
 * attaches update content which can be shown in the ui and also for filtering fake updates
 * @param meta
 * @param ctx
 * @returns {{contentNew: null, contentDiff: null, changeOccured: boolean, contentOld: null}|{contentNew: ({childTags: *[], tag: *, id, text: string|string|string, attrs: {}}|{endpoint: *|string|null, notes: *, method: *, arguments: *, tag: *, id, label: *, text: string|string|string, parameters: *, script, attrs: {}}), contentDiff: ({new: *, kind: string}|{kind: string, old: *}|{notesChanged: boolean, attrChanges: [], labelChanged: boolean, scriptChanged: boolean, textChanged: boolean, childTagsChanged: boolean, endpointChanged: boolean, parametersChanged: boolean}), changeOccured: boolean, contentOld: ({childTags: *[], tag: *, id, text: string|string|string, attrs: {}}|{endpoint: *|string|null, notes: *, method: *, arguments: *, tag: *, id, label: *, text: string|string|string, parameters: *, script, attrs: {}})}}
 */
export function attachUpdateContent(meta, ctx) {
    const { oldRoot, newRoot } = ctx;

    if (!(meta.type === "update" || meta.type === "moveupdate")) {
        return { contentOld: null, contentNew: null, contentDiff: null, changeOccured: false };
    }

    const o = meta.ownerOld || findById(oldRoot, meta.sidOld);
    const n = meta.ownerNew || findById(newRoot, meta.sidNew);

    const contentOld = snapshotForNode(o); // take snapshot of old owner
    const contentNew = snapshotForNode(n); // take snapshot of new owner
    const contentDiff = diffSummaries(contentOld, contentNew); // compute content diff

    const changeOccured = isMeaningfulUpdate(contentOld, contentNew); // decide whether meaningful change occurred
    return { contentOld, contentNew, contentDiff, changeOccured };
}

/**
 * Combines separate move and update operations on the same logical node
 *
 * @param metaOps
 * @returns {*[]}
 */
export function mergeMoveAndUpdateOps(metaOps) {
    const consumed = new Set();
    const out = [];

    function sameLogicalNode(a, b) {
        if (!a || !b) return false;

        const aOld = a.sidOld || a.selfOldId || null;
        const bOld = b.sidOld || b.selfOldId || null;
        const aNew = a.sidNew || null;
        const bNew = b.sidNew || null;

        // If both operations know old and new ids, both sides must agree.
        if (aOld && bOld && aNew && bNew) {
            return aOld === bOld && aNew === bNew;
        }

        // If both know old ids, old ids must agree.
        // But do not allow one operation's new id to contradict the other's old id.
        if (aOld && bOld && aOld === bOld) {
            if (aNew && aNew !== aOld) return false;
            if (bNew && bNew !== bOld) return false;
            return true;
        }

        // If both know new ids, new ids must agree.
        // But do not allow one operation's old id to contradict the other's new id.
        if (aNew && bNew && aNew === bNew) {
            if (aOld && aOld !== aNew) return false;
            if (bOld && bOld !== bNew) return false;
            return true;
        }

        // Path fallback only if no ids are available.
        if (!aOld && !aNew && !bOld && !bNew) {
            return !!a.mergeOwnerPath &&
                !!b.mergeOwnerPath &&
                a.mergeOwnerPath === b.mergeOwnerPath;
        }

        return false;
    }

    // process moves, merge matching updates into them
    for (let i = 0; i < metaOps.length; i++) {
        if (consumed.has(i)) continue;

        const op = metaOps[i];
        if (op.type !== "move") continue;

        let merged = { ...op };

        for (let j = 0; j < metaOps.length; j++) {
            if (i === j || consumed.has(j)) continue;

            const other = metaOps[j];
            if (other.type !== "update") continue;
            if (!sameLogicalNode(op, other)) continue;

            const mergedSidOld = merged.sidOld || other.sidOld || null;
            const mergedSidNew = merged.sidNew || other.sidNew || null;

            if (
                mergedSidOld &&
                mergedSidNew &&
                mergedSidOld !== mergedSidNew &&
                !String(mergedSidOld).startsWith("__gw_")
            ) {
                continue;
            }

            merged = {
                ...merged,
                type: "moveupdate",
                changeOccured: true,
                contentOld: merged.contentOld || other.contentOld,
                contentNew: merged.contentNew || other.contentNew,
                contentDiff: merged.contentDiff || other.contentDiff,
            };

            consumed.add(j);
        }

        consumed.add(i);
        out.push(merged);
    }

    // keep everything else that was not consumed
    for (let i = 0; i < metaOps.length; i++) {
        if (consumed.has(i)) continue;
        out.push(metaOps[i]);
    }

    return out;
}