#!/usr/bin/env node
/**
 * Generate the plain-CommonJS copies of the shared modules used by the Vercel
 * functions in api/. Vercel compiles api/*.ts to CommonJS and cannot require
 * ES modules or resolve `.ts` specifiers outside api/ at runtime, so
 * api-lib/*.js are type-stripped CJS copies of their TypeScript sources —
 * regenerate after editing the sources:
 *
 *   node server/scripts/build-api-lib.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const jobs = [
  {
    from: 'server/src/curl.ts',
    to: 'api-lib/curl.js',
    exports: ['tokenizeCurl', 'parseCurl'],
  },
  {
    from: 'server/src/target.ts',
    to: 'api-lib/target.js',
    exports: ['TargetClient', 'extractReplyText', 'suggestReplyPaths'],
  },
];

let failed = false;

for (const job of jobs) {
  const srcPath = path.join(root, job.from);
  const outPath = path.join(root, job.to);
  const src = fs.readFileSync(srcPath, 'utf8');
  let out = stripTypeScriptTypes(src, { mode: 'strip' });

  if (/^\s*import\s/m.test(out)) {
    console.error(`${job.from}: contains runtime imports — the generated CJS copy would not resolve them. Aborting.`);
    failed = true;
    continue;
  }

  // ESM exports -> plain declarations (the files export no defaults).
  out = out.replace(/^export\s+(async\s+function|function|class|const|let|var)\s/gm, '$1 ');
  if (/^export\s/m.test(out)) {
    console.error(`${job.from}: unhandled export syntax left after stripping. Aborting.`);
    failed = true;
    continue;
  }

  for (const name of job.exports) {
    if (!new RegExp(`(?:function|class|const)\\s+${name}\\b`).test(out)) {
      console.error(`${job.from}: expected export "${name}" not found. Aborting.`);
      failed = true;
    }
  }
  if (failed) continue;

  const header =
    `// AUTO-GENERATED from ${job.from} by server/scripts/build-api-lib.mjs — do not edit by hand.\n` +
    `// (Vercel functions compile to CommonJS and cannot require ES modules or .ts files; regenerate after changing the source.)\n`;
  const footer = `\nmodule.exports = {\n  ${job.exports.join(',\n  ')},\n};\n`;
  fs.writeFileSync(outPath, header + out + footer);
  console.log(`${job.from} -> ${job.to} (${out.length} bytes)`);
}

if (failed) process.exit(1);
