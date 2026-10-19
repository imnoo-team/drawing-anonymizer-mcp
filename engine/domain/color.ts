export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}
export function hexaToRgba(hex?: string | null): Rgba | null {
    if (hex == null || hex.length === 0)
        return null;
    if (hex.startsWith('#'))
        hex = hex.slice(1);
    if (hex.length !== 6 && hex.length !== 8)
        return null;
    const r = Number('0x' + hex.slice(0, 2));
    const g = Number('0x' + hex.slice(2, 4));
    const b = Number('0x' + hex.slice(4, 6));
    const a = hex.length === 8 ? Number('0x' + hex.slice(6, 8)) : 255;
    const invalid = (n: number) => Number.isNaN(n) || n < 0 || n > 255;
    if (invalid(r) || invalid(g) || invalid(b) || invalid(a))
        return null;
    return { r, g, b, a: Math.round((a / 255) * 100) / 100 };
}
export function rgbaToHexa(rgba: Rgba): string {
    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}${toHex(rgba.a * 255)}`;
}
export function hexaToHex(hex?: string | null): string | null {
    if (!hex)
        return null;
    if (hex.length === 7)
        return hex;
    if (hex.length === 9)
        return hex.slice(0, 7);
    return null;
}
export function hexToHexa(hex?: string | null, alpha = 1): string | null {
    const hexAlpha = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0');
    if (hex?.length === 7)
        return `${hex}${hexAlpha}`;
    if (hex?.length === 9)
        return `${hex.slice(0, 7)}${hexAlpha}`;
    return null;
}
export function getHexaAlpha(hexa?: string | null): number {
    return hexa?.length === 9 ? Math.round((Number('0x' + hexa.slice(7, 9)) / 255) * 100) / 100 : 1;
}
export function luminance(hex: string): number {
    const c = hexaToRgba(hex);
    if (!c)
        return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}
export function toPixels(pt: number, dpi: number): number {
    return (pt * dpi) / 72;
}
export function toPoints(px: number, dpi: number): number {
    return px / (dpi / 72);
}
