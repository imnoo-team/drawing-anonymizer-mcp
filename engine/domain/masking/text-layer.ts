import { TextToken } from './text-search';
export interface TextContentItemLike {
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
}
export interface ViewportLike {
    rotation?: number;
    convertToViewportPoint(x: number, y: number): number[];
}
export function textTokensFromContent(items: readonly TextContentItemLike[], viewport: ViewportLike): TextToken[] {
    const tokens: TextToken[] = [];
    for (const item of items) {
        const str = (item.str ?? '').trim();
        const t = item.transform;
        if (!str || !t)
            continue;
        const fontHeight = Math.hypot(t[1], t[3]) || item.height || 8;
        const len = Math.hypot(t[0], t[1]) || 1;
        const dirX = t[0] / len;
        const dirY = t[1] / len;
        const upX = -dirY;
        const upY = dirX;
        const width = item.width ?? 0;
        const descent = fontHeight * 0.22;
        const corners = [
            [t[4] - upX * descent, t[5] - upY * descent],
            [t[4] + dirX * width - upX * descent, t[5] + dirY * width - upY * descent],
            [t[4] + dirX * width + upX * (fontHeight - descent), t[5] + dirY * width + upY * (fontHeight - descent)],
            [t[4] + upX * (fontHeight - descent), t[5] + upY * (fontHeight - descent)],
        ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
        const xs = corners.map(c => c[0]);
        const ys = corners.map(c => c[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const angle = Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI);
        const rotation = normalizeRotation(angle - (viewport.rotation || 0));
        tokens.push({ str, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation });
    }
    return tokens;
}
export function normalizeRotation(angle: number): number {
    let a = angle % 360;
    if (a < 0)
        a += 360;
    if (Math.abs(a) < 3 || Math.abs(a - 360) < 3)
        return 0;
    return Math.round(a / 90) * 90;
}
