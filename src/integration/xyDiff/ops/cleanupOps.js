import {isCoveredByDelete} from "../dom/pathUtils.js";

// if an update is deleted, only visualize the delete
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