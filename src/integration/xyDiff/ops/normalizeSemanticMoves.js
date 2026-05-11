import {
    elementByRelIndexPath,
    indexPathForNodeRelative,
    numericTail,
    parentPath,
    sameDepth
} from "../dom/pathUtils.js";
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

function moveKey(m) {
    return `${m.oldPath}=>${m.newPath}`;
}

function getMoveIdentityEvidence(m, { baseOld, baseNew, pairedByXm = false }) {
    if (!m?.oldPath || !m?.newPath) {
        return {
            score: -100,
            sameTag: false,
            sameId: false,
            sameSignature: false,
            oldId: null,
            newId: null
        };
    }

    const oldEl = elementByRelIndexPath(baseOld, m.oldPath);
    const newEl = elementByRelIndexPath(baseNew, m.newPath);

    if (!oldEl || !newEl) {
        return {
            score: -100,
            sameTag: false,
            sameId: false,
            sameSignature: false,
            oldId: null,
            newId: null
        };
    }

    const oldTag = tagName(oldEl);
    const newTag = tagName(newEl);
    const sameTag = oldTag === newTag;

    const oldId = oldEl.getAttribute?.("id") || null;
    const newId = newEl.getAttribute?.("id") || null;
    const sameId = !!oldId && !!newId && oldId === newId;

    const oldSig = signatureForDrawable(baseOld, m.oldPath);
    const newSig = signatureForDrawable(baseNew, m.newPath);
    const sameSignature = !!oldSig && !!newSig && oldSig === newSig;

    let score = 0;

    if (sameTag) score += 1;
    if (sameId) score += 8;
    if (sameSignature) score += 6;
    if (pairedByXm) score += 2;

    return {
        score,
        sameTag,
        sameId,
        sameSignature,
        oldId,
        newId
    };
}

function getMovePassiveEvidence(m, moves, deletes) {
    if (!m?.oldPath || !m?.newPath) {
        return {
            score: 0,
            reasons: []
        };
    }

    const reasons = [];
    let score = 0;

    const myParentOld = parentPath(m.oldPath);
    const myParentNew = parentPath(m.newPath);
    const myOldIdx = numericTail(m.oldPath);

    const oneStepLeft = isOneStepLeftShift(m);
    const oneStepRight = isOneStepRightShift(m);

    if (!oneStepLeft && !oneStepRight) {
        return { score: 0, reasons };
    }

    score += 1;
    reasons.push("one-step-shift");

    for (const del of deletes || []) {
        if (!del?.oldPath) continue;
        if (parentPath(del.oldPath) !== myParentOld) continue;
        if (!sameDepth(del.oldPath, m.oldPath)) continue;

        const delIdx = numericTail(del.oldPath);
        if (!Number.isFinite(delIdx)) continue;

        if (oneStepLeft && delIdx < myOldIdx) {
            score += 4;
            reasons.push(`delete-before@${delIdx}`);
        }

        if (oneStepRight && delIdx > myOldIdx) {
            score += 4;
            reasons.push(`delete-after@${delIdx}`);
        }
    }

    for (const other of moves || []) {
        if (other === m) continue;
        if (!other?.oldPath || !other?.newPath) continue;
        if (parentPath(other.oldPath) !== myParentOld) continue;
        if (parentPath(other.newPath) !== myParentNew) continue;
        if (!sameDepth(other.oldPath, m.oldPath)) continue;

        const oOld = numericTail(other.oldPath);
        const oNew = numericTail(other.newPath);
        if (!Number.isFinite(oOld) || !Number.isFinite(oNew)) continue;

        // direct neighboring follower pattern:
        // other 1->0 and me 2->1  => me is probably passive
        if (oneStepLeft && oOld === myOldIdx - 1 && oNew === oOld - 1) {
            score += 5;
            reasons.push(`follows-left-neighbor@${oOld}->${oNew}`);
        }

        if (oneStepRight && oOld === myOldIdx + 1 && oNew === oOld + 1) {
            score += 5;
            reasons.push(`follows-right-neighbor@${oOld}->${oNew}`);
        }

        // broader crossing explanation
        const crossesMe =
            (oOld < myOldIdx && oNew >= myOldIdx) ||
            (oOld > myOldIdx && oNew <= myOldIdx);

        if (crossesMe) {
            score += 3;
            reasons.push(`crossed-by@${oOld}->${oNew}`);
        }
    }

    return { score, reasons };
}

function sameLocalNeighborhood(a, b) {
    if (!a?.oldPath || !a?.newPath || !b?.oldPath || !b?.newPath) return false;
    if (parentPath(a.oldPath) !== parentPath(b.oldPath)) return false;
    if (parentPath(a.newPath) !== parentPath(b.newPath)) return false;
    if (!sameDepth(a.oldPath, b.oldPath)) return false;

    return true;
}

function chooseWinnersAmongSiblingShifts(moves, { baseOld, baseNew, deletes }) {
    const out = [];
    const consumed = new Set();

    for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const keyM = moveKey(m);
        if (consumed.has(keyM)) continue;

        const isShiftM = isOneStepLeftShift(m) || isOneStepRightShift(m);
        if (!isShiftM) {
            out.push(m);
            consumed.add(keyM);
            continue;
        }

        const cluster = moves.filter(x => {
            if (consumed.has(moveKey(x))) return false;
            const isShiftX = isOneStepLeftShift(x) || isOneStepRightShift(x);
            if (!isShiftX) return false;
            return sameLocalNeighborhood(m, x);
        });

        if (cluster.length <= 1) {
            out.push(m);
            consumed.add(keyM);
            continue;
        }

        const scored = cluster.map(x => {
            const ident = getMoveIdentityEvidence(x, {
                baseOld,
                baseNew,
                pairedByXm: false
            });

            const passive = getMovePassiveEvidence(x, cluster, deletes);

            // higher is better
            const finalScore = ident.score - passive.score;

            return {
                move: x,
                key: moveKey(x),
                ident,
                passive,
                finalScore
            };
        });

        scored.sort((a, b) => {
            if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
            if (b.ident.score !== a.ident.score) return b.ident.score - a.ident.score;

            // tie-breaker only if genuinely tied:
            // prefer stable-id move, then lower old index
            if ((b.ident.sameId ? 1 : 0) !== (a.ident.sameId ? 1 : 0)) {
                return (b.ident.sameId ? 1 : 0) - (a.ident.sameId ? 1 : 0);
            }

            return numericTail(a.move.oldPath) - numericTail(b.move.oldPath);
        });

        const winner = scored[0];
        out.push({
            ...winner.move,
            semantic: "explicit-real-move"
        });

        console.error("move cluster", {
            cluster: scored.map(s => ({
                oldPath: s.move.oldPath,
                newPath: s.move.newPath,
                identScore: s.ident.score,
                passiveScore: s.passive.score,
                passiveReasons: s.passive.reasons,
                finalScore: s.finalScore,
                sameId: s.ident.sameId,
                sameSignature: s.ident.sameSignature
            })),
            winner: {
                oldPath: winner.move.oldPath,
                newPath: winner.move.newPath
            }
        });

        for (const s of scored) {
            consumed.add(s.key);
        }
    }

    return out;
}

export function normalizeSemanticMoves({ ops, baseOld, baseNew }) {
    const deletes = ops.filter(o => o.kind === "delete" && o.oldPath);
    const moves = ops.filter(o => o.kind === "move" && o.oldPath && o.newPath);
    const others = ops.filter(o => o.kind !== "move");

    const resultMoves = [];
    const consumedMoveKeys = new Set();

    // existing proxy-to-gateway normalization
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
                droppedProxyMoves: proxyMoves.map(m => ({
                    oldPath: m.oldPath,
                    newPath: m.newPath
                }))
            });
        }
    }

    const remainingMoves = moves.filter(m => !consumedMoveKeys.has(moveKey(m)));

    // split into one-step sibling shifts and everything else
    const shiftMoves = remainingMoves.filter(m =>
        isOneStepLeftShift(m) || isOneStepRightShift(m)
    );

    const nonShiftMoves = remainingMoves.filter(m =>
        !(isOneStepLeftShift(m) || isOneStepRightShift(m))
    );

    for (const m of nonShiftMoves) {
        resultMoves.push({
            ...m,
            semantic: "explicit-real-move"
        });
    }

    const resolvedShiftMoves = chooseWinnersAmongSiblingShifts(shiftMoves, {
        baseOld,
        baseNew,
        deletes
    });

    resultMoves.push(...resolvedShiftMoves);

    return [...others, ...resultMoves];
}