export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        try {
            const digest = await subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
            return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        }
        catch {
        }
    }
    return fallbackHash(bytes);
}
function fallbackHash(bytes: Uint8Array): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `fnv-${h.toString(16)}-${bytes.length.toString(16)}`;
}
