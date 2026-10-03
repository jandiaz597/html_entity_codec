/**
 * Public entry point for the HTML Entity Codec library.
 *
 * Re-exports the encode/decode functions and nothing else. The `__internals`
 * object from `core.js` is intentionally NOT re-exported here: it exists for
 * tests and is not part of the supported API.
 */
export { decodeHtmlEntities, encodeHtmlEntities } from './core.js';
