import {nearestDrawable, tagName, firstKRealTaskIds, gatewayStructureSig} from "../../integration/stableIds.js";
import {
    preferStaticOldPath,
    rebaseNewPathDynamicToFinal,
    rebaseOldPathDynamicToStatic
} from "./paths.js";
import {
    atPath,
    buildOldWorkUntil,
    nodeAtPath,
    recoverById
} from "./xml.js";
import {
    diffSummaries,
    isMeaningfulUpdate,
    snapshotForNode
} from "./snapshots.js";
import {DIFF_BOUNDARY_TAGS} from "../../integration/tags.js";

function isGatewayLike(node) {
    if (!node) return false;
    const t = tagName(node);
    return (
        t === "choose" ||
        t === "parallel" ||
        t === "loop" ||
        t === "alternative" ||
        t === "otherwise" ||
        t === "parallel_branch"
    );
}

function recoverGatewayOwnerNew(oldOwner, newRoot) {
    if (!oldOwner || !newRoot) return null;

    const oldTag = tagName(oldOwner);
    const oldStruct = gatewayStructureSig(oldOwner);
    const oldWitnesses = firstKRealTaskIds(oldOwner, 3);

    // strongest fallback: find first witness in NEW, then climb to same gateway tag
    for (const wid of oldWitnesses || []) {
        const witnessNew = recoverById(newRoot, wid);
        if (!witnessNew) continue;

        let cur = witnessNew;
        while (cur) {
            if (cur.nodeType === 1 && tagName(cur) === oldTag) {
                const struct = gatewayStructureSig(cur);
                if (struct === oldStruct) return cur;
            }
            cur = cur.parentNode;
        }
    }

    // broader fallback: scan all gateways of same tag and same structure
    const all = Array.from(newRoot.getElementsByTagName("*"));
    for (const el of all) {
        if (tagName(el) !== oldTag) continue;
        if (gatewayStructureSig(el) !== oldStruct) continue;

        const w = firstKRealTaskIds(el, 3);
        if (JSON.stringify(w || []) === JSON.stringify(oldWitnesses || [])) {
            return el;
        }
    }

    // weakest fallback: same tag only + at least one witness overlap
    for (const el of all) {
        if (tagName(el) !== oldTag) continue;

        const w = firstKRealTaskIds(el, 3);
        const overlap = (w || []).some(id => (oldWitnesses || []).includes(id));
        if (overlap) return el;
    }

    return null;
}

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

    const oldNodeStatic = rebasedOldPath ? atPath(oldRoot, rebasedOldPath, isXy) : null;
    const oldNodeTag = oldNodeStatic ? tagName(oldNodeStatic) : null;
    const selfOldIsDrawable = !!(oldNodeStatic && DIFF_BOUNDARY_TAGS.has(oldNodeTag));
    const selfOldId = selfOldIsDrawable ? (oldNodeStatic.getAttribute("id") || null) : null;
    const newNode = rebasedNewPath ? atPath(newRoot, rebasedNewPath, isXy) : null;

    let oldNodeDynamic = null;
    if (!isXy && (op.type === "move" || op.type === "moveupdate") && op.oldPath) {
        const oldWork = buildOldWorkUntil(idx, ops, oldRoot, newRoot);
        oldNodeDynamic = nodeAtPath(oldWork, op.oldPath);
    }

    const oldNode = oldNodeStatic;

    let ownerOld = oldNode ? nearestDrawable(oldNode) : null;
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

    // XY fallback for updates without newPath
    if (isXy && type === "update" && !ownerNew && rebasedOldPath) {
        const candidateNew = nodeAtPath(newRoot, rebasedOldPath);
        if (candidateNew) {
            const candOwnerNew = nearestDrawable(candidateNew);
            const tagOld = ownerOld ? tagName(ownerOld) : null;
            const tagNew = candOwnerNew ? tagName(candOwnerNew) : null;

            if (!tagOld || !tagNew || tagOld === tagNew) {
                ownerNew = candOwnerNew;
            }
        }
    }

    // CpeeDiff fallback for updates without newPath
    if (!isXy && type === "update" && !ownerNew) {
        const oldOwnerId = ownerOld?.getAttribute?.("id") || null;

        // direct id recovery
        if (oldOwnerId) {
            ownerNew = recoverById(newRoot, oldOwnerId);
        }

        // same rebased path in NEW
        if (!ownerNew && rebasedOldPath) {
            const candidateNew = nodeAtPath(newRoot, rebasedOldPath);
            if (candidateNew) {
                const candOwnerNew = nearestDrawable(candidateNew);
                const tagOld = ownerOld ? tagName(ownerOld) : null;
                const tagNew = candOwnerNew ? tagName(candOwnerNew) : null;

                if (!tagOld || !tagNew || tagOld === tagNew) {
                    ownerNew = candOwnerNew;
                }
            }
        }

        // gateway-specific fallback by witnesses/structure
        if (!ownerNew && ownerOld && isGatewayLike(ownerOld)) {
            ownerNew = recoverGatewayOwnerNew(ownerOld, newRoot);
        }
    }

    if (type === "insert" && newNode) {
        const selfDrawable = DIFF_BOUNDARY_TAGS.has(tagName(newNode));
        if (!selfDrawable && ownerNew) {
            type = "update";
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

    let sidOld = null;
    let sidNew = null;

    if (type === "insert" || type === "update") {
        sidOld = op.id || ownerOld?.getAttribute("id") || null;
        sidNew = op.id || ownerNew?.getAttribute("id") || null;
    } else {
        sidOld = ownerOld?.getAttribute("id") || op.id || null;
        sidNew = ownerNew?.getAttribute("id") || null;
    }

    if (type === "update") {
        // only mirror ids if one side exists
        if (!sidOld && sidNew) sidOld = sidNew;
        if (!sidNew && sidOld) sidNew = sidOld;

        console.log("[UPDATE NORMALIZE]", {
            oldPath: op.oldPath,
            rebasedOldPath,
            ownerOldId: ownerOld?.getAttribute?.("id") || null,
            ownerNewId: ownerNew?.getAttribute?.("id") || null,
            sidOld,
            sidNew
        });
    }

    const mergeOwnerId =
        (!isXy && (type === "move" || type === "moveupdate"))
            ? (ownerOldDynamic?.getAttribute?.("id") || ownerOld?.getAttribute?.("id") || null)
            : (ownerOld?.getAttribute?.("id") || null);

    const mergeOwnerPath = rebasedOldPath || op.oldPath || null;

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
