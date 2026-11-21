// The "exploring with sample data" flag, kept apart from sample-data.js so Today's setup checklist can read it
// without loading the whole sample household builder (P3b). sample-data.js re-exports these.

export const SAMPLE_FLAG_KEY = 'ft-sample-data';

export function sampleDataActive() {
    try { return localStorage.getItem(SAMPLE_FLAG_KEY) === '1'; } catch (_) { return false; }
}

export function clearSampleFlag() {
    try { localStorage.removeItem(SAMPLE_FLAG_KEY); } catch (_) { /* storage full or blocked: skip, deliberate */ }
}
