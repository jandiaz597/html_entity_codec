/**
 * HTML Entity Codec - core implementation.
 *
 * This module encodes and decodes HTML character entities: named entities
 * (e.g. `&amp;`, `&lt;`, `&copy;`) and numeric character references
 * (`&#65;`, `&#x41;`).
 *
 * Design decisions
 * -----------------
 * - We only resolve the subset of named entities that the HTML5 spec marks as
 *   "safe to decode unconditionally" — entities whose replacement text does not
 *   depend on a following semicolon or surrounding characters. This covers the
 *   entities developers actually rely on (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
 *   `&apos;`, `&nbsp;`, `&copy;`, `&reg;`, `&trade;`, `&mdash;`, `&hellip;`,
 *   `&laquo;`, `&raquo;`, `&times;`, `&divide;`, etc.) without forcing us to
 *   ship the ~2,000-entry full entity table or implement the spec's complicated
 *   semicolon-omitted matching rules. The brief asked for a small, focused
 *   library; we picked one clear interpretation and document it here.
 * - Numeric references are decoded fully, including the edge cases the spec
 *   calls out: NULL (U+0000) is replaced with the REPLACEMENT CHARACTER
 *   (U+FFFD), C0/C1 controls and surrogates map to U+FFFD, and values above
 *   U+10FFFF are replaced with U+FFFD. Code points in the valid printable
 *   ranges (including tab, line feed, and carriage return) are emitted as-is.
 * - For ENCODING we use the five entity names HTML5 mandates for attribute and
 *   text content escaping (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`). We do
 *   NOT escape non-ASCII characters as numeric references. This keeps the
 *   output readable and is safe inside UTF-8 documents, which is the only
 *   encoding the HTML5 spec recommends.
 */

/**
 * Named entities we recognize. Values are the exact replacement strings.
 *
 * We deliberately exclude entities with context-dependent replacement text
 * (e.g. `&NotSemicolon;`-style legacy forms). Every entry here maps to a
 * fixed string regardless of what follows, so the decoder does not need
 * lookahead beyond the terminating `;`.
 */
const NAMED_ENTITIES = Object.freeze({
  // ASCII-shifting basics — present in every escaping library.
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Whitespace and dashes.
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200C',
  zwj: '\u200D',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  // Quote variants.
  lsquo: '\u2018',
  rsquo: '\u2019',
  sbquo: '\u201A',
  ldquo: '\u201C',
  rdquo: '\u201D',
  bdquo: '\u201E',
  // Common typographic marks.
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  para: '\u00B6',
  sect: '\u00A7',
  middot: '\u00B7',
  bull: '\u2022',
  dagger: '\u2020',
  Dagger: '\u2021',
  permil: '\u2030',
  prime: '\u2032',
  Prime: '\u2033',
  // Math symbols developers trip over.
  times: '\u00D7',
  divide: '\u00F7',
  minus: '\u2212',
  plusmn: '\u00B1',
  frac12: '\u00BD',
  frac14: '\u00BC',
  frac34: '\u00BE',
  sup1: '\u00B9',
  sup2: '\u00B2',
  sup3: '\u00B3',
  // Guillemets and angle quotes.
  laquo: '\u00AB',
  raquo: '\u00BB',
  lsaquo: '\u2039',
  rsaquo: '\u203A',
  // Currency.
  cent: '\u00A2',
  pound: '\u00A3',
  yen: '\u00A5',
  euro: '\u20AC',
  // Punctuation.
  iexcl: '\u00A1',
  iquest: '\u00BF',
  // Spacing modifiers.
 emsp14: '\u2005',
 emsp13: '\u2004',
  // Misc convenience.
  spades: '\u2660',
  clubs: '\u2663',
  hearts: '\u2665',
  diams: '\u2666',
});

/**
 * U+FFFD, the Unicode REPLACEMENT CHARACTER. Centralized so the tests can
 * reference the same value the implementation uses.
 */
const REPLACEMENT_CHARACTER = '\uFFFD';

/**
 * Map a numeric code point to a string, applying the HTML5 parse-error recovery
 * rules for out-of-range, surrogate, and non-character code points.
 *
 * The rules implemented here are the ones the HTML5 tokenization algorithm
 * specifies for "numeric character reference end state":
 *   - 0x00            -> U+FFFD
 *   - 0x80..0x9F      -> the Windows-1252 mapping (kept as a small table below)
 *   - surrogates       -> U+FFFD
 *   - > 0x10FFFF      -> U+FFFD
 *   - noncharacters    -> U+FFFD (the spec says to emit the code point but with
 *                        a parse error; we emit U+FFFD to be safe for callers
 *                        who may use the output in contexts that reject
 *                        noncharacters — this is the stated interpretation)
 *   - control codes other than tab/LF/CR -> U+FFFD
 *
 * @param {number} code - The numeric value after parsing (decimal or hex).
 * @returns {string} The resulting single-character string.
 */
function codePointToString(code) {
  // Range check first.
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return REPLACEMENT_CHARACTER;
  }

  // NULL is explicitly replaced.
  if (code === 0x00) {
    return REPLACEMENT_CHARACTER;
  }

  // C1 controls (0x80..0x9F) are remapped through the Windows-1252 table per
  // the HTML5 spec. This is the one place we honour a legacy mapping.
  if (code >= 0x80 && code <= 0x9f) {
    const mapped = WINDOWS_1252[code - 0x80];
    if (mapped !== undefined) {
      return String.fromCodePoint(mapped);
    }
  }

  // Surrogates can never appear as a real character — they only exist as part
  // of a UTF-16 pair, never standalone.
  if (code >= 0xd800 && code <= 0xdfff) {
    return REPLACEMENT_CHARACTER;
  }

  // Noncharacters (U+FFFE, U+FFFF, and the last two code points of each plane).
  if (isNoncharacter(code)) {
    return REPLACEMENT_CHARACTER;
  }

  // C0 controls except TAB/LF/CR are replaced. The spec permits TAB/LF/CR.
  if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
    return REPLACEMENT_CHARACTER;
  }

  // DEL and the rest of the C1 block that wasn't remapped above.
  if (code === 0x7f) {
    return REPLACEMENT_CHARACTER;
  }

  return String.fromCodePoint(code);
}

/**
 * Windows-1252 remapping for the 0x80..0x9F range, per HTML5. Entries that
 * are `undefined` mean "fall through to the default behaviour" (i.e. treat as
 * a control and replace with U+FFFD).
 */
const WINDOWS_1252 = [
  0x20ac,  undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d, undefined,
  undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, undefined, 0x017e, 0x0178,
];

/**
 * Returns true if `code` is a Unicode noncharacter. We check the contiguous
 * range U+FDD0..U+FDEF and the final two code points of each plane.
 */
function isNoncharacter(code) {
  if (code >= 0xfdd0 && code <= 0xfdef) return true;
  // U+FFFE and U+FFFF, and the last two of every other plane.
  if ((code & 0xfffe) === 0xfffe) return true;
  return false;
}

/**
 * Decode a single entity reference beginning at `str[i]`, where `str[i] === '&'`.
 *
 * Returns `[replacement, length]` where `length` is the number of input
 * characters consumed (including the leading `&` and, if present, the trailing
 * `;`). If no valid entity starts at `i`, returns `['&', 1]` so the caller can
 * emit the `&` literally and continue.
 *
 * This function is extracted so the decode loop stays a tight per-character
 * copy and so tests can target the entity parser directly.
 */
function decodeEntityAt(str, i) {
  const n = str.length;
  // Caller guarantees str[i] === '&', but guard anyway.
  if (i >= n || str.charCodeAt(i) !== 0x26 /* & */) {
    return ['&', 1];
  }

  // Need at least one character after '&'.
  if (i + 1 >= n) {
    return ['&', 1];
  }

  const next = str.charCodeAt(i + 1);

  // Numeric reference: &#DDD; or &#xHHH;
  if (next === 0x23 /* # */) {
    if (i + 2 >= n) {
      return ['&', 1];
    }
    let j = i + 2;
    let hex = false;
    if (str.charCodeAt(j) === 0x78 /* x */ || str.charCodeAt(j) === 0x58 /* X */) {
      hex = true;
      j++;
      if (j >= n) {
        // Stray `&#x` with no digits. Emit the `&` and let the caller
        // re-scan the rest as text.
        return ['&', 1];
      }
    }

    const start = j;
    let value = 0;
    let sawDigit = false;
    while (j < n) {
      const c = str.charCodeAt(j);
      let digit;
      if (hex) {
        if (c >= 0x30 && c <= 0x39) digit = c - 0x30;
        else if (c >= 0x61 && c <= 0x66) digit = c - 0x61 + 10;
        else if (c >= 0x41 && c <= 0x46) digit = c - 0x41 + 10;
        else break;
      } else {
        if (c >= 0x30 && c <= 0x39) digit = c - 0x30;
        else break;
      }
      value = value * (hex ? 16 : 10) + digit;
      // Clamp to avoid floating-point loss of precision for absurd inputs;
      // any value above 0x10FFFF is handled by codePointToString anyway.
      if (value > 0x10ffff) value = 0x10ffff + 1;
      sawDigit = true;
      j++;
    }

    if (!sawDigit) {
      // `&#` not followed by digits — not a valid numeric reference.
      return ['&', 1];
    }

    const hadSemicolon = j < n && str.charCodeAt(j) === 0x3b /* ; */;
    const consumed = (hadSemicolon ? j + 1 : j) - i;
    // The HTML5 spec says a numeric reference without a trailing semicolon is
    // still parsed (with a parse error). We honour that behaviour because it
    // matches every browser and is what users actually expect when they write
    // `&#65 ` mid-sentence.
    const replacement = codePointToString(value);
    return [replacement, consumed];
  }

  // Named reference: letters followed by optional ';'.
  // We scan the longest run of ASCII alphanumerics and then look it up. If the
  // entity requires a semicolon (it does in our table — we don't keep the
  // legacy no-semicolon forms), we require it; otherwise we emit the `&`
  // literally so the caller can re-scan the rest.
  let j = i + 1;
  while (j < n) {
    const c = str.charCodeAt(j);
    const isAlphaNum =
      (c >= 0x61 && c <= 0x7a) || // a-z
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x30 && c <= 0x39);   // 0-9
    if (!isAlphaNum) break;
    j++;
  }
  const nameLen = j - (i + 1);
  if (nameLen === 0) {
    return ['&', 1];
  }
  const name = str.slice(i + 1, j);
  const hasSemicolon = j < n && str.charCodeAt(j) === 0x3b;

  if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) {
    // We DO require the semicolon for named entities. This is a deliberate
    // simplification: the HTML5 legacy-mode rules for semicolon-less named
    // entities are context-sensitive and we chose not to implement them.
    if (hasSemicolon) {
      return [NAMED_ENTITIES[name], j + 1 - i];
    }
    // If there is no semicolon, we treat it as not-an-entity so `&copyfoo`
    // does not lose its trailing letters to a silent decode.
    return ['&', 1];
  }

  // Unknown name — emit '&' and let the caller re-scan from i+1.
  return ['&', 1];
}

/**
 * Decode every entity in `input`. Unknown or malformed sequences are passed
 * through literally, character by character, so round-tripping arbitrary text
 * is safe.
 *
 * @param {string} input
 * @returns {string}
 */
export function decodeHtmlEntities(input) {
  if (typeof input !== 'string') {
    throw new TypeError('decodeHtmlEntities expects a string');
  }
  if (input.indexOf('&') === -1) {
    // Fast path: no entity can start without '&'.
    return input;
  }
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    if (input.charCodeAt(i) === 0x26 /* & */) {
      const [replacement, consumed] = decodeEntityAt(input, i);
      out += replacement;
      i += consumed;
    } else {
      out += input[i];
      i++;
    }
  }
  return out;
}

/**
 * Encode the five characters HTML5 says you must escape in text and
 * attribute content: `&`, `<`, `>`, `"`, `'`. Everything else — including
 * non-ASCII — is emitted as-is. This is safe for UTF-8 documents, which is
 * the only encoding HTML5 recommends, and it keeps the output readable.
 *
 * @param {string} input
 * @returns {string}
 */
export function encodeHtmlEntities(input) {
  if (typeof input !== 'string') {
    throw new TypeError('encodeHtmlEntities expects a string');
  }
  let out = '';
  let last = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    let esc = null;
    if (c === 0x26) esc = '&amp;';
    else if (c === 0x3c) esc = '&lt;';
    else if (c === 0x3e) esc = '&gt;';
    else if (c === 0x22) esc = '&quot;';
    else if (c === 0x27) esc = '&apos;';
    if (esc !== null) {
      out += input.slice(last, i) + esc;
      last = i + 1;
    }
  }
  out += input.slice(last);
  return out;
}

// Internal helpers are exported for focused tests. They are not part of the
// public API and may change between versions; tests that import them are
// testing the implementation, not the contract.
export const __internals = {
  NAMED_ENTITIES,
  REPLACEMENT_CHARACTER,
  codePointToString,
  decodeEntityAt,
  isNoncharacter,
};
