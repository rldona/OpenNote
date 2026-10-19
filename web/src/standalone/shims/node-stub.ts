/**
 * Stand-in for the Node modules that only the folder-sync, clipper and attachment-indexing code uses (`fs`, `path`, `os`,
 * `net`, `dns`, `child_process`). The browser build imports those files but never runs that code; anything that tries to
 * throws a clear error instead of failing obscurely.
 */
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser build`);
};

// path
export const sep = '/';
export const delimiter = ':';
export const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
export const resolve = (...parts: string[]) => join(...parts);
export const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
// fs, fs/promises
export const existsSync = () => false;
export const statSync = unavailable('fs.statSync');
export const mkdirSync = unavailable('fs.mkdirSync');
export const readFileSync = unavailable('fs.readFileSync');
export const writeFileSync = unavailable('fs.writeFileSync');
export const rmSync = unavailable('fs.rmSync');
export const mkdir = unavailable('fs.mkdir');
export const readFile = unavailable('fs.readFile');
export const readdir = unavailable('fs.readdir');
export const rename = unavailable('fs.rename');
export const rm = unavailable('fs.rm');
export const stat = unavailable('fs.stat');
export const writeFile = unavailable('fs.writeFile');
export const mkdtemp = unavailable('fs.mkdtemp');
// os
export const hostname = () => 'browser';
export const tmpdir = () => '/tmp';
// net, dns, child_process
export const isIP = () => 0;
export const lookup = unavailable('dns.lookup');
export const execFile = unavailable('child_process.execFile');
