import os from 'os';
import path from 'path';

export function getPageDockConfigDirectory(): string {
  if (process.env.PAGEDOCK_CONFIG_DIR) return process.env.PAGEDOCK_CONFIG_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'PageDock');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'PageDock');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'PageDock');
}

export function getManagedPythonExecutable(): string {
  return process.platform === 'win32'
    ? path.join(getPageDockConfigDirectory(), 'python-env', 'Scripts', 'python.exe')
    : path.join(getPageDockConfigDirectory(), 'python-env', 'bin', 'python3');
}

export function getCommonPythonCandidateBases(): string[] {
  const home = os.homedir();
  const shared = [
    getManagedPythonExecutable(),
    path.join(home, 'miniconda3', 'bin', 'python3'),
    path.join(home, 'anaconda3', 'bin', 'python3'),
  ];
  if (process.platform === 'darwin') {
    return [
      ...shared,
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
    ];
  }
  if (process.platform === 'win32') {
    const localPrograms = path.join(
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      'Programs',
      'Python',
    );
    return [
      getManagedPythonExecutable(),
      path.join(localPrograms, 'Python313', 'python'),
      path.join(localPrograms, 'Python312', 'python'),
      path.join(localPrograms, 'Python311', 'python'),
      path.join(home, 'miniconda3', 'python'),
      path.join(home, 'anaconda3', 'python'),
    ];
  }
  return [...shared, '/usr/local/bin/python3', '/usr/bin/python3'];
}
