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
    console.log("MERGE INPUT TYPES", metaOps.map(o => ({
        type: o.type,
        oldPath: o.oldPath,
        newPath: o.newPath,
        rebasedOldPath: o.rebasedOldPath,
        rebasedNewPath: o.rebasedNewPath,
        sidOld: o.sidOld,
        sidNew: o.sidNew
    })));
    const consumed = new Set();
    const out = [];

    function pathList(op) {
        return [
            op.oldPath,
            op.newPath,
            op.rebasedOldPath,
            op.rebasedNewPath,
            op.mergeOwnerPath
        ].filter(Boolean);
    }

    function sameLogicalNode(a, b) {
        if (!a || !b) return false;

        const aPaths = pathList(a);
        const bPaths = pathList(b);

        // CpeeDiff may attach the update to the moved node's new/dynamic path.
        // So if any path overlaps, treat it as same logical operation candidate.
        if (aPaths.some(p => bPaths.includes(p))) {
            return true;
        }

        const aOld = a.sidOld || a.selfOldId || null;
        const bOld = b.sidOld || b.selfOldId || null;
        const aNew = a.sidNew || null;
        const bNew = b.sidNew || null;

        if (aOld && bOld && aNew && bNew) {
            return aOld === bOld && aNew === bNew;
        }

        if (aOld && bOld && aOld === bOld) {
            if (aNew && aNew !== aOld) return false;
            if (bNew && bNew !== bOld) return false;
            return true;
        }

        if (aNew && bNew && aNew === bNew) {
            if (aOld && aOld !== aNew) return false;
            if (bOld && bOld !== bNew) return false;
            return true;
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
            console.log("MOVEUPDATE CANDIDATE", {
                moveOld: op.oldPath,
                moveNew: op.newPath,
                moveRebasedOld: op.rebasedOldPath,
                moveRebasedNew: op.rebasedNewPath,
                moveSidOld: op.sidOld,
                moveSidNew: op.sidNew,

                updOld: other.oldPath,
                updNew: other.newPath,
                updRebasedOld: other.rebasedOldPath,
                updRebasedNew: other.rebasedNewPath,
                updSidOld: other.sidOld,
                updSidNew: other.sidNew,

                same: sameLogicalNode(op, other)
            });
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