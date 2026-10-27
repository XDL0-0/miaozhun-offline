// The retained trainer is teleported beside #app. Its opaque, full-window
// surface covers the mounted hall; keep hall dialogs and injection state alive.
// The top navigation retains its 64px layout box because hall portal drawers
// use its bottom edge when positioning themselves.
export const trainingHallVisibilityCss = `
/* --aim-offline-training-hall-visibility:1 */
body.al-training-active #app .hall-root > header.hall-topnav{visibility:hidden!important}
body.al-training-active #app .hall-root > div.hall-body,
body.al-training-active #app .hall-root > footer.hall-bottombar{display:none!important}
`;

export function applyTrainingHallVisibilityCss(css) {
  if (css.includes('--aim-offline-training-hall-visibility:1')) throw Error('Training hall visibility CSS already applied');
  return css + trainingHallVisibilityCss;
}
