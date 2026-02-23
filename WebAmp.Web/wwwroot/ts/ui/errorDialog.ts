import { showAlert } from '../internal/indiumApi';
import { logEvent } from '../internal/logging';

export async function showErrorDialog(message: string, title: string = 'Error'): Promise<void> {
    logEvent('WebAmp', 'ui:error', { title, message }, undefined, 'error');
    return await showAlert({
        title,
        message,
        variant: 'danger'
    });
}

export function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        const message = error.message;

        if (message.includes('502')) {
            return 'The music service is temporarily unavailable. Please try again in a moment.';
        }
        if (message.includes('401') || message.includes('403')) {
            return 'Your session has expired. Please sign in again.';
        }
        if (message.includes('404')) {
            return 'The requested content could not be found.';
        }
        if (message.includes('429')) {
            return 'Too many requests. Please wait a moment before trying again.';
        }
        if (message.includes('500') || message.includes('503')) {
            return 'The music service is experiencing issues. Please try again later.';
        }
        if (message.includes('network') || message.includes('fetch')) {
            return 'Network error. Please check your connection and try again.';
        }

        const jsonMatch = message.match(/\{.*"message":\s*"([^"]+)"[^}]*\}/);
        if (jsonMatch) {
            return jsonMatch[1];
        }

        return message.replace(/^(Spotify API proxy error|Error):\s*/i, '').trim() || 'An unexpected error occurred.';
    }

    if (typeof error === 'string') {
        return error;
    }

    return 'An unexpected error occurred. Please try again.';
}
