import fontkit from '@pdf-lib/fontkit';
import { BlendMode, degrees, PDFDocument, PDFFont, PDFImage, PDFName, PDFPage, rgb, RGB, StandardFonts } from 'pdf-lib';
import { hexaToRgba, luminance, toPoints } from '../color';
import { getRotatedDimensions, projectRectToOriginalPage, projectRectToRotatedPage } from '../geometry/coordinate-projector';
import { CoverageReport, reportLines } from './coverage-report';
import { MaskBox, MaskSettings, OWN_LOGO_VALUE, PageGeometry, Rect } from './mask-model';
export interface LogoAsset {
    bytes: Uint8Array;
    type: 'png' | 'jpg';
}
export interface RasterizedPage {
    png: Uint8Array;
}
export type Rasterizer = (pdfBytes: Uint8Array, pageIndex: number, scale: number) => Promise<RasterizedPage>;
export interface MaskedPdfInput {
    sourcePdf: Uint8Array;
    pages: PageGeometry[];
    pageIndexBase: number;
    boxes: MaskBox[];
    settings: MaskSettings;
    logo?: LogoAsset | null;
    symbolFont?: Uint8Array | null;
    rasterize?: Rasterizer;
    pageSelection?: number[];
    report?: {
        report: CoverageReport;
        fileName: string;
    } | null;
    preview?: boolean;
}
export interface MaskedPdfResult {
    bytes: Uint8Array;
    pageCount: number;
    flattened: boolean;
    metadataFound: string[];
    drawn: number;
}
const MAX_RASTER_SIDE = 8000;
const PREFERRED_SCALE = 4;
const TEXT_PADDING_PT = 1.5;
const MAX_TEXT_PT = 12;
const MIN_TEXT_PT = 4;
const PRODUCER = 'Imnoo Drawing Anonymizer';
export async function buildMaskedPdf(input: MaskedPdfInput): Promise<MaskedPdfResult> {
    const source = await PDFDocument.load(input.sourcePdf, { ignoreEncryption: true, updateMetadata: false });
    const metadataFound = readMetadata(source);
    const composed = await PDFDocument.create();
    composed.registerFontkit(fontkit);
    const fonts = await loadFonts(composed, input.symbolFont);
    const total = source.getPageCount();
    const selection = (input.pageSelection ?? range(1, total)).filter(n => n >= 1 && n <= total);
    const copied = await composed.copyPages(source, selection.map(n => n - 1));
    const pageByPdfNumber = new Map<number, PDFPage>();
    copied.forEach((page, i) => {
        composed.addPage(page);
        pageByPdfNumber.set(selection[i], page);
    });
    let drawn = 0;
    let logoImage: PDFImage | null = null;
    const wantsLogo = !!input.logo && input.boxes.some(b => b.masked && drawsOwnLogo(b));
    if (wantsLogo)
        logoImage = await embedLogo(composed, input.logo!);
    for (const geometry of input.pages) {
        const pdfNumber = geometry.pageNr - input.pageIndexBase + 1;
        const page = pageByPdfNumber.get(pdfNumber);
        if (!page)
            continue;
        const boxes = input.boxes.filter(b => b.pageNr === geometry.pageNr && b.masked);
        drawn += drawMasks(page, geometry, boxes, input.settings, fonts, logoImage);
    }
    applyMetadata(composed, input.settings.scrubMetadata ? null : source);
    const flatten = input.settings.secureDownload && !input.preview;
    let target = composed;
    if (flatten) {
        if (!input.rasterize)
            throw new Error('Secure download needs a rasterizer.');
        target = await flattenDocument(composed, input.rasterize);
        applyMetadata(target, input.settings.scrubMetadata ? null : source);
    }
    if (input.report && input.settings.includeReport) {
        if (target !== composed)
            target.registerFontkit(fontkit);
        const reportFonts = target === composed ? fonts : await loadFonts(target, input.symbolFont);
        addReportPage(target, input.report.report, input.report.fileName, reportFonts);
    }
    const bytes = await target.save({ useObjectStreams: true });
    return { bytes, pageCount: target.getPageCount(), flattened: flatten, metadataFound, drawn };
}
interface Fonts {
    regular: PDFFont;
    symbol: PDFFont | null;
}
function drawMasks(page: PDFPage, geometry: PageGeometry, boxes: MaskBox[], settings: MaskSettings, fonts: Fonts, logo: PDFImage | null): number {
    if (!boxes.length)
        return 0;
    const rawPage = getRotatedDimensions(geometry, -geometry.rotation);
    const { width, height } = page.getSize();
    const xRatio = width / rawPage.width;
    const yRatio = height / rawPage.height;
    const project = (rect: Rect, rectRotation: number) => {
        const onDisplayed = projectRectToRotatedPage({ ...rect, rotation: rectRotation }, geometry, 0);
        const onRaw = projectRectToOriginalPage({ ...onDisplayed, rotation: 0 }, rawPage, geometry.rotation);
        return { x: onRaw.x * xRatio, y: onRaw.y * yRatio, w: onRaw.width * xRatio, h: onRaw.height * yRatio };
    };
    const fill = hexaToRgba(settings.maskColor) ?? { r: 255, g: 255, b: 255, a: 1 };
    const opacity = Math.max(0, Math.min(1, settings.maskOpacity / 100));
    const textOnDark = luminance(settings.maskColor) < 0.45;
    let drawn = 0;
    for (const box of boxes) {
        const { x, y, w, h } = project(box.rect, box.rotation || 0);
        if (!(w > 0 && h > 0))
            continue;
        const own = box.color ? hexaToRgba(box.color) : null;
        const color = own ?? fill;
        page.drawRectangle({
            x,
            y: height - y - h,
            width: w,
            height: h,
            color: rgb(color.r / 255, color.g / 255, color.b / 255),
            opacity,
            blendMode: BlendMode.Normal,
        });
        drawn++;
        const textRotation = geometry.rotation - (box.rotation || 0);
        const centerX = x + w / 2;
        const centerY = height - y - h / 2;
        const local = getRotatedDimensions({ width: w, height: h }, -textRotation);
        if (box.category === 'CompanyLogo') {
            if (logo && drawsOwnLogo(box)) {
                drawLogo(page, logo, centerX, centerY, textRotation, local.width, local.height);
            }
            continue;
        }
        if (!drawsText(box, settings))
            continue;
        const text = replacementFor(box, settings);
        if (!text)
            continue;
        const fontColor = textOnDark && !own ? rgb(1, 1, 1) : toRgb(box.fontColor) ?? rgb(0, 0, 0);
        drawReplacementText(page, fonts, text, centerX, centerY, textRotation, local.width, local.height, geometry.dpi, box.rect.height, fontColor);
    }
    return drawn;
}
export function drawsText(box: MaskBox, settings: MaskSettings): boolean {
    return settings.maskMode === 'replace' || !!box.stamp;
}
export function drawsOwnLogo(box: MaskBox): boolean {
    return box.category === 'CompanyLogo' && box.replacement === OWN_LOGO_VALUE;
}
export function replacementFor(box: MaskBox, settings: MaskSettings): string {
    if (box.replacement === OWN_LOGO_VALUE)
        return '';
    if (box.replacement?.trim())
        return box.replacement.trim();
    if (box.category === 'CompanyName' && settings.ownCompanyName.trim())
        return settings.ownCompanyName.trim();
    return '';
}
function drawReplacementText(page: PDFPage, fonts: Fonts, text: string, centerX: number, centerY: number, rotation: number, boxWidth: number, boxHeight: number, dpi: number, boxHeightPx: number, color: RGB): void {
    const available = Math.max(0, boxWidth - 2 * TEXT_PADDING_PT);
    const fromBox = Math.floor(toPoints(boxHeightPx, dpi) * 0.75);
    let size = Math.max(MIN_TEXT_PT, Math.min(MAX_TEXT_PT, fromBox || MAX_TEXT_PT, boxHeight * 0.8));
    while (size > MIN_TEXT_PT && measure(fonts, text, size) > available)
        size -= 0.5;
    const capHeight = fonts.regular.heightAtSize(size, { descender: false });
    page.pushOperators(...group(centerX, centerY, rotation));
    writeText(page, fonts, text, -boxWidth / 2 + TEXT_PADDING_PT, -capHeight / 2, size, color, available);
    page.pushOperators(...ungroup());
}
function drawLogo(page: PDFPage, image: PDFImage, centerX: number, centerY: number, rotation: number, boxWidth: number, boxHeight: number): void {
    const ratio = image.width / image.height;
    let w = boxWidth;
    let h = boxHeight;
    if (ratio > w / h)
        h = w / ratio;
    else
        w = h * ratio;
    page.pushOperators(...group(centerX, centerY, rotation));
    page.drawImage(image, { x: -w / 2, y: -h / 2, width: w, height: h });
    page.pushOperators(...ungroup());
}
import { popGraphicsState, pushGraphicsState, rotateDegrees, translate } from 'pdf-lib';
function group(x: number, y: number, rotation: number) {
    return [pushGraphicsState(), translate(x, y), rotateDegrees(rotation)];
}
function ungroup() {
    return [popGraphicsState()];
}
function measure(fonts: Fonts, text: string, size: number): number {
    let width = 0;
    for (const char of text)
        width += fontFor(fonts, char).widthOfTextAtSize(char, size);
    return width;
}
function writeText(page: PDFPage, fonts: Fonts, text: string, x: number, y: number, size: number, color: RGB, maxWidth?: number): number {
    const startX = x;
    for (const char of text) {
        const font = fontFor(fonts, char);
        const w = font.widthOfTextAtSize(char, size);
        if (maxWidth !== undefined && x - startX + w > maxWidth)
            break;
        page.drawText(char, { x, y, size, font, color, lineHeight: size });
        x += w;
    }
    return x - startX;
}
function fontFor(fonts: Fonts, char: string): PDFFont {
    if (canEncode(fonts.regular, char))
        return fonts.regular;
    if (fonts.symbol && canEncode(fonts.symbol, char))
        return fonts.symbol;
    return fonts.regular;
}
function canEncode(font: PDFFont, text: string): boolean {
    try {
        font.encodeText(text);
        return true;
    }
    catch {
        return false;
    }
}
async function loadFonts(pdf: PDFDocument, symbolFont?: Uint8Array | null): Promise<Fonts> {
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    let symbol: PDFFont | null = null;
    if (symbolFont?.length) {
        try {
            symbol = await pdf.embedFont(symbolFont);
        }
        catch {
            symbol = null;
        }
    }
    return { regular, symbol };
}
async function embedLogo(pdf: PDFDocument, logo: LogoAsset): Promise<PDFImage | null> {
    try {
        return logo.type === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    }
    catch {
        return null;
    }
}
function toRgb(hex?: string | null): RGB | null {
    const c = hexaToRgba(hex);
    return c ? rgb(c.r / 255, c.g / 255, c.b / 255) : null;
}
function readMetadata(doc: PDFDocument): string[] {
    const found: string[] = [];
    const add = (label: string, value?: string) => {
        const v = (value ?? '').trim();
        if (v)
            found.push(`${label}: ${v}`);
    };
    try {
        add('Title', doc.getTitle());
        add('Author', doc.getAuthor());
        add('Subject', doc.getSubject());
        add('Keywords', doc.getKeywords());
        add('Creator', doc.getCreator());
        add('Producer', doc.getProducer());
    }
    catch {
    }
    return found;
}
function applyMetadata(doc: PDFDocument, keepFrom: PDFDocument | null): void {
    doc.catalog.delete(PDFName.of('Metadata'));
    doc.setProducer(PRODUCER);
    doc.setCreator(PRODUCER);
    const now = new Date();
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    if (keepFrom) {
        doc.setTitle(keepFrom.getTitle() ?? '');
        doc.setAuthor(keepFrom.getAuthor() ?? '');
        doc.setSubject(keepFrom.getSubject() ?? '');
        doc.setKeywords((keepFrom.getKeywords() ?? '').split(/[,;]\s*/).filter(Boolean));
    }
    else {
        doc.setTitle('');
        doc.setAuthor('');
        doc.setSubject('');
        doc.setKeywords([]);
    }
}
async function flattenDocument(composed: PDFDocument, rasterize: Rasterizer): Promise<PDFDocument> {
    const bytes = await composed.save({ useObjectStreams: false });
    const out = await PDFDocument.create();
    const count = composed.getPageCount();
    for (let i = 0; i < count; i++) {
        const page = composed.getPage(i);
        const { width, height } = page.getSize();
        const rotation = page.getRotation().angle;
        const scale = Math.min(PREFERRED_SCALE, MAX_RASTER_SIDE / Math.max(width, height));
        const raster = await rasterize(bytes, i + 1, Math.max(1, scale));
        const image = await out.embedPng(raster.png);
        const target = out.addPage([width, height]);
        target.drawImage(image, { x: 0, y: 0, width, height });
        target.setRotation(degrees(rotation));
    }
    return out;
}
function addReportPage(doc: PDFDocument, report: CoverageReport, fileName: string, fonts: Fonts): void {
    let page = doc.addPage([595.28, 841.89]);
    const margin = 48;
    let y = page.getHeight() - margin;
    const ink = rgb(0.08, 0.13, 0.17);
    const soft = rgb(0.36, 0.42, 0.48);
    writeText(page, fonts, 'Masking report', margin, y - 20, 20, ink);
    y -= 30;
    writeText(page, fonts, `Generated by ${PRODUCER} on ${new Date().toISOString().slice(0, 10)}`, margin, y - 10, 9, soft);
    y -= 30;
    for (const line of reportLines(report, fileName)) {
        if (y < margin + 20) {
            page = doc.addPage([595.28, 841.89]);
            y = page.getHeight() - margin;
        }
        const warning = line.startsWith('! ');
        const indent = line.startsWith('  ') ? 14 : 0;
        writeText(page, fonts, warning ? line.slice(2) : line.trim(), margin + indent, y - 10, 10.5, warning ? rgb(0.7, 0.25, 0.1) : ink, page.getWidth() - 2 * margin - indent);
        y -= 17;
    }
}
function range(from: number, to: number): number[] {
    const out: number[] = [];
    for (let n = from; n <= to; n++)
        out.push(n);
    return out;
}
