// Before first paint: the look and mode last used in this browser, so the page does not flash.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('cc.look') || '{}');
    var mode = p.mode || 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.look = p.theme || 'command';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
