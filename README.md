# Bestell-App

Offline-App fürs Handy, um die Bestellungen bei Lekkerland und Tabacon vorzubereiten.

- **Laufweg:** ein gemeinsamer Weg durch den Laden für alle Lieferanten, unterteilt in Abschnitte (Überschriften).
  Jedes Produkt hat Foto, Soll-Bestand und Häkchen, bei welchen Lieferanten es bestellt wird.
- **Durchgehen:** je Lieferant nur seine Produkte, mit +1/−1, Suche und Sprungknöpfen zu den Abschnitten.
- **Bearbeiten:** Reihenfolge mit ▲/▼ oder über Position bzw. Abschnitt im Produktfenster, Papierkorb zum Löschen.
- **Bestellliste:** entsteht live aus den Zählern (alles > 0, alphabetisch). Nachträglich gezählte Produkte erscheinen
  sofort. Abhaken, was am PC eingegeben ist (wird durchgestrichen, in „Durchgehen“ steht „✓ eingegeben“); ändert sich
  danach die Menge, verschwindet der Haken und es steht „geändert, vorher …“ dabei. Per „Teilen“ als Text verschicken.
- **Bestellliste löschen** (mit Sicherheitsabfrage) setzt die Zähler dieses Lieferanten auf 0 – erst dann.
- Alles wird sofort auf dem Handy gespeichert. Sicherung über das Wolken-Symbol oben rechts; die App erinnert daran,
  wenn die letzte Sicherung älter als 7 Tage ist.
- **Wiederherstellungspunkte:** einmal pro Woche legt die App beim Öffnen selbst eine Kopie von allem an (die letzten 4),
  zusätzlich vor jedem Zurückholen und vor dem Laden einer Sicherung. Sie liegen auf dem Handy und ersetzen keine Sicherung.
- Design: Kopfbereich in der Lieferantenfarbe (Lekkerland rot, Tabacon blau), Emojis für Abschnitte, Konfetti,
  wenn die Bestellliste fertig abgehakt ist. Schrift: Nunito (SIL Open Font License, siehe `fonts/OFL.txt`).

## Technik

Eine Web-App (PWA): `index.html`, `app.js`, `style.css`. `sw.js` hält die Dateien offline vor.
Laufweg und Listen liegen im `localStorage`, Fotos und Wiederherstellungspunkte in der IndexedDB des Handys. Es gibt keinen Server und kein Konto,
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
