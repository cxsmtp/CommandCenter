// Before first paint: the look and mode last used in this browser, so the page does not flash.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('cc.look') || '{}');
    var mode = p.mode || 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    var look = p.theme || 'maison';
    document.documentElement.dataset.look = look;
    if (['maison', 'calibre', 'joaillier', 'hypercar'].indexOf(look) >= 0) document.documentElement.dataset.lux = '';
    else delete document.documentElement.dataset.lux;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
