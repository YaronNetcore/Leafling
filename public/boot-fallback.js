// Last line of defence (no app code needed): if the app's script never starts — failed or outdated asset —
// show a Hebrew message with a refresh that drops cached code (never the user's data) instead of a blank page.
setTimeout(function () {
  if (window.__leaflingMounted) return;
  var r = document.getElementById("root");
  if (!r || r.childElementCount) return;
  r.innerHTML = '<main data-testid="load-fallback" style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;font-family:system-ui,sans-serif;color:#2c3a2e">' +
    '<h1 style="font-size:22px;margin:0">Leafling לא נטענה</h1><p style="margin:0;color:#6b7563">הנתונים שלך שמורים. רענון יטען את הגרסה העדכנית.</p>' +
    '<button id="lf-reload" style="min-height:48px;padding:0 28px;border:0;border-radius:999px;background:#3d6b35;color:#fff;font-size:17px">רענון</button></main>';
  document.getElementById("lf-reload").onclick = function () {
    var done = function () { location.replace("/?reload=" + Date.now()); };
    try {
      Promise.all([
        navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (x) { return x.unregister(); })); }) : null,
        window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("leafling-shell-") === 0; }).map(function (k) { return caches.delete(k); })); }) : null,
      ]).then(done, done);
    } catch (e) { done(); }
  };
}, 15000);
