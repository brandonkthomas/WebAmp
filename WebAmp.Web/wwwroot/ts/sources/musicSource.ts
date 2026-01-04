export type MusicSourceId = 'spotify' | 'apple';

export interface MusicSourceState {
    isConnected: boolean;
}

export type MusicSourceListener = (state: MusicSourceState) => void;

export interface MusicSource {
    id: MusicSourceId;
    displayName: string;
    getState(): MusicSourceState;
    onChange(listener: MusicSourceListener): () => void;
    connect(): Promise<void>;
    disconnect?(): Promise<void>;
}
