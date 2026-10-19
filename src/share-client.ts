import { appUrl } from './analysis-client';
import type { ShareExpiry } from './engine';
export interface ShareLink {
    url: string;
    expiresAt: string;
    expiresInSeconds: number;
}
export async function createShareLink(bytes: Uint8Array, fileName: string, expiry: ShareExpiry): Promise<ShareLink> {
    let response: Response;
    try {
        response = await fetch(`${appUrl()}/api/share`, {
            method: 'POST',
            headers: {
                'content-type': 'application/octet-stream',
                'x-file-name': encodeURIComponent(fileName),
                'x-expiry': expiry,
            },
            body: bytes as unknown as BodyInit,
        });
    }
    catch (e) {
        throw new Error(`The share service at ${appUrl()} could not be reached: ${e instanceof Error ? e.message : String(e)}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
        throw new Error('Sharing is not available on this server — the masked PDF was written to disk; share that file instead.');
    }
    const body = (await response.json().catch(() => ({}))) as Partial<ShareLink> & {
        error?: string;
    };
    if (!response.ok || !body.url) {
        throw new Error(`Creating the share link failed: ${body.error ?? `HTTP ${response.status}`}`);
    }
    return {
        url: new URL(body.url, `${appUrl()}/`).toString(),
        expiresAt: body.expiresAt ?? '',
        expiresInSeconds: body.expiresInSeconds ?? 60,
    };
}
