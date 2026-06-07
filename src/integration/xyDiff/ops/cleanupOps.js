import {isDescendantPath} from "../dom/pathUtils.js";

export function isCoveredByDelete(path, deletedRoots) {
    if (!path) return false;

    for (const r of deletedRoots) {
        if (!r || r === path) continue; // ignore self
        if (isDescendantPath(path, r)) return true; // any strict ancestor delete covers it
    }
    return false;
}

/**
 * removes operations that are already covered by larger deletes
 *
 * @param operationsFinal
 * @returns {*}
 */
export function cleanupOps(operationsFinal) {
    const deleteRootsFinal = operationsFinal
        .filter(o => o.kind === "delete" && o.oldPath && o.oldPath !== "/?")
        .map(o => o.oldPath);

    return operationsFinal.filter(o => {
        if (!o.oldPath) return true;

        if (o.kind.startsWith("update")) {
            return !isCoveredByDelete(o.oldPath, deleteRootsFinal)
                && !deleteRootsFinal.includes(o.oldPath);
        }

        if (o.kind === "delete") {
            return !isCoveredByDelete(o.oldPath, deleteRootsFinal);
        }

        return true;
    });
}