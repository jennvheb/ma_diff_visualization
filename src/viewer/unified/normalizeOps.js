import {nearestDrawable, tagName} from "../../integration/stableIds.js";
import {preferStaticOldPath, rebaseNewPathDynamicToFinal, rebaseOldPathDynamicToStatic} from "./paths.js";
import {atPath, buildOldWorkUntil, nodeAtPath, recoverById} from "./xml.js";
import {diffSummaries, isMeaningfulUpdate, snapshotForNode} from "./snapshots.js";
import {DIFF_BOUNDARY_TAGS} from "../../integration/tags.js";

export function normalizeOp(op, idx, ops, ctx) {
    const { isXy, oldRoot, newRoot } = ctx;
    let rebasedOldPath = null;

    if (op.oldPath) {
        if (isXy) {
            rebasedOldPath = op.oldPath;
        } else if (
            op.type === "move" ||
            op.type === "moveupdate" ||
            op.type === "delete"
        ) {
            rebasedOldPath = rebaseOldPathDynamicToStatic(op.oldPath, idx, ops);
        } else {
            rebasedOldPath = preferStaticOldPath(op, idx, ops, oldRoot);
        }
    }

    const rebasedNewPath = op.newPath
        ? (isXy ? op.newPath : rebaseNewPathDynamicToFinal(op.newPath, idx, ops))
        : null;

    if (!isXy && op.type === "delete") {
        const rawId = nodeAtPath(oldRoot, op.oldPath)?.getAttribute?.("id") || null;
        const rebId = nodeAtPath(oldRoot, rebasedOldPath)?.getAttribute?.("id") || null;
        console.log("DEL PATH", { idx, raw: op.oldPath, rawId, rebasedOldPath, rebId });
    }


    if (isXy && op.oldPath && op.oldPath !== rebasedOldPath) {
        console.warn("XYDIFF SHOULD NOT REBASE BUT DID", op.oldPath, rebasedOldPath);
    }

    function debugOldPathMeaning(op, idx, ops, oldRoot) {
        const raw = op.oldPath;
        const reb = rebaseOldPathDynamicToStatic(raw, idx, ops);

        const atRaw_inStaticOld = raw ? nodeAtPath(oldRoot, raw) : null;
        const atReb_inStaticOld = reb ? nodeAtPath(oldRoot, reb) : null;

        console.log("OLD PATH DEBUG", {
            rawOldPath: raw,
            rebasedToStatic: reb,
            atRaw_inStaticOld: atRaw_inStaticOld?.getAttribute?.("id") || null,
            atReb_inStaticOld: atReb_inStaticOld?.getAttribute?.("id") || null,
        });
    }



    // STATIC lookup
    const oldNodeStatic = rebasedOldPath ? atPath(oldRoot, rebasedOldPath, isXy) : null;
    const oldNodeTag = oldNodeStatic ? tagName(oldNodeStatic) : null;
    const selfOldIsDrawable = !!(oldNodeStatic && DIFF_BOUNDARY_TAGS.has(oldNodeTag));
    const selfOldId = selfOldIsDrawable ? (oldNodeStatic.getAttribute("id") || null) : null;
    const newNode = rebasedNewPath ? atPath(newRoot, rebasedNewPath, isXy) : null;
    // DYNAMIC lookup (only for CpeeDiff moves): "old just before this op"
    let oldNodeDynamic = null;
    if (!isXy && (op.type === "move" || op.type === "moveupdate") && op.oldPath) {
        const oldWork = buildOldWorkUntil(idx, ops, oldRoot, newRoot);
        oldNodeDynamic = nodeAtPath(oldWork, op.oldPath);
    }

    const oldNode = oldNodeStatic;

    let ownerOld = oldNode ? nearestDrawable(oldNode) : null; // unchanged meaning (static OLD)
    let ownerOldDynamic = oldNodeDynamic ? nearestDrawable(oldNodeDynamic) : null;

    if (!isXy && (op.type === "move" || op.type === "moveupdate")) {
        console.log("MOVE CHECK", {
            idx,
            rawOldPath: op.oldPath,
            staticRebasedOldPath: rebasedOldPath,
            staticOwnerId: ownerOld?.getAttribute?.("id") || null,
            dynamicOwnerId: ownerOldDynamic?.getAttribute?.("id") || null,
        });
    }

    if (op.type === "delete") {
        console.log("DELETE NORMALIZE DEBUG", {
            idx,
            rawOldPath: op.oldPath,
            rebasedOldPath,
            oldNodeStaticTag: oldNodeStatic ? tagName(oldNodeStatic) : null,
            oldNodeStaticId: oldNodeStatic?.getAttribute?.("id") || null,
            ownerOldTag: ownerOld ? tagName(ownerOld) : null,
            ownerOldId: ownerOld?.getAttribute?.("id") || null,
        });
    }


    let ownerNew = newNode ? nearestDrawable(newNode) : null;

    let type = op.type;
    if (!isXy && op.type === "move" && op.oldPath) {
        debugOldPathMeaning(op, idx, ops, oldRoot);
    }


    if (isXy && type === "update" && !ownerNew && rebasedOldPath) {
        const candidateNew = nodeAtPath(newRoot, rebasedOldPath);
        if (candidateNew) {
            // optional safety: only accept if it’s "the same kind of thing"
            const candOwnerNew = nearestDrawable(candidateNew);
            const tagOld = ownerOld ? tagName(ownerOld) : null;
            const tagNew = candOwnerNew ? tagName(candOwnerNew) : null;

            if (!tagOld || !tagNew || tagOld === tagNew) {
                ownerNew = candOwnerNew;
            }
        }
    }

    // insert of non-drawable node -> treat as update on owning drawable
    if (type === "insert" && newNode) {
        const selfDrawable = DIFF_BOUNDARY_TAGS.has(tagName(newNode));
        if (!selfDrawable && ownerNew) {
            type = "update";

            // map update to owner drawable
            const nid = ownerNew.getAttribute("id");
            ownerOld = nid ? recoverById(oldRoot, nid) : null;
        }
    }

    if (type === "delete" && oldNode && ownerOld) {
        const selfDrawable = DIFF_BOUNDARY_TAGS.has(tagName(oldNode));
        if (!selfDrawable) {
            type = "update";

            const oid = ownerOld.getAttribute("id");
            if (oid) ownerNew = recoverById(newRoot, oid);
        }
    }

    // decide sidOld/sidNew
    let sidOld = null, sidNew = null;

    if (type === "insert" || type === "update") {
        sidOld = op.id || ownerOld?.getAttribute("id") || null;
        sidNew = op.id || ownerNew?.getAttribute("id") || null;
    } else {
        sidOld = ownerOld?.getAttribute("id") || op.id || null;
        sidNew = ownerNew?.getAttribute("id") || null;
    }

    // normalize update to one id
    if (type === "update") {
        const sid = sidOld || sidNew;
        sidOld = sid;
        sidNew = sid;
    }

    const mergeOwnerId =
        (!isXy && (type === "move" || type === "moveupdate"))
            ? (ownerOldDynamic?.getAttribute?.("id") || ownerOld?.getAttribute?.("id") || null)
            : (ownerOld?.getAttribute?.("id") || null);

    const mergeOwnerPath =
        rebasedOldPath || op.oldPath || null;

    return {
        ...op,
        type,
        rebasedOldPath,
        rebasedNewPath,
        ownerOld,
        ownerOldDynamic,
        ownerNew,
        sidOld,
        sidNew,
        mergeOwnerId,
        mergeOwnerPath,
        oldNodeStatic,
        oldNodeTag,
        selfOldIsDrawable,
        selfOldId,
    };
}


export function attachUpdateContent(meta, ctx) {
    const { oldRoot, newRoot } = ctx;

    if (!(meta.type === "update" || meta.type === "moveupdate")) {
        return { contentOld: null, contentNew: null, contentDiff: null, changeOccured: false };
    }

    const o = meta.ownerOld || recoverById(oldRoot, meta.sidOld);
    const n = meta.ownerNew || recoverById(newRoot, meta.sidNew);

    const contentOld = snapshotForNode(o);
    const contentNew = snapshotForNode(n);
    const contentDiff = diffSummaries(contentOld, contentNew);

    const changeOccured = isMeaningfulUpdate(contentOld, contentNew);
    if (meta.type === "moveupdate") {
        console.log("MOVEUPDATE DEBUG:", {
            sidOld: meta.sidOld,
            sidNew: meta.sidNew,
            ownerOld: meta.ownerOld?.getAttribute?.("id") || null,
            ownerNew: meta.ownerNew?.getAttribute?.("id") || null,
            endpointOld: contentOld?.endpoint ?? null,
            endpointNew: contentNew?.endpoint ?? null,
            endpointChanged: contentDiff?.endpointChanged ?? null,
            changeOccured
        });
    }
    return { contentOld, contentNew, contentDiff, changeOccured };
}

export function mergeMoveAndUpdateOps(metaOps) {
    const consumed = new Set();
    const out = [];

    function sameLogicalNode(a, b) {
        if (!a || !b) return false;

        if (a.mergeOwnerId && b.mergeOwnerId) {
            return a.mergeOwnerId === b.mergeOwnerId;
        }

        if (a.sidOld && b.sidOld) {
            return a.sidOld === b.sidOld;
        }

        if (a.sidNew && b.sidNew) {
            return a.sidNew === b.sidNew;
        }

        if (a.mergeOwnerPath && b.mergeOwnerPath) {
            return a.mergeOwnerPath === b.mergeOwnerPath;
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
