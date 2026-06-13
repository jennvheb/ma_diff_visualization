import {DiffConfig} from '../../../../cpeediff/src/config/DiffConfig.js';
import {tagOf, getAttr, readTaskLabel} from "./EndpointAnchorMatcher.js";

/**
 * match old/new nodes by visible task label
 */
export class LabelAnchorMatcher {
    match(oldRoot, newRoot, matching) {
        if (!DiffConfig.MATCH_ANCHORS?.includes?.('label')) return;

        const collect = (root) => {
            const map = new Map(); // tag::label -> nodes[]
            for (const v of root.toPreOrderArray()) {
                if (matching.isMatched(v)) continue;
                const lab = readTaskLabel(v);
                if (!lab) continue;

                const key = `${tagOf(v)}::${lab}`;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(v);
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

            // ambiguous tag+label bucket: try id
            const Oid = groupById(olds);
            const Nid = groupById(news);

            for (const [id, oIdNodes] of Oid.entries()) {
                const nIdNodes = Nid.get(id);
                if (!nIdNodes || !oIdNodes.length || !nIdNodes.length) continue;

                if (oIdNodes.length === 1 && nIdNodes.length === 1) {
                    const o = oIdNodes[0], n = nIdNodes[0];
                    if (!matching.isMatched(o) && !matching.isMatched(n)) {
                        matching.matchNew(n, o);
                    }
                }
            }
            // remaining ambiguous nodes in this label bucket fall through
        }
    }
}