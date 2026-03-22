
import {elementByRelIndexPath, indexPathForNodeRelative, numericTail, parentPath, sameDepth} from "../dom/pathUtils.js";
import {tagName} from "../../stableIds.js";
import {signatureForDrawable} from "../dom/signatures.js";
import {BRANCH_CONTAINER_TAGS} from "../../tags.js";
import {nearestOwningGateway} from "../dom/drawableUtils.js";

function isOneStepLeftShift(move) {
    if (!move?.oldPath || !move?.newPath) return false;
    if (parentPath(move.oldPath) !== parentPath(move.newPath)) return false;
    if (!sameDepth(move.oldPath, move.newPath)) return false;

    const oldIdx = numericTail(move.oldPath);
    const newIdx = numericTail(move.newPath);
    return Number.isFinite(oldIdx) && Number.isFinite(newIdx) && newIdx === oldIdx - 1;
}

function isOneStepRightShift(move) {
    if (!move?.oldPath || !move?.newPath) return false;
    if (parentPath(move.oldPath) !== parentPath(move.newPath)) return false;
    if (!sameDepth(move.oldPath, move.newPath)) return false;

    const oldIdx = numericTail(move.oldPath);
    const newIdx = numericTail(move.newPath);
    return Number.isFinite(oldIdx) && Number.isFinite(newIdx) && newIdx === oldIdx + 1;
}

function isProvenRealMove(m, { baseOld, baseNew, pairedByXm = false }) {
    if (!m?.oldPath || !m?.newPath) return false;

    const oldEl = elementByRelIndexPath(baseOld, m.oldPath);
    const newEl = elementByRelIndexPath(baseNew, m.newPath);
    if (!oldEl || !newEl) return false;

    const oldTag = tagName(oldEl);
    const newTag = tagName(newEl);
    if (oldTag !== newTag) return false;

    const oldId = oldEl.getAttribute?.("id") || null;
    const newId = newEl.getAttribute?.("id") || null;

    if (oldId && newId && oldId === newId) return true;

    const oldSig = signatureForDrawable(baseOld, m.oldPath);
    const newSig = signatureForDrawable(baseNew, m.newPath);
    if (oldSig && newSig && oldSig === newSig) return true;

    if (pairedByXm) return true;

    return false;
}

function isPassiveShiftArtifact(m, moves) {
    if (!m?.oldPath || !m?.newPath) return false;
    if (!(isOneStepLeftShift(m) || isOneStepRightShift(m))) return false;

    const myOldIdx = numericTail(m.oldPath);
    const myParent = parentPath(m.oldPath);

    for (const other of moves) {
        if (other === m) continue;
        if (!other.oldPath || !other.newPath) continue;
        if (parentPath(other.oldPath) !== myParent) continue;
        if (parentPath(other.newPath) !== myParent) continue;

        const oOld = numericTail(other.oldPath);
        const oNew = numericTail(other.newPath);

        const crossesMe =
            (oOld < myOldIdx && oNew >= myOldIdx) ||
            (oOld > myOldIdx && oNew <= myOldIdx);

        if (crossesMe) return true;
    }

    return false;
}

export function normalizeSemanticMoves({ ops, baseOld, baseNew }) {
    const deletes = ops.filter(o => o.kind === "delete" && o.oldPath);
    const moves = ops.filter(o => o.kind === "move" && o.oldPath && o.newPath);
    const others = ops.filter(o => o.kind !== "move");

    const resultMoves = [];
    const consumedMoveKeys = new Set();

    function moveKey(m) {
        return `${m.oldPath}=>${m.newPath}`;
    }

    for (const del of deletes) {
        const delEl = elementByRelIndexPath(baseOld, del.oldPath);
        if (!delEl) continue;

        const delTag = tagName(delEl);
        if (!BRANCH_CONTAINER_TAGS.has(delTag)) continue;

        const gatewayEl = nearestOwningGateway(delEl);
        if (!gatewayEl) continue;

        const gatewayOldPath = indexPathForNodeRelative(baseOld, gatewayEl);
        if (!gatewayOldPath) continue;

        const gatewayParent = parentPath(gatewayOldPath);
        const gatewayIdx = numericTail(gatewayOldPath);

        const proxyMoves = moves.filter(m => {
            if (consumedMoveKeys.has(moveKey(m))) return false;
            if (!isOneStepLeftShift(m)) return false;
            if (parentPath(m.oldPath) !== gatewayParent) return false;
            if (!sameDepth(m.oldPath, gatewayOldPath)) return false;

            const oldIdx = numericTail(m.oldPath);
            return oldIdx > gatewayIdx;
        });

        const proxyOldIdxs = proxyMoves
            .map(m => numericTail(m.oldPath))
            .filter(Number.isFinite);

        if (!proxyOldIdxs.length) continue;

        const gatewayNewIdx = Math.max(...proxyOldIdxs);
        const gatewayNewPath =
            gatewayParent === "/"
                ? `/${gatewayNewIdx}`
                : `${gatewayParent}/${gatewayNewIdx}`;

        if (gatewayNewPath !== gatewayOldPath) {
            resultMoves.push({
                kind: "move",
                oldPath: gatewayOldPath,
                newPath: gatewayNewPath,
                semantic: "implicit-container-proxy"
            });

            for (const m of proxyMoves) {
                consumedMoveKeys.add(moveKey(m));
            }

            console.error("NORMALIZE PROXY -> GATEWAY MOVE", {
                deletePath: del.oldPath,
                gatewayOldPath,
                gatewayNewPath,
                droppedProxyMoves: proxyMoves.map(m => ({ oldPath: m.oldPath, newPath: m.newPath }))
            });
        }
    }

    for (const m of moves) {
        if (consumedMoveKeys.has(moveKey(m))) continue;

        const oneStep = isOneStepLeftShift(m) || isOneStepRightShift(m);

        if (oneStep) {
            const proven = isProvenRealMove(m, {
                baseOld,
                baseNew,
                pairedByXm: true
            });

            const passive = isPassiveShiftArtifact(m, moves);

            if (!proven || passive) {
                console.error("DROP INDEX-SHIFT ARTIFACT", {
                    oldPath: m.oldPath,
                    newPath: m.newPath,
                    proven,
                    passive
                });
                continue;
            }
        }

        resultMoves.push({
            ...m,
            semantic: "explicit-real-move"
        });
    }

    return [...others, ...resultMoves];
}
