/**
 * Aequitas Q, as the services bridge (61-services.js) sees it. Its manifest
 * says "runs": "background", so it's read by 62-service-run.js in a process
 * of its own after a check, and by Settings → Services → Aequitas Q → Check now.
 *
 *   bridge.settings   the settings
 *   bridge.force      Check now: don't wait out the hour
 *
 * Signing in, reading and remembering what happened (grades.json, the
 * password in the keychain) are in 40-grades.js.
 */

const grades = () => require('./40-grades.js');

const enabled = bridge => bridge.settings.gradesProvider === 'q';

/** { due, why }: not until an hour after the last try (unless forced), never
 *  without a username, address and saved password, and never again with a
 *  password Q already turned down. */
const due = (bridge, now = new Date()) => grades().due(now.getTime(), { force: !!bridge.force, s: bridge.settings });

/** Signs in and reads the grades, in the shape every service's read() has. */
async function read(bridge) {
  const r = await grades().readAndSave({ s: bridge.settings });
  if (!r.ok) throw new Error(r.why);
  return { grades: r.classes, status: { ok: true, detail: `${r.classes.length} classes` } };
}

module.exports = { enabled, due, read };
