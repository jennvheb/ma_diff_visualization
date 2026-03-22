import {DiffConfig} from '../../../../cpeediff/src/config/DiffConfig.js';

// given a tree node, try to extract the label (call, parallel_branch, parameters, etc)
export const tagOf = v => (v?.label ?? '').toLowerCase();

// return the endpoint attribute value or null
export const getAttr = (node, name) => node?.attributes?.get?.(name) ?? null;

// to make matching easier (and prevent mismatches) cast urls to string and trim whitespace
const normalizeUrl = (s) => {
    return String(s ?? '').trim();
};

// if there are n:n same endpoints, use the label as second step to disambiguate, otherwise fall through
export function readTaskLabel(node) {
    const a = getAttr(node, 'label');
   // if (a && String(a).trim()) return String(a).trim();
    if (a && String(a).trim() && String(a).toLowerCase() !== 'nan') {
        return String(a).trim();
    }
    for (const p of node?.children ?? []) {
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

export class EndpointAnchorMatcher {
    match(oldRoot, newRoot, matching) {
        if (!DiffConfig.MATCH_ANCHORS?.includes?.('endpoint')) return;

        const keyAttr = 'endpoint';

        const collect = (root) => {
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
                if (!raw) continue; // or allow __NO_LABEL__ if you want
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

            // Step 2: ambiguous tag+endpoint bucket -> try label
            const oldByLabel = groupByLabel(olds);
            const newByLabel = groupByLabel(news);

            for (const [labelKey, Olabel] of oldByLabel.entries()) {
                const Nlabel = newByLabel.get(labelKey);
                if (!Nlabel || !Olabel.length || !Nlabel.length) continue;

                // label resolved ambiguity uniquely
                if (Olabel.length === 1 && Nlabel.length === 1) {
                    const o = Olabel[0], n = Nlabel[0];
                    if (!matching.isMatched(o) && !matching.isMatched(n)) {
                        matching.matchNew(n, o);
                    }
                    continue;
                }

                // Step 3: still ambiguous inside same endpoint+label bucket -> try id
                const oldById = groupById(Olabel);
                const newById = groupById(Nlabel);

                for (const [idKey, Oid] of oldById.entries()) {
                    const Nid = newById.get(idKey);
                    if (!Nid || !Oid.length || !Nid.length) continue;

                    // id resolved ambiguity uniquely
                    if (Oid.length === 1 && Nid.length === 1) {
                        const o = Oid[0], n = Nid[0];
                        if (!matching.isMatched(o) && !matching.isMatched(n)) {
                            matching.matchNew(n, o);
                        }
                    }

                    // else still ambiguous -> fall through
                }

                // any remaining ambiguous nodes fall through
            }

            // any remaining ambiguous olds/news for this endpoint bucket fall through
        }
    }
}
