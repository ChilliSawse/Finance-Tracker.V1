// Test cases for the "html" group (S2): the escaping helpers used by HTML-string renderers.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { esc, escNum } from './html.js';

const BREAKOUT = '"><iframe srcdoc="<script nonce=x>alert(1)</script>"></iframe>';

export const HTML_TEST_CASES = [
    {
        name: 'S2.1 esc neutralises every HTML metacharacter',
        fn(assert) {
            assert('lt gt amp', esc('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
            assert('quotes', esc(`"'`), '&quot;&#039;');
            const out = esc(BREAKOUT);
            assert('no raw quote', out.includes('"'), false);
            assert('no raw angle', /[<>]/.test(out), false);
        },
    },
    {
        name: 'S2.2 esc handles null, undefined and numbers',
        fn(assert) {
            assert('null', esc(null), '');
            assert('undefined', esc(undefined), '');
            assert('number', esc(12.5), '12.5');
            assert('zero', esc(0), '0');
        },
    },
    {
        name: 'S2.3 escNum passes finite numbers and numeric strings',
        fn(assert) {
            assert('int', escNum(42), '42');
            assert('float', escNum(0.25), '0.25');
            assert('negative', escNum(-3), '-3');
            assert('numeric string', escNum('7.5'), '7.5');
            assert('zero', escNum(0), '0');
        },
    },
    {
        name: 'S2.4 escNum drops empty and non-numeric input',
        fn(assert) {
            assert('null', escNum(null), '');
            assert('undefined', escNum(undefined), '');
            assert('empty', escNum(''), '');
            assert('NaN', escNum(NaN), '');
            assert('Infinity', escNum(Infinity), '');
            assert('markup string', escNum('3<b id=x>INJ</b>'), '');
            assert('breakout string', escNum(BREAKOUT), '');
            assert('object', escNum({}), '');
        },
    },
    {
        name: 'S2.5 escNum output is always attribute-safe',
        fn(assert) {
            for (const v of [1e21, -1e-7, '1e3', ' 5 ', 'abc', [], [1], true]) {
                assert('safe ' + String(v), /^[0-9eE+.\-]*$/.test(escNum(v)), true);
            }
        },
    },
];
