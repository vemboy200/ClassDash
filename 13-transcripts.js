/**
 * Video transcripts from Edpuzzle.
 *
 * ── How it works ──
 *
 *   assignment page → .webm file address → ffmpeg pulls the audio
 *   → whisper transcribes it locally → text lands in its own file
 *
 * Confirmed on a real video on August 11th: 7.5 minutes of audio
 * transcribed in 13 seconds (on Metal — the Mac's GPU).
 *
 * ── What this deliberately does NOT do ──
 *
 * The player never launches. The video never plays, no questions pop up,
 * no assignment progress happens. ffmpeg pulls the file straight from its
 * address.
 *
 * That's a deliberate line: a transcript helps understand a video the
 * user already has to watch anyway. Anything that replaces watching it —
 * skipping to the end, pulling out answers — is past the line drawn on
 * day one. The answers, for what it's worth, sit right there in the same
 * API response, out in the open; not taking them is a choice, not a
 * limitation.
 *
 * ── One limitation that only clears up in September ──
 *
 * Everything here is tested against an assignment already TURNED IN. How
 * Edpuzzle behaves with a new, not-yet-done one is unknown: opening the
 * page might mark it as started. So check by hand the first time a real
 * assignment comes up.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL = path.join(os.homedir(), '.cache/whisper/ggml-small.en.bin');

/** Whether everything needed is actually there before bothering to try. */
function checkReady() {
  const has = (name) => {
    try { execFileSync('which', [name], { stdio: 'pipe' }); return true; }
    catch { return false; }
  };
  if (!has('ffmpeg')) return 'no ffmpeg (brew install ffmpeg)';
  if (!has('whisper-cli')) return 'no whisper (brew install whisper-cpp)';
  if (!fs.existsSync(MODEL)) return `no model: ${MODEL}`;
  return null;
}

/**
 * Pulls the video file's address off the assignment page.
 *
 * The address is signed and lives for a few hours, so there's no point
 * remembering it — fetched fresh every time it's needed.
 *
 * IMPORTANT about the address: it needs the specific form with
 * attachmentId and summary. Without them Edpuzzle shows the final summary
 * with no player at all — found by hand, poking at the interface, after
 * seven blind guesses at the address.
 */
async function fetchVideoUrl(page, assignmentId, attachmentId) {
  const url = `https://edpuzzle.com/assignments/${assignmentId}/watch`
            + (attachmentId ? `?attachmentId=${attachmentId}&summary=` : '');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  return await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? (v.currentSrc || v.src || null) : null;
  });
}

/**
 * Audio -> text. Returns {text, timed}.
 *
 * whisper produces two forms at once: plain text for reading and a
 * timestamped version. The second is needed to jump the video to a
 * confusing spot instead of hunting for it blind.
 */
function transcribe(videoUrl, outDir, name) {
  fs.mkdirSync(outDir, { recursive: true });
  const wav = path.join(outDir, `${name}.wav`);
  const base = path.join(outDir, name);

  // Download and audio extraction in one command: the video never lands
  // on disk at all, ffmpeg reads it off the network and discards the
  // picture immediately. A forty-megabyte clip turns into a few
  // megabytes of audio.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', videoUrl,
    '-vn',            // no picture
    '-ac', '1',       // one channel
    '-ar', '16000',   // 16 kHz — what whisper expects
    wav,
  ], { timeout: 10 * 60 * 1000 });

  execFileSync('whisper-cli', [
    '-m', MODEL,
    '-f', wav,
    '-otxt', '-ovtt',   // plain text and timestamped markup
    '-of', base,
  ], { timeout: 30 * 60 * 1000 });

  const text = fs.existsSync(base + '.txt')
    ? fs.readFileSync(base + '.txt', 'utf8').trim() : '';
  const timed = fs.existsSync(base + '.vtt')
    ? fs.readFileSync(base + '.vtt', 'utf8').trim() : '';

  // The audio isn't needed anymore, and it takes up real space.
  try { fs.unlinkSync(wav); } catch {}

  return { text, timed };
}

module.exports = { checkReady, fetchVideoUrl, transcribe, MODEL };
