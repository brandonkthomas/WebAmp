import type { Track } from '../state/playerStore';
import { indiumSvg } from '../internal/paths';
import { openPopupMenu } from '../internal/indiumApi';
import { ensureTrackLibraryState, getTrackLibraryActionTitle, toggleTrackLibrary } from '../library/trackLibrary';
import { shareCurrentTrack } from '../share/currentTrackShare';

/**
 * Helper for opening a track's context menu
 * @param anchor - The element to anchor the menu to.
 * @param track - The track to display in the menu.
 * @param title - The title of the menu.
 * @param allowNavigateOnMobile - Whether to allow navigation on narrow mobile viewports.
 * @param onLibraryBusyChange - A hook to reflect async busy state in the menu.
 * @param onShareBusyChange - A hook to reflect async busy state in the menu.
 */
export interface TrackContextMenuOptions {
    anchor: HTMLElement;
    track: Track & {
        albumId?: string;
        primaryArtistId?: string;
    };
    /**
     * Optional menu title.
     */
    title?: string;
    /**
     * If false, album/artist navigation items will no-op on narrow mobile viewports.
     * Defaults to true.
     */
    allowNavigateOnMobile?: boolean;
    /**
     * Optional hooks so callers can reflect async busy state in their own UI.
     */
    onLibraryBusyChange?: (busy: boolean) => void;
    onShareBusyChange?: (busy: boolean) => void;
}

export function openTrackContextMenu(opts: TrackContextMenuOptions): void {
    const {
        anchor,
        track,
        title = 'Track Actions',
        allowNavigateOnMobile = true,
        onLibraryBusyChange,
        onShareBusyChange
    } = opts;

    const t: any = track;
    const canShowAlbum: boolean = !!t?.albumId;
    const canShowArtist: boolean = !!t?.primaryArtistId;

    void (async () => {
        try {
            onLibraryBusyChange?.(true);
            await ensureTrackLibraryState(track);

            const items = [
                {
                    id: 'toggle-library',
                    title: getTrackLibraryActionTitle(track),
                    iconSrc: indiumSvg('heart-filled.svg'),
                    onSelect: async () => {
                        try {
                            onLibraryBusyChange?.(true);
                            await toggleTrackLibrary(track);
                        } finally {
                            onLibraryBusyChange?.(false);
                        }
                    }
                },
                ...(canShowAlbum
                    ? [{
                        id: 'show-album',
                        title: 'Show Album',
                        iconSrc: indiumSvg('album-filled.svg'),
                        onSelect: () => {
                            const albumId: string | undefined = t?.albumId;
                            if (!albumId) return;
                            if (!allowNavigateOnMobile && window.matchMedia('(max-width: 820px)').matches) return;
                            window.dispatchEvent(
                                new CustomEvent('wa:navigate:album', { detail: { albumId } })
                            );
                        }
                    }] as const
                    : []),
                ...(canShowArtist
                    ? [{
                        id: 'show-artist',
                        title: 'Show Artist',
                        iconSrc: indiumSvg('artist-filled.svg'),
                        onSelect: () => {
                            const artistId: string | undefined = t?.primaryArtistId;
                            if (!artistId) return;
                            if (!allowNavigateOnMobile && window.matchMedia('(max-width: 820px)').matches) return;
                            window.dispatchEvent(
                                new CustomEvent('wa:navigate:artist', { detail: { artistId } })
                            );
                        }
                    }] as const
                    : []),
                {
                    id: 'share',
                    title: 'Share',
                    iconSrc: indiumSvg('share.svg'),
                    onSelect: async () => {
                        try {
                            onShareBusyChange?.(true);
                            await shareCurrentTrack(track);
                        } finally {
                            onShareBusyChange?.(false);
                        }
                    }
                }
            ] as const;

            openPopupMenu({
                anchor,
                title,
                items
            });
        } finally {
            onLibraryBusyChange?.(false);
        }
    })();
}
