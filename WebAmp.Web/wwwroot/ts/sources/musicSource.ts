export type MusicSourceId = 'spotify' | 'apple';

/**
 * Connection state snapshot for a music source
 */
export interface MusicSourceState {
    isConnected: boolean;
}

export type MusicSourceListener = (state: MusicSourceState) => void;

/**
 * Minimal adapter interface for auth + connection state
 */
export interface MusicSource {
    id: MusicSourceId;
    displayName: string;
    getState(): MusicSourceState;
    onChange(listener: MusicSourceListener): () => void;
    connect(): Promise<void>;
    disconnect?(): Promise<void>;
}
