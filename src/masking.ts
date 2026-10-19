import { buildCoverageReport, buildMasks, CATEGORIES, CATEGORY_BY_TYPE, DEFAULT_AUTO_MASK, DEFAULT_SETTINGS, inDetectionScope, MAX_REPLACEMENT_LENGTH, newBoxId, normalizeRect, overlaps, OWN_LOGO_VALUE, SensitiveDataType, termBoxes, titleBlockRegions, tokensInside, toPixels, } from './engine';
import type { CoverageReport, DetectionScope, LogoAsset, MaskBox, MaskCategory, MaskMode, MaskSettings, Rect, TextToken, } from './engine';
import type { DrawingEntry } from './analysis-client';
export const CATEGORY_TYPES = CATEGORIES.map(c => c.type) as [
    MaskCategory,
    ...MaskCategory[]
];
export interface RectangleOption {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    category?: MaskCategory;
}
export interface MaskingOptions {
    categories?: MaskCategory[];
    detectionScope?: DetectionScope;
    mode?: MaskMode;
    companyName?: string;
    logo?: LogoAsset | null;
    mask?: string[];
    unmask?: string[];
    replacements?: {
        id: string;
        text: string;
    }[];
    terms?: string[];
    rectangles?: RectangleOption[];
    color?: string;
    opacity?: number;
    pages?: number[];
    secure?: boolean;
    scrubMetadata?: boolean;
    includeReport?: boolean;
    articleNumber?: string;
    stampArticleNumber?: boolean;
    nameAfterArticleNumber?: boolean;
}
export interface TermResult {
    term: string;
    added: number;
    alreadyCovered: number;
}
export interface ComposedMasking {
    settings: MaskSettings;
    boxes: MaskBox[];
    exportedPages: number[];
    pageSelection?: number[];
    terms: TermResult[];
    unknownIds: string[];
    truncated: string[];
    notes: string[];
}
const ANALYSIS_PDF_PAGE = (entry: DrawingEntry, pageNr: number) => pageNr - entry.pageBase + 1;
export function pdfPageNumbers(entry: DrawingEntry): number[] {
    return entry.pages.map(p => ANALYSIS_PDF_PAGE(entry, p.pageNr));
}
export function composeMasking(entry: DrawingEntry, options: MaskingOptions, tokens: Map<number, TextToken[]> | null): ComposedMasking {
    const notes: string[] = [];
    const validPages = pdfPageNumbers(entry);
    const pageNrFor = (pdfPage: number) => pdfPage + entry.pageBase - 1;
    const settings: MaskSettings = {
        ...DEFAULT_SETTINGS,
        autoMask: options.categories ? CATEGORY_TYPES.filter(t => options.categories!.includes(t)) : [...DEFAULT_AUTO_MASK],
        maskMode: options.mode ?? DEFAULT_SETTINGS.maskMode,
        detectionScope: options.detectionScope ?? DEFAULT_SETTINGS.detectionScope,
        ownCompanyName: (options.companyName ?? '').trim().slice(0, MAX_REPLACEMENT_LENGTH),
        replaceLogo: !!options.logo,
        maskColor: options.color ?? DEFAULT_SETTINGS.maskColor,
        maskOpacity: options.opacity ?? DEFAULT_SETTINGS.maskOpacity,
        showOutlines: false,
        secureDownload: options.secure ?? DEFAULT_SETTINGS.secureDownload,
        scrubMetadata: options.scrubMetadata ?? DEFAULT_SETTINGS.scrubMetadata,
        includeReport: options.includeReport ?? DEFAULT_SETTINGS.includeReport,
        clientArticleNumber: (options.articleNumber ?? '').trim(),
        useArticleNumberAsFilename: options.nameAfterArticleNumber ?? DEFAULT_SETTINGS.useArticleNumberAsFilename,
        addArticleNumberToDrawing: options.stampArticleNumber ?? false,
    };
    const fresh = buildMasks(entry.analysis, settings.autoMask);
    const regions = titleBlockRegions(entry.pages, fresh);
    const auto = new Set<string>(settings.autoMask);
    let boxes: MaskBox[] = fresh.map(b => ({
        ...b,
        masked: auto.has(b.category) && inDetectionScope(b, settings.detectionScope, regions),
    }));
    if (options.logo) {
        boxes = boxes.map(b => (b.category === SensitiveDataType.CompanyLogo ? { ...b, replacement: OWN_LOGO_VALUE } : b));
    }
    const ids = new Set(boxes.map(b => b.id));
    const unknownIds: string[] = [];
    const known = (id: string) => {
        if (ids.has(id))
            return true;
        unknownIds.push(id);
        return false;
    };
    const maskIds = new Set((options.mask ?? []).filter(known));
    const unmaskIds = new Set((options.unmask ?? []).filter(known));
    for (const id of maskIds) {
        if (unmaskIds.has(id))
            notes.push(`Detection ${id} is in both mask and unmask — it stays masked.`);
    }
    const truncated: string[] = [];
    const replacementById = new Map<string, string>();
    for (const r of options.replacements ?? []) {
        if (!known(r.id))
            continue;
        const text = r.text.trim();
        if (text.length > MAX_REPLACEMENT_LENGTH)
            truncated.push(r.id);
        replacementById.set(r.id, text.slice(0, MAX_REPLACEMENT_LENGTH));
    }
    boxes = boxes.map(b => {
        let next = b;
        if (unmaskIds.has(b.id) && !maskIds.has(b.id))
            next = { ...next, masked: false };
        if (maskIds.has(b.id))
            next = { ...next, masked: true };
        const replacement = replacementById.get(b.id);
        if (replacement !== undefined && b.category !== SensitiveDataType.CompanyLogo)
            next = { ...next, replacement };
        return next;
    });
    if (replacementById.size && settings.maskMode !== 'replace') {
        notes.push('Replacement texts are only printed in mode "replace" — in "whiteout" the boxes stay blank.');
    }
    for (const r of options.rectangles ?? []) {
        if (!validPages.includes(r.page)) {
            throw new Error(`rectangles: page ${r.page} does not exist — the drawing has PDF pages ${validPages.join(', ')}.`);
        }
        const pageNr = pageNrFor(r.page);
        const geometry = entry.pages.find(p => p.pageNr === pageNr)!;
        const rect = normalizeRect({ x: r.x, y: r.y, width: r.width, height: r.height });
        if (!rect)
            throw new Error(`rectangles: a rectangle on page ${r.page} has no area (width and height must be at least 1 px).`);
        if (rect.x >= geometry.width || rect.y >= geometry.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) {
            throw new Error(`rectangles: the rectangle at (${r.x}, ${r.y}) lies outside page ${r.page}, which is ${geometry.width} × ${geometry.height} px (analysis image pixels, top-left origin).`);
        }
        boxes.push({
            id: newBoxId('u'),
            pageNr,
            category: r.category ?? SensitiveDataType.Other,
            source: 'manual',
            rect,
            rotation: 0,
            originalValue: textUnder(tokens?.get(pageNr) ?? [], rect),
            replacement: '',
            masked: true,
            color: null,
            fontColor: '#000000',
            score: 1,
        });
    }
    const terms: TermResult[] = [];
    const seen = new Set<string>();
    for (const raw of options.terms ?? []) {
        const term = raw.trim();
        const key = term.toLowerCase().replace(/\s+/g, ' ');
        if (!term || seen.has(key))
            continue;
        seen.add(key);
        const result: TermResult = { term, added: 0, alreadyCovered: 0 };
        for (const [pageNr, pageTokens] of tokens ?? new Map<number, TextToken[]>()) {
            const existing = boxes.filter(b => b.pageNr === pageNr && b.masked);
            for (const box of termBoxes(pageTokens, term, pageNr, SensitiveDataType.Other, 'text')) {
                if (existing.some(b => overlaps(b.rect, box.rect, 0.8))) {
                    result.alreadyCovered++;
                    continue;
                }
                boxes.push(box);
                result.added++;
            }
        }
        terms.push(result);
    }
    if (terms.length) {
        if (!tokens) {
            notes.push('Custom terms need the drawing PDF to search its text — pass pdf_path (load_analysis or mask_drawing).');
        }
        else if (![...tokens.values()].some(t => t.length)) {
            notes.push('This PDF has no text layer (a scan?) — custom terms cannot be found; cover the areas with rectangles instead.');
        }
    }
    if (settings.addArticleNumberToDrawing) {
        if (!settings.clientArticleNumber) {
            notes.push('stamp_article_number needs article_number — nothing was stamped.');
        }
        else {
            const page = entry.pages.find(p => p.pageNr === entry.mainPageNr) ?? entry.pages[0];
            const margin = Math.round(page.width * 0.02);
            const width = Math.round(page.width * 0.22);
            const height = Math.round(toPixels(12, page.dpi) * 1.5);
            boxes.push({
                id: newBoxId('stamp'),
                pageNr: page.pageNr,
                category: SensitiveDataType.ArticleNr,
                source: 'manual',
                rect: { x: page.width - width - margin, y: margin, width, height },
                rotation: 0,
                originalValue: '',
                replacement: settings.clientArticleNumber,
                masked: true,
                color: null,
                fontColor: '#000000',
                score: 1,
                stamp: true,
            });
        }
    }
    let pageSelection: number[] | undefined;
    if (options.pages?.length) {
        const wanted = [...new Set(options.pages)].sort((a, b) => a - b);
        const missing = wanted.filter(p => !validPages.includes(p));
        if (missing.length) {
            throw new Error(`pages: ${missing.join(', ')} not in the drawing — it has PDF pages ${validPages.join(', ')}.`);
        }
        pageSelection = wanted.length === validPages.length ? undefined : wanted;
    }
    if (settings.maskOpacity < 100)
        notes.push('Mask opacity is below 100 % — covered content stays readable through the masks.');
    if (!settings.secureDownload) {
        notes.push('secure is off — the layered PDF keeps the original text and graphics under the masks, recoverable with any PDF editor.');
    }
    if (settings.maskMode === 'replace' && !settings.ownCompanyName && !replacementById.size) {
        notes.push('Mode "replace" without company_name or replacements prints nothing — the boxes stay blank.');
    }
    return {
        settings,
        boxes,
        exportedPages: pageSelection ?? validPages,
        pageSelection,
        terms,
        unknownIds: [...new Set(unknownIds)],
        truncated,
        notes,
    };
}
function textUnder(tokens: TextToken[], rect: Rect): string {
    return tokensInside(tokens, [rect])
        .map(t => t.str)
        .join(' ')
        .slice(0, 120);
}
const MASKED_RUN = '[masked]';
export function visibleText(entry: DrawingEntry, boxes: MaskBox[], tokens: Map<number, TextToken[]> | null, exportedPages: number[], limit = 400): Record<string, string[]> | null {
    if (!tokens)
        return null;
    const out: Record<string, string[]> = {};
    for (const [pageNr, pageTokens] of tokens) {
        const pdfPage = ANALYSIS_PDF_PAGE(entry, pageNr);
        if (!exportedPages.includes(pdfPage))
            continue;
        const rects = boxes.filter(b => b.pageNr === pageNr && b.masked && !b.stamp).map(b => b.rect);
        const visible: string[] = [];
        const seen = new Set<string>();
        for (const token of pageTokens) {
            const text = visiblePart(token, rects);
            if (!text || seen.has(text))
                continue;
            seen.add(text);
            visible.push(text);
            if (visible.length >= limit)
                break;
        }
        out[String(pdfPage)] = visible;
    }
    return out;
}
function visiblePart(token: TextToken, rects: Rect[]): string {
    const vertical = token.rotation === 90 || token.rotation === 270 || token.rotation === -90;
    const start = vertical ? token.y : token.x;
    const length = vertical ? token.height : token.width;
    const crossStart = vertical ? token.x : token.y;
    const crossLength = vertical ? token.width : token.height;
    if (!(length > 0))
        return tokensInside([token], rects).length ? '' : token.str;
    const covered: [
        number,
        number
    ][] = [];
    for (const r of rects) {
        const rStart = vertical ? r.y : r.x;
        const rLength = vertical ? r.height : r.width;
        const rCross = vertical ? r.x : r.y;
        const rCrossLength = vertical ? r.width : r.height;
        const cross = Math.min(crossStart + crossLength, rCross + rCrossLength) - Math.max(crossStart, rCross);
        if (cross < crossLength * 0.5)
            continue;
        const from = (Math.max(start, rStart) - start) / length;
        const to = (Math.min(start + length, rStart + rLength) - start) / length;
        if (to > from)
            covered.push([from, to]);
    }
    if (!covered.length)
        return token.str;
    const chars = [...token.str];
    let out = '';
    let hidden = 0;
    let inRun = false;
    chars.forEach((char, i) => {
        const center = (i + 0.5) / chars.length;
        const isCovered = covered.some(([from, to]) => center >= from && center <= to);
        if (isCovered) {
            hidden++;
            if (!inRun)
                out += MASKED_RUN;
            inRun = true;
        }
        else {
            out += char;
            inRun = false;
        }
    });
    if (hidden === chars.length)
        return '';
    return out.replace(/\s+/g, ' ').trim();
}
export function outputFileName(entry: DrawingEntry, settings: MaskSettings): string {
    const detected = entry.analysis.pages?.[entry.mainPageNr]?.articleNr ?? '';
    const article = (settings.clientArticleNumber || detected).trim();
    const base = settings.useArticleNumberAsFilename && article ? article : entry.fileName || 'drawing';
    const clean = base.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'drawing';
    return `${clean}_masked.pdf`;
}
export function coverageReport(composed: ComposedMasking, entry: DrawingEntry, metadataFound: string[]): CoverageReport {
    return buildCoverageReport(composed.boxes, composed.settings, entry.pages, metadataFound);
}
const round = (n: number) => Math.round(n);
function describeBox(entry: DrawingEntry, box: MaskBox, regions: Map<number, Rect>) {
    const region = regions.get(box.pageNr);
    const cx = box.rect.x + box.rect.width / 2;
    const cy = box.rect.y + box.rect.height / 2;
    return {
        id: box.id,
        page: ANALYSIS_PDF_PAGE(entry, box.pageNr),
        category: box.category,
        value: box.originalValue || (box.category === SensitiveDataType.CompanyLogo ? '(logo)' : ''),
        confidence: Math.round(box.score * 100) / 100,
        box: { x: round(box.rect.x), y: round(box.rect.y), width: round(box.rect.width), height: round(box.rect.height) },
        in_title_block: !!region && cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height,
    };
}
export function describeDrawing(entry: DrawingEntry) {
    const fresh = buildMasks(entry.analysis, DEFAULT_AUTO_MASK);
    const regions = titleBlockRegions(entry.pages, fresh);
    const main = entry.analysis.pages?.[entry.mainPageNr];
    const detections = fresh.map(b => ({ ...describeBox(entry, b, regions), masked_by_default: b.masked }));
    const counts = CATEGORIES.map(c => ({
        category: c.type,
        label: c.label,
        found: fresh.filter(b => b.category === c.type).length,
        masked_by_default: c.defaultOn,
    }));
    return {
        drawing_id: entry.id,
        file_name: entry.fileName,
        pages: entry.pages.map(p => ({
            page: ANALYSIS_PDF_PAGE(entry, p.pageNr),
            width_px: p.width,
            height_px: p.height,
            dpi: p.dpi,
            size_mm: `${Math.round((p.width / p.dpi) * 25.4)} × ${Math.round((p.height / p.dpi) * 25.4)}`,
        })),
        title_block: {
            article_number: main?.articleNr || null,
            drawing_number: main?.drawingNr || null,
        },
        detections_found: fresh.length,
        categories: counts.filter(c => c.found > 0 || c.masked_by_default),
        detections,
        coordinates: 'Boxes are in analysis image pixels of their page (top-left origin; width_px × height_px at dpi) — use the same space for rectangles.',
    };
}
export function describeComposition(entry: DrawingEntry, composed: ComposedMasking, report: CoverageReport) {
    const regions = titleBlockRegions(entry.pages, composed.boxes.filter(b => b.source === 'analysis'));
    const analysis = composed.boxes.filter(b => b.source === 'analysis');
    const replacementShown = (b: MaskBox) => b.category === SensitiveDataType.CompanyLogo
        ? b.replacement === OWN_LOGO_VALUE
            ? '(own logo)'
            : null
        : composed.settings.maskMode === 'replace'
            ? b.replacement || (b.category === SensitiveDataType.CompanyName ? composed.settings.ownCompanyName || null : null)
            : null;
    return {
        mode: composed.settings.maskMode,
        detection_scope: composed.settings.detectionScope === 'titleBlock' ? 'title_block' : 'page',
        auto_mask_categories: composed.settings.autoMask,
        masked: analysis
            .filter(b => b.masked)
            .map(b => ({ ...describeBox(entry, b, regions), replacement: replacementShown(b) })),
        left_visible: analysis.filter(b => !b.masked).map(b => describeBox(entry, b, regions)),
        custom_terms: composed.terms.map(t => ({ term: t.term, masks_added: t.added, already_covered: t.alreadyCovered })),
        rectangles: composed.boxes
            .filter(b => b.source === 'manual' && !b.stamp)
            .map(b => ({
            id: b.id,
            page: ANALYSIS_PDF_PAGE(entry, b.pageNr),
            category: b.category,
            box: { x: round(b.rect.x), y: round(b.rect.y), width: round(b.rect.width), height: round(b.rect.height) },
            covers_text: b.originalValue || null,
        })),
        article_number_stamp: composed.boxes.find(b => b.stamp)?.replacement ?? null,
        exported_pages: composed.exportedPages,
        secure: composed.settings.secureDownload,
        scrub_metadata: composed.settings.scrubMetadata,
        include_report: composed.settings.includeReport,
        anonymity_score: report.score,
        warnings: [...report.warnings, ...composed.notes],
        ...(composed.unknownIds.length ? { unknown_ids_ignored: composed.unknownIds } : {}),
        ...(composed.truncated.length ? { replacements_truncated_to_32_chars: composed.truncated } : {}),
    };
}
export function categoryLabelOf(type: MaskCategory): string {
    return CATEGORY_BY_TYPE[type]?.label ?? type;
}
