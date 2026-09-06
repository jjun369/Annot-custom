export const READER_SUMMARY_CHANGED_EVENT = 'pagedock:reader-summary-changed';

export function notifyReaderSummaryChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(READER_SUMMARY_CHANGED_EVENT));
}
