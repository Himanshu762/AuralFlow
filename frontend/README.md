# AuralFlow interface

The Next.js shell for AuralFlow, exported as a static bundle that the Tauri
app loads from disk. See the repository README for the whole picture.

```bash
npm install
npm run dev          # http://localhost:3000, against services started by ../start.py
npm run lint
npm run type-check
npm run build        # static export to out/, which the desktop shell bundles
```

Where things live:

| Path | What |
|---|---|
| `app/page.tsx` | The shell for both form factors, and the wiring between the engine hook and every screen |
| `hooks/useMonochrome.ts` | The bridge to the audio engine, and the DJ loop (mood → pick → queue → feedback) |
| `stores/playerStore.ts` | All app state |
| `lib/api.ts` | Backend client: recommendations, library, DJ |
| `components/FlowCard.tsx` | The DJ: arc selector, next pick, reasons, rejection |
| `components/MoodMeter.tsx` | The mood reading and where it came from |
| `components/SoundSignature.tsx` | Output device, device correction, stabiliser, loudness layers |
