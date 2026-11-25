# Place Naming Game

The page includes the country list. The game downloads `places/world.json` for worldwide play or a file from `places/countries/` for a specific country.

Preferences and saved setups, recent scores, and the round in progress use separate browser storage records. Reloading opens the saved round in a paused state. Reset Game discards the current attempt, and Clear saved data in Preferences deletes all three records for this game.

Choose Standard for the usual one-typo allowance or Strict for exact spelling, with any capitalization. Relaxed also accepts missing accents and familiar country names like USA, UK, UAE, Czechia, and Türkiye. Exact answers come first, and if a looser match could mean several places, the game asks for the exact spelling or country.

After editing `PlacesData.js`, run these commands from this folder to update the list and dictionaries. Commit the generated changes with the source edit.

```sh
node generate-place-dictionary.mjs
node generate-place-dictionary.mjs --check
```
