import {
    stampLogicalIds,
    nearestDrawable,
    firstKRealTaskIds,
    gatewayStructureSig,
    tagName
} from "../../integration/stableIds.js";
import {getDescRoot, renderUnifiedXml} from "./render.js";
import {normalizeOp, attachUpdateContent, mergeMoveAndUpdateOps} from "./normalizeOps.js";
import {collectDrawableIdsXML, recoverById} from "./xml.js";
import {isStrictAncestorPath} from "./paths.js";
import {lastSeg, parentPath, toSegs} from "./config.js";
import {insertGhost} from "./placement.js";
import {buildIdIndex, colorizeUnified} from "./colorize.js";
import {buildOpsByIdDirect, buildOpsByIdRegion, buildOpsByKey, installUnifiedClickHandler} from "./clicks.js";
import {installUndoController} from "./undo/undoController.js";
import {installMockHostUndo} from "./mockHostUndo.js";
import { indexPathForNodeRelative } from "../../integration/xyDiff/dom/pathUtils.js";
function isSameOrDescendantPath(path, ancestor) {
    if (!path || !ancestor) return false;
    return path === ancestor || path.startsWith(ancestor + "/");
}

function isPrefixPath(path, prefix) {
    return path === prefix || path.startsWith(prefix + "/");
}
function opKey(op) {
    const oldP = op.rebasedOldPath || op.oldPath || "";
    const newP = op.rebasedNewPath || op.newPath || "";
    const id = op.sidOld || op.sidNew || op.selfOldId || op.id || "";

    return `${op.type}|${id}|${oldP}|${newP}`;
}

function shiftPathAfterInsert(path, insertPath) {
    if (!path || !insertPath) return path;

    const p = path.split("/").filter(Boolean).map(Number);
    const i = insertPath.split("/").filter(Boolean).map(Number);

    if (p.length !== i.length) return path;

    const sameParent = p.slice(0, -1).join("/") === i.slice(0, -1).join("/");
    if (!sameParent) return path;

    if (p[p.length - 1] >= i[i.length - 1]) {
        p[p.length - 1]++;
    }

    return "/" + p.join("/");
}

function shiftPathAfterRemoval(path, removedPath) {
    if (!path || !removedPath) return path;

    // If the path is inside the removed subtree, no valid slot remains.
    if (isPrefixPath(path, removedPath)) return path;

    const p = path.split("/").filter(Boolean).map(Number);
    const r = removedPath.split("/").filter(Boolean).map(Number);

    if (p.length !== r.length) return path;

    const sameParent = p.slice(0, -1).join("/") === r.slice(0, -1).join("/");
    if (!sameParent) return path;

    if (p[p.length - 1] > r[r.length - 1]) {
        p[p.length - 1]--;
    }

    return "/" + p.join("/");
}

function ghostSourcePathAtDeltaTime(op, ctx) {
    let p = op.rebasedOldPath || op.oldPath;
    const myIdx = op.deltaIndex ?? Infinity;

    for (const other of ctx.ops || []) {
        const otherIdx = other.deltaIndex ?? Infinity;
        if (otherIdx >= myIdx) continue;

        if (other.type === "insert") {
            p = shiftPathAfterInsert(p, other.rebasedNewPath || other.newPath);
        }

        if (
            other.type === "delete" ||
            other.type === "move" ||
            other.type === "moveupdate"
        ) {
            p = shiftPathAfterRemoval(p, other.rebasedOldPath || other.oldPath);
        }
    }

    return p;
}

function isCoveredByDeletedSubtree(oldPath, metaOps) {
    return metaOps.some(op => {
        if (op.type !== "delete") return false;

        const deletePath = op.rebasedOldPath || op.oldPath;
        return isSameOrDescendantPath(oldPath, deletePath);
    });
}

function isCoveredByExplicitMove(oldPath, metaOps) {
    return metaOps.some(op => {
        if (op.type !== "move" && op.type !== "moveupdate") return false;

        // synthetic recovered moves should not suppress other candidates
        if (op.recoveredFromStableId) return false;

        const movePath = op.rebasedOldPath || op.oldPath;
        return isSameOrDescendantPath(oldPath, movePath);
    });
}
function recoverStableIdMovesForCpeeDiff(metaOps, oldRoot, newRoot, isXy) {
    if (isXy) return metaOps;

    const explicitMoves = metaOps.filter(op =>
        (op.type === "move" || op.type === "moveupdate") &&
        !op.recoveredFromStableId
    );

    if (!explicitMoves.length) {
        console.log("skip stable-id move recovery: diff contains no explicit moves");
        return metaOps;
    }

    const existingMoveIds = new Set(
        explicitMoves
            .map(op => op.sidOld)
            .filter(Boolean)
    );

    const deletedSelfIds = new Set(
        metaOps
            .filter(op => op.type === "delete")
            .map(op => op.sidOld)
            .filter(Boolean)
    );

    const insertedIds = new Set(
        metaOps
            .filter(op => op.type === "insert")
            .map(op => op.sidNew)
            .filter(Boolean)
    );

    const stableMoves = [];

    /*
     * IMPORTANT:
     * Do NOT scan the whole tree.
     *
     * Only recover stable-id moves inside explicit move regions.
     * Otherwise every path shift after a gateway/delete restructuring becomes
     * a fake move.
     */
    for (const moveOp of explicitMoves) {
        const oldMoveRoot = moveOp.ownerOld;
        const newMoveRoot = moveOp.ownerNew;

        if (!oldMoveRoot || !newMoveRoot) continue;

        const oldCandidates = Array.from(oldMoveRoot.getElementsByTagName("*"));

        for (const oldEl of oldCandidates) {
            const id = oldEl.getAttribute?.("id");
            if (!id || id.startsWith("__gw_")) continue;
            if (existingMoveIds.has(id)) continue;
            if (deletedSelfIds.has(id)) continue;
            if (insertedIds.has(id)) continue;

            const newEl = recoverById(newMoveRoot, id);
            if (!newEl) continue;

            const oldPath = indexPathForNodeRelative(oldRoot, oldEl);
            const newPath = indexPathForNodeRelative(newRoot, newEl);

            if (!oldPath || !newPath || oldPath === newPath) continue;

            stableMoves.push({
                type: "move",
                oldPath,
                newPath,
                rebasedOldPath: oldPath,
                rebasedNewPath: newPath,
                ownerOld: nearestDrawable(oldEl),
                ownerOldDynamic: null,
                ownerNew: nearestDrawable(newEl),
                sidOld: id,
                sidNew: id,
                mergeOwnerId: id,
                mergeOwnerPath: oldPath,
                oldNodeStatic: oldEl,
                oldNodeTag: tagName(oldEl),
                selfOldIsDrawable: true,
                selfOldId: id,
                subtreeIdsOld: collectDrawableIdsXML(oldEl),
                subtreeIdsNew: collectDrawableIdsXML(newEl),
                contentOld: null,
                contentNew: null,
                contentDiff: null,
                changeOccured: false,
                recoveredFromStableId: true
            });
        }
    }

    return [...metaOps, ...stableMoves];
}

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
function dropCpeeDiffGatewayMoveNoise(metaOps, isXy) {
    if (isXy) return metaOps;

    return metaOps.filter(op => {
        if (op.type !== "move" && op.type !== "moveupdate") return true;

        const sid = String(op.sidOld || op.sidNew || "");
        const tag = String(op.oldNodeTag || "");

        const isSyntheticGatewayMove =
            sid.startsWith("__gw_") ||
            tag === "choose" ||
            tag === "parallel_branch" ||
            tag === "alternative" ||
            tag === "otherwise";

        if (isSyntheticGatewayMove) {
            console.warn("DROP CPEEDIFF GATEWAY MOVE NOISE", {
                sid,
                tag,
                oldPath: op.oldPath,
                rebasedOldPath: op.rebasedOldPath,
                newPath: op.newPath,
                rebasedNewPath: op.rebasedNewPath
            });
            return false;
        }

        return true;
    });
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
            deltaIndex: idx,
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

    metaOps = dropCpeeDiffGatewayMoveNoise(metaOps, isXy);
    metaOps = recoverStableIdMovesForCpeeDiff(metaOps, oldRoot, newRoot, isXy);
    metaOps = suppressNestedMoveOps(metaOps);
    if (!isXy) {
        metaOps = metaOps.filter(op => {
            if (op.type !== "move" && op.type !== "moveupdate") return true;

            const oldP = op.rebasedOldPath || op.oldPath;
            const newP = op.rebasedNewPath || op.newPath;

            // only index changed inside same parent = shift, not visual move
            if (oldP && newP && parentPath(oldP) === parentPath(newP)) {
                console.warn("drop same parent move", {
                    sidOld: op.sidOld,
                    oldP,
                    newP
                });
                return false;
            }

            return true;
        });
    }
    const chooseOps = metaOps.filter(op =>
        (op.type === "update" || op.type === "moveupdate") &&
        String(op.sidOld || op.sidNew || "").includes("__gw_choose__")
    );

    console.log("choose ops after mergemoveandupdateops", JSON.stringify(chooseOps, null, 2));

    const insertedNewIds = new Set();
    for (const op of metaOps) {
        if (op.type !== "insert") continue;
        if (op.sidNew) insertedNewIds.add(op.sidNew);
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
        ops: metaOps,
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
                console.warn("skip move ghost - source already in delete ghost", {
                    sidOld: op.sidOld,
                    moveOldPath
                });
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

    let {
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

    metaOps = metaOps.map(op => ({
        ...op,
        opKey: op.opKey || opKey(op),
        undoKey: op.undoKey || opKey(op)
    }));

    logSampleOps(metaOps);

    window.__META_OPS__ = metaOps;
    window.ALL_DIFF_OPS = metaOps;

    const unifiedRoot = buildUnifiedRoot({
        newRoot,
        metaOps,
        baseCtx,
        movedOldIds,
        deletedOldIds,
        isXy
    });

    window.__UNIFIED_ROOT__ = unifiedRoot;

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