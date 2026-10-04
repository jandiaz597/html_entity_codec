# HTML Entity Codec

Encodes and decodes named and numeric HTML character entities in plain JavaScript strings.

## Usage

```js
import { decodeHtmlEntities, encodeHtmlEntities } from 'html-entity-codec';

decodeHtmlEntities('Tom &amp; Jerry &#x2014; done');
// 'Tom & Jerry — done'

encodeHtmlEntities('if (a < b && c > d)');
// 'if (a &lt; b &amp;&amp; c &gt; d)'
```

## Why this exists

This library exists for the narrow job of turning HTML entity references into
the characters they stand for, and back. It has zero dependencies and a single
file of implementation, which makes it easy to audit and bundle.

The trade-off: the decoder recognises a curated set of named entities (the ones
developers actually type — `&amp;`, `&lt;`, `&copy;`, `&mdash;`, `&hellip;`,
`&times;`, `&divide;`, etc.) plus the full numeric reference syntax
(`&#65;`, `&#x41;`). It does NOT ship the ~2,000-entry HTML5 entity table, and
it does NOT implement the spec's context-sensitive rules for semicolon-less
named entities (where `&copyfoo` would decode to `©foo`). Named entities
require a trailing semicolon. Numeric references, by contrast, follow the
browser-compatible behaviour of decoding even without a semicolon, because that
is what users encounter in real HTML.

Numeric references are passed through the HTML5 recovery rules: NULL, lone
surrogates, noncharacters, and control codes other than TAB/LF/CR are replaced
with U+FFFD; the 0x80–0x9F range is remapped through the Windows-1252 table.

The encoder escapes only the five characters HTML5 mandates for text and
attribute content (`& < > " '`) and leaves non-ASCII untouched. This is safe
for UTF-8 documents, which is the only encoding HTML5 recommends.

## Awkward edges

- `&amp` without a semicolon is returned literally. Browsers in legacy mode
  would decode it; this library chose not to.
- `&#65B` (numeric, no semicolon) decodes as `A` plus the `B`, matching
  browsers.
- `&copyfoo` does not become `©foo`. The lack of a semicolon means no decode.

## Exports

- `decodeHtmlEntities(input: string): string`
- `encodeHtmlEntities(input: string): string`

## License

MIT.
