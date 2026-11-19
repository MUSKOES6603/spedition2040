# Spedition 2040 – Anleitung für den Mac

Das Planspiel läuft als kleine Webseite auf deinem MacBook. Alle anderen spielen im Browser mit (Laptop, iPad, Handy), ohne etwas zu installieren. Der Beamer zeigt das Dashboard mit Live-Karte.

## 1. Einmalig: Node.js installieren

1. Auf https://nodejs.org die **LTS-Version** für macOS herunterladen und installieren.
2. Test im Terminal (Programme → Dienstprogramme → Terminal): `node -v` muss eine Versionsnummer zeigen (ab v18).

## 2. Spiel starten

1. Ordner `spedition2040` entpacken, z. B. in „Downloads“.
2. Terminal öffnen und eingeben:
   ```
   cd ~/Downloads/spedition2040
   node server.js
   ```
   Alternativ: Rechtsklick auf `start.command` → „Öffnen“ (beim ersten Mal die Sicherheitsabfrage bestätigen).
3. Fragt macOS, ob „node“ eingehende Verbindungen annehmen darf: **Erlauben** klicken.
4. Im Terminal stehen jetzt zwei Adressen:
   - **Beamer / Spielleitung:** `http://localhost:3000/host?key=…` → im Browser auf dem Beamer öffnen. Den Schlüssel nicht herumzeigen, damit nur ihr die Runden steuert.
   - **Mitspieler:** `http://192.168.x.x:3000` → wird auf dem Beamer groß mit QR-Code angezeigt.

Das Terminal-Fenster während des Spiels offen lassen. Beenden mit `Ctrl + C`.

## 3. Ablauf in der Vorlesung

| Schritt | Beamer-Button | Was passiert |
| --- | --- | --- |
| Beitreten | Warteraum | Alle scannen den QR-Code, geben ihren Namen ein und wählen ihre Spedition (Nord, Ost, West, Süd) |
| Runde 1 | ▶ Runde 1 (12 Min.) | Jedes Team verteilt nur seine 5 Aufträge auf eigene Lkw |
| Runde 2 | ▶ Runde 2 (15 Min.) | Offene Frachtbörse: Alle 20 Aufträge sind sichtbar, jeder Lkw darf jede Palette laden |
| Auswertung | Auswertung | Vergleich Runde 1 vs. 2 mit Karten; „Musterlösung zeigen“ blendet die Referenzwerte ein |
| Runde 3 (optional) | Faire Verteilung (Shapley) | Nach eurer Verhandlung: Tabelle, wie die Ersparnis nach dem Shapley-Wert verteilt würde |

- **Bedienung für Mitspieler:** Auftrag antippen, dann Lkw antippen. Die App berechnet automatisch die kürzeste Route (max. 4 Paletten gleichzeitig, max. 1.600 km, Rückkehr zum Depot).
- **Mehrere Geräte pro Team** sehen und bearbeiten denselben Plan live.
- **Runde 2:** Einen Auftrag, den gerade ein anderes Team fährt, kann man nicht wegnehmen. Das andere Team muss ihn erst freigeben. Das ist Absicht: So müssen die Teams verhandeln.
- **+1 Min.** verlängert den Timer, **Aktuelle Runde leeren** setzt nur die laufende Runde zurück, **Neues Spiel** löscht alles.
- Musterlösung: Runde 1 14.335 km (4.495 leer), Runde 2 8.245 km (0 leer) = −42 %.

## 4. Wenn sich die anderen nicht verbinden können

Im Hochschul-WLAN (eduroam) können sich Geräte oft **nicht gegenseitig erreichen**. Testet das vorher im Hörsaal mit einem zweiten Gerät. Wenn es nicht klappt, gibt es zwei Lösungen:

**A) Öffentlicher Link per Cloudflare-Tunnel (empfohlen, kostenlos, ohne Konto)**

1. Einmalig installieren: `brew install cloudflared` (Homebrew: https://brew.sh) oder die Mac-Datei von https://github.com/cloudflare/cloudflared/releases laden.
2. Während `node server.js` läuft, ein **zweites** Terminal-Fenster öffnen:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
3. Es erscheint eine Adresse wie `https://irgendwas.trycloudflare.com`. Diese auf der Beamer-Seite im Feld „Öffentliche Adresse“ eintragen und „Übernehmen“ klicken. Der QR-Code zeigt dann diese Adresse, und alle können über WLAN oder mobile Daten mitspielen.

**B) Handy-Hotspot**

MacBook und Mitspieler verbinden sich mit dem Hotspot eines Handys. Geht nur bei kleineren Gruppen, weil Hotspots meist nur ca. 10 Geräte erlauben.

## 5. Gut zu wissen

- Läuft komplett lokal, es werden keine Daten im Internet gespeichert (außer beim Tunnel, der den Verkehr nur durchleitet).
- Nach einem Neustart des Servers sind die Ergebnisse weg, die Mitspieler werden aber automatisch wieder angemeldet.
- Anderer Port: `PORT=8080 node server.js`. Fester Schlüssel: `HOST_KEY=team3 node server.js`.
- Getestet in Chrome (Laptop, iPad- und Handy-Größe). Safari sollte genauso laufen; probiert es vorher einmal auf einem iPhone oder iPad aus.

## Windows (z. B. HP EliteBook)

1. **Node.js installieren:** Auf https://nodejs.org die LTS-Version für Windows (.msi) installieren. Ohne Admin-Rechte: dort die „Windows Binary (.zip)“ laden, entpacken und `node.exe` in den Spiel-Ordner kopieren.
2. **Starten:** Ordner entpacken und **Doppelklick auf `start.bat`**. Alternativ: im Ordner in die Adresszeile des Explorers `powershell` tippen, Enter, dann `node server.js`.
3. **Firewall:** Bei der Windows-Abfrage „Node.js JavaScript Runtime“ für **private und öffentliche Netzwerke zulassen**. Sonst kommen die anderen Geräte nicht durch.
4. Das Fenster zeigt den Beamer-Link (`http://localhost:3000/host?key=…`) und die Adresse für Mitspieler. Fehlt die WLAN-Adresse: in PowerShell `ipconfig` eingeben und die „IPv4-Adresse“ des WLAN-Adapters nehmen, also `http://<IPv4-Adresse>:3000`.
5. **Tunnel unter Windows:** `winget install --id Cloudflare.cloudflared` (oder die .exe von https://github.com/cloudflare/cloudflared/releases), dann in einem zweiten Fenster `cloudflared tunnel --url http://localhost:3000`.

Auf einem Firmen- oder Hochschul-Laptop können Installationen oder die Firewall-Freigabe gesperrt sein. Dann den Tunnel nutzen (braucht keine eingehende Freigabe) oder das Spiel auf einem privaten Laptop starten.
