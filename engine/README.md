# Engine integration

AuralFlow plays audio through [Monochrome](https://github.com/monochrome-music/monochrome),
vendored at `monochrome_app/`. That directory is a **plain copy** of the
upstream tree with no git metadata of its own, so re-vendoring it — which is
how you pick up a fix or move to a newer backend — overwrites everything in it.

Nothing of ours is kept there as its source of truth. This directory owns it:

| | |
|---|---|
| `auralflow-bridge.js` | The whole integration. Translates between AuralFlow's `af:` postMessage protocol and Monochrome's player; measures the playing audio for the library (`af:features`); composes the Sound Signature layers onto the EQ filters; tracks output devices. |
| `patches/` | Small additions to engine source, one file each. |
| `apply.mjs` | Copies the bridge in and applies the patches. Idempotent. |
| `test/selftest.mjs` | Drives the analyser with a synthetic 120 BPM C-major signal and checks tempo, key, mode and the layer arithmetic. Needs no vendored engine: `node engine/test/selftest.mjs`. |
| `vendor.json` | Which upstream commit `monochrome_app/` came from. |

`apply.mjs` runs automatically before every engine build, so a re-vendored tree
is grafted back without anyone having to remember. You can also run it directly:

```bash
node engine/apply.mjs
```

## Re-vendoring

```bash
git clone --depth 1 https://github.com/monochrome-music/monochrome /tmp/mono
rm -rf monochrome_app/js && cp -a /tmp/mono/js monochrome_app/js
cp /tmp/mono/index.html /tmp/mono/vite.config.ts /tmp/mono/package.json monochrome_app/
node engine/apply.mjs          # put our additions back
```

Then update the `commit` in `vendor.json` so the next person knows what this is.

## Why the generation matters

The engine reaches its catalogue and streams through backend instances. Those
moved: builds from before the migration point at `samidy.*` hosts that are now
offline, and **cannot play anything**.

The failure is quiet. Search still works, because that falls through to a public
metadata API, and artwork still loads. The only symptom is that pressing play
does nothing — no error, no sound. We lost a long time to this.

`apply.mjs` checks for those dead hosts and warns at build time. If you see that
warning, the vendored copy is too old; re-vendor it.

## Patches

Each patch matches an exact anchor in upstream source. If upstream rewrites the
surrounding code the patch fails loudly rather than applying in the wrong place,
and the build stops — which is the point.

- **`app.js`** — one import, so the bridge loads at startup.
- **`audio-context.js`** — `applyTransientGains`, which writes band gains to the
  running filters without persisting them. The adaptive EQ recomputes a curve
  several times a second; routing that through the normal setter would write to
  `localStorage` on every update and overwrite the EQ the user set by hand.
