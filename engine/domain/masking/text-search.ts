import { MaskBox, MaskCategory, Rect, newBoxId } from './mask-model';
export interface TextToken {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}
export interface TextMatch {
    rect: Rect;
    rotation: number;
    text: string;
}
const MAX_SPAN = 8;
export function normalizeText(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[\s ]+/g, ' ')
        .trim();
}
function groupIntoLines(tokens: TextToken[]): TextToken[][] {
    const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: TextToken[][] = [];
    for (const token of sorted) {
        const cy = token.y + token.height / 2;
        const line = lines.find(l => {
            const ref = l[0];
            const refCy = ref.y + ref.height / 2;
            return ref.rotation === token.rotation && Math.abs(refCy - cy) <= Math.max(ref.height, token.height) * 0.5;
        });
        if (line)
            line.push(token);
        else
            lines.push([token]);
    }
    for (const line of lines)
        line.sort((a, b) => (a.rotation === 0 ? a.x - b.x : a.y - b.y));
    return lines;
}
export function findTerm(tokens: TextToken[], term: string): TextMatch[] {
    const needle = normalizeText(term);
    if (!needle)
        return [];
    const matches: TextMatch[] = [];
    for (const line of groupIntoLines(tokens)) {
        for (let start = 0; start < line.length; start++) {
            let joined = '';
            for (let end = start; end < Math.min(line.length, start + MAX_SPAN); end++) {
                const piece = normalizeText(line[end].str);
                if (!piece)
                    continue;
                joined = joined ? `${joined} ${piece}` : piece;
                if (start === end && joined.includes(needle) && joined !== needle) {
                    const token = line[start];
                    const index = joined.indexOf(needle);
                    const from = index / joined.length;
                    const to = (index + needle.length) / joined.length;
                    matches.push({ rect: sliceToken(token, from, to), rotation: token.rotation, text: token.str });
                    break;
                }
                if (joined === needle || joinedEqualsWithoutSpaces(joined, needle)) {
                    matches.push({ rect: union(line.slice(start, end + 1)), rotation: line[start].rotation, text: line.slice(start, end + 1).map(t => t.str).join(' ') });
                    break;
                }
                if (!needle.startsWith(joined) && !needle.replace(/ /g, '').startsWith(joined.replace(/ /g, '')))
                    break;
            }
        }
    }
    return dedupe(matches);
}
function joinedEqualsWithoutSpaces(a: string, b: string): boolean {
    return a.replace(/ /g, '') === b.replace(/ /g, '');
}
function sliceToken(token: TextToken, from: number, to: number): Rect {
    if (token.rotation === 90 || token.rotation === -90 || token.rotation === 270) {
        return { x: token.x, y: token.y + token.height * from, width: token.width, height: token.height * (to - from) };
    }
    return { x: token.x + token.width * from, y: token.y, width: token.width * (to - from), height: token.height };
}
function union(tokens: TextToken[]): Rect {
    const minX = Math.min(...tokens.map(t => t.x));
    const minY = Math.min(...tokens.map(t => t.y));
    const maxX = Math.max(...tokens.map(t => t.x + t.width));
    const maxY = Math.max(...tokens.map(t => t.y + t.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function dedupe(matches: TextMatch[]): TextMatch[] {
    const out: TextMatch[] = [];
    for (const m of matches) {
        const dup = out.some(o => Math.abs(o.rect.x - m.rect.x) < 1 && Math.abs(o.rect.y - m.rect.y) < 1 && Math.abs(o.rect.width - m.rect.width) < 1);
        if (!dup)
            out.push(m);
    }
    return out;
}
export function termBoxes(tokens: TextToken[], term: string, pageNr: number, category: MaskCategory, source: 'text' = 'text', pad = 2): MaskBox[] {
    return findTerm(tokens, term).map(match => ({
        id: newBoxId('t'),
        pageNr,
        category,
        source,
        rect: {
            x: match.rect.x - pad,
            y: match.rect.y - pad,
            width: match.rect.width + 2 * pad,
            height: match.rect.height + 2 * pad,
        },
        rotation: match.rotation,
        originalValue: match.text,
        replacement: '',
        masked: true,
        color: null,
        fontColor: '#000000',
        score: 1,
        term,
    }));
}
export function tokensInside(tokens: TextToken[], rects: Rect[]): TextToken[] {
    return tokens.filter(t => {
        const cx = t.x + t.width / 2;
        const cy = t.y + t.height / 2;
        return rects.some(r => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height);
    });
}
