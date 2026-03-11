import type { Track } from '../state/playerStore';
import { showAlert } from '../internal/indiumApi';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import { soundcloudApi } from '../sources/soundcloud/soundcloudApi';
import { formatErrorMessage, showErrorDialog } from '../ui/errorDialog';
import { logEvent } from '../internal/logging';

const MOBILE_SHARE_MEDIA_QUERY = '(max-width: 820px)';

function isMobileViewport(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(MOBILE_SHARE_MEDIA_QUERY).matches;
}

function getTrackShareText(track: Track): string {
    const title = track.title?.trim() || 'Track';
    const artist = track.artist?.trim();
    return artist ? `${artist} - ${title}` : title;
}

function getSpotifyExternalUrl(data: any): string | null {
    const url = data?.external_urls?.spotify;
    return typeof url === 'string' && url.trim() ? url : null;
}

async function copyToClipboard(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    if (typeof document === 'undefined') {
        throw new Error('Clipboard is unavailable.');
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        const ok = document.execCommand('copy');
        if (!ok) throw new Error('Copy failed.');
    } finally {
        textarea.remove();
    }
}

async function shareOnMobile(track: Track, url: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || !isMobileViewport()) {
        return false;
    }

    const payload = {
        title: track.title,
        text: getTrackShareText(track),
        url
    };

    if (typeof navigator.canShare === 'function' && !navigator.canShare(payload)) {
        return false;
    }

    try {
        await navigator.share(payload);
        return true;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return true;
        }
        throw error;
    }
}

export async function resolveCurrentTrackShareUrl(track: Track): Promise<string | null> {
    if (typeof track.permalinkUrl === 'string' && track.permalinkUrl.trim()) {
        return track.permalinkUrl;
    }

    switch (track.source) {
        case 'soundcloud': {
            const info = await soundcloudApi.stream(track.id);
            const url = info?.permalinkUrl;
            return typeof url === 'string' && url.trim() ? url : null;
        }
        case 'spotify':
        default: {
            const data = await spotifyApi.track(track.id);
            const externalUrl = getSpotifyExternalUrl(data);
            if (externalUrl) return externalUrl;
            return track.id ? `https://open.spotify.com/track/${encodeURIComponent(track.id)}` : null;
        }
    }
}

export async function shareCurrentTrack(track: Track | null): Promise<void> {
    if (!track) return;

    try {
        const url = await resolveCurrentTrackShareUrl(track);
        if (!url) {
            throw new Error('This track does not have a shareable provider URL.');
        }

        const mode = await shareOnMobile(track, url) ? 'sheet' : 'clipboard';
        if (mode === 'clipboard') {
            await copyToClipboard(url);
            await showAlert({
                title: 'Share Song',
                message: 'Song URL copied to clipboard.'
            });
        }

        logEvent('WebAmp', 'track:share', {
            source: track.source ?? 'spotify',
            trackId: track.id,
            mode
        });
    } catch (error) {
        const message = formatErrorMessage(error);
        logEvent('WebAmp', 'track:share:error', {
            source: track.source ?? 'spotify',
            trackId: track.id
        }, message, 'error');
        await showErrorDialog(message, 'Share Failed');
    }
}
