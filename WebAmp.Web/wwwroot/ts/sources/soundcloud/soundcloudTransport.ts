import type { PlayerTransport, Track, TrackSource } from '../../state/playerStore';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';

type PlaybackStateListener = (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void;

/**
 * PlayerTransport implementation backed by the official SoundCloud HTML5
 * widget, embedded in a hidden iframe. This avoids dealing with raw HLS
 * stream URLs and lets SoundCloud handle streaming/auth under the hood.
 *
 * Docs: https://developers.soundcloud.com/docs/api/html5-widget
 */
export class SoundCloudTransport implements PlayerTransport {
    private widget: any | null = null;
    private iframe: HTMLIFrameElement | null = null;
    private currentTrack: Track | null = null;
    private lastPositionSec: number = 0;

    constructor(private readonly onRemoteState?: PlaybackStateListener) {}

    private getSource(track: Track | null): TrackSource {
        return (track?.source ?? 'spotify') as TrackSource;
    }

    private getIframe(): HTMLIFrameElement | null {
        if (this.iframe && document.body.contains(this.iframe)) {
            return this.iframe;
        }
        const container = document.querySelector<HTMLElement>('[data-wa-sc-widget-container]');
        if (!container) return null;
        const iframe = container.querySelector<HTMLIFrameElement>('[data-wa-sc-widget]');
        if (!iframe) return null;
        this.iframe = iframe;
        return iframe;
    }

    private ensureWidget(): any {
        if (this.widget) return this.widget;

        const iframe = this.getIframe();
        if (!iframe) {
            throw new Error('SoundCloud widget iframe not found.');
        }

        const w = window as any;
        if (!w.SC || !w.SC.Widget) {
            throw new Error('SoundCloud widget API is not available.');
        }

        const widget = w.SC.Widget(iframe);
        this.widget = widget;

        // Wire up basic event forwarding so PlayerStore can keep its remote
        // ticker in sync with the widget.
        const Events = w.SC.Widget.Events;

        widget.bind(Events.PLAY_PROGRESS, (e: any) => {
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            this.lastPositionSec = Math.max(0, posMs / 1000);
        });

        widget.bind(Events.PLAY, () => {
            if (!this.currentTrack) return;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: this.lastPositionSec
            });
        });

        widget.bind(Events.PAUSE, () => {
            if (!this.currentTrack) return;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: this.lastPositionSec
            });
        });

        widget.bind(Events.FINISH, () => {
            if (!this.currentTrack) return;
            const duration =
                (typeof this.currentTrack.durationSec === 'number' && Number.isFinite(this.currentTrack.durationSec))
                    ? this.currentTrack.durationSec
                    : this.lastPositionSec;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: duration
            });
        });

        return widget;
    }

    private emitRemote(s: { track: Track | null; isPlaying: boolean; positionSec: number }) {
        if (!this.onRemoteState) return;
        this.onRemoteState({
            track: s.track,
            isPlaying: s.isPlaying,
            positionSec: s.positionSec
        });
    }

    /**
     * Starts playback of a SoundCloud-backed track using the widget.
     */
    async play(track: Track, positionSec: number = 0): Promise<void> {
        const source = this.getSource(track);
        if (source !== 'soundcloud') {
            // This transport is only responsible for SoundCloud tracks.
            return;
        }

        this.currentTrack = track;
        this.lastPositionSec = Math.max(0, positionSec || 0);

        try {
            const widget = this.ensureWidget();

            const trackUrl = `https://api.soundcloud.com/tracks/${encodeURIComponent(track.id)}`;

            await new Promise<void>((resolve, reject) => {
                try {
                    // Use the documented widget.load API with auto_play. This
                    // behaves reliably after a user gesture (clicking a track
                    // in WebAmp), and matches the behavior that worked in your
                    // CodePen experiment.
                    widget.load(trackUrl, {
                        auto_play: true,
                        hide_related: true,
                        show_comments: false,
                        show_user: true,
                        show_reposts: false,
                        visual: false,
                        callback: () => {
                            // Initial remote sync; PLAY events will continue to
                            // update the store as playback progresses.
                            this.emitRemote({
                                track,
                                isPlaying: true,
                                positionSec: this.lastPositionSec
                            });
                            resolve();
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            });
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }

    /**
     * Toggles pause/resume based on previous playing state.
     */
    async togglePlay(previouslyPlaying: boolean): Promise<void> {
        if (!this.currentTrack) return;

        try {
            const widget = this.ensureWidget();
            // The widget keeps its own play/pause state; toggle() is simpler
            // than trying to mirror the boolean.
            widget.toggle();
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }

    /**
     * Seeks within the current SoundCloud track.
     */
    async seek(positionSec: number): Promise<void> {
        if (!this.currentTrack) return;

        const widget = this.ensureWidget();
        const nextPos = Math.max(0, positionSec || 0);
        const ms = nextPos * 1000;

        try {
            widget.seekTo(ms);
            this.lastPositionSec = nextPos;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: nextPos
            });
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }
}

