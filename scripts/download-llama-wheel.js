const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const bundledWheelDir = path.join(repoRoot, 'backend', 'lib', 'python');
const wheelDir = path.join(bundledWheelDir, 'wheels');
const minimumWheelBytes = 1024;
const cpuWheelIndexUrl = 'https://abetlen.github.io/llama-cpp-python/whl/cpu';

const platformWheels = {
  win32: {
    name: 'Windows x64',
    platformArgs: ['win_amd64'],
    platformMatchers: [/win_amd64/i, /windows/i],
    preferredPythonVersions: ['312', '311', '310']
  },
  linux: {
    name: 'Linux x64',
    platformArgs: ['linux_x86_64', 'manylinux2014_x86_64'],
    platformMatchers: [/manylinux.*x86_64/i, /linux_x86_64/i, /linux/i],
    preferredPythonVersions: ['312', '311', '310'],
    extraIndexUrl: cpuWheelIndexUrl
  },
  darwin: {
    name: 'macOS x64',
    platformArgs: ['macosx_10_13_x86_64', 'macosx_11_0_x86_64'],
    platformMatchers: [/macosx/i, /macos/i, /darwin/i],
    preferredPythonVersions: ['312', '311', '310'],
    extraIndexUrl: cpuWheelIndexUrl
  }
};

function runPythonCommand(pythonCmd, args) {
  const result = spawnSync(pythonCmd, args, { stdio: 'inherit' });
  return result.status === 0;
}

function findPython() {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const ok = runPythonCommand(cmd, ['-c', 'print("ok")']);
    if (ok) return cmd;
  }
  return null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listWheelInfos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.whl'))
    .map((name) => {
      const wheelPath = path.join(dir, name);
      const stats = fs.statSync(wheelPath);
      return {
        path: wheelPath,
        name,
        size: stats.size,
        mtime: stats.mtimeMs
      };
    });
}

function scoreWheel(info, platformConfig) {
  return (
    (platformConfig.platformMatchers.some((matcher) => matcher.test(info.name)) ? 10 : 0) +
    (/cp312/i.test(info.name) ? 3 : 0) +
    (/cp311/i.test(info.name) ? 2 : 0) +
    (/cp310/i.test(info.name) ? 1 : 0) +
    (info.size > minimumWheelBytes ? 1 : -100) +
    (/^llama-cpp-python-(win64|linux64|macos)\.whl$/i.test(info.name) ? -5 : 0)
  );
}

function findBestExistingWheel(platformConfig, dirs) {
  return dirs
    .flatMap((dir) => listWheelInfos(dir))
    .filter((info) => info.size > minimumWheelBytes)
    .filter((info) => platformConfig.platformMatchers.some((matcher) => matcher.test(info.name)))
    .sort((left, right) => scoreWheel(right, platformConfig) - scoreWheel(left, platformConfig) || right.mtime - left.mtime || left.name.localeCompare(right.name))[0] || null;
}

function main() {
  const envWheelPath = process.env.LLAMA_CPP_WHEEL_PATH;
  const wheelSearchDirs = [bundledWheelDir, wheelDir];

  const allExist = Object.values(platformWheels).every((platformConfig) => findBestExistingWheel(platformConfig, wheelSearchDirs));
  if (allExist) {
    console.log('All platform wheels already present as real staged wheels');
    return;
  }

  if (envWheelPath && fs.existsSync(envWheelPath)) {
    const currentPlatform = process.platform;
    const platformConfig = platformWheels[currentPlatform];
    const targetName = path.basename(envWheelPath);
    const targetPath = path.join(bundledWheelDir, targetName);
    if (!platformConfig) {
      console.error('Unsupported platform for LLAMA_CPP_WHEEL_PATH:', currentPlatform);
      process.exit(1);
    }
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(envWheelPath, targetPath);
    console.log('Wheel copied from LLAMA_CPP_WHEEL_PATH:', targetPath);
    return;
  }

  const pythonCmd = findPython();
  if (!pythonCmd) {
    console.error('No Python interpreter found (python or python3).');
    process.exit(1);
  }

  ensureDir(bundledWheelDir);
  ensureDir(wheelDir);

  const versions = [
    { ver: '312', abi: 'cp312' },
    { ver: '311', abi: 'cp311' },
    { ver: '310', abi: 'cp310' }
  ];

  const indexArgs = [
    '--index-url', 'https://pypi.org/simple',
    '--trusted-host', 'pypi.org',
    '--trusted-host', 'files.pythonhosted.org'
  ];

  for (const platformConfig of Object.values(platformWheels)) {
    const existingWheel = findBestExistingWheel(platformConfig, wheelSearchDirs);
    if (existingWheel) {
      console.log(`${platformConfig.name} wheel already present: ${existingWheel.path}`);
      continue;
    }

    console.log(`\nDownloading llama-cpp-python for ${platformConfig.name}...`);
    let downloadOk = false;

    for (const { ver, abi } of versions) {
      for (const platformArg of platformConfig.platformArgs) {
        const args = [
          '-m', 'pip', 'download', 'llama-cpp-python',
          '--only-binary=:all:', '--no-deps',
          '--platform', platformArg,
          '--python-version', ver,
          '--implementation', 'cp',
          '--abi', abi,
          '-d', wheelDir
        ].concat(indexArgs);

        if (platformConfig.extraIndexUrl) {
          args.push('--extra-index-url', platformConfig.extraIndexUrl);
        }

        console.log(`  Trying cp${ver} with ${platformArg}...`);
        if (runPythonCommand(pythonCmd, args)) {
          downloadOk = true;
          break;
        }
      }

      if (downloadOk) {
        break;
      }
    }

    if (downloadOk) {
      const downloadedWheel = findBestExistingWheel(platformConfig, [wheelDir]);
      if (downloadedWheel) {
        const targetPath = path.join(bundledWheelDir, downloadedWheel.name);
        fs.copyFileSync(downloadedWheel.path, targetPath);
        console.log(`  ✓ Saved to: ${targetPath}`);
      }
    } else {
      console.warn(`  ⚠ Could not download wheel for ${platformConfig.name}`);
    }
  }

  console.log('\nWheel download complete.');
}

main();
