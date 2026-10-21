# Bestell-App

Offline-App fürs Handy, um die Bestellungen bei Lekkerland und Tabacon vorzubereiten.

- **Laufweg:** ein gemeinsamer Weg durch den Laden für alle Lieferanten, unterteilt in Abschnitte (Überschriften).
  Jedes Produkt hat Foto, Soll-Bestand und Häkchen, bei welchen Lieferanten es bestellt wird.
- **Durchgehen:** je Lieferant nur seine Produkte, mit +1/−1, Suche und Sprungknöpfen zu den Abschnitten.
- **Bearbeiten:** Reihenfolge mit ▲/▼ oder über Position bzw. Abschnitt im Produktfenster, Papierkorb zum Löschen.
- **Liste bestätigen:** fragt „Bist du sicher?“, macht daraus eine alphabetische Bestellliste und setzt die Zähler
  dieses Lieferanten auf 0.
- **Bestellliste:** abhaken, was am PC eingegeben ist (wird durchgestrichen), oder per „Teilen“ als Text verschicken.
- Alles wird sofort auf dem Handy gespeichert. Sicherung über das Wolken-Symbol oben rechts; die App erinnert daran,
  wenn die letzte Sicherung älter als 14 Tage ist.

## Technik

Eine Web-App (PWA): `index.html`, `app.js`, `style.css`. `sw.js` hält die Dateien offline vor.
Laufweg und Listen liegen im `localStorage`, Fotos in der IndexedDB des Handys. Es gibt keinen Server und kein Konto,
die Daten verlassen das Handy nur über eine selbst gespeicherte Sicherung.

Version 1 hatte zwei getrennte Listen. Beim ersten Start von Version 2 werden sie automatisch zu einem Laufweg
zusammengeführt; der alte Stand bleibt unter `bestellapp-v1` im `localStorage` erhalten. Alte Sicherungen lassen
sich weiterhin laden.

**Nach jeder Änderung** in `sw.js` die Nummer bei `CACHE` erhöhen, sonst zeigt das Handy weiter die alte Version.

## Testen am PC

```powershell
powershell -ExecutionPolicy Bypass -File tests\server.ps1      # Testserver auf http://localhost:8765/
powershell -ExecutionPolicy Bypass -File tests\run-test.ps1    # automatischer Test in Chrome
powershell -ExecutionPolicy Bypass -File tests\screenshots.ps1 # Screenshots in Handygröße
```
