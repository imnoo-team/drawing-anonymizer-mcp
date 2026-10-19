import { CATEGORIES, MaskBox, MaskCategory, MaskSettings, PageGeometry, categoryLabel } from './mask-model';
export interface CategoryCoverage {
    type: MaskCategory;
    label: string;
    total: number;
    masked: number;
    visible: number;
    lowConfidence: number;
}
export interface CoverageReport {
    pages: number;
    pagesWithMasks: number;
    totalDetections: number;
    masked: number;
    visible: number;
    byCategory: CategoryCoverage[];
    customTerms: {
        term: string;
        count: number;
    }[];
    manualBoxes: number;
    secure: boolean;
    metadataScrubbed: boolean;
    metadataFound: string[];
    score: number;
    warnings: string[];
}
const IDENTIFYING: MaskCategory[] = CATEGORIES.filter(c => c.defaultOn).map(c => c.type);
export function buildCoverageReport(boxes: MaskBox[], settings: MaskSettings, pages: PageGeometry[], metadataFound: string[] = []): CoverageReport {
    const byCategory: CategoryCoverage[] = CATEGORIES.map(info => {
        const own = boxes.filter(b => b.category === info.type && b.source === 'analysis');
        const masked = own.filter(b => b.masked);
        return {
            type: info.type,
            label: info.label,
            total: own.length,
            masked: masked.length,
            visible: own.length - masked.length,
            lowConfidence: masked.filter(b => b.score < 0.6).length,
        };
    }).filter(c => c.total > 0);
    const analysisBoxes = boxes.filter(b => b.source === 'analysis');
    const terms = new Map<string, number>();
    for (const b of boxes)
        if (b.source === 'text' && b.term)
            terms.set(b.term, (terms.get(b.term) ?? 0) + 1);
    const identifying = analysisBoxes.filter(b => IDENTIFYING.includes(b.category));
    const identifyingMasked = identifying.filter(b => b.masked).length;
    const coverage = identifying.length ? identifyingMasked / identifying.length : 1;
    const opaque = settings.maskOpacity >= 100;
    const warnings: string[] = [];
    if (!opaque)
        warnings.push('Mask opacity is below 100 % — covered text stays readable.');
    if (!settings.secureDownload)
        warnings.push('Secure download is off — the layered PDF keeps the original text under the masks.');
    if (!settings.scrubMetadata && metadataFound.length)
        warnings.push('Document metadata is kept: ' + metadataFound.join(', '));
    if (settings.detectionScope === 'titleBlock')
        warnings.push('Detection scope is the title block only — detections elsewhere on the sheet were left unmasked.');
    const visibleIdentifying = identifying.length - identifyingMasked;
    if (visibleIdentifying > 0)
        warnings.push(`${visibleIdentifying} identifying detection${visibleIdentifying === 1 ? '' : 's'} left visible.`);
    const lowConfidence = byCategory.reduce((n, c) => n + c.lowConfidence, 0);
    if (lowConfidence > 0)
        warnings.push(`${lowConfidence} low-confidence detection${lowConfidence === 1 ? '' : 's'} — check their boxes cover the whole text.`);
    const score = Math.round(coverage * 60 +
        (settings.secureDownload ? 25 : 0) +
        (settings.scrubMetadata || !metadataFound.length ? 10 : 0) +
        (opaque ? 5 : 0));
    const maskedPages = new Set(boxes.filter(b => b.masked).map(b => b.pageNr));
    return {
        pages: pages.length,
        pagesWithMasks: maskedPages.size,
        totalDetections: analysisBoxes.length,
        masked: analysisBoxes.filter(b => b.masked).length,
        visible: analysisBoxes.filter(b => !b.masked).length,
        byCategory,
        customTerms: [...terms.entries()].map(([term, count]) => ({ term, count })),
        manualBoxes: boxes.filter(b => b.source === 'manual' && b.masked && !b.stamp).length,
        secure: settings.secureDownload,
        metadataScrubbed: settings.scrubMetadata,
        metadataFound,
        score: Math.max(0, Math.min(100, score)),
        warnings,
    };
}
export function reportLines(report: CoverageReport, fileName: string): string[] {
    const lines: string[] = [];
    lines.push(`Drawing: ${fileName}`);
    lines.push(`Pages: ${report.pages} (${report.pagesWithMasks} with masks)`);
    lines.push(`Anonymity score: ${report.score} / 100`);
    lines.push(`Detections: ${report.totalDetections} — ${report.masked} masked, ${report.visible} visible`);
    for (const c of report.byCategory) {
        lines.push(`  ${c.label}: ${c.masked} of ${c.total} masked${c.visible ? ` (${c.visible} visible)` : ''}`);
    }
    if (report.customTerms.length) {
        lines.push('Custom text masks: ' + report.customTerms.map(t => `"${t.term}" ×${t.count}`).join(', '));
    }
    if (report.manualBoxes)
        lines.push(`Manual rectangles: ${report.manualBoxes}`);
    lines.push(`Secure (flattened) output: ${report.secure ? 'yes' : 'no'}`);
    lines.push(`Document metadata removed: ${report.metadataScrubbed ? (report.metadataFound.length ? report.metadataFound.join('; ') : 'nothing to remove') : 'no'}`);
    for (const w of report.warnings)
        lines.push(`! ${w}`);
    return lines;
}
export { categoryLabel };
