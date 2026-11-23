// Publishes a new version: checks, bumps the version (commit + tag), pushes, builds the installer and
// publishes it as a GitHub release, where installed apps find it and update themselves.
// Publishing goes through the GitHub CLI's login, and the script checks afterwards that every file the
// updater needs (installer, blockmap, latest.yml) is on the release.
//   npm run release            patch: 0.1.0 -> 0.1.1
//   npm run release -- minor   0.1.0 -> 0.2.0
import { execSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const level = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(level)) throw new Error(`Okänd nivå: ${level} (patch, minor eller major).`);

const run = (command) => execSync(command, { stdio: 'inherit' });
const read = (command) => execSync(command).toString().trim();

if (read('git status --porcelain')) throw new Error('Committa eller ångra ändringarna först.');
run('npm run typecheck');
run('npm test');
run(`npm version ${level}`);
run('git push --follow-tags');
run('npx electron-vite build');
run('npx electron-builder --win --publish never');

// latest.yml names the files with dashes instead of spaces; the release assets must carry those names.
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const built = `dist/Claude Manager Setup ${version}.exe`;
const name = `Claude-Manager-Setup-${version}.exe`;
const staging = 'dist/upload';
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
copyFileSync(built, `${staging}/${name}`);
copyFileSync(`${built}.blockmap`, `${staging}/${name}.blockmap`);
copyFileSync('dist/latest.yml', `${staging}/latest.yml`);

const tag = `v${version}`;
run(`gh release create ${tag} --title ${tag} --notes "Claude Manager ${version}" "${staging}/${name}" "${staging}/${name}.blockmap" "${staging}/latest.yml"`);

const assets = read(`gh release view ${tag} --json assets --jq ".assets[].name"`).split(/\r?\n/);
const missing = [name, `${name}.blockmap`, 'latest.yml'].filter((file) => !assets.includes(file));
if (missing.length) throw new Error(`Releasen ${tag} saknar: ${missing.join(', ')}. Ladda upp med gh release upload ${tag} <filer> --clobber.`);
// Nudge the app on this computer, if it runs, to look for the new version now instead of within 3 hours.
const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Claude Manager', 'Claude Manager.exe');
const running = read('tasklist /FI "IMAGENAME eq Claude Manager.exe" /NH').includes('Claude Manager.exe');
if (running && existsSync(installed)) spawn(installed, ['--check-update'], { detached: true, stdio: 'ignore' }).unref();
console.log(`\nReleasen ${tag} är publicerad. Appen här ${running ? 'letar efter den nu och ' : ''}installerar den när den är ledig.`);
