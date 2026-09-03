import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';

const SCREEN_INPUT = process.env.LIHA_SCREEN_INPUT ?? '4:none';
let terminalWindowId = null;

function runAppleScript(lines) {
  const args = lines.flatMap((line) => ['-e', line]);
  const result = spawnSync('osascript', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'AppleScript failed');
  return result.stdout.trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function prepareTerminal(cwd, environment = {}) {
  const extraEnvironment = Object.entries(environment)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(' ');
  const exportCommand = ['NPM_CONFIG_USERCONFIG=/dev/null', 'NPM_CONFIG_YES=true', extraEnvironment]
    .filter(Boolean)
    .join(' ');
  terminalWindowId = Number(
    runAppleScript([
      'tell application "Terminal"',
      'activate',
      `set demoTab to do script "cd ${cwd.replaceAll('\\', '\\\\').replaceAll('"', '\\"')} && export ${exportCommand.replaceAll('\\', '\\\\').replaceAll('"', '\\"')} && export PS1='demo@northwind $ ' && unset RPS1 && clear"`,
      'set demoWindow to front window',
      'set bounds of demoWindow to {0, 25, 1470, 956}',
      'set font size of demoTab to 20',
      'set custom title of demoTab to "Liha demo"',
      'set background color of demoTab to {61166, 61166, 61166}',
      'set normal text color of demoTab to {5000, 5000, 5000}',
      'return id of demoWindow',
      'end tell',
    ]),
  );
  if (!Number.isFinite(terminalWindowId))
    throw new Error('Could not identify the recording Terminal window');
}

function typeCommand(command, delay = 0.4) {
  const chunks = command.match(/\S+|\s+/g) ?? [];
  const chunkScript = chunks.flatMap((chunk) => {
    const escaped = chunk.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return [
      `set the clipboard to "${escaped}"`,
      'tell application "System Events" to keystroke "v" using command down',
      `delay ${delay}`,
    ];
  });
  runAppleScript([
    'tell application "Terminal"',
    `set index of window id ${terminalWindowId} to 1`,
    'activate',
    'end tell',
    'delay 0.4',
    ...chunkScript,
    'tell application "System Events" to key code 36',
  ]);
}

function terminalContents() {
  return runAppleScript([
    `tell application "Terminal" to get contents of selected tab of window id ${terminalWindowId}`,
  ]);
}

async function captureTerminal({
  cwd,
  command,
  output,
  environment = {},
  settleMs = 6_000,
  timeoutMs = 45_000,
}) {
  prepareTerminal(cwd, environment);
  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-framerate',
      '30',
      '-capture_cursor',
      '1',
      '-i',
      SCREEN_INPUT,
      '-vf',
      'scale=1920:-2:flags=lanczos,crop=1920:1080:0:(ih-1080)/2,setsar=1',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      output,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let ffmpegError = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegError += chunk.toString();
  });

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  typeCommand(command);

  const started = Date.now();
  let contents = '';
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    contents = terminalContents();
    if (/Published v\d+ to the same URL|Run "liha-preview deploy \." again/.test(contents)) break;
  }
  if (!/Published v\d+ to the same URL|Run "liha-preview deploy \." again/.test(contents)) {
    ffmpeg.kill('SIGINT');
    await once(ffmpeg, 'exit');
    throw new Error(
      `CLI did not finish before timeout. Terminal ended with:\n${contents.slice(-1_500)}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, settleMs));
  ffmpeg.kill('SIGINT');
  const [code] = await once(ffmpeg, 'exit');
  if (code !== 0 && code !== 255) throw new Error(ffmpegError.trim() || `ffmpeg exited ${code}`);
  return contents;
}

export { captureTerminal };
