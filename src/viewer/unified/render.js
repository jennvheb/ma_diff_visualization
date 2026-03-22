function renderWithCpeeLayout(xmlString, targetSvgId) {
    const NS = "http://cpee.org/ns/description/1.0";

    const doc = new DOMParser().parseFromString(xmlString, "text/xml");

    let descEl = null;
    const hits = doc.getElementsByTagNameNS ? doc.getElementsByTagNameNS(NS, "description") : doc.getElementsByTagName("description");
    if (hits && hits.length) descEl = hits[hits.length - 1];

    if (!descEl) {
        console.error("[UNIFIED] renderWithCpeeLayout: no <description> found");
        return;
    }

    const descXml = new XMLSerializer().serializeToString(descEl);
    const descDoc = $.parseXML(descXml);

    const themeUrl = "../../cpee-layout/themes/preset/theme.js";

    new window.WfAdaptor(themeUrl, function (graph) {
        const $svg = $("#" + targetSvgId);

        graph.set_svg_container($svg);
        graph.set_label_container($("#layout-new"));
        graph.set_description($(descDoc), true);

        setTimeout(() => window.colorUnifiedSvg?.(), 0);
    });
}

export function renderUnifiedXml(xmlRoot) {
    const xmlStr = new XMLSerializer().serializeToString(xmlRoot);
    renderWithCpeeLayout(xmlStr, "graph-new");
}

export function getDescRoot(xmlStr) {
    const parser = new DOMParser();
    const NS = "http://cpee.org/ns/description/1.0";

    const doc = parser.parseFromString(xmlStr, "text/xml");
    const hits = doc.getElementsByTagNameNS
        ? doc.getElementsByTagNameNS(NS, "description")
        : doc.getElementsByTagName("description");

    return hits && hits.length ? hits[hits.length - 1] : null;
}
