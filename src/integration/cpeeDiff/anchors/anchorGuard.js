import {DiffConfig} from '../../../../cpeediff/src/config/DiffConfig.js';
import {tagOf, getAttr, readTaskLabel} from './EndpointAnchorMatcher.js';

const DRAWABLE_TAGS = new Set([
    'call',
    'manipulate',
    'loop',
    'choose',
    'parallel',
    'stop',
    'alternative',
    'otherwise',
    'parallel_branch',
]);

function isDrawable(node) {
    return DRAWABLE_TAGS.has(tagOf(node));
}

function selectedSingleAnchor() {
    const a = DiffConfig.MATCH_ANCHORS || [];
    return a.length === 1 ? a[0] : null;
}

function anchorValue(node, anchor) {
    if (!node) return null;

    if (anchor === 'id') {
        const id = getAttr(node, 'id');
        return id ? String(id).trim() : null;
    }

    if (anchor === 'endpoint') {
        const ep = getAttr(node, 'endpoint');
        return ep ? String(ep).trim() : null;
    }

    if (anchor === 'label') {
        const lab = readTaskLabel(node);
        return lab ? String(lab).trim() : null;
    }

    return null;
}

export function allowFallbackMatch(oldNode, newNode) {
    const anchor = selectedSingleAnchor();
    if (!anchor) return true;

    if (!isDrawable(oldNode) || !isDrawable(newNode)) return true;

    const oldVal = anchorValue(oldNode, anchor);
    const newVal = anchorValue(newNode, anchor);

    // Important: only block when both sides actually have that anchor.
    // If one side has no label/endpoint/id, continue as normal (let CPEEDiff behave normally).
    if (!oldVal || !newVal) return true;

    return oldVal === newVal;
}