import {DiffConfig} from '../../../../cpeediff/src/config/DiffConfig.js';

// given a tree node, try to extract the tag (call, manipulate, parallel_branch, parameters, etc)
export const tagOf = v => (v?.label ?? '').toLowerCase();

// return the attribute value from the CPEE node or null
export const getAttr = (node, name) => node?.attributes?.get?.(name) ?? null;

// to make matching easier (and prevent mismatches) cast urls to string and trim whitespace
const normalizeUrl = (s) => {
    return String(s ?? '').trim();
};

// if there are n:n same endpoints, use the label as second step to disambiguate, otherwise fall through
// gateways usually have the label stored as a direct attribute, whereas nodes have labels stored inside parameters
export function readTaskLabel(node) {
    const a = getAttr(node, 'label');

    if (a && String(a).trim() && String(a).toLowerCase() !== 'nan') { // ignore invalid labels like 'nan'
        return String(a).trim();
    }
    for (const p of node?.children ?? []) { // if nothing could be extracted from the label attribute, search the parameters
        if (tagOf(p) !== 'parameters') continue;
        for (const c of p?.children ?? []) {
            if (tagOf(c) === 'label') {
                const t = c.text ?? c.value ?? c.textContent;
                if (t && String(t).trim()) return String(t).trim();
            }
        }
    }
    return null;
}

/**
 * matches old/new nodes by endpoint URL
 */
export class EndpointAnchorMatcher {
    match(oldRoot, newRoot, matching) {
        if (!DiffConfig.MATCH_ANCHORS?.includes?.('endpoint')) return;

        const keyAttr = 'endpoint';

        const collect = (root) => { // collects unmatched nodes in buckets
            const buckets = new Map();
            for (const v of root.toPreOrderArray()) {
                if (matching.isMatched(v)) continue;
                const ep = normalizeUrl(getAttr(v, keyAttr));
                if (!ep) continue;

                const key = `${tagOf(v)}::${ep}`;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push(v);
            }
            return buckets;
        };

        const groupByLabel = (nodes) => {
            const map = new Map();
            for (const n of nodes) {
                const raw = readTaskLabel(n);
                if (!raw) continue;
                if (!map.has(raw)) map.set(raw, []);
                map.get(raw).push(n);
            }
            return map;
        };

        const groupById = (nodes) => {
            const map = new Map(); // id -> nodes[]
            for (const n of nodes) {
                const id = getAttr(n, 'id');
                if (!id) continue; // no id -> cannot resolve ambiguity here
                if (!map.has(id)) map.set(id, []);
                map.get(id).push(n);
            }
            return map;
        };

        const Omap = collect(oldRoot);
        const Nmap = collect(newRoot);

        for (const [key, olds] of Omap.entries()) {
            const news = Nmap.get(key);
            if (!news || !olds.length || !news.length) continue;

            // Step 1: strict tag+endpoint 1:1
            if (olds.length === 1 && news.length === 1) {
                const o = olds[0], n = news[0];
                if (!matching.isMatched(o) && !matching.isMatched(n)) {
                    matching.matchNew(n, o);
                }
                continue;
            }

            // Step 2: ambiguous tag+endpoint bucket -> try id FIRST
            const oldById = groupById(olds);
            const newById = groupById(news);

            for (const [idKey, Oid] of oldById.entries()) {
                const Nid = newById.get(idKey);
                if (!Nid || !Oid.length || !Nid.length) continue;

                if (Oid.length === 1 && Nid.length === 1) {
                    const o = Oid[0], n = Nid[0];
                    if (!matching.isMatched(o) && !matching.isMatched(n)) {
                        matching.matchNew(n, o);
                    }
                }
            }

            // Step 3: remaining ambiguous tag+endpoint bucket -> try label
            const oldRemaining = olds.filter(o => !matching.isMatched(o));
            const newRemaining = news.filter(n => !matching.isMatched(n));

            const oldByLabel = groupByLabel(oldRemaining);
            const newByLabel = groupByLabel(newRemaining);

            for (const [labelKey, Olabel] of oldByLabel.entries()) {
                const Nlabel = newByLabel.get(labelKey);
                if (!Nlabel || !Olabel.length || !Nlabel.length) continue;

                if (Olabel.length === 1 && Nlabel.length === 1) {
                    const o = Olabel[0], n = Nlabel[0];
                    if (!matching.isMatched(o) && !matching.isMatched(n)) {
                        matching.matchNew(n, o);
                    }
                }

                // any remaining ambiguous nodes fall through
            }

            // any remaining ambiguous olds/news for this endpoint bucket fall through
        }
    }
}
