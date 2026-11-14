/**
 * Google Classroom, as the services bridge (61-services.js) sees it.
 *
 *   bridge.settings   the settings
 *
 * So far this answers the check's questions about Classroom (on? needs the
 * browser? where is it?). Reading it is still done by the collector itself,
 * 05-playwright-draft.js, one tab per class; moving that here as read() comes
 * next, in steps.
 */

const SITE = 'https://classroom.google.com/';

// Its own switch (classroomEnabled in 19-settings.js): there's nothing to type in.
const enabled = bridge => bridge.settings.classroomEnabled !== false;

// Classroom is only read by loading its pages, so on means a browser.
const browserNeeded = enabled;
const signInNeeded = enabled;

const addresses = bridge => (enabled(bridge) ? [SITE] : []);

module.exports = { enabled, browserNeeded, signInNeeded, addresses, SITE };
