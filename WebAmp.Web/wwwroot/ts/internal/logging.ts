export type LogLevel = 'info' | 'warn' | 'error';
export type LogData = Record<string, string | number | boolean | null | undefined>;

export function logEvent(
    component: string,
    event: string,
    data?: LogData | null,
    note?: string,
    level: LogLevel = 'info'
) {
    const logger =
        level === 'error' ? console.error :
        level === 'warn' ? console.warn :
        console.log;

    const fieldSegment = data
        ? Object.entries(data)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
            .join(' ')
        : '';

    const noteSegment = note ? ` (${note})` : '';
    const message =
        fieldSegment
            ? `[${component}] ${event} - ${fieldSegment}${noteSegment}`
            : `[${component}] ${event}${noteSegment}`;

    logger(message);
}
