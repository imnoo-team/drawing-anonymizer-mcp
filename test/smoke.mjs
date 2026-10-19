// End-to-end smoke test: drives the bundled server over real stdio MCP against the web app's
// bundled sample drawing (test/fixtures — the web app's public sample drawing):
// discovery, load_analysis, review_masking in several configurations, mask_drawing in secure
// and layered form (checked by reading the output's text layer and pixels), reuse of
// identical PDFs, the guard rails, and the error paths that need no network.
//
// Run: npm test   (builds first)
// Live upload + share link (spends one daily analysis credit of your IP): SMOKE_LIVE=1 npm test
//   — set DRAWING_ANONYMIZER_URL to the dev app to test against dev.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCanvas } from '@napi-rs/canvas';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = path.dirname(fileURLToPath(import.meta.url)); // mcp/test
const pkgRoot = path.dirname(root); // mcp/
const fixtures = path.join(root, 'fixtures');
const outDir = path.join(root, 'out');
const sampleJson = path.join(fixtures, 'sample-analysis.json');
const samplePdf = path.join(fixtures, 'sample-drawing.pdf');
const logoPng = path.join(fixtures, 'icon-256.png');
const LIVE = process.env.SMOKE_LIVE === '1';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const fontDir = path.join(pdfjsRoot, 'standard_fonts').replace(/\\/g, '/') + '/';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function parseTool(res) {
  if (res.isError) throw new Error(`tool error: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content[0].text);
}

const call = (name, args) => client.callTool({ name, arguments: args });
const callJson = async (name, args) => parseTool(await call(name, args));
const errorText = async (name, args) => {
  const res = await call(name, args);
  return res.isError ? res.content[0].text : '';
};

async function loadPdf(bytes) {
  return getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: fontDir, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
}

/** All text of a PDF (every page), joined. */
async function pdfText(bytes) {
  const doc = await loadPdf(bytes);
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  await doc.destroy();
  return text;
}

/** Dark pixels inside an analysis-space box of page 1, rendered at the analysis resolution. */
async function darkPixels(bytes, box, analysisWidth) {
  const doc = await loadPdf(bytes);
  const page = await doc.getPage(1);
  const scale = analysisWidth / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  const data = ctx.getImageData(Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)).data;
  await doc.destroy();
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
  return dark;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pkgRoot, 'dist', 'index.js')],
  cwd: pkgRoot,
  stderr: 'pipe',
  env: { ...process.env },
});
const client = new Client({ name: 'smoke-test', version: '0.0.0' });
await client.connect(transport);

try {
  // --- discovery ----------------------------------------------------------------------
  console.log('discovery');
  const tools = await client.listTools();
  const names = tools.tools.map(t => t.name).sort();
  check('lists 4 tools', JSON.stringify(names) === JSON.stringify(['analyze_drawing', 'load_analysis', 'mask_drawing', 'review_masking']), names.join(','));
  check('every tool has a description and annotations', tools.tools.every(t => (t.description ?? '').length > 80 && t.annotations));
  const prompts = await client.listPrompts();
  check('anonymize-drawing prompt', prompts.prompts.some(p => p.name === 'anonymize-drawing'));
  const prompt = await client.getPrompt({ name: 'anonymize-drawing', arguments: { pdf_path: 'x.pdf', company_name: 'Supplier AG', share: '1h' } });
  check('prompt walks the flow', /review_masking[\s\S]*mask_drawing[\s\S]*share_link="1h"/.test(prompt.messages[0].content.text));
  check('server instructions describe the flow', /analyze_drawing[\s\S]*review_masking[\s\S]*mask_drawing/.test(client.getInstructions() ?? ''));

  // --- load_analysis ------------------------------------------------------------------
  console.log('load_analysis');
  const drawing = await callJson('load_analysis', { analysis_path: sampleJson, pdf_path: samplePdf });
  check('registers the sample', drawing.drawing_id === 'sample-analysis' && drawing.status === 'ready');
  check('18 detections', drawing.detections_found === 18, String(drawing.detections_found));
  check('1-based page with size', drawing.pages[0].page === 1 && drawing.pages[0].width_px === 2381 && drawing.pages[0].size_mm === '420 × 297');
  check('title block values', drawing.title_block.article_number === 'ART-88213' && drawing.title_block.drawing_number === 'DRW-10457-B');
  const det = id => drawing.detections.find(d => d.id === id);
  check('company name masked by default, article nr kept', det('sd-02').masked_by_default === true && det('sd-14').masked_by_default === false);
  check('title-block flag', det('sd-14').in_title_block === true && det('sd-03').in_title_block === false);
  check('logo reported with a placeholder value', det('sd-04').category === 'CompanyLogo' && det('sd-04').value === '(logo)');
  check('low confidence kept', det('sd-16').confidence === 0.58);

  // --- review_masking -----------------------------------------------------------------
  console.log('review_masking');
  const review = await callJson('review_masking', { drawing_id: 'sample-analysis' });
  check('default: 14 masked, 4 visible', review.masked.length === 14 && review.left_visible.length === 4, `${review.masked.length}/${review.left_visible.length}`);
  check('visible: article nr, drawing nr, two dates', review.left_visible.map(d => d.category).sort().join() === 'ArticleNr,Date,Date,DrawingNr');
  check('secure + scrubbed by default', review.secure === true && review.scrub_metadata === true);
  check('anonymity score 100 when everything identifying is masked', review.anonymity_score === 100, String(review.anonymity_score));
  check('output named after the article number', review.output_file_name === 'ART-88213_masked.pdf', review.output_file_name);
  const visible = (review.visible_text_after_masking['1'] ?? []).join(' | ');
  check('masked email no longer visible', !visible.includes('info@acme-precision.example'), visible.slice(0, 200));
  check('drawing number still visible', visible.includes('DRW-10457-B'));
  check('detected name inside a notes line shows as a gap', visible.includes('4. Deburr; mark with article no. a[masked]'), visible.slice(0, 600));
  check('leftover found: the undetected part title', visible.includes('BRACKET LEFT'));
  check('lists low-confidence warning', review.warnings.some(w => /low-confidence/.test(w)));

  const withTerms = await callJson('review_masking', {
    drawing_id: 'sample-analysis',
    masking: { terms: ['BRACKET LEFT', 'bracket  left', 'anodized black', 'ACME Precision GmbH'] },
  });
  const term = t => withTerms.custom_terms.find(c => c.term === t);
  check('terms deduplicated case- and spacing-insensitively', withTerms.custom_terms.length === 3, JSON.stringify(withTerms.custom_terms));
  check('whole-token term masked', term('BRACKET LEFT').masks_added === 1, JSON.stringify(term('BRACKET LEFT')));
  check('term inside a longer line masked', term('anodized black').masks_added === 1);
  check('term skips occurrences already covered', term('ACME Precision GmbH').masks_added === 0 && term('ACME Precision GmbH').already_covered >= 3, JSON.stringify(term('ACME Precision GmbH')));
  const visibleAfterTerms = (withTerms.visible_text_after_masking['1'] ?? []).join(' | ');
  check('part title gone', !visibleAfterTerms.includes('BRACKET LEFT'));
  check('notes line shows the term as a gap', visibleAfterTerms.includes('3. Surface: [masked], co[masked]'), visibleAfterTerms.slice(0, 600));

  const scoped = await callJson('review_masking', { drawing_id: 'sample-analysis', masking: { detection_scope: 'title_block' } });
  check('title_block scope keeps the footer visible', scoped.left_visible.some(d => d.id === 'sd-03') && scoped.detection_scope === 'title_block');
  check('title_block scope warns', scoped.warnings.some(w => /title block/i.test(w)));

  const none = await callJson('review_masking', { drawing_id: 'sample-analysis', masking: { categories: [] } });
  check('categories [] masks nothing automatically', none.masked.length === 0 && none.anonymity_score < 50, String(none.anonymity_score));

  const overrides = await callJson('review_masking', {
    drawing_id: 'sample-analysis',
    masking: { unmask: ['sd-03'], mask: ['sd-14', 'nope-1'], mode: 'replace', company_name: 'Supplier AG', replacements: [{ id: 'sd-06', text: 'Industriestrasse 1, 8000 Zürich' }] },
  });
  check('unmask/mask overrides', overrides.left_visible.some(d => d.id === 'sd-03') && overrides.masked.some(d => d.id === 'sd-14'));
  check('unknown ids reported', JSON.stringify(overrides.unknown_ids_ignored) === '["nope-1"]');
  const companyRow = overrides.masked.find(d => d.id === 'sd-02');
  check('replace mode prints the own company name', companyRow?.replacement === 'Supplier AG', JSON.stringify(companyRow));
  check('per-detection replacement', overrides.masked.find(d => d.id === 'sd-06')?.replacement === 'Industriestrasse 1, 8000 Zürich');

  const rect = await callJson('review_masking', {
    drawing_id: 'sample-analysis',
    masking: { rectangles: [{ page: 1, x: 1400, y: 1560, width: 200, height: 40 }] },
  });
  check('rectangle reports the text it covers', rect.rectangles.length === 1 && /Nordwind/.test(rect.rectangles[0].covers_text ?? ''), JSON.stringify(rect.rectangles));

  check('bad page rejected', /pages: 3 not in the drawing/.test(await errorText('review_masking', { drawing_id: 'sample-analysis', masking: { pages: [3] } })));
  check('rectangle outside the page rejected', /lies outside page 1/.test(await errorText('review_masking', { drawing_id: 'sample-analysis', masking: { rectangles: [{ page: 1, x: 9000, y: 10, width: 10, height: 10 }] } })));
  check('bad colour rejected by the schema', (await call('review_masking', { drawing_id: 'sample-analysis', masking: { color: 'red' } })).isError === true);
  check('unknown drawing rejected', /Unknown drawing_id/.test(await errorText('review_masking', { drawing_id: 'nope' })));

  // --- mask_drawing -------------------------------------------------------------------
  console.log('mask_drawing');
  const secure = await callJson('mask_drawing', { drawing_id: 'sample-analysis', output_path: outDir + path.sep });
  check('secure output written', secure.output === path.join(outDir, 'ART-88213_masked.pdf') && (await stat(secure.output)).size === secure.bytes);
  check('one page, flattened', secure.pages_written === 1 && secure.secure_flattened === true);
  check('14 masks drawn', secure.masks_drawn === 14, String(secure.masks_drawn));
  const secureBytes = await readFile(secure.output);
  check('flattened output has no text layer', (await pdfText(secureBytes)).trim() === '');
  const secureDoc = await PDFDocument.load(secureBytes, { updateMetadata: false });
  check('metadata scrubbed', secureDoc.getProducer() === 'Imnoo Drawing Anonymizer' && !secureDoc.getAuthor() && !secureDoc.getTitle());
  check('masked company name has no ink left', (await darkPixels(secureBytes, { x: 1718, y: 1243, width: 223, height: 23 }, 2381)) === 0);
  check('visible drawing number still printed', (await darkPixels(secureBytes, { x: 2018, y: 1370, width: 172, height: 29 }, 2381)) > 50);

  check(
    'existing output protected',
    /already exists/.test(await errorText('mask_drawing', { drawing_id: 'sample-analysis', output_path: secure.output, masking: {} }))
  );
  check(
    'source drawing never overwritten',
    /never overwritten/.test(await errorText('mask_drawing', { drawing_id: 'sample-analysis', output_path: samplePdf, overwrite: true, masking: {} }))
  );

  const layered = await callJson('mask_drawing', {
    drawing_id: 'sample-analysis',
    output_path: path.join(outDir, 'layered.pdf'),
    masking: { secure: false, mode: 'replace', company_name: 'Supplier AG', article_number: 'CUST-4711', stamp_article_number: true, include_report: true },
  });
  const layeredText = await pdfText(await readFile(layered.output));
  check('layered output keeps a text layer with the replacement', /Supplier AG/.test(layeredText));
  check('article number stamped on the sheet', /CUST-4711/.test(layeredText) && layered.article_number_stamp === 'CUST-4711');
  check('coverage report page appended', layered.pages_written === 2 && /Masking report/.test(layeredText) && /Anonymity score/.test(layeredText));
  check('layered output warns that content stays recoverable', layered.warnings.some(w => /Secure download is off|secure is off/i.test(w)));

  const named = await callJson('review_masking', { drawing_id: 'sample-analysis', masking: { article_number: 'CUST-4711' } });
  check('own article number names the file', named.output_file_name === 'CUST-4711_masked.pdf');

  const withLogo = await callJson('mask_drawing', {
    drawing_id: 'sample-analysis',
    output_path: path.join(outDir, 'logo.pdf'),
    masking: { secure: false, logo_path: logoPng },
  });
  const logoDoc = await PDFDocument.load(await readFile(withLogo.output));
  const xobjects = logoDoc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
  check('own logo drawn as an image', !!xobjects && xobjects.keys().length >= 1);
  check('non-image logo rejected', /PNG or JPEG/.test(await errorText('review_masking', { drawing_id: 'sample-analysis', masking: { logo_path: sampleJson } })));

  // reuse: the previous call's masking is applied when the next one omits it
  const reused = await callJson('mask_drawing', { drawing_id: 'sample-analysis', output_path: path.join(outDir, 'reused.pdf') });
  check('masking reused when omitted', !!reused.masking_reused && reused.masks_drawn === withLogo.masks_drawn);

  // reuse: an identical PDF under another path resolves to the analysed drawing, no upload
  const copy = path.join(outDir, 'copy-of-sample.pdf');
  await copyFile(samplePdf, copy);
  const again = await callJson('analyze_drawing', { pdf_path: copy });
  check('identical PDF reuses the analysis (no upload)', again.drawing_id === 'sample-analysis' && !!again.reused);
  const oneShot = await callJson('mask_drawing', { pdf_path: copy, output_path: path.join(outDir, 'one-shot.pdf') });
  check('one-shot mask_drawing by pdf_path reuses analysis and masking', oneShot.drawing_id === 'sample-analysis' && !!oneShot.masking_reused);

  const selected = await callJson('mask_drawing', { drawing_id: 'sample-analysis', output_path: path.join(outDir, 'pages.pdf'), masking: { pages: [1] } });
  check('page selection of every page writes all pages', selected.pages_written === 1);

  // guard rails before any upload
  const fivePages = await PDFDocument.create();
  for (let i = 0; i < 5; i++) fivePages.addPage([595, 842]).drawText(`page ${i + 1}`, { x: 50, y: 800 });
  const fivePath = path.join(outDir, 'five-pages.pdf');
  await writeFile(fivePath, await fivePages.save());
  check('more than 4 pages rejected before upload', /up to 4 pages/.test(await errorText('analyze_drawing', { pdf_path: fivePath })));
  check('non-PDF rejected', /is not a PDF/.test(await errorText('analyze_drawing', { pdf_path: sampleJson })));
  check('missing file rejected', /File not found/.test(await errorText('mask_drawing', { pdf_path: path.join(outDir, 'missing.pdf') })));
  check('bad analysis JSON rejected', /not a drawing analysis/.test(await errorText('load_analysis', { analysis_path: path.join(pkgRoot, 'package.json') })));
  check('different PDF for a drawing_id rejected', /different PDF/.test(await errorText('mask_drawing', { drawing_id: 'sample-analysis', pdf_path: fivePath })));

  // --- live ---------------------------------------------------------------------------
  if (LIVE) {
    console.log(`live (${process.env.DRAWING_ANONYMIZER_URL || 'https://drawing-anonymizer.imnoo.com'})`);
    // A byte-different copy, so the in-session hash reuse does not short-circuit the upload.
    const variant = await PDFDocument.load(await readFile(samplePdf));
    variant.setTitle(`smoke ${Date.now()}`);
    const variantPath = path.join(outDir, 'live-sample.pdf');
    await writeFile(variantPath, await variant.save());
    const live = await callJson('analyze_drawing', { pdf_path: variantPath, timeout_seconds: 240 });
    check('live analysis ready', live.status === 'ready' && /^public-\d+-/.test(live.drawing_id), `${live.status} ${live.drawing_id}`);
    check('live analysis finds sensitive data', live.detections_found > 0, String(live.detections_found));
    const shared = await callJson('mask_drawing', { drawing_id: live.drawing_id, output_path: path.join(outDir, 'live-masked.pdf'), share_link: '1m' });
    check('share link created', !!shared.share_link?.url, shared.share_link_error ?? '');
    if (shared.share_link?.url) {
      const r = await fetch(shared.share_link.url);
      const body = Buffer.from(await r.arrayBuffer());
      check('share link serves the masked PDF', r.ok && body.subarray(0, 5).toString('latin1') === '%PDF-' && body.length === shared.bytes, `${r.status} ${body.length}/${shared.bytes}`);
    }
  } else {
    console.log('live checks skipped (SMOKE_LIVE=1 to upload the sample and create a share link)');
  }
} catch (e) {
  failures++;
  console.error(`  FAIL  unexpected: ${e instanceof Error ? e.stack : e}`);
} finally {
  await client.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
