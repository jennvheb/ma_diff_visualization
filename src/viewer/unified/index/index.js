import {
    stampLogicalIds
} from "../../../integration/stableIds.js";
import {getDescRoot, renderUnifiedXml} from "../render.js";
import {buildIdIndex, colorizeUnified} from "../colorize.js";
import {buildOpsByIdDirect, buildOpsByIdRegion, buildOpsByKey, installUnifiedClickHandler} from "../clicks.js";
import {installUndoController} from "../undo/undoController.js";
import {installMockHostUndo} from "../mockHostUndo.js";
import {buildMetaOps} from "./metaOpsPipeline.js";
import {buildUnifiedRoot} from "./buildUnifiedRoot.js";
import {clearUnifiedCanvas, opKey} from "./viewerLifecycle.js";


/**
 * render function
 * determines the source, clears old canvas, parses old and new xml, stamps stable logical ids, builds metaops, stores them for click/undo,
 * builds unified root, stores for visual undo, builds click lookup indexes, renders the unified XML,
 * defines window.colorUnifiedSvg, which colors the SVG and installs click handlers after cpee-layout finishes rendering
 *
 * @param oldTreeXml
 * @param newTreeXml
 * @param diffOps
 * @param diffSource
 */
export function renderUnifiedApp({
                                     oldTreeXml,
                                     newTreeXml,
                                     diffOps,
                                     diffSource
                                 }) {
    const source = (diffSource || "").toLowerCase();
    const isXy = source === "xydiff";

    if (!oldTreeXml || !newTreeXml) {
        return;
    }

    clearUnifiedCanvas();

    const oldRoot = getDescRoot(oldTreeXml);
    const newRoot = getDescRoot(newTreeXml);

    if (!oldRoot || !newRoot) {
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

    renderUnifiedXml(unifiedRoot);

    window.colorUnifiedSvg = function () {
        const svgRoot =
            document.getElementById("graph-new") ||
            document.querySelector("#graph-new svg");

        if (!svgRoot) {
            return;
        }

        const idx = buildIdIndex(svgRoot);
        colorizeUnified(idx, metaOps);

        installUnifiedClickHandler({
            opsByIdDirect,
            opsByIdRegion,
            opsByKey
        });
    };
}

installUndoController();

installMockHostUndo({
    rerender: async ({ oldXml, newXml, diffOps, diffSource }) => {

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