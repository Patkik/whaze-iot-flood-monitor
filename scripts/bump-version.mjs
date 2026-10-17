import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const isHook = process.argv.includes('--hook');

if (process.env.SKIP_VERSION_BUMP === '1' || process.env.SKIP_VERSION_BUMP === 'true') {
  if (isHook) {
    console.log('[whaze-version] Skipping automatic version bump (SKIP_VERSION_BUMP is set)');
    process.exit(0);
  }
}

// In hook mode, avoid bumping if git is rebasing or merging
if (isHook) {
  const gitDir = join(rootDir, '.git');
  const isMerging = existsSync(join(gitDir, 'MERGE_HEAD'));
  const isRebasing =
    existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'));
  if (isMerging || isRebasing) {
    process.exit(0);
  }

  // Check if there are any staged changes before committing
  let stagedFiles = [];
  try {
    stagedFiles = execSync('git diff --cached --name-only', { cwd: rootDir })
      .toString()
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {}

  if (stagedFiles.length === 0) {
    // Nothing staged; let git exit normally with "no changes added to commit"
    process.exit(0);
  }
}

const pkgPath = join(rootDir, 'package.json');
const lockPath = join(rootDir, 'package-lock.json');
const gradlePath = join(rootDir, 'android', 'app', 'build.gradle');

// 1. Bump package.json semver patch
const pkgRaw = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);

const parts = (pkg.version || '2.0.0').split('.');
const major = parseInt(parts[0] || '2', 10);
const minor = parseInt(parts[1] || '0', 10);
const patch = parseInt(parts[2] || '0', 10) + 1;
const nextVersion = `${major}.${minor}.${patch}`;
pkg.version = nextVersion;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Bump package-lock.json if present
if (existsSync(lockPath)) {
  try {
    const lockRaw = readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(lockRaw);
    lock.version = nextVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = nextVersion;
    }
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  } catch (err) {
    console.warn('[whaze-version] Warning: failed to update package-lock.json version:', err.message);
  }
}

// 3. Bump android/app/build.gradle versionCode and versionName
let gradleContent = readFileSync(gradlePath, 'utf-8');
let newVersionCode = 2;

gradleContent = gradleContent.replace(/versionCode\s+(\d+)/, (match, code) => {
  newVersionCode = parseInt(code, 10) + 1;
  return `versionCode ${newVersionCode}`;
});

gradleContent = gradleContent.replace(/versionName\s+"[^"]+"/, () => {
  return `versionName "${nextVersion}"`;
});

writeFileSync(gradlePath, gradleContent);

// 4. Stage files in git index so they are committed together
try {
  const filesToStage = ['package.json', 'android/app/build.gradle'];
  if (existsSync(lockPath)) {
    filesToStage.push('package-lock.json');
  }
  execSync(`git add ${filesToStage.join(' ')}`, { cwd: rootDir, stdio: 'ignore' });
} catch {
  // Ignore if outside git
}

console.log(`[whaze-version] Iterated version to v${nextVersion} (versionCode ${newVersionCode})`);
