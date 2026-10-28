# Tiberian Skirmish – a Command & Conquer-style RTS prototype

Plain HTML5 Canvas + vanilla JavaScript. No build step, no dependencies.

## Run
```
cd cnc-clone
python3 -m http.server 8000
# open http://localhost:8000/index.html
```
(Opening `index.html` directly via `file://` also works in most browsers.)

## Goal
Destroy the red enemy **Construction Yard** (top-right) before the AI destroys yours (bottom-left).

## How to play
1. You start with 2000 credits, a Construction Yard, a Refinery and one Harvester. Harvesters automatically mine the teal crystal fields and deliver to the Refinery/Yard.
2. Click **War Factory** (or `B`), then click a green spot near your base (within 8 tiles of your buildings, 1-tile gap from other buildings, not on rocks/crystals). It takes ~10 s to construct.
3. Click **Tank** (or `T`) to queue tanks at the factory; **Harvester** (or `H`) to queue harvesters at the Construction Yard. Progress bars show on buttons and above buildings. Units spawn beside the building.
4. Select tanks and send them at the enemy. The AI builds harvesters, a factory and tanks, and sends attack waves (first wave ~2 minutes in, growing each time).

## Controls
| Input | Action |
|---|---|
| Left click / drag box | Select unit or building / box-select units (Shift adds) |
| Right click ground | Move (group spreads into a formation). Harvesters right-clicked on crystals mine there |
| Right click enemy | Attack |
| Units idle | Auto-attack enemies in sight |
| WASD / arrow keys / mouse at screen edge | Scroll the camera |
| Minimap (click/drag) | Jump the camera |
| `B` / `T` / `H` | Build factory / queue tank / queue harvester |
| `X` | Stop selected tanks |
| `Space` | Centre camera on your Construction Yard |
| `Esc` or right-click | Cancel placement / deselect |
| `F` | Toggle 3x game speed |
| `P` | Pause |

## Files
- `index.html` – page and HUD markup
- `style.css` – styling
- `game.js` – everything else (map, A* pathfinding, units, combat, economy, AI, rendering)

## Debug hooks
`window.__game` exposes `state`, `tick(seconds)` (fast-forward simulation), `queueUnit`, `placeBuilding`, etc., used by the headless test.

## Known limitations (prototype)
- One map, one resource, one buildable structure (War Factory), one combat unit (Tank) plus Harvester.
- No fog of war, no sound, no unit veterancy, no building power/sell/repair.
- Crystal fields do not regrow; the AI cheats nothing but knows the whole map.
- Pathfinding is single-unit A* with line-of-sight smoothing and soft unit separation, so big blobs can jostle in tight spots.
