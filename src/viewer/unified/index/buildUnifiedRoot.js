import {resetPlacementState} from "../placement/placementState.js";
import {lastSeg, parentPath, toSegs} from "../config.js";
import {insertGhost} from "../placement/placement.js";

/**
 * checks whether a path is exactly the ancestor path or inside it
 * used to avoid placing move ghosts inside already deleted regions
 * @param path
 * @param ancestor
 * @returns {boolean|boolean}
 */
function isSameOrDescendantPath(path, ancestor) {
    if (!path || !ancestor) return false;
    return path === ancestor || path.startsWith(ancestor + "/");
}

/**
 * creates the actual XML that will be rendered
 * starts from a clone of the final NEW model, adds ghosts
 *
 * @param newRoot
 * @param metaOps
 * @param baseCtx
 * @param movedOldIds
 * @param deletedOldIds
 * @param isXy
 * @returns {*|ActiveX.IXMLDOMNode|Node}
 */
export function buildUnifiedRoot({ newRoot, metaOps, baseCtx, movedOldIds, deletedOldIds, isXy }) {
    const placementCtx = {
        ...baseCtx,
        movedOldIds,
        deletedOldIds,
        ops: metaOps,
    };

    resetPlacementState();

    const unifiedRoot = newRoot.cloneNode(true);
    const init = unifiedRoot.querySelector('manipulate[id="init"]');
    if (init) init.remove();

    const deleteOps = metaOps
        .filter(o => o.type === "delete")
        .sort((a, b) => toSegs(a.rebasedOldPath || a.oldPath).length - toSegs(b.rebasedOldPath || b.oldPath).length);
    /*
    For XYDiff, collect all delete/move/moveupdate ghosts,
    filter out ghosts that should not be shown,
    sort them by old path, then insert them
     */
    if (isXy) {
        function cmpPathLex(aPath, bPath) {
            const a = toSegs(aPath);
            const b = toSegs(bPath);
            const n = Math.min(a.length, b.length);
            for (let i = 0; i < n; i++) {
                if (a[i] !== b[i]) return a[i] - b[i];
            }
            return a.length - b.length;
        }

        function ghostOldPath(op) {
            return op.rebasedOldPath || op.oldPath || "";
        }

        let ghostOps = metaOps.filter(op =>
            op.type === "delete" || op.type === "move" || op.type === "moveupdate"
        );

        ghostOps = ghostOps.filter(op => {
            if ((op.type === "move" || op.type === "moveupdate")) {
                if (op._insertedThenMoved) return false;
                if (op._coveredByAncestorMoveGhost) return false;
                if (!op.ownerOld) return false;
                if (op.sidOld && deletedOldIds.has(op.sidOld)) return false;
            }
            if (op.type === "delete") {
                if (!op.ownerOld) return false;
            }
            return true;
        });

        ghostOps = [...ghostOps].sort((a, b) => {
            const pa = ghostOldPath(a);
            const pb = ghostOldPath(b);

            const parentA = parentPath(pa);
            const parentB = parentPath(pb);

            if (parentA === parentB) {
                return lastSeg(pa) - lastSeg(pb);
            }

            return cmpPathLex(pa, pb);
        });

        for (const op of ghostOps) {
            if (op.type === "delete") {
                insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "delete", skipSameIdAnchor: false });
            } else {
                insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "move", skipSameIdAnchor: true });
            }
        }
    } else {
        /*
        For CpeeDiff, insert move ghosts first and delete ghosts afterward,
        with additional checks to avoid move ghosts inside delete regions
        or explicitly deleted same nodes
         */
        for (const op of metaOps) {
            if (op.type !== "move" && op.type !== "moveupdate") continue;
            if (op._insertedThenMoved) continue;
            if (op._coveredByAncestorMoveGhost) continue;
            if (!op.ownerOld && !op.ownerOldDynamic) continue;

            const moveOldPath = op.rebasedOldPath || op.oldPath;

            const sourceCoveredByDeleteGhost = metaOps.some(d => {
                if (d.type !== "delete") return false;

                const deletePath = d.rebasedOldPath || d.oldPath;
                if (!deletePath || !moveOldPath) return false;

                return isSameOrDescendantPath(moveOldPath, deletePath);
            });

            if (sourceCoveredByDeleteGhost) {
                continue;
            }

            const explicitlyDeletedSameNode = metaOps.some(d =>
                d.type === "delete" &&
                d.sidOld &&
                op.sidOld &&
                d.sidOld === op.sidOld
            );

            if (explicitlyDeletedSameNode) continue;

            insertGhost(op, unifiedRoot, placementCtx, {
                ghostKind: "move",
                skipSameIdAnchor: true
            });
        }

        for (const op of deleteOps) {
            insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "delete", skipSameIdAnchor: false });
        }
    }

    return unifiedRoot;
}
