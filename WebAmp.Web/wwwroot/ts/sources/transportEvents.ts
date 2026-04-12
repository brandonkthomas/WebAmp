import type { TrackSource } from '../state/playerStore';

/**
 * Dispatches a provider-agnostic "track finished" event that higher-level
 * player wiring can use to advance the queue.
 */
export function dispatchTransportFinish(source: TrackSource, trackId: string): void {
    if (!trackId) return;
    try {
        window.dispatchEvent(new CustomEvent('wa:transport:finish', {
            detail: { source, trackId }
        }));
    } catch {
        // ignore
    }
}

/**
 * Dispatches a global "transport busy" flag so UI can show an indeterminate
 * progress state while providers perform async work like loading/switching.
 */
export function dispatchTransportBusy(busy: boolean): void {
    try {
        window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy } }));
    } catch {
        // ignore
    }
}
