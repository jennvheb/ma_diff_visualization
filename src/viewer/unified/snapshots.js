import {isGatewayTagName, tagName} from "../../integration/stableIds.js";

/**
 * Returns attributes except helper ids
 *
 * @param el
 * @returns {{}}
 */
function cleanAttrs(el) {
    const out = {};
    if (!el || el.nodeType !== 1) return out;
    for (const a of Array.from(el.attributes || [])) {
        const k = a.name;
        if (k === "id" || k === "_orig_id" || k === "_ghost") continue;
        out[k] = a.value;
    }
    return out;
}

/**
 * Returns normalized text content, capped at 200 chars
 * Used for quick comparison
 * @param el
 * @returns {string|string}
 */
function textSig(el) {
    if (!el || el.nodeType !== 1) return "";
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > 200 ? t.slice(0, 200) + "…" : t;
}


/**
 * used for gateway updates (conditions, scripts, etc.)
 * useful for detecting gateway changes like branch structure or condition changes
 *
 * @param el
 * @returns {{childTags: *[], tag: *, id: (*|string|null), text: string, attrs: {}}|null}
 */
function nodeSummary(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = tagName(el);

    // immediate child structure (choose/parallel etc.)
    const childTags = Array.from(el.children || [])
        .filter((n) => n.nodeType === 1)
        .map((n) => tagName(n));
    return {
        tag,
        id: el.getAttribute("id") || null,
        attrs: cleanAttrs(el),
        childTags,
        text: textSig(el),
    };
}

/**
 * Used for task updates (call/manipulate/stop)
 * extracts meaningful CPEE fields
 * So a task update can be explained more meaningfully
 *
 * @param el
 * @returns {{endpoint: (*|string), notes: *, method: *, arguments: *, tag: *, id: (*|string|null), label: *, text: string, parameters: *, script: (*|null), attrs: {}}|null}
 */
function taskSummary(el) {
    if (!el || el.nodeType !== 1) return null;

    const tag = tagName(el);

    const pickText = (q) => {
        const n = el.querySelector(q);
        const t = (n?.textContent || "").replace(/\s+/g, " ").trim();
        return t || null;
    };

    const endpointAttr = el.getAttribute("endpoint") || null;
    const labelText = pickText("parameters > label, label");
    const methodText = pickText("parameters > method, method");
    const paramsText = pickText("parameters");
    const argsText   = pickText("arguments");

    const codeText = pickText("code");
    const finalizeText = pickText("code > finalize, finalize");
    const notesText = pickText("_notes");
    const customizationText = pickText("customization");
    const annotationsText = pickText("annotations");

    return {
        tag,
        id: el.getAttribute("id") || null,
        attrs: cleanAttrs(el),

        endpoint: endpointAttr,
        label: labelText,
        method: methodText,

        parameters: paramsText,
        arguments: argsText,

        script: codeText || finalizeText || null,
        notes: notesText,

        text: textSig(el),
    };
}

/**
 * Chooses the correct summary type
 *
 * @param node
 * @returns {{endpoint: (*|string), notes: *, method: *, arguments: *, tag: *, id: (*|string|null), label: *, text: string, parameters: *, script: (*|null), attrs: {}}|null|{childTags: *[], tag: *, id: (*|string|null), text: string, attrs: {}}}
 */
export function snapshotForNode(node) {
    if (!node) return null;
    const t = tagName(node);
    if (isGatewayTagName(t)) return nodeSummary(node);
    if (t === "call" || t === "manipulate" || t === "stop") return taskSummary(node);
    return null;
}

/**
 * Compares two snapshots
 * detects if change is meaningful
 * filters noise
 *
 * @param oldS
 * @param newS
 * @returns {{new, kind: string}|{notesChanged: boolean, attrChanges: *[], labelChanged: boolean, scriptChanged: boolean, textChanged: boolean, childTagsChanged: boolean, endpointChanged: boolean, parametersChanged: boolean}|{kind: string, old}|null}
 */
export function diffSummaries(oldS, newS) {
    if (!oldS && !newS) return null;
    if (!oldS) return { kind: "added", new: newS };
    if (!newS) return { kind: "removed", old: oldS };

    const attrChanges = [];
    const keys = new Set([...Object.keys(oldS.attrs || {}), ...Object.keys(newS.attrs || {})]);
    for (const k of keys) {
        const a = oldS.attrs?.[k];
        const b = newS.attrs?.[k];
        if (a !== b) attrChanges.push({ key: k, old: a ?? null, new: b ?? null });
    }

    const childTagsChanged =
        (oldS.childTags || []).join(",") !== (newS.childTags || []).join(",");


    const textChanged = (oldS.text || "") !== (newS.text || "");

    // also allow task fields to be checked without overdoing it
    const labelChanged = (oldS.label ?? null) !== (newS.label ?? null);
    const endpointChanged = (oldS.endpoint ?? null) !== (newS.endpoint ?? null);
    const scriptChanged = (oldS.script ?? null) !== (newS.script ?? null);
    const parametersChanged = (oldS.parameters ?? null) !== (newS.parameters ?? null);
    const notesChanged =
        (oldS.notes ?? null) !== (newS.notes ?? null);

    return {
        attrChanges,
        childTagsChanged,
        textChanged,
        labelChanged,
        endpointChanged,
        scriptChanged,
        parametersChanged,
        notesChanged
    };
}

export function isMeaningfulUpdate(contentOld, contentNew) {
    if (!contentOld || !contentNew) return true;

    const d = diffSummaries(contentOld, contentNew);
    if (!d) return false;

    const tag = contentOld.tag || contentNew.tag;

    const hasAttrChanges = (d.attrChanges || []).length > 0;

    //  tasks: only count key fields
    const taskChanged =
        d.labelChanged ||
        d.endpointChanged ||
        d.parametersChanged ||
        d.scriptChanged ||
        d.notesChanged ||
        //    d.customizationChanged ||
        //    d.annotationsChanged ||
        d.attrChanges?.some?.(x =>
            ["endpoint", "label", "method"].includes(x.key)
        ) || false;
    // If *only* label/endpoint/method:
    // const taskChanged = d.labelChanged || d.endpointChanged;

    const gatewayChanged =
        d.childTagsChanged || hasAttrChanges || d.textChanged;

    if (tag === "call" || tag === "manipulate" || tag === "stop") return taskChanged;
    return gatewayChanged;
}
