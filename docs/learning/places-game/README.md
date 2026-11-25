# Place Naming Game

The page includes the country list. The game downloads `places/world.json` for worldwide play or a file from `places/countries/` for a specific country.

Preferences and saved setups, recent scores, and the round in progress use separate browser storage records. Reloading opens the saved round in a paused state. Reset Game discards the current attempt, and Clear saved data in Preferences deletes all three records for this game.

After editing `PlacesData.js`, run these commands from this folder to update the list and dictionaries. Commit the generated changes with the source edit.

```sh
node generate-place-dictionary.mjs
node generate-place-dictionary.mjs --check
```
