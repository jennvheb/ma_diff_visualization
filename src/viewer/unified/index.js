import {stampLogicalIds, nearestDrawable, firstKRealTaskIds, gatewayStructureSig} from "../../integration/stableIds.js";
import {getDescRoot, renderUnifiedXml} from "./render.js";
import {normalizeOp, attachUpdateContent, mergeMoveAndUpdateOps} from "./normalizeOps.js";
import {collectDrawableIdsXML} from "./xml.js";
import {isStrictAncestorPath} from "./paths.js";
import {toSegs} from "./config.js"
import {insertGhost} from "./placement.js";
import {buildIdIndex, colorizeUnified} from "./colorize.js";
import {buildOpsByIdDirect, buildOpsByIdRegion, installUnifiedClickHandler} from "./clicks.js";

const source = (window.DIFF_SOURCE || "").toLowerCase();
const isXy = source === "xydiff";

(function () {
    const { OLD_TREE, NEW_TREE, DIFF } = window;
    if (!OLD_TREE || !NEW_TREE) {
        return;
    }

    const oldRoot = getDescRoot(OLD_TREE);
    const newRoot = getDescRoot(NEW_TREE);

    if (!oldRoot || !newRoot) {
        console.error("Missing <description> root in OLD/NEW");
        return;
    }

    stampLogicalIds(oldRoot);
    stampLogicalIds(newRoot);

    function indexNewGateways(newRoot) {
        const arr = [];
        newRoot.querySelectorAll("loop, choose, parallel, otherwise, alternative, parallel_branch, stop")
            .forEach(gw => {
                const id = gw.getAttribute("id") || null;
                const parent = nearestDrawable(gw.parentNode);
                const pid = parent?.getAttribute("id") || "root";
                const witnesses = firstKRealTaskIds(gw, 3);
                const struct = gatewayStructureSig(gw);
                arr.push({ id, pid, witnesses, struct });
            });
        return arr;
    }

    const newGatewayIndex = indexNewGateways(newRoot);

    const baseCtx = {
        isXy,
        oldRoot,
        newRoot,
        newGatewayIndex,
    };

    const rawOps = Array.isArray(DIFF) ? DIFF : [];

    let metaOps = rawOps.map((op, idx) => {
        const base = normalizeOp(op, idx, rawOps, baseCtx);

        const subtreeIdsOld = base.ownerOld ? collectDrawableIdsXML(base.ownerOld) : [];
        const subtreeIdsNew = base.ownerNew ? collectDrawableIdsXML(base.ownerNew) : [];

        const { contentOld, contentNew, contentDiff, changeOccured } =
            attachUpdateContent(base, baseCtx);

        return {
            ...base,
            subtreeIdsOld,
            subtreeIdsNew,
            contentOld,
            contentNew,
            contentDiff,
            changeOccured,
        };
    }).filter(op => {
        if (op.type === "update") return !!op.changeOccured;
        return true;
    });

    metaOps = mergeMoveAndUpdateOps(metaOps);

    const insertedNewIds = new Set();
    for (const op of metaOps) {
        if (op.type !== "insert") continue;
        if (op.sidNew) insertedNewIds.add(op.sidNew);
        for (const id of op.subtreeIdsNew || []) insertedNewIds.add(id);
    }

    const movedOldIds = new Set();
    for (const op of metaOps) {
        if (!(op.type === "move" || op.type === "moveupdate")) continue;
        if (op.sidOld) movedOldIds.add(op.sidOld);
        for (const id of op.subtreeIdsOld || []) movedOldIds.add(id);
    }

    metaOps = metaOps.filter((op) => {
        if (op.type !== "delete") return true;
        if (op.selfOldIsDrawable && op.selfOldId && movedOldIds.has(op.selfOldId)) {
            return false;
        }
        return true;
    });

    metaOps = metaOps.map((op) => {
        if (!(op.type === "move" || op.type === "moveupdate")) return op;

        const insertedThenMoved =
            !!op.sidNew && insertedNewIds.has(op.sidNew) &&
            (!op.sidOld || !op.ownerOld);

        const myOldPath = op.rebasedOldPath || op.oldPath || "";

        const coveredByAncestorMoveGhost = metaOps.some((other) => {
            if (other === op) return false;
            if (!(other.type === "move" || other.type === "moveupdate")) return false;

            const otherOldPath = other.rebasedOldPath || other.oldPath || "";
            if (!otherOldPath || !myOldPath) return false;

            return isStrictAncestorPath(otherOldPath, myOldPath);
        });

        return {
            ...op,
            _insertedThenMoved: insertedThenMoved,
            _coveredByAncestorMoveGhost: coveredByAncestorMoveGhost,
        };
    });

    const deletedOldIds = new Set();
    for (const op of metaOps) {
        if (op.type !== "delete") continue;
        if (op.sidOld) deletedOldIds.add(op.sidOld);
        for (const id of op.subtreeIdsOld || []) deletedOldIds.add(id);
    }

    const placementCtx = {
        ...baseCtx,
        movedOldIds,
        deletedOldIds,
    };

    const unifiedRoot = newRoot.cloneNode(true);
    const init = unifiedRoot.querySelector('manipulate[id="init"]');
    if (init) init.remove();

    const deleteOps = metaOps
        .filter(o => o.type === "delete")
        .sort((a, b) => toSegs(a.rebasedOldPath || a.oldPath).length - toSegs(b.rebasedOldPath || b.oldPath).length);

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
            const d = cmpPathLex(pa, pb);
            if (d !== 0) return d;

            const pr = (t) => (t === "delete" ? 0 : 1);
            const td = pr(a.type) - pr(b.type);
            if (td !== 0) return td;

            return 0;
        });

        for (const op of ghostOps) {
            if (op.type === "delete") {
                insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "delete", skipSameIdAnchor: false });
            } else {
                insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "move", skipSameIdAnchor: true });
            }
        }
    } else {
        for (const op of metaOps) {
            if (op.type !== "move" && op.type !== "moveupdate") continue;
            if (op._insertedThenMoved) continue;
            if (op._coveredByAncestorMoveGhost) continue;
            if (!op.ownerOld) continue;
            if (op.sidOld && deletedOldIds.has(op.sidOld)) continue;

            insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "move", skipSameIdAnchor: true });
        }

        for (const op of deleteOps) {
            insertGhost(op, unifiedRoot, placementCtx, { ghostKind: "delete", skipSameIdAnchor: false });
        }
    }

    const opsByIdDirect = buildOpsByIdDirect(metaOps);
    const opsByIdRegion = buildOpsByIdRegion(metaOps);

    renderUnifiedXml(unifiedRoot);

    window.colorUnifiedSvg = function () {
        const svgRoot =
            document.getElementById("graph-new") ||
            document.querySelector("#graph-new svg");

        if (!svgRoot) {
            console.warn("UNIFIED svgRoot not found (#graph-new)");
            return;
        }

        const idx = buildIdIndex(svgRoot);
        colorizeUnified(idx, metaOps);

        installUnifiedClickHandler({
            unifiedRoot,
            opsByIdDirect,
            opsByIdRegion,
        });
    };
})();
