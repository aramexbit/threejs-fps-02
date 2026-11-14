// main.ts — DUSTLINE entry program (Node 22, standard library only).
// Copies game/ and screenshots/ from this repository to /output (or
// $MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json
// with buildDossier from vendor/makefun-threejs.ts. Runs twice, byte-identical.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
// Resolve the repository root from this file's own location, never from the
// working directory: the grader runs `node /bot/main.ts` with cwd=/, so
// process.cwd() points at "/" and copying "game" fails with ENOENT (that
// killed the v1 dev-phase run). import.meta.url always points at this file.
const root = dirname(fileURLToPath(import.meta.url));

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });
cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

const dossier = await buildDossier(root, {
  text_max_bytes: 163840,
  screenshots_max: 4,
  screenshot_max_bytes: 262144,
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
