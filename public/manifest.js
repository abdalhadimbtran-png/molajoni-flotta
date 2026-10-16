// App tecnico e app gestione: due icone separate sulla schermata Home
(function () {
  var tec = location.pathname.indexOf('/t') === 0;
  var l = document.createElement('link'); l.rel = 'manifest';
  l.href = tec ? '/manifest-tecnico.webmanifest' : '/manifest-gestione.webmanifest';
  document.head.appendChild(l);
  var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-title'; m.content = tec ? 'Flotta' : 'Gestione flotta';
  document.head.appendChild(m);
})();
