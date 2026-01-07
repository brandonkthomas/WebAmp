/**
 * errorDialog.ts
 * Wrapper for Portfolio's UI kit dialog system
 * Uses the shared dialog component from Portfolio workspace
 */

// Import from Portfolio's dialog system (relative path from WebAmp to Portfolio)
// From: WebAmp.Web/wwwroot/ts/ui/errorDialog.ts
// To: Portfolio/wwwroot/ts/components/dialogs.ts
// Path: ../../../../../Portfolio/wwwroot/ts/components/dialogs
import { showAlert } from '../../../../../Portfolio/wwwroot/ts/components/dialogs';

/**
 * Shows an error dialog with a user-friendly message using Portfolio's UI kit
 */
export async function showErrorDialog(message: string, title: string = 'Error'): Promise<void> {
    return await showAlert({
        title,
        message,
        variant: 'danger'
    });
}

/**
 * Formats an error into a user-friendly message
 */
export function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        const message = error.message;
        
        // Extract user-friendly message from common error patterns
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
        
        // Try to extract message from JSON error responses
        const jsonMatch = message.match(/\{.*"message":\s*"([^"]+)"[^}]*\}/);
        if (jsonMatch) {
            return jsonMatch[1];
        }
        
        // Fallback to original message, but clean it up
        return message.replace(/^(Spotify API proxy error|Error):\s*/i, '').trim() || 'An unexpected error occurred.';
    }
    
    if (typeof error === 'string') {
        return error;
    }
    
    return 'An unexpected error occurred. Please try again.';
}
