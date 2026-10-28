# Dependency security compatibility packages

These are explicit, private local packages, installed under the legacy dependency
names through npm overrides. They are not upstream releases. Keep this directory
in the checkout when running `npm ci` (npm lockfile v3 records local links).

## image-size

Metro 0.84.4 requires the callable image-size 1.x API for buffers and synchronous
filenames. Official image-size 2.0.4 fixes the ICNS and JXL/HEIF infinite loops
(GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq), but removed that filename API.
The adapter uses the unmodified official 2.0.4 parser (`image-size-parser` npm
alias), preserving Metro's buffer/filename behavior and its 512 KiB read limit.
Only the API used by this repository's Metro is supported; v1's callback,
filesystem-disable and concurrency APIs are not exposed.

Upstream: https://codeberg.org/image-size/image-size (MIT).
Remove the adapter when the installed Metro supports the fixed upstream API.

## deepmerge

`@iishnitsa/deepmerge` is a local fork of deepmerge 4.3.1's published
`dist/cjs.js` and `index.d.ts`, with its MIT license retained. There is no upstream
fixed npm version for GHSA-gcqx-w48m-w2h4 as of 2026-10-28.
The only behavior change is that writes to the merge result use
`Object.defineProperty` in both source and target loops. This preserves enumerable
own data (including a literal `__proto__`) without calling the inherited prototype
setter. Array merging, cloning, symbols, custom merge and `.all` remain intact.
This is a maintained mitigation in this repository, not an upstream fix or an
advisory dismissal. Reassess it when upstream publishes a correction.

Upstream: https://github.com/TehShrike/deepmerge/tree/v4.3.1 (MIT).
Report: https://github.com/TehShrike/deepmerge/issues/273

## Validation

`npm test -- --runInBand client/lib/__tests__/dependency-security.test.ts`
checks the real installed packages through Metro, Expo and Jest resolution paths,
malformed-image termination, normal PNG assets, and prototype-poisoning cases.
Run `npm run check:required` and Android/iOS Expo exports before dependency updates.
Do not remove these overrides merely to reduce the diff or silence a warning.
