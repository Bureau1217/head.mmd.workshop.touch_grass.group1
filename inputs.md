# Touch Grass: inputs and what they change

Branch `calculations-core`. The likelihood of a fire and the rate of burning are worked out on the server
(`server.js`) every second, from every visitor online. Each visitor's own values come from `userdata.js`
and are sent to the server by `main.js` every 10 seconds.

## Data about each visitor

Each visitor's values change their own **contribution** to the shared totals.

| Input | Source | What it changes |
|---|---|---|
| **Location** | `?at=` test place, then browser location, then IP address (GeoJS) | Where every lookup below is made. Shown in the debug box |
| **Fire danger** (class 0–5) | GWIS fire danger index (FWI), once per page load | **Likelihood:** × 0.25 (very low) up to × 4 (extreme). The strongest factor |
| **Nearest fire** | GWIS satellite hotspots from the last 7 days, once | Within 50 km: **likelihood** +1 % a minute, **burn rate** +1 character/s |
| **Humidity** | Open-Meteo, every 15 min | Under 50 %: **burn rate** × 1 → × 2 (× 2 at 20 % or less). Over 50 %: makes `canAddWater` true |
| **Rain in the last 2 hours** | Open-Meteo, every 15 min | Makes `canAddWater` true |
| **`canAddWater`** | humidity over 50 % or rain | The visitor adds **0** to the burn rate and pours water every 10 s instead. Each drop lowers the whole fire's rate to × 0.2, and it recovers over 30 s |
| **Wind speed** | Open-Meteo, every 15 min | **Burn rate:** × 1 → × 2 (× 2 at 50 km/h) |
| **Time on the site** | server clock | **Likelihood** and **burn rate:** × 1 → × 3 over 30 minutes |
| **Tabs of the site open** | counted between tabs | **Likelihood** and **burn rate:** × 1 → × 2 (+0.5 per extra tab) |
| **Framerate** | measured in the page | **Likelihood** and **burn rate:** × 1 → × 1.5 when below 50 fps |
| **Visitor ID** | kept in the browser | The name in the news. Several tabs count as one visitor |

## Shared, worked out on the server every second

| Input | What it changes |
|---|---|
| **Number of visitors online** | All their contributions add up. With nobody online, the likelihood drops 1 % a minute, and a burning fire goes out once its baseline has faded |
| **Fire baseline** | Every fire starts at 2 characters/s, fading to 0 over 60 s, so even an all-wet group sees a small fire |
| **`likelihood.txt`** | Keeps the likelihood when the server restarts. Delete it to start from 0 % |

## Interaction

| Input | What it changes |
|---|---|
| **Microphone** (blowing) | Blows the visitor's leaf. "blowing softly" or "blowing steadily" shows on the right |
| **Arrow keys** | Move the leaf, as a backup to the microphone |
| **H key** | Grows the top sky colour (*simulated* humidity) |
| **S key** | Grows the bottom sky colour (*simulated* drought) |
| **X key** | Shows or hides the debug box: burn rate, likelihood, water rate, location, `canAddWater` |
| **F key** | Starts a test fire **for everyone** |
| **`wildfire_stats.js`** | The text of the tree-ring spiral, which is what the fire burns |

## How the shared totals show on screen

| Shared total | On screen |
|---|---|
| **Likelihood** | One leaf falls for every 2 %. At 95 % the sky starts turning red. At 100 % a fire starts once the last leaf lands |
| **Burn rate** | How many characters of the ring spiral burn each second |
| **Fire out** (rate reaches 0) | What's burning finishes and turns to ash, nothing new catches, the sky goes back to green, and a news line appears |

## The formulas

```
likelihood, per minute = Σ over the visitors online of  1 × time × tabs × device × danger  + near
burn rate              = ( baseline + Σ over the dry visitors of  ( 1 × time × tabs × device × wind × dry  + near ) )  × water
```

The settings (`P_BASE`, `DANGER`, `START_RATE`, `WATER_EVERY_S`, …) are at the top of the likelihood and
burn rate sections in `server.js`.
