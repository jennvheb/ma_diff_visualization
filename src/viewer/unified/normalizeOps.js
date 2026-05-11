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
import {indexPathForNodeRelative} from "../../integration/xyDiff/dom/pathUtils.js";

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

function nearestTaskFromPathPrefix(root, path, isXy) {
    if (!root || !path) return null;

    const parts = String(path).split("/").filter(Boolean);

    while (parts.length > 0) {
        const p = "/" + parts.join("/");
        const n = atPath(root, p, isXy) || nodeAtPath(root, p);

        if (n && n.nodeType === 1) {
            let cur = n;
            while (cur && cur.nodeType === 1) {
                const t = tagName(cur);
                if (t === "call" || t === "manipulate" || t === "stop") {
                    return cur;
                }
                cur = cur.parentNode;
            }
        }

        parts.pop();
    }

    return null;
}

function updatePayloadText(op) {
    return [
        op.payloadTag,
        op.payloadText,
        op.payloadXml,
        op.newValue,
        op.value,
        op.text,
        op.meta?.newValue,
        op.meta?.text,
        op.meta?.kind
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
}

function updateLooksLikeTaskText(op) {
    const s = updatePayloadText(op);
    return /label|urls|url|method|arguments|parameters|_text|newValue/i.test(s);
}
function nearestDrawableFromPathPrefix(root, path, isXy) {
    if (!root || !path) return null;

    const parts = String(path).split("/").filter(Boolean);

    while (parts.length > 0) {
        const p = "/" + parts.join("/");
        const n = atPath(root, p, isXy) || nodeAtPath(root, p);
        const d = n ? nearestDrawable(n) : null;

        if (d) return d;

        parts.pop();
    }

    return null;
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
        } else if (op.type === "move" || op.type === "moveupdate") {
            rebasedOldPath = rebaseOldPathDynamicToStatic(op.oldPath, idx, ops);
        } else if (op.type === "delete") {
            // CpeeDiff delete paths already identify the deleted node in the old working tree, rebasing can lead to wrong ids/paths
            rebasedOldPath = rebaseOldPathDynamicToStatic(op.oldPath, idx, ops);
        } else if (op.type === "update" && updateLooksLikeTaskText(op)) {
            rebasedOldPath = rebaseOldPathDynamicToStatic(op.oldPath, idx, ops);
        } else {
            rebasedOldPath = preferStaticOldPath(op, idx, ops, oldRoot);
        }
    }

    let rebasedNewPath = op.newPath
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
    let newNode = rebasedNewPath ? atPath(newRoot, rebasedNewPath, isXy) : null;

    // CpeeDiff insert paths are often dynamic/shifted.
    // If the inserted payload has an id, that is the real node.
    if (!isXy && op.type === "insert" && op.id) {
        const byId = recoverById(newRoot, op.id);
        if (byId) {
            newNode = byId;
            const p = indexPathForNodeRelative(newRoot, byId);
            if (p) rebasedNewPath = p;
        }
    }

    let oldNodeDynamic = null;
    if (!isXy && (op.type === "move" || op.type === "moveupdate" || op.type === "update") && op.oldPath) {
        const oldWork = buildOldWorkUntil(idx, ops, oldRoot, newRoot);
        oldNodeDynamic = nodeAtPath(oldWork, op.oldPath);
    }

    const oldNode = oldNodeStatic;
    let type = op.type;

    let ownerOld = oldNode ? nearestDrawable(oldNode) : null;
    let ownerOldDynamic = oldNodeDynamic ? nearestDrawable(oldNodeDynamic) : null;
    // CpeeDiff drawable update: payload itself identifies the real node.
    if (!isXy && type === "update" && op.id) {
        const oldById = recoverById(oldRoot, op.id);
        const newById = recoverById(newRoot, op.id);

        if (oldById) {
            ownerOld = oldById;
            const p = indexPathForNodeRelative(oldRoot, oldById);
            if (p) rebasedOldPath = p;
        }

        if (newById) {
            newNode = newById;
            const p = indexPathForNodeRelative(newRoot, newById);
            if (p) rebasedNewPath = p;
        }
    }
    if (!isXy && type === "update" && !ownerOld && ownerOldDynamic) {
        const dynId = ownerOldDynamic.getAttribute?.("id") || null;

        if (dynId && !String(dynId).startsWith("__gw_")) {
            const staticById = recoverById(oldRoot, dynId);
            const newById = recoverById(newRoot, dynId);

            if (staticById) {
                ownerOld = staticById;
                const p = indexPathForNodeRelative(oldRoot, staticById);
                if (p) rebasedOldPath = p;
            }

            if (newById) {
                newNode = newById;
            }
        }
    }
    if (!ownerOld && !isXy && type === "update" && updateLooksLikeTaskText(op)) {
        ownerOld = nearestTaskFromPathPrefix(oldRoot, rebasedOldPath, isXy);
    }
    if (!isXy && op.type === "update") {
        console.log("UPDATE OP SHAPE", {
            keys: Object.keys(op),
            op,
            payloadText: updatePayloadText(op)
        });
    }

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

    // CpeeDiff: for moves, never trust newPath as final identity.
// The moved node identity is the OLD owner id, so recover that same id in NEW.
    if (!isXy && (type === "move" || type === "moveupdate")) {
        const movedId =
            ownerOldDynamic?.getAttribute?.("id") ||
            ownerOld?.getAttribute?.("id") ||
            op.id ||
            null;

        if (movedId && !String(movedId).startsWith("__gw_")) {
            const realNew = recoverById(newRoot, movedId);
            if (realNew) {
                ownerNew = realNew;
                const p = indexPathForNodeRelative(newRoot, realNew);
                if (p) rebasedNewPath = p;
            }
        }
    }

    if (!isXy && op.type === "move" && op.oldPath) {
        debugOldPathMeaning(op, idx, ops, oldRoot);
    }

    // XY fallback for updates without newPath
    if (isXy && type === "update" && !ownerNew && rebasedOldPath) {
        const oldOwnerId = ownerOld?.getAttribute?.("id") || null;

        // same logical id in NEW
        if (oldOwnerId) {
            const byId = recoverById(newRoot, oldOwnerId);
            if (byId) {
                ownerNew = nearestDrawable(byId);
            }
        }

        // fallback: same path only if it is really the same node
        if (!ownerNew) {
            const candidateNew = nodeAtPath(newRoot, rebasedOldPath);
            const candOwnerNew = candidateNew ? nearestDrawable(candidateNew) : null;

            const tagOld = ownerOld ? tagName(ownerOld) : null;
            const tagNew = candOwnerNew ? tagName(candOwnerNew) : null;

            const candId = candOwnerNew?.getAttribute?.("id") || null;

            const oldIsSyntheticGateway =
                oldOwnerId && String(oldOwnerId).startsWith("__gw_");

            if (
                candOwnerNew &&
                (!tagOld || !tagNew || tagOld === tagNew) &&
                (
                    !oldOwnerId ||
                    !candId ||
                    oldOwnerId === candId ||
                    oldIsSyntheticGateway
                )
            ) {
                ownerNew = candOwnerNew;
            }
        }
    }
    // XY gateway fallback: same path may fail after branch deletion / move,
    // but the gateway can still be recovered by witnesses/structure
    if (isXy && type === "update" && !ownerNew && ownerOld && isGatewayLike(ownerOld)) {
        ownerNew = recoverGatewayOwnerNew(ownerOld, newRoot);
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

        if (isXy && !selfDrawable && ownerNew) {
            const nid = ownerNew.getAttribute("id");
            const oldOwner = nid ? recoverById(oldRoot, nid) : null;

            if (oldOwner) {
                type = "update";
                ownerOld = oldOwner;

                const oldOwnerPath = indexPathForNodeRelative(oldRoot, oldOwner);
                if (oldOwnerPath) rebasedOldPath = oldOwnerPath;
            }
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

    if (type === "insert") {
        sidOld = null;
        sidNew = op.id || ownerNew?.getAttribute("id") || null;
    } else if (type === "update") {
        sidOld = ownerOld?.getAttribute("id") || op.id || null;
        sidNew = ownerNew?.getAttribute("id") || op.id || null;
    } else {
        sidOld =
            ownerOld?.getAttribute("id") ||
            ownerOldDynamic?.getAttribute?.("id") ||
            op.id ||
            null;

        sidNew = ownerNew?.getAttribute("id") || sidOld || null;
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
