// Publishes a new version: checks, bumps the version (commit + tag), pushes, builds the installer and
// uploads it as a GitHub release, where installed apps find it and update themselves.
// Uses the GitHub CLI's login (`gh auth token`), so nothing else needs a token.
//   npm run release            patch: 0.1.0 -> 0.1.1
//   npm run release -- minor   0.1.0 -> 0.2.0
import { execSync } from 'node:child_process';

const level = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(level)) throw new Error(`Okänd nivå: ${level} (patch, minor eller major).`);

const run = (command, env = {}) => execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });

if (execSync('git status --porcelain').toString().trim()) throw new Error('Committa eller ångra ändringarna först.');
run('npm run typecheck');
run('npm test');
run(`npm version ${level}`);
run('git push --follow-tags');
const token = execSync('gh auth token').toString().trim();
run('npx electron-vite build');
run('npx electron-builder --win --publish always', { GH_TOKEN: token });
