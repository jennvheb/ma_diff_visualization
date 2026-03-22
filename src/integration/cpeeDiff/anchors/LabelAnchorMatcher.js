import {DiffConfig} from '../../../../cpeediff/src/config/DiffConfig.js';
import {tagOf, getAttr, readTaskLabel} from "./EndpointAnchorMatcher.js";

export class LabelAnchorMatcher {
    match(oldRoot, newRoot, matching) {
        if (!DiffConfig.MATCH_ANCHORS?.includes?.('label')) return;

        const collect = (root) => {
            const map = new Map(); // tag::label -> nodes[]
            for (const v of root.toPreOrderArray()) {
                if (matching.isMatched(v)) continue;
                const lab = readTaskLabel(v);
                if (!lab) continue;

                //  const key = `${tagOf(v)}::${norm(lab)}`;
                const key = `${tagOf(v)}::${lab}`;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(v);
            }
            return map;
        };

        const groupByEndpoint = (nodes) => {
            const map = new Map(); // endpoint -> nodes[]
            for (const v of nodes) {
                const epRaw = getAttr(v, 'endpoint');
                const ep = epRaw ? String(epRaw).trim() : '';
                if (!ep) continue; // no endpoint -> fall through, do not resolve here

                if (!map.has(ep)) map.set(ep, []);
                map.get(ep).push(v);
            }
            return map;
        };

        const groupById = (nodes) => {
            const map = new Map(); // id -> nodes[]
            for (const v of nodes) {
                const id = getAttr(v, 'id');
                if (!id) continue; // no id -> cannot resolve ambiguity here

                if (!map.has(id)) map.set(id, []);
                map.get(id).push(v);
            }
            return map;
        };

        const Omap = collect(oldRoot);
        const Nmap = collect(newRoot);

        for (const [key, olds] of Omap.entries()) {
            const news = Nmap.get(key);
            if (!news || !olds.length || !news.length) continue;

            // strict tag+label 1:1
            if (olds.length === 1 && news.length === 1) {
                const o = olds[0], n = news[0];
                if (!matching.isMatched(o) && !matching.isMatched(n)) {
                    matching.matchNew(n, o);
                }
                continue;
            }

            // ambiguous tag+label bucket: try to resolve by real endpoint
            const Oep = groupByEndpoint(olds);
            const Nep = groupByEndpoint(news);

            for (const [ep, oNodes] of Oep.entries()) {
                const nNodes = Nep.get(ep);
                if (!nNodes || !oNodes.length || !nNodes.length) continue;

                // only resolve ambiguity when endpoint itself becomes unique
                if (oNodes.length === 1 && nNodes.length === 1) {
                    const o = oNodes[0], n = nNodes[0];
                    if (!matching.isMatched(o) && !matching.isMatched(n)) {
                        matching.matchNew(n, o);
                    }
                    continue;
                }

                const Oid = groupById(oNodes);
                const Nid = groupById(nNodes);

                for (const [id, oIdNodes] of Oid.entries()) {
                    const nIdNodes = Nid.get(id);
                    if (!nIdNodes || !oIdNodes.length || !nIdNodes.length) continue;

                    // id resolved ambiguity uniquely
                    if (oIdNodes.length === 1 && nIdNodes.length === 1) {
                        const o = oIdNodes[0], n = nIdNodes[0];
                        if (!matching.isMatched(o) && !matching.isMatched(n)) {
                            matching.matchNew(n, o);
                        }
                    }
                    // else still ambiguous -> fall through
                }
                // remaining ambiguous nodes in this endpoint bucket fall through
            }
            // remaining ambiguous nodes in this label bucket fall through
        }
    }
}