import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { format } from 'node:util';
import { z } from 'zod';
import pkg from '../package.json';
import symbolaFont from '../assets/fonts/Symbola-Subset.ttf';
import { analysisErrorMessage, appUrl, attachPdf, drawingPdf, drawingTokens, findByHash, getDrawing, MAX_PAGES, pollAnalysis, readPdfFile, registerDrawing, resolveDrawing, uploadDrawing, } from './analysis-client';
import type { DrawingEntry } from './analysis-client';
import { buildMaskedPdf, sha256Hex } from './engine';
import type { IFileStoreDrawingDataDto, LogoAsset, MaskCategory, ShareExpiry } from './engine';
import { CATEGORY_TYPES, composeMasking, coverageReport, describeComposition, describeDrawing, outputFileName, visibleText, } from './masking';
import type { MaskingOptions } from './masking';
import { pdfPageCount, rasterize, readPdfMetadata } from './pdf-node';
import { createShareLink } from './share-client';
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[m] = (...args: unknown[]) => {
        process.stderr.write(format(...args) + '\n');
    };
}
const WEB_APP = 'https://drawing-anonymizer.imnoo.com';
const REVIEW_CAVEAT = 'Detections come from an automated drawing analysis and can miss text (person names, free-text notes, unusual layouts) — check visible_text_after_masking in review_masking and add terms or rectangles for anything still identifying before the drawing is shared.';
const QUOTA_NOTE = "analyze_drawing uploads the PDF to Imnoo's drawing analysis (the service behind the web app): 1 free analysis per day per IP address (signed-in users get more in the web app); uploaded files are deleted automatically within 24 hours and nothing else is stored. Masking itself runs locally and is unlimited.";
function ok(payload: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}
function fail(message: string) {
    return { content: [{ type: 'text' as const, text: message }], isError: true };
}
const describeError = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function guarded<T>(fn: () => Promise<T>): Promise<T | ReturnType<typeof fail>> {
    try {
        return await fn();
    }
    catch (e) {
        return fail(describeError(e));
    }
}
const CATEGORY = z.enum(CATEGORY_TYPES);
const MASKING = z
    .object({
    categories: z
        .array(CATEGORY)
        .optional()
        .describe('categories masked automatically — default: CompanyName, Name, Address, PhoneNr, Email, Website, CompanyLogo, Other (ArticleNr, DrawingNr and Date stay visible for traceability). Pass the full list you want; [] masks no detection automatically.'),
    detection_scope: z
        .enum(['page', 'title_block'])
        .optional()
        .describe('page (default): mask detections anywhere on the sheet; title_block: only those inside the inferred title block (bottom-right), so notes elsewhere stay untouched. Explicit mask ids, terms and rectangles are never filtered.'),
    mode: z
        .enum(['whiteout', 'replace'])
        .optional()
        .describe('whiteout (default): cover detections with blank boxes; replace: print replacement text inside the boxes (company_name for company names, replacements[] per detection)'),
    company_name: z.string().optional().describe('own company name printed over detected company names in mode "replace" (max 32 characters)'),
    logo_path: z.string().optional().describe('own logo (PNG or JPEG, < 1 MB) drawn into every detected logo instead of a blank box'),
    mask: z.array(z.string()).optional().describe('detection ids to mask regardless of their category'),
    unmask: z.array(z.string()).optional().describe('detection ids to keep visible regardless of their category'),
    replacements: z
        .array(z.object({ id: z.string(), text: z.string() }))
        .optional()
        .describe('per-detection replacement text for mode "replace", e.g. [{"id": "…", "text": "Supplier GmbH"}] (max 32 characters each)'),
    terms: z
        .array(z.string())
        .optional()
        .describe('custom text to mask everywhere it appears (case- and spacing-insensitive, across split words), e.g. a customer or project name the analysis missed; needs the PDF text layer'),
    rectangles: z
        .array(z.object({
        page: z.number().int().min(1).describe('1-based PDF page'),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        category: CATEGORY.optional().describe('report category (default Other)'),
    }))
        .optional()
        .describe('extra areas to cover, in analysis image pixels of the page (top-left origin, the same space as the detection boxes)'),
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('mask colour, #rrggbb (default #ffffff white)'),
    opacity: z.number().min(0).max(100).optional().describe('mask opacity 0–100 (default 100; below 100 the covered content stays readable)'),
    pages: z.array(z.number().int().min(1)).optional().describe('1-based PDF pages to write (default all)'),
    secure: z
        .boolean()
        .optional()
        .describe('true (default): rasterize every page after masking so covered text and graphics are destroyed (tamper-proof single-layer PDF); false: layered PDF, masks painted over the intact content'),
    scrub_metadata: z.boolean().optional().describe('remove author, title, subject, keywords, creator and XMP from the document (default true)'),
    include_report: z.boolean().optional().describe('append a masking coverage report page (default false)'),
    article_number: z.string().optional().describe('your own article number for this part — names the output file and can be stamped on the sheet'),
    stamp_article_number: z.boolean().optional().describe('print article_number top-right on the main page (default false)'),
    name_after_article_number: z
        .boolean()
        .optional()
        .describe('name the output <article number>_masked.pdf (default true; falls back to the article number the analysis read, then the file name)'),
})
    .optional()
    .describe('Masking settings — shared by review_masking and mask_drawing; pass the same object to both so the PDF matches the reviewed masks. Everything is optional; the defaults reproduce the web app.');
type MaskingArgs = z.infer<typeof MASKING>;
async function loadLogo(logoPath: string): Promise<LogoAsset> {
    const file = path.resolve(logoPath);
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await readFile(file));
    }
    catch {
        throw new Error(`logo_path: file not found: "${file}".`);
    }
    if (bytes.length >= 1000000)
        throw new Error('logo_path: the logo must be smaller than 1 MB.');
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpg)
        throw new Error('logo_path: please use a PNG or JPEG logo.');
    return { bytes, type: isPng ? 'png' : 'jpg' };
}
async function toOptions(m: MaskingArgs): Promise<MaskingOptions> {
    if (!m)
        return {};
    return {
        categories: m.categories as MaskCategory[] | undefined,
        detectionScope: m.detection_scope === 'title_block' ? 'titleBlock' : m.detection_scope === 'page' ? 'page' : undefined,
        mode: m.mode,
        companyName: m.company_name,
        logo: m.logo_path ? await loadLogo(m.logo_path) : null,
        mask: m.mask,
        unmask: m.unmask,
        replacements: m.replacements,
        terms: m.terms,
        rectangles: m.rectangles as MaskingOptions['rectangles'],
        color: m.color,
        opacity: m.opacity,
        pages: m.pages,
        secure: m.secure,
        scrubMetadata: m.scrub_metadata,
        includeReport: m.include_report,
        articleNumber: m.article_number,
        stampArticleNumber: m.stamp_article_number,
        nameAfterArticleNumber: m.name_after_article_number,
    };
}
const pending = new Map<string, {
    fileName: string;
    pdfPath?: string;
    bytes?: Uint8Array;
}>();
type Extra = {
    _meta?: {
        progressToken?: string | number;
    };
    sendNotification: (notification: never) => Promise<void>;
};
async function progress(extra: Extra, value: number, message: string): Promise<void> {
    const token = extra._meta?.progressToken;
    if (token == null)
        return;
    try {
        await extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken: token, progress: value, message },
        } as never);
    }
    catch {
    }
}
const exists = (p: string) => access(p).then(() => true, () => false);
type Analyzed = {
    entry: DrawingEntry;
    reused: boolean;
} | {
    processing: {
        drawing_id: string;
        waited_seconds: number;
    };
};
async function analyzeFile(pdfPath: string, deadlineMs: number, extra: Extra): Promise<Analyzed> {
    const file = await readPdfFile(pdfPath);
    const fileName = path.basename(file.path);
    const known = findByHash(await sha256Hex(file.bytes));
    if (known) {
        if (!known.pdfPath)
            known.pdfPath = file.path;
        if (!known.pdfBytes)
            await attachPdf(known, file.bytes);
        return { entry: known, reused: true };
    }
    let pageCount: number | null = null;
    try {
        pageCount = await pdfPageCount(file.bytes);
    }
    catch {
        pageCount = null;
    }
    if (pageCount != null && pageCount > MAX_PAGES) {
        throw new Error(`"${fileName}" has ${pageCount} pages — up to ${MAX_PAGES} pages are treated as one drawing. Split the PDF and mask each part.`);
    }
    await progress(extra, 0, `Uploading ${fileName}…`);
    const fileId = await uploadDrawing(file.bytes, fileName);
    pending.set(fileId, { fileName, pdfPath: file.path, bytes: file.bytes });
    return waitForAnalysis(fileId, deadlineMs, extra);
}
async function waitForAnalysis(fileId: string, deadlineMs: number, extra: Extra): Promise<Analyzed> {
    const info = pending.get(fileId);
    const fileName = info?.fileName ?? fileId;
    const started = Date.now();
    const outcome = await pollAnalysis(fileId, {
        deadlineMs,
        onTick: attempt => progress(extra, attempt, `Analysing ${fileName}… ${Math.round((Date.now() - started) / 1000)}s`),
    });
    if (outcome.status === 'processing') {
        return { processing: { drawing_id: fileId, waited_seconds: Math.round((Date.now() - started) / 1000) } };
    }
    const entry = registerDrawing({ id: fileId, source: 'imnoo', fileId, fileName, pdfPath: info?.pdfPath, analysis: outcome.analysis });
    if (info?.bytes)
        await attachPdf(entry, info.bytes, info.pdfPath);
    pending.delete(fileId);
    return { entry, reused: false };
}
function processingResult(p: {
    drawing_id: string;
    waited_seconds: number;
}, tool: string) {
    return ok({
        drawing_id: p.drawing_id,
        status: 'processing',
        waited_seconds: p.waited_seconds,
        next: `The analysis is still running. Call ${tool} again with drawing_id="${p.drawing_id}" (and no pdf_path) to keep waiting — that costs no additional credit.`,
    });
}
async function resolveOutput(requested: string | undefined, entry: DrawingEntry, defaultName: string, overwrite: boolean | undefined): Promise<string> {
    const defaultDir = entry.pdfPath ? path.dirname(entry.pdfPath) : process.cwd();
    let output = path.resolve(requested ?? path.join(defaultDir, defaultName));
    const isDir = !!requested && (/[\\/]$/.test(requested) || (await stat(output).then(s => s.isDirectory(), () => false)));
    if (isDir)
        output = path.join(output, defaultName);
    if (entry.pdfPath && path.resolve(entry.pdfPath).toLowerCase() === output.toLowerCase()) {
        throw new Error('The output path is the source drawing itself — the original is never overwritten. Choose another output_path.');
    }
    if (!overwrite && (await exists(output))) {
        throw new Error(`"${output}" already exists. Pass overwrite=true to replace it.`);
    }
    await mkdir(path.dirname(output), { recursive: true });
    return output;
}
const server = new McpServer({ name: 'drawing-anonymizer', title: 'Drawing Anonymizer', version: pkg.version }, {
    instructions: `Anonymize technical drawings before they leave the company — the engine behind ${WEB_APP} (Imnoo). Finds company names, logos, people, addresses, phone numbers, emails, websites and other identifying data on drawing PDFs, masks them and writes a tamper-proof, metadata-free PDF (or an expiring share link) — NDA- and GDPR-safe drawing exchange with suppliers, subcontractors and customers.

Typical flow:
1. analyze_drawing — upload the PDF (up to ${MAX_PAGES} pages, ≤ 30 MB) to Imnoo's drawing analysis and get every detection with an id, category, value, page, box and whether it is masked by default. ${QUOTA_NOTE} save_analysis_to keeps the analysis JSON; load_analysis re-opens it offline.
2. review_masking — see exactly what the output will hide and what stays visible, the anonymity score, warnings and the text a reader will still see. Adjust the \`masking\` options (categories, detection scope, mask/unmask ids, custom terms, rectangles, replace mode with your own company name or logo) and call again until nothing identifying is left. Offline and free.
3. mask_drawing — write the masked PDF with the same \`masking\` object (secure = flattened, metadata scrubbed, by default) and optionally create an expiring share link (1m, 15m, 1h, 24h) that serves only the masked copy. mask_drawing also accepts pdf_path directly for a one-shot run, and an identical PDF reuses its analysis and its last masking.

Detection ids come from analyze_drawing/load_analysis; pages are 1-based PDF pages; boxes are analysis image pixels. ${REVIEW_CAVEAT}`,
});
server.registerTool('analyze_drawing', {
    title: 'Analyse a drawing PDF for sensitive data (Imnoo drawing analysis)',
    description: `Upload a technical-drawing PDF to Imnoo's drawing analysis and return the sensitive data it finds — company names, logos, person names, addresses, phone numbers, emails, websites, article numbers, drawing numbers, dates and other identifying text — each with a detection id, category, value, PDF page, box (analysis image pixels), confidence, whether it sits in the title block and whether it is masked by default, plus the page sizes. Up to ${MAX_PAGES} pages are treated as one drawing. Analysis takes roughly 10–120 s; the call waits up to timeout_seconds and otherwise returns status "processing" with the drawing_id to resume with. An identical PDF analysed earlier in this session is returned from memory (no upload). ${QUOTA_NOTE}`,
    inputSchema: {
        pdf_path: z.string().optional().describe('path to the drawing PDF (vector or scanned, ≤ 30 MB)'),
        drawing_id: z
            .string()
            .optional()
            .describe('instead of pdf_path: the drawing_id of an earlier upload that returned status "processing" — keeps waiting for it without a new upload'),
        save_analysis_to: z.string().optional().describe('write the analysis JSON to this path (re-open it later with load_analysis, no upload needed)'),
        timeout_seconds: z.number().int().min(10).max(600).optional().describe('how long to wait for the analysis before returning "processing" (default 180)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ pdf_path, drawing_id, save_analysis_to, timeout_seconds }, extra) => guarded(async () => {
    const deadlineMs = (timeout_seconds ?? 180) * 1000;
    let result: Analyzed;
    if (drawing_id && !pdf_path) {
        const known = getDrawing(drawing_id);
        if (known) {
            result = { entry: known, reused: true };
        }
        else {
            if (!/^public-/i.test(drawing_id)) {
                return fail(`drawing_id "${drawing_id}" is not an Imnoo upload id. Pass pdf_path to analyse a new drawing, or use load_analysis for a saved analysis JSON.`);
            }
            result = await waitForAnalysis(drawing_id, deadlineMs, extra as Extra);
        }
    }
    else if (pdf_path) {
        result = await analyzeFile(pdf_path, deadlineMs, extra as Extra);
    }
    else {
        return fail('Pass pdf_path (a drawing PDF to analyse) or drawing_id (an earlier upload to keep waiting for).');
    }
    if ('processing' in result)
        return processingResult(result.processing, 'analyze_drawing');
    const { entry, reused } = result;
    let saved: string | undefined;
    if (save_analysis_to) {
        saved = path.resolve(save_analysis_to);
        await mkdir(path.dirname(saved), { recursive: true });
        await writeFile(saved, JSON.stringify(entry.analysis, null, 2));
    }
    return ok({
        ...describeDrawing(entry),
        status: 'ready',
        ...(reused ? { reused: 'Already analysed in this session (identical PDF) — no upload, no credit.' } : {}),
        ...(saved ? { analysis_saved_to: saved } : {}),
        notes: [REVIEW_CAVEAT, QUOTA_NOTE],
    });
}));
server.registerTool('load_analysis', {
    title: 'Open a saved drawing analysis (offline)',
    description: 'Open a drawing analysis JSON saved earlier (analyze_drawing with save_analysis_to, or the Imnoo FileStore analysis document) and register it as a drawing for review_masking and mask_drawing. Fully offline — no upload, no daily credit. Pass pdf_path as well: masking needs the original PDF, and custom terms search its text.',
    inputSchema: {
        analysis_path: z.string().describe('path to the analysis JSON'),
        pdf_path: z.string().optional().describe('path to the matching drawing PDF (needed to write the masked PDF)'),
        drawing_id: z.string().optional().describe('id to register the drawing under (default: the analysis id, else the file name)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ analysis_path, pdf_path, drawing_id }) => guarded(async () => {
    const file = path.resolve(analysis_path);
    let dto: IFileStoreDrawingDataDto;
    try {
        dto = JSON.parse(await readFile(file, 'utf8')) as IFileStoreDrawingDataDto;
    }
    catch (e) {
        return fail(`Could not read "${file}": ${describeError(e)}`);
    }
    if (!dto || typeof dto !== 'object' || !dto.pages || typeof dto.pages !== 'object') {
        return fail(`"${file}" is not a drawing analysis — expected the analysis JSON with a "pages" object, as written by analyze_drawing's save_analysis_to.`);
    }
    if (dto.error)
        return fail(`This analysis failed: ${analysisErrorMessage(dto.error.analysisErrorCode)}`);
    const pdf = pdf_path ? await readPdfFile(pdf_path) : null;
    const id = drawing_id?.trim() || (typeof dto.id === 'string' && dto.id.trim()) || path.basename(file).replace(/\.json$/i, '');
    const fileName = pdf ? path.basename(pdf.path) : `${id}.pdf`;
    const entry = registerDrawing({ id, source: 'file', fileName, pdfPath: pdf?.path, analysis: dto });
    if (pdf)
        await attachPdf(entry, pdf.bytes, pdf.path);
    return ok({
        ...describeDrawing(entry),
        status: 'ready',
        notes: [
            ...(pdf ? [] : ['No pdf_path given — mask_drawing needs the original drawing; pass pdf_path here or to mask_drawing.']),
            REVIEW_CAVEAT,
        ],
    });
}));
server.registerTool('review_masking', {
    title: 'Review what the masked drawing will hide',
    description: 'Compose the masks for an analysed drawing exactly as mask_drawing will, without writing anything: which detections are masked (with their replacement in mode "replace") and which stay visible, custom-term matches, rectangles, the article-number stamp, the pages written, the anonymity score (0–100) with its warnings, the output file name, and visible_text_after_masking — the text a reader will still see on each page (from the PDF text layer). Use it to find leftovers (a customer name in the notes, a person the analysis missed) and add them as terms or rectangles. Deterministic and offline — iterate freely.',
    inputSchema: {
        drawing_id: z.string().describe('from analyze_drawing or load_analysis'),
        masking: MASKING,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ drawing_id, masking }) => guarded(async () => {
    const entry = await resolveDrawing(drawing_id);
    const options = await toOptions(masking);
    const tokens = await drawingTokens(entry);
    const composed = composeMasking(entry, options, tokens);
    const bytes = await drawingPdf(entry);
    const metadata = bytes ? await readPdfMetadata(bytes) : [];
    const report = coverageReport(composed, entry, metadata);
    return ok({
        drawing_id: entry.id,
        ...describeComposition(entry, composed, report),
        metadata_found: metadata,
        output_file_name: outputFileName(entry, composed.settings),
        visible_text_after_masking: visibleText(entry, composed.boxes, tokens, composed.exportedPages) ??
            'Unknown — the drawing PDF is not available; pass pdf_path to load_analysis to see the remaining text.',
        notes: [REVIEW_CAVEAT],
    });
}));
server.registerTool('mask_drawing', {
    title: 'Write the masked (anonymized) drawing PDF',
    description: 'Mask the drawing and write the anonymized PDF: blank (or replacement-text / own-logo) boxes over every masked detection, custom term and rectangle; by default every page is then rasterized at 288 dpi so the covered content is destroyed rather than painted over (tamper-proof single-layer PDF) and the document metadata (author, title, producer, XMP) is removed. Optional coverage report page and page selection. share_link additionally uploads the MASKED copy (never the original) and returns an expiring public link (1m, 15m, 1h or 24h). Accepts drawing_id (from analyze_drawing/load_analysis) or pdf_path for a one-shot run (analyses first). When masking is omitted for a drawing masked before in this session — including an identical PDF under another path — the previous masking is reused. Default location: next to the drawing PDF as <article number>_masked.pdf (else <file name>_masked.pdf); the source PDF is never modified.',
    inputSchema: {
        drawing_id: z.string().optional().describe('from analyze_drawing or load_analysis'),
        pdf_path: z
            .string()
            .optional()
            .describe('the drawing PDF — analysed first when it is not known yet (one daily credit), or the original PDF for a drawing_id loaded without one'),
        masking: MASKING,
        output_path: z.string().optional().describe('target .pdf path, or a directory (default: next to the drawing PDF, else the working directory)'),
        overwrite: z.boolean().optional().describe('allow replacing an existing output file'),
        share_link: z
            .enum(['1m', '15m', '1h', '24h'])
            .optional()
            .describe('also create an expiring public link to the masked copy, valid for 1 minute, 15 minutes, 1 hour or 24 hours'),
        timeout_seconds: z.number().int().min(10).max(600).optional().describe('with pdf_path: how long to wait for the analysis (default 180)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ drawing_id, pdf_path, masking, output_path, overwrite, share_link, timeout_seconds }, extra) => guarded(async () => {
    let entry: DrawingEntry;
    if (drawing_id) {
        entry = await resolveDrawing(drawing_id);
        if (pdf_path) {
            const file = await readPdfFile(pdf_path);
            if (!entry.pdfBytes)
                await attachPdf(entry, file.bytes, file.path);
            else if ((await sha256Hex(file.bytes)) !== entry.sha256) {
                return fail(`pdf_path is a different PDF than the one drawing "${entry.id}" was analysed from. Pass only pdf_path to analyse it, or only drawing_id.`);
            }
        }
    }
    else if (pdf_path) {
        const analyzed = await analyzeFile(pdf_path, (timeout_seconds ?? 180) * 1000, extra as Extra);
        if ('processing' in analyzed)
            return processingResult(analyzed.processing, 'mask_drawing');
        entry = analyzed.entry;
    }
    else {
        return fail('Pass drawing_id (from analyze_drawing or load_analysis) or pdf_path (a drawing PDF to analyse and mask).');
    }
    const reused = masking === undefined && entry.lastMasking !== undefined;
    const maskingArgs = (masking ?? entry.lastMasking) as MaskingArgs;
    const options = await toOptions(maskingArgs);
    const bytes = await drawingPdf(entry);
    if (!bytes) {
        return fail(`The original PDF of drawing "${entry.id}" is not available (uploads are deleted after 24 hours) — pass pdf_path.`);
    }
    const tokens = await drawingTokens(entry);
    const composed = composeMasking(entry, options, tokens);
    const metadata = await readPdfMetadata(bytes);
    const report = coverageReport(composed, entry, metadata);
    await progress(extra as Extra, 0, composed.settings.secureDownload ? 'Masking and flattening the pages…' : 'Masking…');
    let result;
    try {
        result = await buildMaskedPdf({
            sourcePdf: bytes,
            pages: entry.pages,
            pageIndexBase: entry.pageBase,
            boxes: composed.boxes,
            settings: composed.settings,
            logo: options.logo,
            symbolFont: symbolaFont,
            rasterize,
            pageSelection: composed.pageSelection,
            report: { report, fileName: entry.fileName },
        });
    }
    catch (e) {
        return fail(`Writing the masked PDF failed: ${describeError(e)}. Encrypted or damaged PDFs cannot always be processed — re-export the drawing as a plain PDF.`);
    }
    const output = await resolveOutput(output_path, entry, outputFileName(entry, composed.settings), overwrite);
    await writeFile(output, result.bytes);
    entry.lastMasking = maskingArgs ?? {};
    let share: {
        url: string;
        expires_at: string;
        expires_in_seconds: number;
    } | undefined;
    let shareError: string | undefined;
    if (share_link) {
        try {
            const link = await createShareLink(result.bytes, path.basename(output), share_link as ShareExpiry);
            share = { url: link.url, expires_at: link.expiresAt, expires_in_seconds: link.expiresInSeconds };
        }
        catch (e) {
            shareError = describeError(e);
        }
    }
    const summary = describeComposition(entry, composed, report);
    return ok({
        output,
        bytes: result.bytes.length,
        pages_written: result.pageCount,
        secure_flattened: result.flattened,
        masks_drawn: result.drawn,
        detections_masked: summary.masked.length,
        left_visible: summary.left_visible,
        custom_terms: summary.custom_terms,
        rectangles: summary.rectangles.length,
        article_number_stamp: summary.article_number_stamp,
        metadata_removed: composed.settings.scrubMetadata ? result.metadataFound : [],
        anonymity_score: report.score,
        warnings: summary.warnings,
        ...(summary.unknown_ids_ignored ? { unknown_ids_ignored: summary.unknown_ids_ignored } : {}),
        ...(reused ? { masking_reused: 'No masking given — reused the masking of the previous mask_drawing call for this drawing.' } : {}),
        ...(share ? { share_link: share } : {}),
        ...(shareError ? { share_link_error: shareError } : {}),
        drawing_id: entry.id,
        notes: [REVIEW_CAVEAT],
    });
}));
server.registerPrompt('anonymize-drawing', {
    title: 'Anonymize a drawing before sharing it',
    description: 'Guided flow: analyse the drawing, review what stays visible, mask leftovers, write the secure PDF (and optionally a share link).',
    argsSchema: {
        pdf_path: z.string().describe('path to the drawing PDF'),
        company_name: z.string().optional().describe('your company name, printed over detected company names'),
        share: z.string().optional().describe('share-link lifetime: 1m, 15m, 1h or 24h'),
    },
}, ({ pdf_path, company_name, share }) => ({
    messages: [
        {
            role: 'user',
            content: {
                type: 'text',
                text: `Anonymize the technical drawing at "${pdf_path}" so it can be shared with a supplier without revealing whose part it is:

1. Call analyze_drawing (save the analysis JSON next to the drawing with save_analysis_to). If it returns status "processing", call it again with the drawing_id until it is ready.
2. Call review_masking${company_name ? ` with masking.mode="replace" and masking.company_name="${company_name}"` : ''}. Read visible_text_after_masking: anything that still identifies the customer, a person, a project or an address must be masked — add it to masking.terms (or masking.rectangles for graphics), or mask detection ids that were left visible. Keep article numbers, drawing numbers, dimensions and tolerances visible. Call review_masking again until nothing identifying is left.
3. Call mask_drawing with the same masking object${share ? ` and share_link="${share}"` : ''}.
4. Report the output path${share ? ', the share link and when it expires' : ''}, the anonymity score, what was masked per category, and anything the user should double-check.`,
            },
        },
    ],
}));
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`drawing-anonymizer-mcp v${pkg.version} ready on stdio (analysis: ${appUrl()})\n`);
}
main().catch(e => {
    process.stderr.write(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
});
