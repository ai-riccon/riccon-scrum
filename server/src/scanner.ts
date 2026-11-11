import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectProfile } from '@acp-scrum/shared';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const FRAMEWORK_HINTS: Record<string, string> = {
  react: 'React',
  'react-dom': 'React',
  vue: 'Vue',
  next: 'Next.js',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  nestjs: 'NestJS',
  '@nestjs/core': 'NestJS',
  vite: 'Vite',
  typescript: 'TypeScript',
  jest: 'Jest',
  vitest: 'Vitest',
  mocha: 'Mocha',
  tailwindcss: 'Tailwind CSS',
  electron: 'Electron',
  '@angular/core': 'Angular',
};

export async function scanProject(repoPath: string): Promise<ProjectProfile> {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const manifests: string[] = [];
  const scripts: Record<string, string> = {};
  const dependencies = new Set<string>();
  const testCommands = new Set<string>();
  const buildCommands = new Set<string>();
  const entryPoints = new Set<string>();
  let packageManager: string | null = null;

  const has = async (name: string) => exists(path.join(repoPath, name));

  // Node / JS / TS
  if (await has('package.json')) {
    manifests.push('package.json');
    languages.add('JavaScript/TypeScript');
    const pkg = await readJson(path.join(repoPath, 'package.json'));
    if (pkg) {
      const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, string>;
      for (const [dep, hint] of Object.entries(FRAMEWORK_HINTS)) {
        if (dep in deps) {
          frameworks.add(hint);
          dependencies.add(dep);
        }
      }
      if (deps.typescript || (await has('tsconfig.json'))) languages.add('TypeScript');
      const sc = (pkg.scripts ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(sc)) scripts[k] = v;
      if (sc.test && !/no test specified/i.test(sc.test)) testCommands.add('npm test');
      if (sc.build) buildCommands.add('npm run build');
      if (typeof pkg.main === 'string') entryPoints.add(pkg.main);

      // monorepo workspaces: merge deps/frameworks/scripts from member packages
      const workspaces = Array.isArray(pkg.workspaces) ? (pkg.workspaces as string[]) : [];
      for (const ws of workspaces) {
        const dirs = ws.endsWith('/*')
          ? await fs.readdir(path.join(repoPath, ws.slice(0, -2)), { withFileTypes: true }).then((es) => es.filter((e) => e.isDirectory()).map((e) => path.join(ws.slice(0, -2), e.name))).catch(() => [])
          : [ws];
        for (const dir of dirs) {
          const wpkg = await readJson(path.join(repoPath, dir, 'package.json'));
          if (!wpkg) continue;
          manifests.push(path.join(dir, 'package.json'));
          const wdeps = { ...(wpkg.dependencies as object), ...(wpkg.devDependencies as object) } as Record<string, string>;
          for (const [dep, hint] of Object.entries(FRAMEWORK_HINTS)) {
            if (dep in wdeps) {
              frameworks.add(hint);
              dependencies.add(dep);
            }
          }
          const wsc = (wpkg.scripts ?? {}) as Record<string, string>;
          if (wsc.test && !/no test specified/i.test(wsc.test)) testCommands.add(`npm test -w ${dir}`);
          if (wsc.build) buildCommands.add(`npm run build -w ${dir}`);
        }
      }
    }
    if (await has('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (await has('yarn.lock')) packageManager = 'yarn';
    else if (await has('package-lock.json')) packageManager = 'npm';
    if (await has('tsconfig.json')) manifests.push('tsconfig.json');
  }

  // Java
  if (await has('pom.xml')) {
    manifests.push('pom.xml');
    languages.add('Java');
    frameworks.add('Maven');
    testCommands.add('mvn test');
    buildCommands.add('mvn package');
  }
  if ((await has('build.gradle')) || (await has('build.gradle.kts'))) {
    manifests.push('build.gradle');
    languages.add('Java/Kotlin');
    frameworks.add('Gradle');
    testCommands.add('gradle test');
    buildCommands.add('gradle build');
  }

  // Go
  if (await has('go.mod')) {
    manifests.push('go.mod');
    languages.add('Go');
    testCommands.add('go test ./...');
    buildCommands.add('go build ./...');
  }

  // Rust
  if (await has('Cargo.toml')) {
    manifests.push('Cargo.toml');
    languages.add('Rust');
    testCommands.add('cargo test');
    buildCommands.add('cargo build');
  }

  // Python
  if ((await has('pyproject.toml')) || (await has('requirements.txt')) || (await has('setup.py'))) {
    manifests.push((await has('pyproject.toml')) ? 'pyproject.toml' : 'requirements.txt');
    languages.add('Python');
    if (await has('pytest.ini')) frameworks.add('pytest');
    testCommands.add('pytest');
  }

  // .NET
  if ((await has('global.json')) || (await exists(repoPath + '.sln'))) {
    languages.add('C#');
    frameworks.add('.NET');
    testCommands.add('dotnet test');
  }

  // generic entry points
  for (const cand of ['src/index.ts', 'src/main.ts', 'src/index.js', 'src/main.js', 'src/App.tsx', 'src/app.py', 'main.go', 'src/main.rs', 'index.html']) {
    if (await has(cand)) entryPoints.add(cand);
  }

  // top-level structure
  const entries = await fs.readdir(repoPath, { withFileTypes: true });
  const structure = entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => (e.isDirectory() ? e.name + '/' : e.name))
    .sort();

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    packageManager,
    scripts,
    testCommands: [...testCommands],
    buildCommands: [...buildCommands],
    entryPoints: [...entryPoints],
    structure,
    dependencies: [...dependencies].slice(0, 30),
    manifests,
  };
}