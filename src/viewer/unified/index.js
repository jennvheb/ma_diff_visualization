import {stampLogicalIds, nearestDrawable, firstKRealTaskIds, gatewayStructureSig} from "../../integration/stableIds.js";
import {getDescRoot, renderUnifiedXml} from "./render.js";
import {normalizeOp, attachUpdateContent, mergeMoveAndUpdateOps} from "./normalizeOps.js";
import {collectDrawableIdsXML} from "./xml.js";
import {isStrictAncestorPath} from "./paths.js";
import {toSegs} from "./config.js";
import {insertGhost} from "./placement.js";
import {buildIdIndex, colorizeUnified} from "./colorize.js";
import {buildOpsByIdDirect, buildOpsByIdRegion, buildOpsByKey, installUnifiedClickHandler} from "./clicks.js";
import {installUndoController} from "./undo/undoController.js";
import {installMockHostUndo} from "./mockHostUndo.js";

function logSampleOps(metaOps) {
    const insertOp = metaOps.find(op => op.type === "insert");
    const deleteOp = metaOps.find(op => op.type === "delete");
    const updateOp = metaOps.find(op => op.type === "update");

    console.log("sample insert op", insertOp);
    console.log("sample delete op", deleteOp);
    console.log("sample update op", updateOp);

    if (insertOp) console.log("sample insert op json", JSON.stringify(insertOp, null, 2));
    if (deleteOp) console.log("sample delete op json", JSON.stringify(deleteOp, null, 2));
    if (updateOp) console.log("sample update op json", JSON.stringify(updateOp, null, 2));
}

function clearUnifiedCanvas() {
    const graph = document.getElementById("graph-new");
    if (graph) {
        if (graph.__unifiedClickHandler) {
            graph.removeEventListener("click", graph.__unifiedClickHandler, true);
            delete graph.__unifiedClickHandler;
        }
        graph.innerHTML = "";
        delete graph.__unifiedClickInstalled;
    }

    const layout = document.getElementById("layout-new");
    if (layout) {
        if (layout.__unifiedClickHandler) {
            layout.removeEventListener("click", layout.__unifiedClickHandler, true);
            delete layout.__unifiedClickHandler;
        }
        delete layout.__unifiedClickInstalled;
    }

    delete window.colorUnifiedSvg;
}

function isMoveLike(op) {
    return op?.type === "move" || op?.type === "moveupdate";
}

function stableOpId(op) {
    return op?.sidOld || op?.sidNew || op?.selfOldId || null;
}

function isStrictDescendantPath(child, parent) {
    return !!child && !!parent && child !== parent && child.startsWith(parent + "/");
}

function parentCoversChildMove(parentOp, childOp) {
    if (!isMoveLike(parentOp) || !isMoveLike(childOp)) return false;
    if (parentOp === childOp) return false;

    const parentId = stableOpId(parentOp);
    const childId = stableOpId(childOp);

    // never compare the same op against itself logically
    if (parentId && childId && parentId === childId) return false;

    // strongest signal: subtree ids
    if (childId) {
        if ((parentOp.subtreeIdsOld || []).includes(childId)) return true;
        if ((parentOp.subtreeIdsNew || []).includes(childId)) return true;
    }

    // fallback: path containment
    const parentOld = parentOp.rebasedOldPath || parentOp.oldPath || null;
    const childOld = childOp.rebasedOldPath || childOp.oldPath || null;
    if (isStrictDescendantPath(childOld, parentOld)) return true;

    const parentNew = parentOp.rebasedNewPath || parentOp.newPath || null;
    const childNew = childOp.rebasedNewPath || childOp.newPath || null;
    if (isStrictDescendantPath(childNew, parentNew)) return true;

    return false;
}

function suppressNestedMoveOps(metaOps) {
    return metaOps.filter((op, i) => {
        if (!isMoveLike(op)) return true;

        const covered = metaOps.some((other, j) => {
            if (i === j) return false;
            return parentCoversChildMove(other, op);
        });

        if (covered) {
            console.log("move suppress: dropping nested move", {
                sidOld: op.sidOld || null,
                sidNew: op.sidNew || null,
                oldPath: op.rebasedOldPath || op.oldPath || null,
                newPath: op.rebasedNewPath || op.newPath || null,
            });
            return false;
        }

        return true;
    });
}
function buildMetaOps({ oldRoot, newRoot, diffOps, isXy }) {
    function indexNewGateways(root) {
        const arr = [];
        root.querySelectorAll("loop, choose, parallel, otherwise, alternative, parallel_branch, stop")
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

    let metaOps = diffOps.map((op, idx) => {
        const base = normalizeOp(op, idx, diffOps, baseCtx);

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
    metaOps = suppressNestedMoveOps(metaOps);
    const chooseOps = metaOps.filter(op =>
        (op.type === "update" || op.type === "moveupdate") &&
        String(op.sidOld || op.sidNew || "").includes("__gw_choose__")
    );

    console.log("choose ops after mergeMoveAndUpdateOps", JSON.stringify(chooseOps, null, 2));

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
    console.log("choose ops after delete-filter", JSON.stringify(
        metaOps.filter(op =>
            (op.type === "update" || op.type === "moveupdate") &&
            String(op.sidOld || op.sidNew || "").includes("__gw_choose__")
        ),
        null,
        2
    ));

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

    return {
        metaOps,
        baseCtx,
        movedOldIds,
        deletedOldIds
    };
}

function buildUnifiedRoot({ newRoot, metaOps, baseCtx, movedOldIds, deletedOldIds, isXy }) {
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

    return unifiedRoot;
}

export function renderUnifiedApp({
                                     oldTreeXml,
                                     newTreeXml,
                                     diffOps,
                                     diffSource
                                 }) {
    const source = (diffSource || "").toLowerCase();
    const isXy = source === "xydiff";

    if (!oldTreeXml || !newTreeXml) {
        console.error("Missing OLD_TREE / NEW_TREE XML");
        return;
    }

    clearUnifiedCanvas();

    const oldRoot = getDescRoot(oldTreeXml);
    const newRoot = getDescRoot(newTreeXml);

    if (!oldRoot || !newRoot) {
        console.error("Missing <description> root in OLD/NEW");
        return;
    }

    stampLogicalIds(oldRoot);
    stampLogicalIds(newRoot);

    const rawOps = Array.isArray(diffOps) ? diffOps : [];

    const {
        metaOps,
        baseCtx,
        movedOldIds,
        deletedOldIds
    } = buildMetaOps({
        oldRoot,
        newRoot,
        diffOps: rawOps,
        isXy
    });

    logSampleOps(metaOps);
    window.__META_OPS__ = metaOps;

    const unifiedRoot = buildUnifiedRoot({
        newRoot,
        metaOps,
        baseCtx,
        movedOldIds,
        deletedOldIds,
        isXy
    });

    const opsByIdDirect = buildOpsByIdDirect(metaOps);
    const opsByIdRegion = buildOpsByIdRegion(metaOps);
    const opsByKey = buildOpsByKey(metaOps);

    console.log("final choose ops before render", JSON.stringify(
        metaOps.filter(op =>
            (op.type === "update" || op.type === "moveupdate") &&
            String(op.sidOld || op.sidNew || "").includes("__gw_choose__")
        ),
        null,
        2
    ));

    renderUnifiedXml(unifiedRoot);

    window.colorUnifiedSvg = function () {
        const svgRoot =
            document.getElementById("graph-new") ||
            document.querySelector("#graph-new svg");

        if (!svgRoot) {
            console.warn("unified svgRoot not found (#graph-new)");
            return;
        }

        const idx = buildIdIndex(svgRoot);
        colorizeUnified(idx, metaOps);

        installUnifiedClickHandler({
            unifiedRoot,
            opsByIdDirect,
            opsByIdRegion,
            opsByKey
        });
    };
}

installUndoController();

installMockHostUndo({
    rerender: async ({ oldXml, newXml, diffOps, diffSource }) => {
        console.log("rerender old stays fixed, new replaced");
        console.log(oldXml);
        console.log(newXml);

        renderUnifiedApp({
            oldTreeXml: oldXml,
            newTreeXml: newXml,
            diffOps: diffOps || [],
            diffSource: diffSource || window.DIFF_SOURCE || ""
        });
    }
});

renderUnifiedApp({
    oldTreeXml: window.OLD_TREE,
    newTreeXml: window.NEW_TREE,
    diffOps: window.DIFF || [],
    diffSource: window.DIFF_SOURCE || ""
});