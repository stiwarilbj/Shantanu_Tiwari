# Place Naming Game

The page includes the country list. The game downloads `places/world.json` for worldwide play or a file from `places/countries/` for a specific country.

After editing `PlacesData.js`, run these commands from this folder to update the list and dictionaries. Commit the generated changes with the source edit.

```sh
node generate-place-dictionary.mjs
node generate-place-dictionary.mjs --check
```
