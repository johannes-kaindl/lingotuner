# Fixture-Vault für den GUI-Smoke

`scripts/gui-smoke.ts --setup` baut daraus den Staging-Vault
(`$STAGING_VAULTS_DIR/lingotuner`). Der Vault ist Wegwerfware, **dieses Verzeichnis ist
die Quelle** — verloren heißt neu gebaut, nicht rekonstruiert.

- `notes/` → Vault-Wurzel. `Mail-Entwurf.md` ist das Prüfmaterial: ein Text mit
  Frontmatter (belegt, dass `replace-note` den YAML-Kopf stehen lässt) und einer betont
  indirekten, sozial gepolsterten Bitte — genau die Sorte Satz, an der sich die vier
  Regler messen lassen.
- `obsidian/` → die Dateien landen flach in `.obsidian/` des Vaults. Nur LingoTuner
  aktiv, helles Theme, keine fremden Plugins, die das Panel-DOM verändern würden.
- `plugin-data.json` → wird von `setupVault()` **nach** `buildVault` nach
  `.obsidian/plugins/lingotuner/data.json` gelegt. Nicht unter `obsidian/`, weil
  `buildVault` dort nur flache Dateien kopiert und `data.json` absichtlich entfernt
  (der Auslieferungszustand ist der Startzustand). Der Inhalt deckt sich derzeit mit
  `DEFAULT_SETTINGS`; er steht trotzdem geschrieben da, damit der Lauf gegen einen
  **benannten** Endpunkt fährt und nicht gegen einen Default, der sich ändern kann.

## Warum ein eigener Vault und nicht der Arbeitsvault

Im Arbeitsvault läge (a) womöglich der Store-Build statt des Repo-Stands und (b) fremdes
Prüfmaterial. Beides macht einen Lauf unbelegt, und `manifest.version` ist gegen den
ersten Fall strukturell blind: Store- und Repo-Build tragen dieselbe Nummer. Der Treiber
prüft die Herkunft deshalb am sha1 (`requireEigenerBuild`), und zwar an dem Pfad, den die
**laufende** Instanz nennt.
