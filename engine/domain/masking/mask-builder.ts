import { IFileStoreDrawingDataDto, IDrawingPageDto, ISensitiveDataItemDto, SensitiveDataType, } from '../../core/models/drawing.dtos';
import { hexaToHex } from '../color';
import { MaskBox, MaskCategory, PageGeometry, Rect } from './mask-model';
const KNOWN_TYPES = new Set<string>(Object.values(SensitiveDataType));
export function pageGeometries(dto: IFileStoreDrawingDataDto): PageGeometry[] {
    return Object.values(dto.pages ?? {})
        .sort((a, b) => a.pageNr - b.pageNr)
        .map(page => ({
        pageNr: page.pageNr,
        width: page.width,
        height: page.height,
        dpi: page.dpi || 144,
        rotation: page.rotation || 0,
    }));
}
export function pageIndexBase(dto: IFileStoreDrawingDataDto): number {
    const pages = Object.values(dto.pages ?? {});
    return pages.length ? Math.min(...pages.map(p => p.pageNr)) : 0;
}
export function toPdfPageNumber(dto: IFileStoreDrawingDataDto, analysisPageNr: number): number {
    return analysisPageNr - pageIndexBase(dto) + 1;
}
export function selectMainPageNr(dto: IFileStoreDrawingDataDto): number {
    const pages = Object.values(dto.pages ?? {}).sort((a, b) => a.pageNr - b.pageNr);
    if (!pages.length)
        return 0;
    const preferred = dto.mainPageNr ?? dto.predefinedMainPageNr ?? null;
    if (preferred != null && dto.pages[preferred])
        return preferred;
    return (pages.find(p => p.isDrawing) ?? pages[0]).pageNr;
}
export function buildMasks(dto: IFileStoreDrawingDataDto, autoMask: MaskCategory[]): MaskBox[] {
    const auto = new Set<string>(autoMask);
    const boxes: MaskBox[] = [];
    for (const page of Object.values(dto.pages ?? {}).sort((a, b) => a.pageNr - b.pageNr)) {
        for (const item of page.sensitiveData ?? []) {
            const box = itemToBox(page, item, auto);
            if (box)
                boxes.push(box);
        }
    }
    return boxes;
}
function itemToBox(page: IDrawingPageDto, item: ISensitiveDataItemDto, auto: Set<string>): MaskBox | null {
    const rect = normalizeRect(item.boundingBox);
    if (!rect)
        return null;
    const type = KNOWN_TYPES.has(item.type) ? item.type : SensitiveDataType.Other;
    return {
        id: item.id || `a-${page.pageNr}-${boxes(rect)}`,
        pageNr: page.pageNr,
        category: type,
        source: 'analysis',
        rect,
        rotation: item.textRotation ?? 0,
        originalValue: (item.originalValue ?? '').trim(),
        replacement: '',
        masked: auto.has(type),
        color: null,
        fontColor: hexaToHex(item.fontColorHex) ?? '#000000',
        score: clamp01(item.score ?? 1),
    };
}
function boxes(rect: Rect): string {
    return `${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
}
export function normalizeRect(rect?: Rect | null): Rect | null {
    if (!rect)
        return null;
    const width = Math.abs(rect.width);
    const height = Math.abs(rect.height);
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || width < 1 || height < 1)
        return null;
    return {
        x: Math.min(rect.x, rect.x + rect.width),
        y: Math.min(rect.y, rect.y + rect.height),
        width,
        height,
    };
}
function clamp01(n: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1));
}
export function overlaps(a: Rect, b: Rect, ratio = 0.6): boolean {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const inter = x * y;
    if (inter <= 0)
        return false;
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    return smaller > 0 && inter / smaller >= ratio;
}
export function padRect(rect: Rect, pad: number, page: PageGeometry): Rect {
    const x = Math.max(0, rect.x - pad);
    const y = Math.max(0, rect.y - pad);
    return {
        x,
        y,
        width: Math.min(page.width - x, rect.width + 2 * pad),
        height: Math.min(page.height - y, rect.height + 2 * pad),
    };
}
