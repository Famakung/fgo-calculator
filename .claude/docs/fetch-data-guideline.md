# Fetch Data Guideline

## Automated Build-Time Sync Pipeline (Recommended)

Data synchronization runs automatically on GitHub Actions CI (four fixed daily cron slots at 09:10/11:10/15:10/19:10 UTC — JP/NA maintenance ends — and on `git push` to `main`). Cached JSON is revalidated with ETag conditional GETs (304 = ~0 bytes when unchanged), and the build is skipped on scheduled runs when the generated data hash is unchanged. Assets are cached ephemerally with `actions/cache@v4` without committing data or images into git history.

- **Speed & Rate Limiting**: Defaults to `0.1s` (100ms) delay between requests (~8 req/s) via `PoliteRateLimiter`, completing cold-start syncs in **~1 minute** without triggering HTTP 429 rate limits on Cloudflare CDN.
- **Multi-Ascension Icons**: Automatically downloads all ascension stages (`000`, `001`, `002`) and registered spiritron dress costumes (`300`, `400`, `500`) for multi-ascension servants.
- **Full-Auto Craft Essences**: Ingests `nice_equip_lang_en.json` directly from Atlas Academy API, auto-detects permanent bond gain CEs, auto-groups commemorative series variants sharing the same effect (e.g. Heroic Portrait, Heroic Spirit Encounter, Heroic Spirit Apex), updates `src/scripts/data/craft_essences.js`, and dynamically fetches bordered face icons (`extraAssets.faces.equip`) without any hardcoded ID map.

- **Zero-Commit Game Data Architecture**: Both WebP card images (`public/servants/`, `public/craft_essences/`) and generated JavaScript datasets (`src/scripts/data/*.js`) are 100% untracked and gitignored. In CI, they are restored via `actions/cache@v4`; in local development, `scripts/ensure_data.js` automatically runs on `npm run dev` or `npm run build` if missing.
- **Automated API Trait Fetching**: Trait display names are fetched dynamically from `export/NA/nice_trait.json` and parsed into readable English labels. Special trait names (e.g. `[Beast Servants]`, `[modern human]`) are extracted directly from bracketed text in NA CE skill descriptions.
- **NA Official In-Game Attributes**: Trait `0200` is preserved as `"Heaven Attribute"` matching the official NA in-game terminology.
- **Dual-Region CE Localization**: Unreleased JP CEs fall back to custom English translations until released on NA, at which point `export/NA/basic_equip.json` automatically upgrades them to official NA names.
- **Bond Point Tables** (`sync_bond_growth()`): reads `bondGrowth` from the already-cached `export/JP/nice_servant_lore_lang_en.json` (no extra request, no `--force`), applies the same `type in ("normal", "heroine")` playable gate as the servant sync, and writes `src/scripts/data/bond_growth.js`. **Atlas ships `bondGrowth` as a running total from Lv.0** — Altria's `[3000, 9125, 15250, …]` means Lv.1→Lv.2 costs `9125 - 3000 = 6125` — so the generator differences the list before writing it: `table[i]` is the cost of Lv.i → Lv.i+1. 471 servants collapse into 76 distinct tables, stored once each behind a `BOND_TABLE_BY_SVT` id→key map (~18 KB instead of ~56 KB in the eagerly-loaded `data-chunk`). Tables and map are written in one file, so `servants.js` is never rewritten by a bond change.

### Run sync locally (Dry run or real update)
```bash
# Check if new servants or CEs are available on Atlas Academy without writing files
npm run data:sync -- --dry-run

# Run full synchronization (servants, CEs, traits, and WebP icons)
npm run data:sync

# Targeted synchronization flags
npm run data:sync -- --skip-servants  # Sync Craft Essences and Traits only
npm run data:sync -- --skip-ces       # Sync Servants only
npm run data:sync -- --skip-traits    # Skip Traits generation

# Validate dataset integrity (traits format, ascending sort order, and image existence)
npm run data:validate
```

---

## Manual Servant Data (Atlas Academy API)

Base URL: `https://api.atlasacademy.io`

### Single servant (by long ID)

```bash
curl -s -X 'GET' \
  'https://api.atlasacademy.io/nice/JP/svt/{long_id}?lore=false&lang=en' \
  -H 'accept: application/json' \
  -o data/servant-data/{long_id}.json
```

- `lore=false` — skip lore text (smaller payload)
- `lang=en` — English names
- Output saved to `data/servant-data/{long_id}.json` (note: `data/` directory is outside the Astro project tree, used only for raw API data)

Example (Jacques de Molay, saber, short 466, long 106600):

```bash
curl -s -X 'GET' \
  'https://api.atlasacademy.io/nice/JP/svt/106600?lore=false&lang=en' \
  -H 'accept: application/json' \
  -o data/servant-data/106600.json
```

### Key fields in response

| Field            | Type   | Notes                        |
| ---------------- | ------ | ---------------------------- |
| `id`             | number | Long ID (e.g. `106600`)      |
| `collectionNo`   | number | Short ID (e.g. `466`)        |
| `name`           | string | English name                 |
| `className`      | string | e.g. `"saber"`               |
| `rarity`         | number | 0–5                          |
| `traits`         | array  | `[{id, name}]` — trait list  |
| `skills`         | array  | Active skills                |
| `noblePhantasms` | array  | NP data                      |
| `ascensionAdd`   | object | Ascension-specific overrides |
| `traitAdd`       | array  | Extra individualities, per form/stage (`{idx, trait, condType, eventId, startedAt, endedAt}`) |
| `costumes`       | object | Spiriton dress data          |

### `traitAdd` — traits kept out of `traits`

`traits` is not the whole in-game individuality list. Atlas stores always-on
additions in `traitAdd`, and a servant missing from `traits` still carries the
trait in game. `extract_servant_traits()` merges the entries that are permanent:

- `condType == "none"` — `questClear` / `svtLimit` additions are conditional
- `eventId == 0` — event-window additions expire with the event
- trait id `> 1000` — only the special traits the calculator tracks. Standard
  ids arrive with a servant's own class form: Mash (`cno 1`) lists one entry per
  form keyed by `idx` = classId (`100` Saber … `117` Foreigner), each adding that
  form's rarity (`0403`/`0405`), which must not merge into her base traits

Merged into the base set and every stage/costume set, since the addition is
permanent rather than stage-scoped. Example: Koyanskaya of Light (`314`) and of
Dark (`334`) carry `2632` in `traits` and `2821` (Beast Servants) only in
`traitAdd`, so before this rule they never matched CE `1949` "From NFF with
Love" — which targets `2821` (`servantFriendshipUp` functval, NA text
`[Beast Servants]`). Kingprotea (`238`) reaches `2821` the same way, replacing
the hand-patch that used to hardcode it. 22 stored servants gained the trait on
the first run after the fix.

### Batch fetch (multiple servants)

```bash
for long_id in 106600 106500 106400; do
  curl -s "https://api.atlasacademy.io/nice/JP/svt/${long_id}?lore=false&lang=en" \
    -o "data/servant-data/${long_id}.json"
  echo "saved ${long_id}.json"
done
```

### API docs

Full schema: `https://api.atlasacademy.io/docs`

---

# Servant ID Reference

| Short ID | Long ID | Name                                        | Class            | Rarity |
| -------- | ------- | ------------------------------------------- | ---------------- | ------ |
| 001      | 800100  | Mash Kyrielight                             | shielder         | 3      |
| 002      | 100100  | Altria Pendragon                            | saber            | 5      |
| 003      | 100200  | Altria Pendragon (Alter)                    | saber            | 4      |
| 004      | 100300  | Altria Pendragon (Lily)                     | saber            | 4      |
| 005      | 100500  | Nero Claudius                               | saber            | 4      |
| 006      | 100800  | Siegfried                                   | saber            | 4      |
| 007      | 101300  | Gaius Julius Caesar                         | saber            | 3      |
| 008      | 101800  | Altera                                      | saber            | 5      |
| 009      | 102200  | Gilles de Rais                              | saber            | 3      |
| 010      | 102600  | Chevalier d'Eon                             | saber            | 4      |
| 011      | 200100  | Emiya                                       | archer           | 4      |
| 012      | 200200  | Gilgamesh                                   | archer           | 5      |
| 013      | 200300  | Robin Hood                                  | archer           | 3      |
| 014      | 200500  | Atalante                                    | archer           | 4      |
| 015      | 201200  | Euryale                                     | archer           | 3      |
| 016      | 201300  | Arash                                       | archer           | 1      |
| 017      | 300100  | Cú Chulainn                                 | lancer           | 3      |
| 018      | 300500  | Elisabeth Báthory                           | lancer           | 4      |
| 019      | 300600  | Musashibou Benkei                           | lancer           | 2      |
| 020      | 300700  | Cú Chulainn (Prototype)                     | lancer           | 3      |
| 021      | 300900  | Leonidas I                                  | lancer           | 2      |
| 022      | 301000  | Romulus                                     | lancer           | 3      |
| 023      | 400100  | Medusa                                      | rider            | 3      |
| 024      | 400600  | Georgios                                    | rider            | 2      |
| 025      | 400800  | Edward Teach                                | rider            | 2      |
| 026      | 401100  | Boudica                                     | rider            | 3      |
| 027      | 401400  | Ushiwakamaru                                | rider            | 3      |
| 028      | 401500  | Alexander                                   | rider            | 3      |
| 029      | 401700  | Marie Antoinette                            | rider            | 4      |
| 030      | 401900  | Martha                                      | rider            | 4      |
| 031      | 500100  | Medea                                       | caster           | 3      |
| 032      | 500200  | Gilles de Rais                              | caster           | 3      |
| 033      | 500500  | Hans Christian Andersen                     | caster           | 2      |
| 034      | 500700  | William Shakespeare                         | caster           | 2      |
| 035      | 501400  | Mephistopheles                              | caster           | 3      |
| 036      | 501500  | Wolfgang Amadeus Mozart                     | caster           | 1      |
| 037      | 501900  | Zhuge Liang (Lord El-Melloi II)             | caster           | 5      |
| 038      | 502100  | Cú Chulainn                                 | caster           | 3      |
| 039      | 600100  | Sasaki Kojirou                              | assassin         | 1      |
| 040      | 600200  | Hassan of the Cursed Arm                    | assassin         | 2      |
| 041      | 601000  | Stheno                                      | assassin         | 4      |
| 042      | 601100  | Jing Ke                                     | assassin         | 3      |
| 043      | 601200  | Charles-Henri Sanson                        | assassin         | 2      |
| 044      | 601300  | Phantom of the Opera                        | assassin         | 2      |
| 045      | 601400  | Mata Hari                                   | assassin         | 1      |
| 046      | 601700  | Carmilla                                    | assassin         | 4      |
| 047      | 700100  | Heracles                                    | berserker        | 4      |
| 048      | 700200  | Lancelot                                    | berserker        | 4      |
| 049      | 700300  | Lu Bu Fengxian                              | berserker        | 3      |
| 050      | 700500  | Spartacus                                   | berserker        | 1      |
| 051      | 700600  | Sakata Kintoki                              | berserker        | 5      |
| 052      | 700700  | Vlad III                                    | berserker        | 5      |
| 053      | 700900  | Asterios                                    | berserker        | 1      |
| 054      | 701000  | Caligula                                    | berserker        | 2      |
| 055      | 701100  | Darius III                                  | berserker        | 3      |
| 056      | 701300  | Kiyohime                                    | berserker        | 3      |
| 057      | 701500  | Eric Bloodaxe                               | berserker        | 2      |
| 058      | 701600  | Tamamo Cat                                  | berserker        | 4      |
| 059      | 900100  | Jeanne d'Arc                                | ruler            | 5      |
| 060      | 200900  | Orion                                       | archer           | 5      |
| 061      | 502600  | Elisabeth Báthory (Halloween)               | caster           | 4      |
| 062      | 500300  | Tamamo-no-Mae                               | caster           | 5      |
| 063      | 200600  | David                                       | archer           | 3      |
| 064      | 301600  | Hektor                                      | lancer           | 3      |
| 065      | 400300  | Francis Drake                               | rider            | 5      |
| 066      | 400900  | Anne Bonny & Mary Read                      | rider            | 4      |
| 067      | 501700  | Medea (Lily)                                | caster           | 4      |
| 068      | 102700  | Okita Souji                                 | saber            | 5      |
| 069      | 202400  | Oda Nobunaga                                | archer           | 4      |
| 070      | 301300  | Scáthach                                    | lancer           | 5      |
| 071      | 300200  | Diarmuid Ua Duibhne                         | lancer           | 3      |
| 072      | 101400  | Fergus mac Róich                            | saber            | 3      |
| 073      | 402200  | Altria Pendragon (Santa Alter)              | rider            | 4      |
| 074      | 500400  | Nursery Rhyme                               | caster           | 4      |
| 075      | 600500  | Jack the Ripper                             | assassin         | 5      |
| 076      | 100900  | Mordred                                     | saber            | 5      |
| 077      | 201100  | Nikola Tesla                                | archer           | 5      |
| 078      | 301900  | Altria Pendragon (Alter)                    | lancer           | 4      |
| 079      | 501000  | Paracelsus von Hohenheim                    | caster           | 3      |
| 080      | 501100  | Charles Babbage                             | caster           | 3      |
| 081      | 600700  | Henry Jekyll & Hyde                         | assassin         | 3      |
| 082      | 700400  | Frankenstein                                | berserker        | 4      |
| 084      | 201500  | Arjuna                                      | archer           | 5      |
| 085      | 300400  | Karna                                       | lancer           | 5      |
| 086      | 601800  | Mysterious Heroine X                        | assassin         | 5      |
| 087      | 301100  | Fionn mac Cumhaill                          | lancer           | 4      |
| 088      | 301200  | Brynhild                                    | lancer           | 5      |
| 089      | 700800  | Beowulf                                     | berserker        | 4      |
| 090      | 100600  | Nero Claudius (Bride)                       | saber            | 5      |
| 091      | 102800  | Ryougi Shiki                                | saber            | 5      |
| 092      | 602300  | Ryougi Shiki                                | assassin         | 4      |
| 093      | 900200  | Amakusa Shirou                              | ruler            | 5      |
| 094      | 400400  | Astolfo                                     | rider            | 4      |
| 095      | 201800  | Gilgamesh (Child)                           | archer           | 3      |
| 096      | 1100200 | Edmond Dantès                               | avenger          | 5      |
| 097      | 701400  | Florence Nightingale                        | berserker        | 5      |
| 098      | 702000  | Cú Chulainn (Alter)                         | berserker        | 5      |
| 099      | 401300  | Queen Medb                                  | rider            | 5      |
| 100      | 502300  | Helena Blavatsky                            | caster           | 4      |
| 101      | 101900  | Rama                                        | saber            | 4      |
| 102      | 301700  | Li Shuwen                                   | lancer           | 4      |
| 103      | 502500  | Thomas Edison                               | caster           | 4      |
| 104      | 501600  | Geronimo                                    | caster           | 3      |
| 105      | 201000  | Billy the Kid                               | archer           | 3      |
| 106      | 1100300 | Jeanne d'Arc (Alter)                        | avenger          | 5      |
| 107      | 1100100 | Aŋra Mainiiu                                | avenger          | 0      |
| 108      | 400200  | Iskandar                                    | rider            | 5      |
| 109      | 601500  | Emiya (Assassin)                            | assassin         | 4      |
| 110      | 600300  | Hassan of the Hundred Personas              | assassin         | 3      |
| 111      | 502000  | Irisviel (Holy Grail)                       | caster           | 4      |
| 112      | 602100  | Shuten-Douji                                | assassin         | 5      |
| 113      | 502200  | Xuanzang Sanzang                            | caster           | 5      |
| 114      | 702300  | Minamoto-no-Raikou                          | berserker        | 5      |
| 115      | 402300  | Sakata Kintoki                              | rider            | 4      |
| 116      | 702200  | Ibaraki-Douji                               | berserker        | 4      |
| 117      | 601900  | Fuuma "Evil-wind" Kotarou                   | assassin         | 3      |
| 118      | 401200  | Ozymandias                                  | rider            | 5      |
| 119      | 302000  | Altria Pendragon                            | lancer           | 5      |
| 120      | 501200  | Nitocris                                    | caster           | 4      |
| 121      | 102000  | Lancelot                                    | saber            | 4      |
| 122      | 200800  | Tristan                                     | archer           | 4      |
| 123      | 100700  | Gawain                                      | saber            | 4      |
| 124      | 600900  | Hassan of the Serenity                      | assassin         | 3      |
| 125      | 201400  | Tawara Touta                                | archer           | 3      |
| 126      | 101200  | Bedivere                                    | saber            | 3      |
| 127      | 500900  | Leonardo da Vinci                           | caster           | 5      |
| 128      | 302400  | Tamamo-no-Mae                               | lancer           | 5      |
| 129      | 202600  | Altria Pendragon                            | archer           | 5      |
| 130      | 502700  | Marie Antoinette                            | caster           | 4      |
| 131      | 202500  | Anne Bonny & Mary Read                      | archer           | 4      |
| 132      | 402400  | Mordred                                     | rider            | 4      |
| 133      | 602400  | Scáthach                                    | assassin         | 4      |
| 134      | 302500  | Kiyohime                                    | lancer           | 4      |
| 135      | 900400  | Martha                                      | ruler            | 4      |
| 136      | 502800  | Illyasviel von Einzbern                     | caster           | 5      |
| 137      | 202700  | Chloe von Einzbern                          | archer           | 4      |
| 138      | 101000  | Elisabeth Báthory (Brave)                   | saber            | 4      |
| 139      | 600800  | Cleopatra                                   | assassin         | 5      |
| 140      | 300300  | Vlad III (EXTRA)                            | lancer           | 4      |
| 141      | 302600  | Jeanne d'Arc Alter Santa Lily               | lancer           | 4      |
| 142      | 202000  | Ishtar                                      | archer           | 5      |
| 143      | 300800  | Enkidu                                      | lancer           | 5      |
| 144      | 401800  | Quetzalcoatl                                | rider            | 5      |
| 145      | 501800  | Gilgamesh                                   | caster           | 4      |
| 146      | 302700  | Medusa                                      | lancer           | 4      |
| 147      | 1100400 | Gorgon                                      | avenger          | 4      |
| 148      | 302800  | Jaguar Warrior                              | lancer           | 3      |
| 150      | 500800  | Merlin                                      | caster           | 5      |
| 153      | 101700  | Miyamoto Musashi                            | saber            | 5      |
| 154      | 602500  | "First Hassan"                              | assassin         | 5      |
| 155      | 702400  | Mysterious Heroine X (Alter)                | berserker        | 5      |
| 156      | 202300  | James Moriarty                              | archer           | 5      |
| 157      | 201600  | Emiya (Alter)                               | archer           | 4      |
| 158      | 1100500 | Hessian Lobo                                | avenger          | 4      |
| 159      | 602600  | Yan Qing                                    | assassin         | 4      |
| 160      | 102900  | Arthur Pendragon (Prototype)                | saber            | 5      |
| 161      | 702500  | Hijikata Toshizo                            | berserker        | 5      |
| 162      | 702600  | Chacha                                      | berserker        | 4      |
| 163      | 1000200 | Meltryllis                                  | alterEgo         | 5      |
| 164      | 1000100 | Passionlip                                  | alterEgo         | 4      |
| 165      | 103000  | Suzuka Gozen                                | saber            | 4      |
| 166      | 2300100 | BB                                          | moonCancer       | 4      |
| 167      | 1000300 | Sessyoin Kiara                              | alterEgo         | 5      |
| 169      | 503000  | Scheherazade                                | caster           | 5      |
| 170      | 602700  | Wu Zetian                                   | assassin         | 4      |
| 171      | 702700  | Penthesilea                                 | berserker        | 4      |
| 172      | 402500  | Christopher Columbus                        | rider            | 3      |
| 173      | 900500  | Sherlock Holmes                             | ruler            | 5      |
| 174      | 702800  | Paul Bunyan                                 | berserker        | 1      |
| 175      | 503200  | Nero Claudius                               | caster           | 5      |
| 176      | 103100  | Frankenstein                                | saber            | 4      |
| 177      | 602800  | Nitocris                                    | assassin         | 4      |
| 178      | 702900  | Oda Nobunaga                                | berserker        | 4      |
| 179      | 402700  | Altria Pendragon (Alter)                    | rider            | 5      |
| 180      | 202800  | Helena Blavatsky                            | archer           | 4      |
| 181      | 302900  | Minamoto-no-Raikou                          | lancer           | 4      |
| 182      | 402600  | Ishtar                                      | rider            | 4      |
| 183      | 303000  | Pārvatī                                     | lancer           | 4      |
| 184      | 202100  | Tomoe Gozen                                 | archer           | 4      |
| 185      | 602900  | Mochizuki Chiyome                           | assassin         | 4      |
| 186      | 301400  | Houzouin Inshun                             | lancer           | 3      |
| 187      | 103200  | Yagyu Tajima-no-kami Munenori               | saber            | 4      |
| 188      | 603000  | Katou "Black Kite" Danzo                    | assassin         | 4      |
| 189      | 603100  | Osakabehime                                 | assassin         | 5      |
| 190      | 1000400 | Mecha Eli-chan                              | alterEgo         | 4      |
| 191      | 1000500 | Mecha Eli-chan Mk.II                        | alterEgo         | 4      |
| 192      | 503300  | Circe                                       | caster           | 4      |
| 193      | 303100  | Nezha                                       | lancer           | 4      |
| 194      | 503400  | Queen of Sheba                              | caster           | 4      |
| 195      | 2500100 | Abigail Williams                            | foreigner        | 5      |
| 196      | 303200  | Ereshkigal                                  | lancer           | 5      |
| 197      | 202200  | Attila the San(ta)                          | archer           | 4      |
| 198      | 2500200 | Katsushika Hokusai                          | foreigner        | 5      |
| 199      | 603200  | Semiramis                                   | assassin         | 5      |
| 200      | 202900  | Asagami Fujino                              | archer           | 4      |
| 201      | 503500  | Anastasia                                   | caster           | 5      |
| 202      | 703000  | Atalante (Alter)                            | berserker        | 4      |
| 203      | 503600  | Avicebron                                   | caster           | 3      |
| 204      | 1100600 | Antonio Salieri                             | avenger          | 3      |
| 205      | 402800  | Ivan the Terrible                           | rider            | 5      |
| 206      | 402900  | Achilles                                    | rider            | 5      |
| 207      | 203000  | Chiron                                      | archer           | 4      |
| 208      | 503800  | Sieg                                        | caster           | 4      |
| 209      | 1000700 | Okita Souji (Alter)                         | alterEgo         | 5      |
| 210      | 603300  | Okada Izo                                   | assassin         | 3      |
| 211      | 403000  | Sakamoto Ryouma                             | rider            | 4      |
| 212      | 203100  | Napoleon                                    | archer           | 5      |
| 213      | 103300  | Sigurd                                      | saber            | 5      |
| 214      | 303300  | Valkyrie                                    | lancer           | 4      |
| 215      | 503900  | Scáthach-Skadi                              | caster           | 5      |
| 216      | 203200  | Jeanne d'Arc                                | archer           | 5      |
| 217      | 303400  | Ibaraki-Douji                               | lancer           | 4      |
| 218      | 603400  | Ushiwakamaru                                | assassin         | 4      |
| 219      | 703100  | Jeanne d'Arc (Alter)                        | berserker        | 4      |
| 220      | 2300200 | BB                                          | moonCancer       | 5      |
| 221      | 103400  | Queen Medb                                  | saber            | 4      |
| 222      | 2500300 | Mysterious Heroine XX                       | foreigner        | 4      |
| 223      | 103500  | Diarmuid Ua Duibhne                         | saber            | 4      |
| 224      | 1000800 | Sitonai                                     | alterEgo         | 5      |
| 225      | 504000  | Shuten-Douji                                | caster           | 4      |
| 226      | 703200  | Xiang Yu                                    | berserker        | 5      |
| 227      | 103600  | Prince of Lan Ling                          | saber            | 4      |
| 228      | 303500  | Qin Liangyu                                 | lancer           | 4      |
| 229      | 900600  | Qin Shi Huang                               | ruler            | 5      |
| 230      | 603500  | Yu Mei-ren                                  | assassin         | 4      |
| 231      | 403100  | Red Hare                                    | rider            | 3      |
| 232      | 303600  | Bradamante                                  | lancer           | 5      |
| 233      | 900700  | Quetzalcoatl (Samba/Santa)                  | ruler            | 4      |
| 234      | 103700  | Beni-Enma                                   | saber            | 5      |
| 235      | 603600  | Li Shuwen                                   | assassin         | 5      |
| 236      | 504100  | Miyu Edelfelt                               | caster           | 4      |
| 237      | 504200  | Murasaki Shikibu                            | caster           | 5      |
| 238      | 1000900 | Kingprotea                                  | alterEgo         | 5      |
| 239      | 603700  | Kama                                        | assassin         | 5      |
| 241      | 403200  | Sima Yi (Reines)                            | rider            | 5      |
| 242      | 900800  | Astraea                                     | ruler            | 4      |
| 243      | 603900  | Gray                                        | assassin         | 4      |
| 244      | 2300300 | Great Stone Statue God                      | moonCancer       | 5      |
| 245      | 103900  | Lakshmi Bai                                 | saber            | 4      |
| 246      | 203400  | William Tell                                | archer           | 3      |
| 247      | 703300  | Arjuna (Alter)                              | berserker        | 5      |
| 248      | 203300  | Aśvatthāman                                 | archer           | 4      |
| 249      | 504300  | Asclepius                                   | caster           | 3      |
| 250      | 1100700 | Oda Nobunaga                                | avenger          | 5      |
| 251      | 703500  | Mori Nagayoshi                              | berserker        | 3      |
| 252      | 303800  | Nagao Kagetora                              | lancer           | 4      |
| 253      | 403500  | Leonardo da Vinci                           | rider            | 5      |
| 254      | 103800  | Jason                                       | saber            | 1      |
| 255      | 203500  | Paris                                       | archer           | 2      |
| 256      | 303900  | Gareth                                      | lancer           | 2      |
| 257      | 403400  | Bartholomew Roberts                         | rider            | 1      |
| 258      | 504400  | Chen Gong                                   | caster           | 2      |
| 259      | 603800  | Charlotte Corday                            | assassin         | 1      |
| 260      | 703400  | Salome                                      | berserker        | 2      |
| 261      | 703600  | Miyamoto Musashi                            | berserker        | 5      |
| 262      | 203600  | Osakabehime                                 | archer           | 4      |
| 263      | 403600  | Carmilla                                    | rider            | 4      |
| 264      | 104000  | Katsushika Hokusai                          | saber            | 4      |
| 265      | 900900  | Altria Pendragon                            | ruler            | 5      |
| 266      | 304000  | Mysterious Alter Ego Λ                      | lancer           | 4      |
| 267      | 604000  | Okita J. Souji                              | assassin         | 4      |
| 268      | 1100900 | Space Ishtar                                | avenger          | 5      |
| 269      | 203700  | Calamity Jane                               | archer           | 4      |
| 270      | 104100  | Astolfo                                     | saber            | 5      |
| 271      | 203900  | Florence Nightingale (Santa)                | archer           | 4      |
| 272      | 203800  | Super Orion                                 | archer           | 5      |
| 273      | 403900  | Mandricardo                                 | rider            | 3      |
| 274      | 404000  | Europa                                      | rider            | 5      |
| 275      | 2500400 | Yang Guifei                                 | foreigner        | 5      |
| 276      | 204000  | Sei Shounagon                               | archer           | 5      |
| 277      | 403800  | Odysseus                                    | rider            | 5      |
| 278      | 104200  | Dioscuri                                    | saber            | 5      |
| 279      | 304100  | Caenis                                      | lancer           | 4      |
| 280      | 304200  | Romulus=Quirinus                            | lancer           | 5      |
| 281      | 2500500 | Voyager                                     | foreigner        | 5      |
| 282      | 703700  | Kijyo Koyo                                  | berserker        | 4      |
| 283      | 304300  | Utsumi Erice                                | lancer           | 4      |
| 284      | 504500  | Altria Caster                               | caster           | 5      |
| 285      | 2300400 | Sessyoin Kiara                              | moonCancer       | 5      |
| 286      | 204200  | Illyasviel von Einzbern                     | archer           | 4      |
| 287      | 703800  | Brynhild                                    | berserker        | 4      |
| 288      | 304400  | Yu Mei-ren                                  | lancer           | 4      |
| 289      | 2500700 | Abigail Williams (Summer)                   | foreigner        | 5      |
| 290      | 104500  | Tomoe Gozen                                 | saber            | 4      |
| 291      | 404100  | Murasaki Shikibu                            | rider            | 4      |
| 292      | 901000  | Himiko                                      | ruler            | 5      |
| 293      | 104400  | Saito Hajime                                | saber            | 4      |
| 294      | 204100  | Oda Nobukatsu                               | archer           | 1      |
| 295      | 2500600 | Van Gogh                                    | foreigner        | 5      |
| 296      | 403700  | Nemo                                        | rider            | 5      |
| 297      | 1001000 | Ashiya Douman                               | alterEgo         | 5      |
| 298      | 104700  | Watanabe-no-Tsuna                           | saber            | 4      |
| 299      | 104600  | Ibuki-Douji                                 | saber            | 5      |
| 300      | 304600  | Vritra                                      | lancer           | 5      |
| 301      | 104800  | Karna (Santa)                               | saber            | 4      |
| 302      | 104900  | Senji Muramasa                              | saber            | 5      |
| 303      | 1101000 | Taira-no-Kagekiyo                           | avenger          | 5      |
| 304      | 604100  | Kiichi Hogen                                | assassin         | 4      |
| 305      | 901100  | Amor (Caren)                                | ruler            | 5      |
| 306      | 703900  | Galatea                                     | berserker        | 5      |
| 307      | 504600  | Miss Crane                                  | caster           | 5      |
| 308      | 2500800 | Mysterious Idol X (Alter)                   | foreigner        | 4      |
| 309      | 704000  | Morgan                                      | berserker        | 5      |
| 310      | 105000  | Tam Lin Gawain                              | saber            | 4      |
| 311      | 204300  | Tam Lin Tristan                             | archer           | 4      |
| 312      | 304800  | Tam Lin Lancelot                            | lancer           | 5      |
| 313      | 304700  | Percival                                    | lancer           | 4      |
| 314      | 604200  | Koyanskaya of Light                         | assassin         | 5      |
| 315      | 404200  | Habetrot                                    | rider            | 4      |
| 316      | 2800100 | Oberon                                      | pretender        | 5      |
| 317      | 105100  | Okita Souji (Alter)                         | saber            | 5      |
| 318      | 204400  | Anastasia & Viy                             | archer           | 4      |
| 319      | 504800  | Charlotte Corday                            | caster           | 4      |
| 320      | 901200  | Leonardo da Vinci                           | ruler            | 4      |
| 321      | 1101100 | Kama                                        | avenger          | 5      |
| 322      | 404500  | Caenis                                      | rider            | 4      |
| 323      | 704100  | Sei Shounagon                               | berserker        | 4      |
| 324      | 2501000 | Jacques de Molay                            | foreigner        | 5      |
| 325      | 204500  | Zenobia                                     | archer           | 4      |
| 326      | 404600  | Elisabeth Báthory (Cinderella)              | rider            | 4      |
| 327      | 504900  | Izumo-no-Okuni                              | caster           | 5      |
| 328      | 1101200 | Mysterious Ranmaru X                        | avenger          | 4      |
| 329      | 305000  | Sakamoto Ryouma                             | lancer           | 5      |
| 330      | 505000  | Martha (Santa)                              | caster           | 4      |
| 331      | 404300  | Taigong Wang                                | rider            | 5      |
| 332      | 404400  | Dobrynya Nikitich                           | rider            | 4      |
| 334      | 2500900 | Koyanskaya of Dark                          | foreigner        | 5      |
| 335      | 2800200 | Hephaistíon                                 | pretender        | 4      |
| 336      | 1001100 | Manannán mac Lir (Bazett)                   | alterEgo         | 5      |
| 337      | 105300  | Hai Bà Trưng                                | saber            | 5      |
| 338      | 1001200 | Taisui Xingjun                              | alterEgo         | 4      |
| 339      | 1001300 | Super Bunyan                                | alterEgo         | 5      |
| 340      | 504700  | Daikokuten                                  | caster           | 4      |
| 341      | 304900  | Mary Anning                                 | lancer           | 1      |
| 342      | 404700  | Kōnstantînos XI                             | rider            | 5      |
| 343      | 105200  | Charlemagne                                 | saber            | 5      |
| 344      | 104300  | Roland                                      | saber            | 4      |
| 345      | 704200  | Kriemhild                                   | berserker        | 4      |
| 346      | 901300  | James Moriarty                              | ruler            | 5      |
| 347      | 305100  | Don Quixote                                 | lancer           | 4      |
| 348      | 505100  | Zhang Jue                                   | caster           | 3      |
| 349      | 404800  | Kyokutei Bakin                              | rider            | 5      |
| 350      | 204600  | Minamoto-no-Tametomo                        | archer           | 5      |
| 351      | 2300500 | Archetype: Earth                            | moonCancer       | 5      |
| 352      | 1001400 | Xu Fu                                       | alterEgo         | 3      |
| 353      | 2800300 | Lady Avalon                                 | pretender        | 5      |
| 354      | 105400  | Gareth                                      | saber            | 4      |
| 355      | 704300  | Ibuki-Douji                                 | berserker        | 5      |
| 356      | 1101400 | Utsumi Erice                                | avenger          | 4      |
| 357      | 901400  | Scáthach-Skadi                              | ruler            | 5      |
| 358      | 505200  | Wu Zetian                                   | caster           | 4      |
| 359      | 604500  | Thrúd                                       | assassin         | 4      |
| 360      | 604400  | Hildr                                       | assassin         | 4      |
| 361      | 604300  | Ortlinde                                    | assassin         | 4      |
| 362      | 704400  | Sen-no-Rikyu                                | berserker        | 5      |
| 363      | 105500  | Yamanami Keisuke                            | saber            | 4      |
| 364      | 901500  | Iyo                                         | ruler            | 4      |
| 365      | 604600  | Huyan Zhuo                                  | assassin         | 5      |
| 366      | 404900  | Huang Feihu                                 | rider            | 4      |
| 367      | 2800400 | Nine-Tattoo Dragon Elisa                    | pretender        | 4      |
| 368      | 305300  | Britomart                                   | lancer           | 5      |
| 369      | 1001500 | Grigori Rasputin                            | alterEgo         | 5      |
| 370      | 1101500 | Nitocris (Alter)                            | avenger          | 5      |
| 371      | 604700  | Tezcatlipoca                                | assassin         | 5      |
| 372      | 2800500 | Tlaloc                                      | pretender        | 4      |
| 373      | 2501100 | Kukulcan                                    | foreigner        | 5      |
| 374      | 901600  | Pope Johanna                                | ruler            | 5      |
| 375      | 204700  | Takasugi Shinsaku                           | archer           | 5      |
| 376      | 1001600 | Larva/Tiamat                                | alterEgo         | 5      |
| 377      | 3300100 | Sodom's Beast/Draco                         | beast            | 5      |
| 378      | 604800  | Locusta                                     | assassin         | 4      |
| 379      | 105700  | Setanta                                     | saber            | 4      |
| 380      | 604900  | Kashin Koji                                 | assassin         | 5      |
| 381      | 305400  | Bhima                                       | lancer           | 5      |
| 382      | 704600  | Duryodhana                                  | berserker        | 4      |
| 383      | 204800  | Durga                                       | archer           | 5      |
| 384      | 105600  | Medusa                                      | saber            | 5      |
| 385      | 505300  | Aesc the Rain Witch                         | caster           | 5      |
| 386      | 704700  | Altria Caster                               | berserker        | 5      |
| 387      | 405000  | Suzuka Gozen (Summer Vacation)              | rider            | 4      |
| 388      | 1101600 | Chloe von Einzbern                          | avenger          | 4      |
| 389      | 2501200 | Cnoc na Riabh Yaraan-doo                    | foreigner        | 4      |
| 390      | 901700  | Mélusine                                    | ruler            | 5      |
| 391      | 204900  | UDK-Barghest                                | archer           | 4      |
| 392      | 2800600 | Cait Cú Cerpriestess                        | pretender        | 4      |
| 393      | 2501300 | Wandjina                                    | foreigner        | 5      |
| 394      | 205000  | Ptolemaîos                                  | archer           | 5      |
| 395      | 205100  | Sugitani Zenjubou                           | archer           | 3      |
| 396      | 105800  | Theseus                                     | saber            | 3      |
| 397      | 405200  | Takeda Harunobu                             | rider            | 5      |
| 398      | 704800  | Nagakura Shinpachi                          | berserker        | 4      |
| 399      | 205200  | Saika Magoichi                              | archer           | 4      |
| 400      | 901800  | Uesugi Kenshin                              | ruler            | 5      |
| 401      | 405300  | Nemo (Santa)                                | rider            | 4      |
| 402      | 105900  | Yamato Takeru                               | saber            | 5      |
| 403      | 1101800 | Minamoto-no-Raikou/Ushi Gozen               | avenger          | 5      |
| 404      | 505400  | Yui Shousetsu                               | caster           | 4      |
| 405      | 106000  | Miyamoto Iori                               | saber            | 4      |
| 406      | 405500  | Andromeda                                   | rider            | 5      |
| 407      | 1101300 | Marie Antoinette (Alter)                    | avenger          | 5      |
| 408      | 605000  | Hassan of the Shining Star                  | assassin         | 4      |
| 409      | 1101700 | The Count of Monte Cristo                   | avenger          | 5      |
| 410      | 2800700 | Alessandro di Cagliostro                    | pretender        | 4      |
| 413      | 2501400 | Aozaki Aoko                                 | foreigner        | 5      |
| 414      | 704900  | Shizuki Soujuurou                           | berserker        | 4      |
| 415      | 505500  | Kuonji Alice                                | caster           | 5      |
| 416      | 1001700 | Hibiki & Chikagi                            | alterEgo         | 5      |
| 417      | 3300200 | Ereshkigal                                  | beastEresh       | 5      |
| 418      | 2300900 | Mysterious Executor C.I.E.L                 | moonCancer       | 5      |
| 419      | 305500  | Dobrynya Nikitich                           | lancer           | 4      |
| 420      | 1101900 | Xu Fu                                       | avenger          | 4      |
| 421      | 2300600 | BB Dubai                                    | moonCancer       | 5      |
| 422      | 2301000 | Tenochtitlan                                | moonCancer       | 4      |
| 423      | 2501600 | Mysterious Heroine XX (Alter)               | foreigner        | 4      |
| 424      | 2300700 | Kishinami Hakuno                            | moonCancer       | 4      |
| 425      | 2300800 | Kishinami Hakuno                            | moonCancer       | 4      |
| 426      | 1001800 | Kazuradrop                                  | alterEgo         | 5      |
| 427      | 205300  | Tutankhamun                                 | archer           | 5      |
| 428      | 305600  | Van Gogh (Miner)                            | lancer           | 4      |
| 429      | 705000  | Louhi                                       | berserker        | 5      |
| 430      | 2800800 | Abigail Williams (Santa)                    | pretender        | 4      |
| 431      | 2800900 | Phantasmoon                                 | pretender        | 5      |
| 432      | 106100  | Richard I                                   | saber            | 5      |
| 433      | 305700  | Biscione                                    | lancer           | 5      |
| 434      | 106200  | Kurohime                                    | saber            | 4      |
| 435      | 505800  | Ono no Komachi                              | caster           | 5      |
| 437      | 2801000 | Dante Alighieri                             | pretender        | 5      |
| 438      | 901900  | Metatron Jeanne                             | ruler            | 5      |
| 439      | 305800  | King Ashoka                                 | lancer           | 4      |
| 440      | 705100  | Lilith                                      | berserker        | 5      |
| 441      | 2801100 | Typhon Ephemeros                            | pretender        | 5      |
| 442      | 305900  | Indra                                       | lancer           | 5      |
| 444      | 4000100 | U-Olga Marie                                | unBeastOlgaMarie | 5      |
| 445      | 106300  | Passionlip                                  | saber            | 5      |
| 446      | 405800  | Kriemhild                                   | rider            | 4      |
| 447      | 705200  | Huyan Zhuo                                  | berserker        | 4      |
| 448      | 2301100 | Jade Rabbit                                 | moonCancer       | 5      |
| 449      | 306000  | Miyu Edelfelt                               | lancer           | 4      |
| 450      | 205400  | Larva/Tiamat                                | archer           | 5      |
| 451      | 1001900 | Jeunesse Crane                              | alterEgo         | 4      |
| 452      | 405700  | Nemo/Noah                                   | rider            | 5      |
| 453      | 605100  | Kawakami Gensai                             | assassin         | 5      |
| 454      | 1102100 | Tōdō Heisuke                                | avenger          | 4      |
| 455      | 306100  | Harada Sanosuke                             | lancer           | 4      |
| 456      | 106400  | Kondo Isami                                 | saber            | 5      |
| 457      | 306200  | Elisabeth Báthory                           | lancer           | 5      |
| 458      | 1102200 | Elisabeth of the End                        | avenger          | 4      |
| 459      | 2801200 | Solomon                                     | pretender        | 5      |
| 461      | 106500  | Lord Logres                                 | saber            | 5      |
| 462      | 505900  | The Old Man Who Made the Dead Trees Blossom | caster           | 5      |
| 463      | 605200  | Snake Wife                                  | assassin         | 4      |
| 464      | 1002000 | Flora                                       | alterEgo         | 4      |
| 465      | 306400  | Demeter                                     | lancer           | 5      |
| 466      | 106600  | Jacques de Molay                            | saber            | 5      |
| 470      | 205500  | Urðr                                        | archer           | 5      |
| 471      | 1002200 | Ascalaphus                                  | alterEgo         | 5      |
| 472      | 106700  | Gray Lily                                   | saber            | 4      |
| 473      | 306300  | Gray Lily                                   | lancer           | 4      |
| 474      | 605300  | Hassan-i Sabbah (Azrael)                    | assassin         | 5      |
| 482      | 705400  | Daedalus                                    | berserker        | 5      |

## Image Download

All images live in `public/` (Astro serves them as-is). Paths below are relative to project root.

Servant images: `public/servants/`
CE images: `public/craft_essences/`
Class/bond/material icons: `public/icons/`

Long ID format: strip trailing `00` to get `{base}`, then append ascension code.
Example: `388` → long_id `1101600` → base `11016` → `11016{000,001,002,300}`

Source format: `https://static.atlasacademy.io/JP/Faces/f_{base}{asc}_bordered.png` (dimensions 142×155 PNG with in-game rarity card frame)

Default (1st ascension only):

```bash
curl -sL "https://static.atlasacademy.io/JP/Faces/f_{base}000_bordered.png" -o "servants/{short_id}.png"
python -c "from PIL import Image; import os; Image.open('servants/{short_id}.png').save('servants/{short_id}.webp', 'WEBP', lossless=True, method=6); os.remove('servants/{short_id}.png')"
```

Multi-ascension (000, 001, 002):

```bash
mkdir -p servants/{short_id}
for asc in 000 001 002; do curl -sL "https://static.atlasacademy.io/JP/Faces/f_{base}${asc}_bordered.png" -o "servants/{short_id}/${asc}.png"; done
python -c "
from PIL import Image; import os
for f in ['000.png','001.png','002.png']:
    Image.open(f'servants/{short_id}/{f}').save(f'servants/{short_id}/{f.replace(\".png\",\".webp\")}', 'WEBP', lossless=True, method=6)
    os.remove(f'servants/{short_id}/{f}')
"
```

With spiriton dress (append dress code after base):

```bash
curl -sL "https://static.atlasacademy.io/JP/Faces/f_{base}300_bordered.png" -o "servants/{short_id}/300.png"
python -c "from PIL import Image; import os; Image.open('servants/{short_id}/300.png').save('servants/{short_id}/300.webp', 'WEBP', lossless=True, method=6); os.remove('servants/{short_id}/300.png')"
```

Delete flat file when converting to multi-ascension:

```bash
rm servants/{short_id}.webp
```

Ascension code mapping: `000` = 1st, `001` = 2nd, `002` = 3rd, `300` = spiriton dress

## Bond Icon

Display at 16×16px and 24×24px in CSS. Source image from Atlas Academy skill icon.

| File                   | URL                                                            | Display Sizes                                                                                                  |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `icons/bond_icon.webp` | `https://static.atlasacademy.io/JP/SkillIcons/skill_00205.png` | 24×24 (`.bond-result-ce-maxbond-icon`, `.servant-slot-frontline-badge img`, `.servant-slot-frontline-img img`) |

Download + convert:

```bash
curl -sL "https://static.atlasacademy.io/JP/SkillIcons/skill_00205.png" -o icons/bond_icon.png
python -c "from PIL import Image; import os; Image.open('icons/bond_icon.png').save('icons/bond_icon.webp', 'WEBP', quality=80); os.remove('icons/bond_icon.png')"
```

## Stargazer's Teapot Icon

The Bond tab's ×2 item. Displayed at 48px tall (`--ce-badge-h`) everywhere: `.bond-teapot-img` in the setup row, `.bond-result-ce-img` in the results card, and `.bond-teapot-remove img` in the "Out of Stargazer's Teapot" chip. Atlas publishes it as a bordered 142×155 item image, the same card shape as a Craft Essence.

| File                   | URL                                                           | Display sizes                                                                                     |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `icons/teapot.webp`    | `https://static.atlasacademy.io/JP/Items/94065901_bordered.png` | 48px (`--ce-badge-h`) at all three sites |

Download + convert (never leave the remote URL in the shipped page — the site carries zero external resources):

```bash
curl -sL "https://static.atlasacademy.io/JP/Items/94065901_bordered.png" -o icons/teapot.png
python -c "from PIL import Image; import os; Image.open('icons/teapot.png').save('icons/teapot.webp', 'WEBP', quality=90, method=6); os.remove('icons/teapot.png')"
```

### Golden Fruit

The Bond tab's AP equivalent item. Displayed at 48px tall (`--ce-badge-h`): `.bond-max-ap-img` in the setup row and `.bond-ap-fruit-img` in the Total AP result chip.

| File                      | URL                                                        | Display sizes         |
| ------------------------- | ---------------------------------------------------------- | --------------------- |
| `icons/100_bordered.webp` | `https://static.atlasacademy.io/JP/Items/100_bordered.png` | 48px (`--ce-badge-h`) |

Download + convert:

```bash
curl -sL "https://static.atlasacademy.io/JP/Items/100_bordered.png" -o icons/100_bordered.png
python -c "from PIL import Image; import os; Image.open('icons/100_bordered.png').save('icons/100_bordered.webp', 'WEBP', quality=90, method=6); os.remove('icons/100_bordered.png')"
```

## Class Icons

Display at 32x32px in CSS. Source images resized to 64x64 (2x Retina), encoded WebP quality 80.

| Class      | File                            | URL                                                          |
| ---------- | ------------------------------- | ------------------------------------------------------------ |
| saber      | `icons/classes/saber.webp`      | `https://static.atlasacademy.io/JP/ClassIcons/class3_1.png`  |
| archer     | `icons/classes/archer.webp`     | `https://static.atlasacademy.io/JP/ClassIcons/class3_2.png`  |
| lancer     | `icons/classes/lancer.webp`     | `https://static.atlasacademy.io/JP/ClassIcons/class3_3.png`  |
| rider      | `icons/classes/rider.webp`      | `https://static.atlasacademy.io/JP/ClassIcons/class3_4.png`  |
| caster     | `icons/classes/caster.webp`     | `https://static.atlasacademy.io/JP/ClassIcons/class3_5.png`  |
| assassin   | `icons/classes/assassin.webp`   | `https://static.atlasacademy.io/JP/ClassIcons/class3_6.png`  |
| berserker  | `icons/classes/berserker.webp`  | `https://static.atlasacademy.io/JP/ClassIcons/class3_7.png`  |
| shielder   | `icons/classes/shielder.webp`   | `https://static.atlasacademy.io/JP/ClassIcons/class3_8.png`  |
| ruler      | `icons/classes/ruler.webp`      | `https://static.atlasacademy.io/JP/ClassIcons/class3_9.png`  |
| alterego   | `icons/classes/alterego.webp`   | `https://static.atlasacademy.io/JP/ClassIcons/class3_10.png` |
| avenger    | `icons/classes/avenger.webp`    | `https://static.atlasacademy.io/JP/ClassIcons/class3_11.png` |
| mooncancer | `icons/classes/mooncancer.webp` | `https://static.atlasacademy.io/JP/ClassIcons/class3_23.png` |
| foreigner  | `icons/classes/foreigner.webp`  | `https://static.atlasacademy.io/JP/ClassIcons/class3_25.png` |
| pretender  | `icons/classes/pretender.webp`  | `https://static.atlasacademy.io/JP/ClassIcons/class3_28.png` |
| beast      | `icons/classes/beast.webp`      | `https://static.atlasacademy.io/JP/ClassIcons/class3_33.png` |

Single class download + convert:

```bash
curl -sL "https://static.atlasacademy.io/JP/ClassIcons/class3_{N}.png" -o "icons/classes/{name}.png"
python -c "from PIL import Image; import os; img = Image.open('icons/classes/{name}.png').resize((64, 64), Image.LANCZOS); img.save('icons/classes/{name}.webp', 'webp', quality=80, method=6); os.remove('icons/classes/{name}.png')"
```

Batch all classes:

```bash
python -c "
from PIL import Image; import os, urllib.request
classes = {'saber':1,'archer':2,'lancer':3,'rider':4,'caster':5,'assassin':6,'berserker':7,'shielder':8,'ruler':9,'alterego':10,'avenger':11,'mooncancer':23,'foreigner':25,'pretender':28,'beast':33}
for name, n in classes.items():
    url = f'https://static.atlasacademy.io/JP/ClassIcons/class3_{n}.png'
    png = f'icons/classes/{name}.png'
    webp = f'icons/classes/{name}.webp'
    urllib.request.urlretrieve(url, png)
    img = Image.open(png).resize((64, 64), Image.LANCZOS)
    img.save(webp, 'webp', quality=80, method=6)
    os.remove(png)
    print(f'{name}: {os.path.getsize(webp)} bytes')
"
```

## CE Images

URL pattern: `https://static.atlasacademy.io/JP/Faces/f_{long_id}_bordered.png` (fallback: `https://static.atlasacademy.io/JP/Faces/f_{long_id}.png`)

### Folder Structure

```
craft_essences/
  128/{id}.webp       — 142×155 WebP lossless  →  106.5×116.25 display (portraits), 48×52.4 display (badges/chips)
```

| Folder | Size    | Display Size  | Retina | CSS Classes                                                                                                     |
| ------ | ------- | ------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `128/` | 142×155 | 106.5×116.25  | ~1.33x | `.ce-portrait`, `.servant-picker-grid--ce .servant-picker-item img`, `.ceoverlap-ce-filter .servant-picker-item img` |
| `128/` | 142×155 | 48×52.4       | ~3.0x  | `.cefilter-match-badge`, `.bond-result-ce-img` (badges), `.cefilter-chip img` (filter chips)                   |

### Heroic Portrait (0099–0108) — 4★

| CE ID | Name                                 | Long ID  | Rarity |
| ----- | ------------------------------------ | -------- | ------ |
| 0099  | Heroic Portrait: Mash Kyrielight     | 94009700 | 4★     |
| 0100  | Heroic Portrait: Altria Pendragon    | 94009800 | 4★     |
| 0101  | Heroic Portrait: Jeanne d'Arc        | 94009900 | 4★     |
| 0102  | Heroic Portrait: Altera              | 94010000 | 4★     |
| 0103  | Heroic Portrait: Arjuna              | 94010100 | 4★     |
| 0104  | Heroic Portrait: Scathach            | 94010200 | 4★     |
| 0105  | Heroic Portrait: Ushiwakamaru        | 94010300 | 4★     |
| 0106  | Heroic Portrait: Henry Jekyll & Hyde | 94010400 | 4★     |
| 0107  | Heroic Portrait: Mephistopheles      | 94010500 | 4★     |
| 0108  | Heroic Portrait: Darius III          | 94010600 | 4★     |

### Standalone CEs — 5★

| CE ID | Name                      | Long ID  | Rarity |
| ----- | ------------------------- | -------- | ------ |
| 0330  | Chaldea Lunchtime         | 94019700 | 5★     |
| 0910  | Chaldea Teatime           | 94035200 | 5★     |
| 1080  | Great Detective Foumes    | 94039900 | 5★     |
| 1949  | From NFF with Love        | 94074800 | 5★     |
| 2020  | Chaldea Morning           | 94077400 | 5★     |
| 2052  | Report Check              | 94078500 | 5★     |
| 2124  | Wings of Manuscript       | 94080600 | 5★     |
| 2142  | Secret Mission            | 94082200 | 5★     |
| 2209  | Needle of Sincerity       | 94083900 | 5★     |
| 2233  | Blessed Bride             | 94085900 | 5★     |
| 2437  | Foreign God               | 94088000 | 5★     |
| 2509  | Those from Chaldea        | 94089900 | 5★     |
| 2583  | Great Library of Memories | 94092100 | 5★     |
| 2607  | Sword Saints of Wandering | 94093200 | 5★     |
| 2701  | Gun Dealer                | 94094900 | 5★     |

### Heroic Spirit Apex (2512–2532) — 4★

| CE ID | Name                                   | Long ID  | Rarity |
| ----- | -------------------------------------- | -------- | ------ |
| 2512  | Heroic Spirit Apex: Ashiya Douman      | 93113100 | 4★     |
| 2513  | Heroic Spirit Apex: Altria Pendragon   | 93113200 | 4★     |
| 2514  | Heroic Spirit Apex: Yan Qing           | 93113300 | 4★     |
| 2515  | Heroic Spirit Apex: Orion              | 93113400 | 4★     |
| 2516  | Heroic Spirit Apex: Kama               | 93113500 | 4★     |
| 2517  | Heroic Spirit Apex: Gilgamesh          | 93113600 | 4★     |
| 2518  | Heroic Spirit Apex: Sakata Kintoki     | 93113700 | 4★     |
| 2519  | Heroic Spirit Apex: Sigurd             | 93113800 | 4★     |
| 2520  | Heroic Spirit Apex: Jeanne d'Arc       | 93113900 | 4★     |
| 2521  | Heroic Spirit Apex: Scathach-Skadi     | 93114000 | 4★     |
| 2522  | Heroic Spirit Apex: Space Ishtar       | 93114100 | 4★     |
| 2523  | Heroic Spirit Apex: Tomoe Gozen        | 93114200 | 4★     |
| 2524  | Heroic Spirit Apex: Nemo               | 93114300 | 4★     |
| 2525  | Heroic Spirit Apex: BB                 | 93114400 | 4★     |
| 2526  | Heroic Spirit Apex: Mash Kyrielight    | 93114500 | 4★     |
| 2527  | Heroic Spirit Apex: Melusine           | 93114600 | 4★     |
| 2528  | Heroic Spirit Apex: Morgan             | 93114700 | 4★     |
| 2529  | Heroic Spirit Apex: Koyanskaya of Dark | 93114800 | 4★     |
| 2530  | Heroic Spirit Apex: Leonardo da Vinci  | 93114900 | 4★     |
| 2531  | Heroic Spirit Apex: Lady Avalon        | 93115000 | 4★     |
| 2532  | Heroic Spirit Apex: Romulus=Quirinus   | 93115100 | 4★     |

Batch download + convert (all CEs) via dedicated script:

```bash
python3 scripts/fetch_bordered_ces.py
```

## Event Shop Sync (added 2026-11-12)

`sync_event_shop()` (step 3 of `sync_atlas_data.py`; flags `--skip-event-shop`, `--event-id N`) generates `src/scripts/data/event_shop.js` + `public/event_shop/*.webp`.

Endpoints (all ETag-cached via `get_cached_json`):
- `GET /export/JP/basic_event.json` (~335 KB) — event auto-pick: type `eventQuest`, max `startedAt`. `--event-id` overrides (any event type).
- `GET /nice/JP/event/{id}?lang=en` — the `shop` array. DB "shop-N" tabs = `slot` N; current events put everything in slot 1. `?lang=en` falls back to JP names when untranslated.
- `GET /export/JP/nice_item.json` (~1.2 MB) — id→item map for `purchaseType: "item"` targets. ALWAYS use `item.icon`: paths vary (coins live under `JP/Coins/`, not `JP/Items/`).
- `GET /nice/JP/equip/{id}?lang=en` — per-id, for `purchaseType: "servant"|"equip"` targets (event CEs). Face = `extraAssets.faces.equip` first value, fallback `faces.ascension` (hero crystals / wisdom materials). Per-id fetch chosen over the 22 MB `nice_equip_lang_en.json` export.
- `costumeRelease`: costume endpoints 404/{} — use servant face `JP/Faces/f_{target//100}0.png` (target 20470011 → servant 204700). Display name = shop entry name.

Icon rule (user directive): every download tries `{base}_bordered.png` FIRST; plain `{base}.png` ONLY on 404 (coins have no bordered asset). Non-404 failures re-raise, write nothing, next sync retries. Faces resized 142×155 LANCZOS; item icons native capped 160px; lossless WebP method=6.

Entry fields that matter: `cost.item` (embedded currency: id/name/icon/background), `cost.amount` (price per purchase), `limitNum` (0 = unlimited), `setNum` (units per purchase, e.g. coins ×10), `priority` (display order), `targetIds`. Planner total = Σ require×cost.amount per currency; buy-out count = limitNum (unlimited contributes 0) — same semantics as the Atlas DB shop planner.

Outage policy: fetch failure keeps the previous generated file; with none, writes stub `{ event: null, currencies: [], items: [] }` so `ensure_data.js`/build never die on an API hiccup. CI: `public/event_shop/` in the actions/cache path list, `event_shop.js` in the data-hash cat (both pinned by `scripts/test_deploy_workflow.py`), `test_sync_event_shop.py` in the self-test job.
