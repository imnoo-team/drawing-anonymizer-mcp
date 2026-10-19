import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { textTokensFromContent } from './engine';
import type { PageGeometry, TextContentItemLike, TextToken } from './engine';
type PdfjsModule = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;
let pdfjsModule: Promise<PdfjsModule> | null = null;
function pdfjs(): Promise<PdfjsModule> {
    if (!pdfjsModule) {
        pdfjsModule = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfjsModule>;
    }
    return pdfjsModule;
}
const require = createRequire(import.meta.url);
function assetDir(name: string): string {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
    return path.join(root, name).replace(/\\/g, '/') + '/';
}
async function load(bytes: Uint8Array): Promise<PdfDocument> {
    const { getDocument } = await pdfjs();
    return getDocument({
        data: bytes.slice(),
        standardFontDataUrl: assetDir('standard_fonts'),
        cMapUrl: assetDir('cmaps'),
        cMapPacked: true,
        wasmUrl: assetDir('wasm'),
        useSystemFonts: false,
        disableFontFace: true,
        isEvalSupported: false,
        verbosity: 0,
    } as Parameters<PdfjsModule['getDocument']>[0]).promise;
}
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
    const doc = await load(bytes);
    try {
        return doc.numPages;
    }
    finally {
        await doc.destroy();
    }
}
export async function rasterize(bytes: Uint8Array, pageNr: number, scale: number): Promise<{
    png: Uint8Array;
}> {
    const { createCanvas } = await import('@napi-rs/canvas');
    const doc = await load(bytes);
    try {
        const page = await doc.getPage(pageNr);
        const viewport = page.getViewport({ scale, rotation: 0 });
        const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
            canvasContext: context as unknown as CanvasRenderingContext2D,
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
        } as Parameters<typeof page.render>[0]).promise;
        const png = await canvas.encode('png');
        page.cleanup();
        return { png: new Uint8Array(png) };
    }
    finally {
        await doc.destroy();
    }
}
export async function textTokens(bytes: Uint8Array, pages: readonly PageGeometry[], pageBase: number): Promise<Map<number, TextToken[]>> {
    const doc = await load(bytes);
    try {
        const map = new Map<number, TextToken[]>();
        for (const geometry of pages) {
            const pdfPage = geometry.pageNr - pageBase + 1;
            if (pdfPage < 1 || pdfPage > doc.numPages)
                continue;
            const page = await doc.getPage(pdfPage);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: geometry.width / base.width });
            const content = await page.getTextContent();
            map.set(geometry.pageNr, textTokensFromContent(content.items as TextContentItemLike[], viewport));
            page.cleanup();
        }
        return map;
    }
    finally {
        await doc.destroy();
    }
}
export async function readPdfMetadata(bytes: Uint8Array): Promise<string[]> {
    const found: string[] = [];
    try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        const add = (label: string, value?: string) => {
            const v = (value ?? '').trim();
            if (v)
                found.push(`${label}: ${v}`);
        };
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
