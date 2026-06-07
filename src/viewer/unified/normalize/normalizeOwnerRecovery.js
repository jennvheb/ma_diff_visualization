import {firstKRealTaskIds, gatewayStructureSig, tagName} from "../../../integration/stableIds.js";
import {atPath, nodeAtPath, findById} from "../xml.js";

export function isGatewayLike(node) {
    if (!node) return false;
    const t = tagName(node);
    return (
        t === "choose" ||
        t === "parallel" ||
        t === "loop" ||
        t === "alternative" ||
        t === "otherwise" ||
        t === "parallel_branch"
    );
}

/**
 * If a path points too deep or to a non-task child, climb path prefixes until a task is found
 *
 * @param root
 * @param path
 * @param isXy
 * @returns {*|null}
 */
export function nearestTaskFromPathPrefix(root, path, isXy) {
    if (!root || !path) return null;

    const parts = String(path).split("/").filter(Boolean);

    while (parts.length > 0) {
        const p = "/" + parts.join("/");
        const n = atPath(root, p, isXy) || nodeAtPath(root, p);

        if (n && n.nodeType === 1) {
            let cur = n;
            while (cur && cur.nodeType === 1) {
                const t = tagName(cur);
                if (t === "call" || t === "manipulate" || t === "stop") {
                    return cur;
                }
                cur = cur.parentNode;
            }
        }

        parts.pop();
    }

    return null;
}

/**
 * Tries to find the corresponding gateway in the NEW tree
 * Because gateways often have synthetic ids that can change
 * This is used when ownerNew cannot be found by id/path
 *
 * @param oldOwner
 * @param newRoot
 * @returns {unknown|null}
 */
export function recoverGatewayOwnerNew(oldOwner, newRoot) {
    if (!oldOwner || !newRoot) return null;

    const oldTag = tagName(oldOwner);
    const oldStruct = gatewayStructureSig(oldOwner);
    const oldWitnesses = firstKRealTaskIds(oldOwner, 3);

    // strongest fallback: find first witness in NEW, then climb to same gateway tag
    for (const wid of oldWitnesses || []) {
        const witnessNew = findById(newRoot, wid);
        if (!witnessNew) continue;

        let cur = witnessNew;
        while (cur) {
            if (cur.nodeType === 1 && tagName(cur) === oldTag) {
                const struct = gatewayStructureSig(cur);
                if (struct === oldStruct) return cur;
            }
            cur = cur.parentNode;
        }
    }

    // broader fallback: scan all gateways of same tag and same structure
    const all = Array.from(newRoot.getElementsByTagName("*"));
    for (const el of all) {
        if (tagName(el) !== oldTag) continue;
        if (gatewayStructureSig(el) !== oldStruct) continue;

        const w = firstKRealTaskIds(el, 3);
        if (JSON.stringify(w || []) === JSON.stringify(oldWitnesses || [])) {
            return el;
        }
    }

    // weakest fallback: same tag only + at least one witness overlap
    for (const el of all) {
        if (tagName(el) !== oldTag) continue;

        const w = firstKRealTaskIds(el, 3);
        const overlap = (w || []).some(id => (oldWitnesses || []).includes(id));
        if (overlap) return el;
    }

    return null;
}

/**
 * Concatenates possible update payload fields into one searchable string
 * Used only for classification
 *
 * @param op
 * @returns {string}
 */
function updatePayloadText(op) {
    return [
        op.payloadTag,
        op.payloadText,
        op.payloadXml,
        op.newValue,
        op.value,
        op.text,
        op.meta?.newValue,
        op.meta?.text,
        op.meta?.kind
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
}

export function updateLooksLikeTaskText(op) {
    const s = updatePayloadText(op);
    return /label|urls|url|method|arguments|parameters|_text|newValue/i.test(s);
}