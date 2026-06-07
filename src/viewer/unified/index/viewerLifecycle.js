/**
 * creates a stable identifier for an operation from type, id, old path, and new path
 * later stored as opKey and undoKey
 * so clicking and undo can identify the same operation reliably
 *
 * @param op
 * @returns {string}
 */
export function opKey(op) {
    const oldP = op.rebasedOldPath || op.oldPath || "";
    const newP = op.rebasedNewPath || op.newPath || "";
    const id = op.sidOld || op.sidNew || op.selfOldId || op.id || "";

    return `${op.type}|${id}|${oldP}|${newP}`;
}

/**
 * reset the viewer before rendering
 *
 */
export function clearUnifiedCanvas() {
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