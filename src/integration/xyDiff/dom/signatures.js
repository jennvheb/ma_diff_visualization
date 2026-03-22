import {indexPathForNodeRelative} from "./pathUtils.js";
import {findFirstElementById} from "./domUtils.js";
import {DIFF_BOUNDARY_TAGS} from "../../tags.js";
import {drawableElAt} from "./drawableUtils.js";
import {tagName} from "../../stableIds.js";

function endpointText(el) {
    const hit = el?.querySelector?.("endpoint");
    const t = hit ? String(hit.textContent || "").replace(/\s+/g, " ").trim() : "";
    return t || "";
}

export function getDrawableId(el) {
    const id = el?.getAttribute?.("id");
    return id ? String(id) : null;
}

export function drawableGuardSignature(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = tagName(el);

    const labelAttr = el.getAttribute?.("label") || "";
    const ep = (tag === "call") ? (el.getAttribute?.("endpoint") || "") : endpointText(el);

    return `g:${tag}|lbl:${labelAttr}|ep:${ep}`;
}

export function signatureForDrawable(baseElem, relPath) {
    const el = drawableElAt(baseElem, relPath);
    if (!el) return null;

    const tag = (el.localName || el.tagName || "").toLowerCase();
    const id = el.getAttribute?.("id") || "";
    const label = el.getAttribute?.("label") || "";
    const ep = endpointText(el);

    // only treat REAL ids as stable
    if (id && !isSyntheticGatewayId(id)) return `id:${id}`;

    // next: semantic anchors
    if (label || ep) return `tle:${tag}|${label}|${ep}`;

    // last resort: tag + stable attributes (excluding id)
    const attrs = [];
    if (el.attributes) {
        for (let i = 0; i < el.attributes.length; i++) {
            const a = el.attributes.item(i);
            if (!a) continue;
            if (a.name === "id") continue;
            attrs.push(`${a.name}=${a.value}`);
        }
    }
    attrs.sort();
    return `tagattrs:${tag}|${attrs.join("&")}`;
}

function isSyntheticGatewayId(id) {
    return typeof id === "string" && id.startsWith("__gw_");
}

// if an id is reused, guard signature will differ and null is returned
// FIXME
export function mapOldDrawableToNew(oldDrawableEl, newById) {
    const id = getDrawableId(oldDrawableEl);
    if (!id) return null;

    const hit = newById.get(id);
    if (!hit) return null;

    const gOld = drawableGuardSignature(oldDrawableEl);
    const gNew = drawableGuardSignature(hit);

    return (gOld && gNew && gOld === gNew) ? hit : null;
}

export function findDrawableRelPathBySignature(baseElem, sig) {
    if (!baseElem || !sig) return null;

    if (sig.startsWith("id:")) {
        const id = sig.slice(3);
        const hit = findFirstElementById(baseElem, id);
        return hit ? indexPathForNodeRelative(baseElem, hit) : null;
    }


    // fallback: scan all drawables and compare computed signatures
    const stack = [baseElem];
    while (stack.length) {
        const n = stack.pop();
        if (n.nodeType !== 1) continue;

        const tag = (n.localName || n.tagName || "").toLowerCase();
        if (DIFF_BOUNDARY_TAGS.has(tag)) {
            const rel = indexPathForNodeRelative(baseElem, n);
            if (rel) {
                const s = signatureForDrawable(baseElem, rel);
                if (s === sig) return rel;
            }
        }

        for (let i = n.childNodes.length - 1; i >= 0; i--) {
            const c = n.childNodes[i];
            if (c.nodeType === 1) stack.push(c);
        }
    }

    return null;
}

export function buildDrawableIndexById(baseElem) {
    const map = new Map(); // id -> element
    const stack = [baseElem];
    while (stack.length) {
        const n = stack.pop();
        if (!n || n.nodeType !== 1) continue;

        const t = tagName(n);
        if (DIFF_BOUNDARY_TAGS.has(t)) {
            const id = getDrawableId(n);
            if (id) map.set(id, n);
        }

        for (let i = n.childNodes.length - 1; i >= 0; i--) {
            const c = n.childNodes[i];
            if (c?.nodeType === 1) stack.push(c);
        }
    }
    return map;
}
