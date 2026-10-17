import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const pkgPath = join(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const argVersion = process.argv[2];
let targetVersion = argVersion || pkg.version || '2.0.0';
targetVersion = targetVersion.replace(/^v/i, '').trim();

if (argVersion && argVersion !== pkg.version) {
  pkg.version = targetVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Updated package.json version to ${targetVersion}`);

  const lockPath = join(rootDir, 'package-lock.json');
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      lock.version = targetVersion;
      if (lock.packages && lock.packages['']) lock.packages[''].version = targetVersion;
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    } catch {}
  }

  const gradlePath = join(rootDir, 'android', 'app', 'build.gradle');
  if (existsSync(gradlePath)) {
    let gradle = readFileSync(gradlePath, 'utf-8');
    gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${targetVersion}"`);
    gradle = gradle.replace(/versionCode\s+(\d+)/, (_, code) => `versionCode ${parseInt(code, 10) + 1}`);
    writeFileSync(gradlePath, gradle);
  }

  execSync(`git add package.json package-lock.json android/app/build.gradle`, { cwd: rootDir, stdio: 'ignore' });
  execSync(`git commit -m "chore(release): bump version to ${targetVersion}"`, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, SKIP_VERSION_BUMP: '1' },
  });
}

const tagName = `v${targetVersion}`;

// Check if tag already exists locally
let existingTags = '';
try {
  existingTags = execSync('git tag -l', { cwd: rootDir }).toString();
} catch {}

if (existingTags.split('\n').map((t) => t.trim()).includes(tagName)) {
  console.log(`Tag ${tagName} already exists locally.`);
} else {
  console.log(`Creating git tag ${tagName}...`);
  execSync(`git tag -a ${tagName} -m "Release ${tagName}"`, {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

console.log(`Pushing main branch and tag ${tagName} to GitHub...`);
execSync('git push origin main', { cwd: rootDir, stdio: 'inherit' });
execSync(`git push origin ${tagName}`, { cwd: rootDir, stdio: 'inherit' });

console.log('\n======================================================');
console.log(` Tag ${tagName} pushed to GitHub successfully!`);
console.log(' GitHub Actions is now automatically:');
console.log('   1. Building the web app & syncing Capacitor');
console.log('   2. Compiling the Android APK (whaze-flood-ews.apk)');
console.log('   3. Publishing the GitHub Release with the APK attached');
console.log(' Monitor workflow progress:');
console.log('   https://github.com/Patkik/whaze-iot-flood-monitor/actions');
console.log(' View published release:');
console.log(`   https://github.com/Patkik/whaze-iot-flood-monitor/releases/tag/${tagName}`);
console.log('======================================================\n');
