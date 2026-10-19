import { SensitiveDataType } from '../../core/models/drawing.dtos';
import { MaskBox, MaskCategory, PageGeometry, Rect } from './mask-model';
const ANCHOR_TYPES = new Set<MaskCategory>([
    SensitiveDataType.ArticleNr,
    SensitiveDataType.DrawingNr,
    SensitiveDataType.Date,
]);
const ANCHOR_BAND_TOP = 0.6;
const FALLBACK_LEFT = 0.55;
const FALLBACK_TOP = 0.7;
const PADDING = 0.02;
export function inferTitleBlock(page: PageGeometry, boxes: readonly MaskBox[]): Rect {
    const anchors = boxes.filter(b => b.pageNr === page.pageNr &&
        ANCHOR_TYPES.has(b.category) &&
        b.rect.y + b.rect.height / 2 >= page.height * ANCHOR_BAND_TOP);
    const pad = page.width * PADDING;
    const left = anchors.length
        ? Math.min(...anchors.map(a => a.rect.x)) - pad
        : page.width * FALLBACK_LEFT;
    const top = anchors.length
        ? Math.min(...anchors.map(a => a.rect.y)) - pad
        : page.height * FALLBACK_TOP;
    const x = Math.max(0, Math.min(left, page.width));
    const y = Math.max(0, Math.min(top, page.height));
    return { x, y, width: page.width - x, height: page.height - y };
}
export function titleBlockRegions(pages: readonly PageGeometry[], boxes: readonly MaskBox[]): Map<number, Rect> {
    return new Map(pages.map(page => [page.pageNr, inferTitleBlock(page, boxes)]));
}
export function isInside(rect: Rect, region: Rect): boolean {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height;
}
export function inDetectionScope(box: MaskBox, scope: 'page' | 'titleBlock', regions: Map<number, Rect>): boolean {
    if (scope === 'page' || box.source !== 'analysis')
        return true;
    const region = regions.get(box.pageNr);
    return !region || isInside(box.rect, region);
}
