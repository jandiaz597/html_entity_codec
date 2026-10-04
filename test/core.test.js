import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeHtmlEntities,
  encodeHtmlEntities,
  __internals,
} from '../src/core.js';

const { REPLACEMENT_CHARACTER } = __internals;

// --- Happy path: named entities ------------------------------------------------

test('decodes the five mandatory entities', () => {
  assert.equal(decodeHtmlEntities('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'');
});

test('decodes common typographic named entities', () => {
  assert.equal(decodeHtmlEntities('&copy;&reg;&trade;&mdash;&hellip;'),
    '\u00A9\u00AE\u2122\u2014\u2026');
});

test('decodes named entities embedded in surrounding text', () => {
  assert.equal(decodeHtmlEntities('Price: 5 &amp; 6 &mdash; done'),
    'Price: 5 & 6 \u2014 done');
});

// --- Numeric references --------------------------------------------------------

test('decodes decimal numeric references', () => {
  assert.equal(decodeHtmlEntities('&#65;&#66;&#67;'), 'ABC');
});

test('decodes lowercase hex numeric references', () => {
  assert.equal(decodeHtmlEntities('&#x41;&#x42;&#x43;'), 'ABC');
});

test('decodes uppercase hex numeric references', () => {
  // The spec accepts both `x` and `X` as the hex marker.
  assert.equal(decodeHtmlEntities('&#X41;&#X42;&#X43;'), 'ABC');
});

test('decodes a high code point above the BMP', () => {
  assert.equal(decodeHtmlEntities('&#x1F600;'), '\uD83D\uDE00');
});

// --- Numeric edge cases --------------------------------------------------------

test('NULL reference becomes REPLACEMENT CHARACTER', () => {
  assert.equal(decodeHtmlEntities('&#0;'), REPLACEMENT_CHARACTER);
});

test('lone surrogate reference becomes REPLACEMENT CHARACTER', () => {
  assert.equal(decodeHtmlEntities('&#xD800;'), REPLACEMENT_CHARACTER);
});

test('out-of-range reference becomes REPLACEMENT CHARACTER', () => {
  assert.equal(decodeHtmlEntities('&#x110000;'), REPLACEMENT_CHARACTER);
});

test('C0 control other than TAB/LF/CR becomes REPLACEMENT CHARACTER', () => {
  assert.equal(decodeHtmlEntities('&#x01;'), REPLACEMENT_CHARACTER);
});

test('TAB, LF, CR numeric references are preserved', () => {
  assert.equal(decodeHtmlEntities('&#9;&#10;&#13;'), '\t\n\r');
});

test('C1 controls 0x80-0x9F use the Windows-1252 mapping', () => {
  // 0x80 -> Euro sign; 0x93 -> left double quote; 0x99 -> trademark sign.
  assert.equal(decodeHtmlEntities('&#128;&#147;&#153;'),
    '\u20AC\u201C\u2122');
});

test('noncharacter code points become REPLACEMENT CHARACTER', () => {
  assert.equal(decodeHtmlEntities('&#xFFFE;'), REPLACEMENT_CHARACTER);
  assert.equal(decodeHtmlEntities('&#xFFFF;'), REPLACEMENT_CHARACTER);
  assert.equal(decodeHtmlEntities('&#x1FFFE;'), REPLACEMENT_CHARACTER);
  assert.equal(decodeHtmlEntities('&#xFDD0;'), REPLACEMENT_CHARACTER);
});

// --- Malformed / non-entity input ---------------------------------------------

test('passes through a bare ampersand', () => {
  assert.equal(decodeHtmlEntities('Tom & Jerry'), 'Tom & Jerry');
});

test('passes through an ampersand with no semicolon when name is known', () => {
  // We chose to require the trailing semicolon for named entities.
  assert.equal(decodeHtmlEntities('Tom &amp Jerry'), 'Tom &amp Jerry');
});

test('passes through ampersand at end of string', () => {
  assert.equal(decodeHtmlEntities('ends with &'), 'ends with &');
});

test('passes through a bare hash after ampersand', () => {
  assert.equal(decodeHtmlEntities('&# without digits'), '&# without digits');
});

test('passes through ampersand-hash-x without hex digits', () => {
  assert.equal(decodeHtmlEntities('&#xZ;'), '&#xZ;');
});

test('decodes a numeric reference with no trailing semicolon', () => {
  // The spec's browser-compatible behaviour: numeric refs without ';' still
  // decode. We test this because we implement it.
  assert.equal(decodeHtmlEntities('&#65B'), 'AB');
});

test('does not consume trailing alphanumerics after a known named entity without semicolon', () => {
  // `&copyfoo` is NOT `&copy;` + `foo` here because there is no semicolon.
  assert.equal(decodeHtmlEntities('&copyfoo'), '&copyfoo');
});

test('decodes multiple entities in sequence', () => {
  assert.equal(decodeHtmlEntities('&lt;a&gt; &amp; &quot;b&quot;'),
    '<a> & "b"');
});

test('returns input unchanged when it contains no ampersand', () => {
  assert.equal(decodeHtmlEntities('plain text'), 'plain text');
});

test('throws on non-string input to decode', () => {
  assert.throws(() => decodeHtmlEntities(42), TypeError);
  assert.throws(() => decodeHtmlEntities(null), TypeError);
});

// --- Encoding -----------------------------------------------------------------

test('encodes the five mandatory characters', () => {
  assert.equal(encodeHtmlEntities('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
});

test('does not encode non-ASCII characters', () => {
  assert.equal(encodeHtmlEntities('café — €'), 'café — €');
});

test('encodes characters embedded in text', () => {
  assert.equal(encodeHtmlEntities('a < b && c > d'),
    'a &lt; b &amp;&amp; c &gt; d');
});

test('encodes an empty string to an empty string', () => {
  assert.equal(encodeHtmlEntities(''), '');
});

test('throws on non-string input to encode', () => {
  assert.throws(() => encodeHtmlEntities(42), TypeError);
});

// --- Round-trip ----------------------------------------------------------------

test('encode then decode round-trips arbitrary text with the five special chars', () => {
  const original = 'if (a < b && c > d) print("hi")';
  assert.equal(decodeHtmlEntities(encodeHtmlEntities(original)), original);
});
