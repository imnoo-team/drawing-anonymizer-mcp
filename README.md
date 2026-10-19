# Drawing Anonymizer MCP Server

[![Drawing Anonymizer MCP server](https://glama.ai/mcp/servers/imnoo-team/drawing-anonymizer-mcp/badges/score.svg)](https://glama.ai/mcp/servers/imnoo-team/drawing-anonymizer-mcp)

**Anonymize technical drawings before you share them — mask company names, logos, people, addresses and contact data on drawing PDFs from any MCP-enabled assistant.**

This [Model Context Protocol](https://modelcontextprotocol.io) server exposes the engine behind [drawing-anonymizer.imnoo.com](https://drawing-anonymizer.imnoo.com), the free drawing anonymizer by [Imnoo](https://www.imnoo.com). Sending a drawing to a supplier, a subcontractor or a second source for a quote? Hand the PDF to your assistant and get an anonymized copy in about a minute: Imnoo's drawing analysis finds the sensitive data in the title block, the notes and anywhere else on the sheet — company names, logos, person names, addresses, phone numbers, emails, websites and other identifying text — and the server whites it out (or replaces it with your own company name and logo), masks any extra term or area you name, and writes a tamper-proof, single-layer PDF with the document metadata removed. Article numbers, drawing numbers, dates, dimensions and tolerances stay readable, so the drawing can still be quoted and manufactured. Need to send it right away? Ask for an expiring share link (1 minute to 24 hours) that only ever serves the masked copy. NDA-safe drawing sharing and GDPR-safe drawing exchange, on vector and scanned PDFs alike. Built by Imnoo, the planning, scheduling and quoting platform for CNC manufacturers — where the same automatic drawing masking protects every drawing that leaves a quote.

```
"Anonymize bracket.pdf for our subcontractor, put our name in, and give me a 1-hour link"
        │
        ▼  (your assistant calls the tools)
analyze_drawing ──► review_masking ──► mask_drawing
                         │                  │
                         ▼                  ▼
       14 masked · 4 visible        ART-88213_masked.pdf  (flattened, metadata removed)
       still visible: "BRACKET LEFT" https://drawing-anonymizer.imnoo.com/api/share/…  (expires in 1 h)
```

## Tools

| Tool | What it does |
| --- | --- |
| `analyze_drawing` | Uploads a drawing PDF (vector or scanned, up to 4 pages, ≤ 30 MB) to Imnoo's drawing analysis — the service behind the web app — and returns every detection: id, category, value, PDF page, box, confidence, whether it sits in the title block and whether it is masked by default. `save_analysis_to` keeps the analysis JSON for offline reuse. |
| `load_analysis` | Opens a saved analysis JSON. Fully offline — no upload, no daily credit. |
| `review_masking` | Shows exactly what the output will hide and what stays visible: masked detections (with their replacement), detections left visible, custom-term matches, rectangles, the anonymity score (0–100) with its warnings, the output file name, and the text a reader will still see on each page. Deterministic and offline — iterate until nothing identifying is left. |
| `mask_drawing` | Writes the anonymized PDF: blank (or replacement-text / own-logo) boxes over every masked item; by default every page is then rasterized at 288 dpi so the covered content is destroyed rather than painted over, and author, title, producer and XMP metadata are removed. Optional coverage-report page, page selection and expiring share link. Also accepts `pdf_path` directly for a one-shot run. |

Plus an `anonymize-drawing` prompt that walks the assistant through analyze → review → mask.

**Where the analysis runs.** Uploading the drawing is the only step that leaves your machine: `analyze_drawing` (or `mask_drawing` with a new `pdf_path`) sends the PDF to Imnoo's drawing analysis exactly like the web app does — **1 free analysis per day per IP address** (need more? signed-in Imnoo users get a higher daily limit in the [web app](https://drawing-anonymizer.imnoo.com)); uploaded files are deleted automatically within 24 hours and nothing else is stored. Masking, flattening and metadata removal run locally and are unlimited: review and re-mask as often as you like. A share link uploads the **masked** copy only — never the original.

## Installation

Requires Node.js ≥ 22.13.

### Claude Code

```bash
claude mcp add drawing-anonymizer -- npx -y drawing-anonymizer-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "drawing-anonymizer": {
      "command": "npx",
      "args": ["-y", "drawing-anonymizer-mcp"]
    }
  }
}
```

### Cursor

[**Add to Cursor**](cursor://anysphere.cursor-deeplink/mcp/install?name=drawing-anonymizer&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImRyYXdpbmctYW5vbnltaXplci1tY3AiXX0=) — or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "drawing-anonymizer": {
      "command": "npx",
      "args": ["-y", "drawing-anonymizer-mcp"]
    }
  }
}
```

### VS Code (GitHub Copilot)

```bash
code --add-mcp '{"name":"drawing-anonymizer","command":"npx","args":["-y","drawing-anonymizer-mcp"]}'
```

### Windsurf / other stdio clients

Any client that launches stdio servers works with:

```
npx -y drawing-anonymizer-mcp
```

### Configuration (optional)

| Variable | Purpose |
| --- | --- |
| `DRAWING_ANONYMIZER_URL` | Point the analysis and share links at another deployment of the web app (default `https://drawing-anonymizer.imnoo.com`). |

## Example session

> **You:** Anonymize `C:\drawings\bracket.pdf` before it goes to our subcontractor. Put "Supplier AG" where the customer's name was and give me a link that works for an hour.
>
> **Assistant:** *calls `analyze_drawing`* — 18 detections on 1 page (A3): 3 company names, 4 person names, a logo, an address, a phone number, an email, a website, 2 other identifying items (a purchase-order number and a project name), plus the article number ART-88213, the drawing number DRW-10457-B and 2 dates, which stay visible. *calls `review_masking` with `mode: "replace"` and `company_name: "Supplier AG"`* — 14 items masked, anonymity score 100; still visible on the sheet: the part title "BRACKET LEFT". *adds it with `terms: ["BRACKET LEFT"]`, reviews again, then calls `mask_drawing` with the same masking and `share_link: "1h"`* — wrote `ART-88213_masked.pdf` (flattened, metadata removed) and created a link that expires at 15:42. Two "Other" detections were found with low confidence — their boxes are worth a glance.

Those numbers are the web app's bundled sample drawing the smoke test runs against; real drawings vary.

## Masking options (the `masking` argument)

One object, accepted by `review_masking` and `mask_drawing` — pass the same one to both so the PDF matches the reviewed masks. Everything is optional; the defaults reproduce the web app.

| Option | Values |
| --- | --- |
| `categories` | categories masked automatically — default `CompanyName`, `Name`, `Address`, `PhoneNr`, `Email`, `Website`, `CompanyLogo`, `Other`; `ArticleNr`, `DrawingNr` and `Date` stay visible for traceability |
| `detection_scope` | `page` (default, the whole sheet) or `title_block` (only detections inside the title block — notes elsewhere stay untouched) |
| `mode` · `company_name` · `replacements[]` | `whiteout` (default) or `replace`: print your own company name over detected company names, or any text per detection id (32 characters max) |
| `logo_path` | your own logo (PNG or JPEG, < 1 MB), drawn into every detected logo instead of a blank box |
| `mask` · `unmask` | detection ids to mask or keep visible regardless of their category |
| `terms` | extra text to mask everywhere it appears — case- and spacing-insensitive, across words the CAD export split |
| `rectangles[]` | extra areas to cover: `page`, `x`, `y`, `width`, `height` in the analysis image pixels the detections use |
| `color` · `opacity` | mask colour (`#rrggbb`, default white) and opacity (default 100 — anything lower leaves the content readable) |
| `pages` | 1-based PDF pages to write (default all) |
| `secure` · `scrub_metadata` · `include_report` | flatten the pages (default on), remove document metadata (default on), append a coverage-report page (default off) |
| `article_number` · `stamp_article_number` · `name_after_article_number` | your own article number for the part: names the file `<article number>_masked.pdf` and can be printed top-right on the sheet |

When `masking` is omitted on a drawing that was masked before in the same session — including the identical PDF under another path — the previous masking is reused, and the identical PDF is not uploaded again.

## How the masked PDF is made

- Detections come with their box, value and confidence; the categories you choose (and the detection scope) decide which are masked, and your explicit `mask` / `unmask` choices win.
- Boxes are drawn onto a copy of the original pages. With `secure` on (the default), every page is then rasterized at 288 dpi and the PDF is rebuilt from those images — the covered text no longer exists in the file, so it cannot be copied, searched or recovered by removing the boxes. With `secure` off, the result is a layered PDF whose original content stays recoverable under the masks; the tools warn about it.
- Document metadata (author, title, subject, keywords, creator, XMP) is removed by default.
- The anonymity score combines the share of identifying detections masked, secure output, metadata removal and full opacity — the same score the web app shows.

## Limitations

- The drawing analysis is automated: it can miss text (unusual layouts, free-text notes, hand-written additions) — read `visible_text_after_masking` in `review_masking` and add `terms` or `rectangles` for anything still identifying, and look at the masked PDF before sharing it.
- Custom terms need the PDF's text layer; on scans, cover areas with `rectangles`. Inside a longer line the term's position is estimated from the character count, so leave a little margin with a rectangle when a term sits between other text.
- Free tier: 1 analysis per day per IP address; PDFs up to 30 MB and 4 pages. Saved analyses (`save_analysis_to` → `load_analysis`) and re-masking are unlimited and offline.
- Dragging boxes, the before/after slider, batch processing of up to 15 drawings and the hand-off from the Imnoo calculator are features of the [web app](https://drawing-anonymizer.imnoo.com).

## Development

The server lives in `src/`; `engine/` holds the masking engine it shares with the [web app](https://drawing-anonymizer.imnoo.com) (mask builder, title-block scope, text search, coverage report and the secure-PDF builder), synced from the Drawing Anonymizer monorepo at [Imnoo](https://www.imnoo.com) on every release — so the web app and this server detect, mask and flatten a drawing the same way by construction. Every release is gated on end-to-end checks that drive all four tools over stdio against the sample drawing in `test/fixtures` and read the output's text layer and pixels:

```bash
npm ci
npm test                 # build + end-to-end stdio checks
SMOKE_LIVE=1 npm test    # + a real upload and share link (one daily analysis of your IP)
```

Issues and feature requests are welcome in this repository.

## About Imnoo

**Imnoo — The System for Manufacturers | AI Planning, Scheduling & Quoting · Complete Assemblies · DFM · Tool & Material Libraries · Quoted-Parts Database · Toolpath & G-Code · Machine Connection · Webshop · ERP · Shop Analytics & Optimization · Drawing Masking & IP Security**

*Plan It. Schedule It. Quote It. Win It.* — trusted by over 3,000 manufacturers.

[Imnoo](https://www.imnoo.com) is the AI-powered planning, scheduling, and quoting platform for CNC manufacturers — your automatic production platform. One system that covers it all: automatic manufacturing planning with raw-material, catalog and purchase-part, and subcontracting sourcing; scheduling with smart reminders and AI-driven customer workflows; and AI cost and cycle-time estimation for milling, turning, and EDM — even from a 2D PDF alone. Quote complete assemblies: drop in one file and Imnoo explodes it into single parts automatically — with DFM checks, quality protocols, tolerance extraction and 2D-to-3D matching, toolpath and G-code generation, tool and machine recommendations, and connected machines feeding real production data back into every quote. Built on your own tool and material libraries and a growing database of every part you've ever quoted — powering statistics, benchmarks, and shop optimization. Extends to deep hole drilling, sheet metal, casting, and profile parts — with a 24/7 webshop, built-in ERP, hourly-rate calculation, market-price benchmarking, and imperial ⇄ metric conversion. Your data lives in its own physically separated environment — automatic drawing masking, Swiss hosting, end-to-end encryption. From messy RFQ to production-ready order, on one platform.

### Planning

- **Automatic manufacturing planning** — production plans generated straight from the quote.
- **Machine recommendation** — every job routed to the machine that runs it best.
- **Catalog & purchase part management** — norm parts, screws, and bought-in components recognized straight from the BOM, managed and priced alongside your machined parts.
- **Raw material sourcing** — price, source, and order material without leaving the workflow.
- **Purchase part & external step sourcing** — bought-in components, coating, heat treatment, and subcontracting sourced and ordered in the same flow.
- **Beyond milling & turning** — deep hole drilling, sheet metal, casting, and profile parts.

### Scheduling & Workflow

- **Scheduling & smart reminders** — via email, Telegram, or WhatsApp. Nothing slips.
- **Email-to-quote automation** — a messy inbox in, structured quotes out.
- **AI customer agents** — RFQ answers, clarifications, and follow-ups handled automatically.
- **Built-in lightweight ERP** — orders, companies, payment terms, and margins without the bulky software.

### Quoting & Estimation

- **Complete assemblies, exploded automatically** — upload one assembly file and Imnoo blows it out into single parts: every component recognized, drawings matched to the right parts, sub-assemblies nested, purchase parts pulled from the BOM. Quote the whole machine as easily as one part.
- **CNC quoting in one place** — milling, turning, and EDM jobs quoted from a single AI-powered platform.
- **AI cost & cycle-time estimation** — know price, time, and effort before engineering ever looks at it.
- **Drawing-only estimation** — quote from the PDF alone. No 3D model needed.
- **Feature-by-feature costing** — see exactly which holes, pockets, and tolerances drive the price.
- **Instant quotes** — respond in minutes while competitors are still opening the STEP file.
- **24/7 instant-quoting webshop** — customers upload parts and buy while you sleep.
- **Instant market-price benchmarking** — know where your bid stands before you send it.
- **Hourly-rate calculation** — your true machine and labor rates, always current.
- **Imperial ⇄ metric conversion** — international RFQs without manual cleanup.

### Libraries & Insights

- **Tool library** — your cutting tools, holders, and parameters in one managed catalog.
- **Material library** — standard and custom materials with live supplier pricing.
- **Quoted-parts database** — every part you've ever quoted, searchable by geometry: similar part found, price found.
- **Statistics & analytics** — win rates, margins, throughput, and quoting performance at a glance.
- **Shop optimization** — learn from already-quoted parts to sharpen prices, spot profitable niches, and load the right machines.

### Drawing Intelligence

- **DFM — Design for Manufacturing** — manufacturability checked before you quote: undercuts, thin walls, unreachable features, and impossible tolerances flagged with the part still on the screen.
- **Quality check protocols** — inspection plans generated automatically: stamped and numbered drawing features, inspection classes and rates, ready-to-use measurement reports.
- **Axis & orientation detection** — AI finds the best part orientation and machining axes.
- **Automatic tolerance extraction** — critical tolerances pulled straight off the drawing.
- **2D-to-3D tolerance matching** — drawing requirements linked to the right model features.

### CAM & Shop Intelligence

- **AI tool recommendation** — stop searching catalogs: Imnoo suggests the exact cutting tools for every feature.
- **Automatic toolpath generation** — from quote to machining strategy in one step.
- **G-code generation & estimation** — generate and evaluate programs before work hits the floor.
- **Machine connection** — your machines feed real production data back into the AI. Every quote gets smarter.

### IP Protection & Data Security — Engineered Like a Swiss Vault

- **Physically separated data** — every manufacturer runs in its own isolated environment. Your drawings, prices — never pooled with anyone else's: not for storage, not for AI training.
- **Automatic drawing masking & redaction** — customer names, logos, and confidential data hidden before a drawing ever leaves your workflow. Share with suppliers and subcontractors without exposing whose part it is.
- **Your customers' IP, treated like your own** — end customers' designs stay within your tenant, full stop.
- **Swiss hosting & end-to-end encryption** — data sovereignty and security engineered to Swiss standards.
- **Trusted at scale** — over 3,000 manufacturers run their quoting on Imnoo.

Quote the complete job — not just the spindle time.

👉 [Book a demo at imnoo.com](https://www.imnoo.com)

## Privacy

Two things can leave your machine, both over HTTPS to drawing-anonymizer.imnoo.com: the drawing PDF you analyse (sent to Imnoo's drawing analysis to detect the sensitive data, deleted automatically within 24 hours, not used for anything else), and — only when you ask for a share link — the **masked** copy, stored privately until the link expires. There is no telemetry and no other network call; masking, flattening and metadata removal run locally on your machine. Imnoo's privacy policy: https://www.imnoo.com/en/privacy-policy · Imprint: https://www.imnoo.com/en/imprint · Questions: https://github.com/imnoo-team/drawing-anonymizer-mcp/issues

## License

[MIT](./LICENSE) © Imnoo AG
