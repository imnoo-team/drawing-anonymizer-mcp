import { SensitiveDataType } from '../../core/models/drawing.dtos';
export type MaskCategory = SensitiveDataType;
export type MaskSource = 'analysis' | 'text' | 'manual';
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface MaskBox {
    id: string;
    pageNr: number;
    category: MaskCategory;
    source: MaskSource;
    rect: Rect;
    rotation: number;
    originalValue: string;
    replacement: string;
    masked: boolean;
    color: string | null;
    fontColor: string;
    score: number;
    term?: string;
    stamp?: boolean;
}
export type MaskMode = 'whiteout' | 'replace';
export type DetectionScope = 'page' | 'titleBlock';
export type ShareExpiry = '1m' | '15m' | '1h' | '24h';
export interface MaskSettings {
    autoMask: MaskCategory[];
    maskMode: MaskMode;
    detectionScope: DetectionScope;
    ownCompanyName: string;
    replaceLogo: boolean;
    maskColor: string;
    maskOpacity: number;
    showOutlines: boolean;
    secureDownload: boolean;
    scrubMetadata: boolean;
    includeReport: boolean;
    shareExpiry: ShareExpiry;
    clientArticleNumber: string;
    useArticleNumberAsFilename: boolean;
    addArticleNumberToDrawing: boolean;
}
export const SHARE_EXPIRY_SECONDS: Record<ShareExpiry, number> = {
    '1m': 60,
    '15m': 15 * 60,
    '1h': 60 * 60,
    '24h': 24 * 60 * 60,
};
export type MaskSectionId = 'meta' | 'personal';
export interface CategoryInfo {
    type: MaskCategory;
    label: string;
    hint: string;
    defaultOn: boolean;
    group: MaskSectionId;
    icon: string;
}
export const SECTIONS: {
    id: MaskSectionId;
    label: string;
}[] = [
    { id: 'meta', label: 'Meta data' },
    { id: 'personal', label: 'Personal data' },
];
export const CATEGORIES: CategoryInfo[] = [
    { type: SensitiveDataType.ArticleNr, label: 'Article Nr.', hint: 'Kept visible by default', defaultOn: false, group: 'meta', icon: 'tag' },
    { type: SensitiveDataType.DrawingNr, label: 'Drawing Nr.', hint: 'Incl. drawing index', defaultOn: false, group: 'meta', icon: 'numbers' },
    { type: SensitiveDataType.CompanyName, label: 'Company Names', hint: 'Title block, notes, copyright lines', defaultOn: true, group: 'personal', icon: 'business' },
    { type: SensitiveDataType.Name, label: 'Names', hint: 'Drawn by, checked by, approved by', defaultOn: true, group: 'personal', icon: 'person' },
    { type: SensitiveDataType.Address, label: 'Addresses', hint: 'Streets, cities, countries', defaultOn: true, group: 'personal', icon: 'location_on' },
    { type: SensitiveDataType.PhoneNr, label: 'Phone Numbers', hint: 'Phone and fax', defaultOn: true, group: 'personal', icon: 'call' },
    { type: SensitiveDataType.Date, label: 'Dates', hint: 'Kept visible by default', defaultOn: false, group: 'personal', icon: 'event' },
    { type: SensitiveDataType.Email, label: 'Emails', hint: '', defaultOn: true, group: 'personal', icon: 'alternate_email' },
    { type: SensitiveDataType.Website, label: 'Websites', hint: 'URLs and domains', defaultOn: true, group: 'personal', icon: 'language' },
    { type: SensitiveDataType.CompanyLogo, label: 'Logos', hint: 'Logos anywhere on the sheet', defaultOn: true, group: 'personal', icon: 'branding_watermark' },
    { type: SensitiveDataType.Other, label: 'Others', hint: 'Anything else identifying', defaultOn: true, group: 'personal', icon: 'more_horiz' },
];
export const MAX_REPLACEMENT_LENGTH = 32;
export const OWN_LOGO_VALUE = 'own-logo';
export const CATEGORY_BY_TYPE: Record<string, CategoryInfo> = Object.fromEntries(CATEGORIES.map(c => [c.type, c]));
export function categoryLabel(type: MaskCategory): string {
    return CATEGORY_BY_TYPE[type]?.label ?? type;
}
export const DEFAULT_AUTO_MASK: MaskCategory[] = CATEGORIES.filter(c => c.defaultOn).map(c => c.type);
export const DEFAULT_SETTINGS: MaskSettings = {
    autoMask: DEFAULT_AUTO_MASK,
    maskMode: 'whiteout',
    detectionScope: 'page',
    ownCompanyName: '',
    replaceLogo: false,
    maskColor: '#ffffff',
    maskOpacity: 100,
    showOutlines: true,
    secureDownload: true,
    scrubMetadata: true,
    includeReport: false,
    shareExpiry: '1m',
    clientArticleNumber: '',
    useArticleNumberAsFilename: true,
    addArticleNumberToDrawing: false,
};
export interface PageGeometry {
    pageNr: number;
    width: number;
    height: number;
    dpi: number;
    rotation: number;
}
let counter = 0;
export function newBoxId(prefix = 'm'): string {
    counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
export function cloneRect(rect: Rect): Rect {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
