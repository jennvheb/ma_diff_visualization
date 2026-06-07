import {nearestDrawable, tagName} from "../../../integration/stableIds.js";
import {
    preferStaticOldPath,
    rebaseNewPathDynamicToFinal,
    rebaseOldPathDynamicToStatic
} from "../paths.js";
import {
    atPath,
    buildOldWorkUntil,
    nodeAtPath,
    findById
} from "../xml.js";
import {DIFF_BOUNDARY_TAGS} from "../../../integration/tags.js";
import {indexPathForNodeRelative} from "../../../integration/xyDiff/dom/pathUtils.js";
import {
    isGatewayLike,
    nearestTaskFromPathPrefix,
    recoverGatewayOwnerNew,
    updateLooksLikeTaskText
} from "./normalizeOwnerRecovery.js";


/**
 * main function, takes one raw operation and enriches it
 * determines oldpath and new path through different methods
 * resolves old/new nodes
 * fixes cpeediff inserts by id as paths may be shifted
 * builds dynamic old work tree for CpeeDiff
 * finds visual owners
 * use CpeeDiff update by id, update fallback logic
 * convert non-drawable insert/delete into update
 * determine sidOld and sidNew
 * return enriched op
 *
 * @param op
 * @param idx
 * @param ops
 * @param ctx
 * @returns {*&{sidNew: *, selfOldIsDrawable: boolean, rebasedNewPath: (*|string), sidOld: *, type: string, ownerNew: *, ownerOld: *, mergeOwnerPath: null, oldNodeStatic: (*), ownerOldDynamic: *, selfOldId: (*|string), mergeOwnerId: (*|string), rebasedOldPath: null, oldNodeTag: *}}
 */
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

    const oldNodeStatic = rebasedOldPath ? atPath(oldRoot, rebasedOldPath, isXy) : null;
    const oldNodeTag = oldNodeStatic ? tagName(oldNodeStatic) : null;
    const selfOldIsDrawable = !!(oldNodeStatic && DIFF_BOUNDARY_TAGS.has(oldNodeTag));
    const selfOldId = selfOldIsDrawable ? (oldNodeStatic.getAttribute("id") || null) : null;
    let newNode = rebasedNewPath ? atPath(newRoot, rebasedNewPath, isXy) : null;

    // CpeeDiff insert paths are often dynamic/shifted.
    // If the inserted payload has an id, that is the real node.
    if (!isXy && op.type === "insert" && op.id) {
        const byId = findById(newRoot, op.id);
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
        const oldById = findById(oldRoot, op.id);
        const newById = findById(newRoot, op.id);

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
            const staticById = findById(oldRoot, dynId);
            const newById = findById(newRoot, dynId);

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
            const realNew = findById(newRoot, movedId);
            if (realNew) {
                ownerNew = realNew;
                const p = indexPathForNodeRelative(newRoot, realNew);
                if (p) rebasedNewPath = p;
            }
        }
    }

    // XY fallback for updates without newPath
    if (isXy && type === "update" && !ownerNew && rebasedOldPath) {
        const oldOwnerId = ownerOld?.getAttribute?.("id") || null;

        // same logical id in NEW
        if (oldOwnerId) {
            const byId = findById(newRoot, oldOwnerId);
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
            ownerNew = findById(newRoot, oldOwnerId);
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
            const oldOwner = nid ? findById(oldRoot, nid) : null;

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
            if (oid) ownerNew = findById(newRoot, oid);
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
