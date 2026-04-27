#!/usr/bin/env node
// Script de build para produção
// 1. Vite builda o frontend (pode limpar dist/)
// 2. tsc compila o server para dist/server.js
// 3. Cria dist/package.json para forçar CommonJS (resolve conflito com "type":"module" do root)

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

// 1. Build frontend (Vite pode limpar dist/)
run('npx vite build');

// 2. Compilar server TypeScript para dist/server.js
run('npx tsc -p tsconfig.server.json');

// 3. Garantir que dist/package.json marca CommonJS
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(
  join(root, 'dist', 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2)
);
console.log('\n✓ dist/package.json criado (CommonJS)');
console.log('✓ Build completo!');
