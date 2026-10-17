// Before the page paints: macOS draws its own window buttons on the left, and the
// words that name Windows have a Mac wording. Runs from the desktop app and from a
// browser looking at the page.
const mac = window.nc?.platform ? window.nc.platform === 'darwin' : /Mac/.test(navigator.platform || '');
if (mac) document.documentElement.classList.add('darwin');
