# Bestell-App

Offline-App fürs Handy, um die Bestellungen bei Lekkerland und Tabacon vorzubereiten.

- **Durchgehen:** alle Produkte in Laufweg-Reihenfolge, mit Foto und +1/−1.
- **Liste bestätigen:** fragt „Bist du sicher?“, macht daraus eine alphabetische Bestellliste und setzt die Zähler auf 0.
- **Bestellliste:** abhaken, was am PC eingegeben ist (wird durchgestrichen).
- Alles wird sofort auf dem Handy gespeichert. Sicherung über das Wolken-Symbol oben rechts.

## Technik

Eine Web-App (PWA): `index.html`, `app.js`, `style.css`. `sw.js` hält die Dateien offline vor.
Produkte und Listen liegen im `localStorage`, Fotos in der IndexedDB des Handys. Es gibt keinen Server und kein Konto,
die Daten verlassen das Handy nur über eine selbst gespeicherte Sicherung.

**Nach jeder Änderung** in `sw.js` die Nummer bei `CACHE` erhöhen, sonst zeigt das Handy weiter die alte Version.

## Testen am PC

```powershell
powershell -ExecutionPolicy Bypass -File tests\server.ps1      # Testserver auf http://localhost:8765/
powershell -ExecutionPolicy Bypass -File tests\run-test.ps1    # automatischer Test in Chrome
powershell -ExecutionPolicy Bypass -File tests\screenshots.ps1 # Screenshots in Handygröße
```
