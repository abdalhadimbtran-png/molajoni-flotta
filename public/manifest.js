// App tecnico e app gestione: due icone separate sulla schermata Home
(function () {
  var tec = location.pathname.indexOf('/t') === 0;
  var l = document.createElement('link'); l.rel = 'manifest';
  l.href = tec ? '/manifest-tecnico.webmanifest' : '/manifest-gestione.webmanifest';
  document.head.appendChild(l);
  var a = tec ? 'tecnico' : 'gestione';
  var i = document.createElement('link'); i.rel = 'icon'; i.type = 'image/png'; i.href = '/icon-' + a + '-32.png'; document.head.appendChild(i);
  var t = document.createElement('link'); t.rel = 'apple-touch-icon'; t.href = '/icon-' + a + '-180.png'; document.head.appendChild(t);
  var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-title'; m.content = tec ? 'Flotta' : 'Gestione flotta';
  document.head.appendChild(m);
})();
