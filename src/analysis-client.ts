import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AnalysisErrorCodes, pageGeometries, pageIndexBase, selectMainPageNr, sha256Hex } from './engine';
import type { IFileStoreDrawingDataDto, PageGeometry, TextToken } from './engine';
import { textTokens } from './pdf-node';
export const DEFAULT_APP_URL = 'https://drawing-anonymizer.imnoo.com';
export const MAX_UPLOAD_BYTES = 30000000;
export const MAX_PAGES = 4;
const POLL_INTERVAL_MS = 2000;
export function appUrl(): string {
    return (process.env.DRAWING_ANONYMIZER_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
}
export function authHeaders(): Record<string, string> {
    const token = (process.env.IMNOO_ACCESS_TOKEN || '').trim().replace(/^Bearer\s+/i, '');
    return token ? { 'X-Imnoo-Auth': `Bearer ${token}` } : {};
}
export class UploadError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'UploadError';
    }
}
export class AnalysisFailedError extends Error {
    constructor(message: string, readonly code: AnalysisErrorCodes) {
        super(message);
        this.name = 'AnalysisFailedError';
    }
}
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
export async function readPdfFile(p: string): Promise<{
    path: string;
    bytes: Uint8Array;
}> {
    const file = path.resolve(p);
    let size: number;
    try {
        size = (await stat(file)).size;
    }
    catch {
        throw new Error(`File not found: "${file}".`);
    }
    if (size > MAX_UPLOAD_BYTES) {
        throw new Error(`"${path.basename(file)}" is ${(size / 1e6).toFixed(1)} MB — the analysis accepts PDFs up to 30 MB.`);
    }
    const bytes = new Uint8Array(await readFile(file));
    const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
    if (!head.includes('%PDF')) {
        throw new Error(`"${path.basename(file)}" is not a PDF. Export the drawing as PDF first — the analysis reads vector and scanned PDFs alike.`);
    }
    return { path: file, bytes };
}
export async function uploadDrawing(bytes: Uint8Array, fileName: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), encodeURIComponent(fileName));
    let response: Response;
    try {
        response = await fetch(`${appUrl()}/api/public/drawings`, { method: 'POST', body: form, headers: authHeaders() });
    }
    catch (e) {
        throw new UploadError(`The drawing analysis at ${appUrl()} could not be reached: ${describe(e)}`, 0);
    }
    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            limit?: number;
        };
        throw new UploadError(uploadErrorMessage(response.status, body), response.status);
    }
    const body = (await response.json().catch(() => ({}))) as {
        fileId?: string;
    };
    if (!body.fileId)
        throw new UploadError('The upload did not return a file id.', 502);
    return body.fileId;
}
export type PollOutcome = {
    status: 'ready';
    analysis: IFileStoreDrawingDataDto;
} | {
    status: 'processing';
    attempts: number;
};
export async function pollAnalysis(fileId: string, opts: {
    deadlineMs: number;
    onTick?: (attempt: number) => void | Promise<void>;
}): Promise<PollOutcome> {
    const started = Date.now();
    for (let attempt = 1;; attempt++) {
        let response: Response;
        try {
            response = await fetch(`${appUrl()}/api/public/drawings/${encodeURIComponent(fileId)}/analysis`, {
                headers: authHeaders(),
            });
        }
        catch (e) {
            throw new UploadError(`The drawing analysis at ${appUrl()} could not be reached: ${describe(e)}`, 0);
        }
        if (response.status === 200) {
            const dto = (await response.json()) as IFileStoreDrawingDataDto;
            if (dto.error) {
                throw new AnalysisFailedError(analysisErrorMessage(dto.error.analysisErrorCode), dto.error.analysisErrorCode);
            }
            return { status: 'ready', analysis: dto };
        }
        if (response.status === 404) {
            throw new AnalysisFailedError(`${analysisErrorMessage(AnalysisErrorCodes.Unknown)} (The analysis failed, or the file has already been deleted — uploads are kept only briefly.)`, AnalysisErrorCodes.Unknown);
        }
        if (response.status !== 202) {
            const body = (await response.json().catch(() => ({}))) as {
                error?: string;
            };
            throw new UploadError(body.error ?? `The drawing analysis returned HTTP ${response.status}.`, response.status);
        }
        await opts.onTick?.(attempt);
        if (Date.now() - started + POLL_INTERVAL_MS > opts.deadlineMs) {
            return { status: 'processing', attempts: attempt };
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}
export async function fetchOriginal(fileId: string): Promise<Uint8Array | null> {
    try {
        const response = await fetch(`${appUrl()}/api/public/drawings/${encodeURIComponent(fileId)}/original`, {
            headers: authHeaders(),
        });
        if (!response.ok)
            return null;
        return new Uint8Array(await response.arrayBuffer());
    }
    catch {
        return null;
    }
}
function uploadErrorMessage(status: number, body: {
    error?: string;
    limit?: number;
}): string {
    switch (status) {
        case 413:
            return 'The file is too large — the analysis accepts PDFs up to 30 MB.';
        case 429:
            return (`${body.error ?? 'The daily analysis limit has been reached.'} ` +
                `The free tier allows ${body.limit ?? 1} drawing analysis per day per IP address (resets at midnight UTC). ` +
                `Until then: drawings already analysed in this session can be masked again at no cost, and load_analysis re-opens any analysis saved earlier with save_analysis_to (offline, no credit). ` +
                `Need more today? Signed-in Imnoo users get a higher daily limit in the web app: ${appUrl()}`);
        case 503:
            return 'The drawing analysis is temporarily not configured on the server. Please try again later.';
        default:
            return body.error ?? `The upload failed (HTTP ${status}).`;
    }
}
export function analysisErrorMessage(code: AnalysisErrorCodes): string {
    switch (code) {
        case AnalysisErrorCodes.CorruptedFile:
            return 'The file could not be read. Please export the drawing as a regular PDF and try again.';
        case AnalysisErrorCodes.NoDrawings:
            return 'No technical drawing was detected in this file.';
        case AnalysisErrorCodes.TooManyDrawings:
            return 'The file contains more drawings than the analysis supports.';
        default:
            return 'The drawing analysis failed. Please try again.';
    }
}
export type DrawingSource = 'imnoo' | 'file';
export interface DrawingEntry {
    id: string;
    source: DrawingSource;
    fileId?: string;
    fileName: string;
    pdfPath?: string;
    pdfBytes?: Uint8Array;
    sha256?: string;
    analysis: IFileStoreDrawingDataDto;
    pages: PageGeometry[];
    pageBase: number;
    mainPageNr: number;
    tokens?: Map<number, TextToken[]> | null;
    lastMasking?: unknown;
}
const registry = new Map<string, DrawingEntry>();
const byHash = new Map<string, string>();
export function registerDrawing(entry: Omit<DrawingEntry, 'pages' | 'pageBase' | 'mainPageNr'>): DrawingEntry {
    const pages = pageGeometries(entry.analysis);
    if (!pages.length)
        throw new Error('The analysis contains no pages.');
    const previous = registry.get(entry.id);
    const full: DrawingEntry = {
        ...entry,
        pages,
        pageBase: pageIndexBase(entry.analysis),
        mainPageNr: selectMainPageNr(entry.analysis),
        lastMasking: entry.lastMasking ?? previous?.lastMasking,
    };
    registry.set(full.id, full);
    if (full.sha256)
        byHash.set(full.sha256, full.id);
    return full;
}
export function getDrawing(id: string): DrawingEntry | undefined {
    return registry.get(id);
}
export function findByHash(sha256: string): DrawingEntry | undefined {
    const id = byHash.get(sha256);
    return id ? registry.get(id) : undefined;
}
export async function attachPdf(entry: DrawingEntry, bytes: Uint8Array, pdfPath?: string): Promise<void> {
    entry.pdfBytes = bytes;
    if (pdfPath)
        entry.pdfPath = pdfPath;
    entry.sha256 = await sha256Hex(bytes);
    byHash.set(entry.sha256, entry.id);
    entry.tokens = undefined;
}
export async function resolveDrawing(id: string): Promise<DrawingEntry> {
    const known = registry.get(id);
    if (known)
        return known;
    if (/^public-/i.test(id)) {
        const outcome = await pollAnalysis(id, { deadlineMs: 0 });
        if (outcome.status === 'ready') {
            return registerDrawing({ id, source: 'imnoo', fileId: id, fileName: id, analysis: outcome.analysis });
        }
        throw new Error(`Drawing "${id}" is not available yet (still being analysed, or unknown). Call analyze_drawing with drawing_id="${id}" to wait for it.`);
    }
    throw new Error(`Unknown drawing_id "${id}". Call analyze_drawing (upload a drawing PDF) or load_analysis (open a saved analysis JSON) first — both return the drawing_id to use here.`);
}
export async function drawingPdf(entry: DrawingEntry): Promise<Uint8Array | null> {
    if (entry.pdfBytes)
        return entry.pdfBytes;
    if (entry.pdfPath) {
        const file = await readPdfFile(entry.pdfPath);
        await attachPdf(entry, file.bytes);
        return file.bytes;
    }
    if (entry.fileId) {
        const bytes = await fetchOriginal(entry.fileId);
        if (bytes)
            await attachPdf(entry, bytes);
        return bytes;
    }
    return null;
}
export async function drawingTokens(entry: DrawingEntry): Promise<Map<number, TextToken[]> | null> {
    if (entry.tokens !== undefined)
        return entry.tokens;
    const bytes = await drawingPdf(entry);
    if (!bytes) {
        entry.tokens = null;
        return null;
    }
    try {
        entry.tokens = await textTokens(bytes, entry.pages, entry.pageBase);
    }
    catch {
        entry.tokens = new Map();
    }
    return entry.tokens;
}
