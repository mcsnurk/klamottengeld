# Klamottengeld-App

Mobile gemeinsame Web-App fuer das Klamottengeld-Budget.

## Funktionen

- 50 EUR pro Quartal fuer Klamotten, Sportsachen und Schuhe
- Guthaben und negativer Saldo werden quartalsuebergreifend weitergetragen
- mehrere Kategorien/Positionen pro Bestellung
- Eigenanteil des Kindes
- Buchungen bearbeiten und loeschen
- mehrere Benutzer ueber einen gemeinsamen Familiencode
- Smartphone-optimiert; als Web-App zum Home-Bildschirm hinzufuegbar

## Status

Die Datei `config.js` ist bereits mit dem vorgesehenen Supabase-Projekt verbunden.
Die Datenbank wurde im Supabase SQL Editor eingerichtet.

## GitHub Pages

1. Neues GitHub-Repository anlegen, z. B. `klamottengeld`.
2. Alle Dateien dieses Ordners in die oberste Ebene des Repositories hochladen.
3. In GitHub: Settings > Pages.
4. Unter Build and deployment: `Deploy from a branch`.
5. Branch `main`, Ordner `/(root)`, dann Save.
6. Die von GitHub angezeigte Seitenadresse oeffnen.

## Supabase Auth nach dem GitHub-Deployment

Sobald die endgueltige GitHub-Pages-Adresse feststeht, diese in Supabase unter Authentication > URL Configuration als Site URL eintragen. Falls E-Mail-Bestaetigung aktiv ist, kann dadurch der Bestaetigungslink korrekt zur App zurueckkehren.

## Sicherheit

`config.js` enthaelt nur den Supabase Publishable Key. Dieser ist fuer Browser-Apps vorgesehen. Niemals einen Secret- oder `service_role`-Key in GitHub oder diese Dateien eintragen.

Der eigentliche Datenzugriff wird in Supabase ueber Login, Tabellenrechte und Row Level Security eingeschraenkt.
