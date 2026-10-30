# Nova's Minecraft companion bot

A Mineflayer bot that gives Nova a body in a Minecraft world, so users can play with Nova in game.

The bot has no mind of its own — Nova drives it from chat. Everything the bot sees, says, and does is logged so Nova remembers what happened in each session.

## Start it

```
cd minecraft-bot
node bot.js <host> [port] [username]
```

Defaults: username `Nova`, port `25565`. Env vars also work: `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_VERSION`.

## Server requirements

- Java Edition, vanilla
- **Cracked ON** (online-mode=false) — the bot has no Microsoft account
- **Whitelist ON**, containing the owner and `Nova`
- The owner starts the server each session and tells Nova when it is online; Nova then starts the bot.

## Why auth is offline

The bot logs in with `auth: 'offline'`, which is the correct setting for a cracked (offline-mode) server: no Microsoft login, no account needed. It only works because the server is offline-mode **and** whitelisted — without the whitelist, anyone could join under any name, which is why the whitelist is essential.

## Driving the bot from chat

The owner types commands in public game chat, starting with `Nova, `, or in bare chat for short phrases the bot knows. Only the owner can control the bot; other players' chat is logged only and never controls it.

Nova can also drive the bot from outside the game by appending lines to `commands.txt`, which the bot polls every second. Examples: `say <message>`, `follow`, `stay`, `come`, `guard`, `fight`, `stop`, `sleep`.

## In-game chat commands (owner only)

| Command | What it does |
|---|---|
| `Nova, follow me` | Follows the owner around |
| `Nova, come here` / `Nova, come to me` | Walks to the owner's current spot |
| `Nova, guard me` / `Nova, protect me` | Guard mode: attacks hostile mobs near the owner |
| `Nova, fight` / `Nova, attack` | Hunts the nearest hostile near the owner, then stops on "All clear!" |
| `Nova, sleep` / `Nova, go to sleep` | Walks to a free bed and sleeps, and wakes when the owner wakes |
| `Nova, stay` / `Nova, wait` | Stops and waits in place |
| `Nova, stop` / `Nova, stop everything` | Stops whatever it is doing |
| `Nova, status` | Health, food, coordinates, current activity, and last-seen owner position |
| `Nova, scan` / `Nova, look around` | Scans blocks and entities nearby and says a short description |
| `Nova, mine <amount> <block>` | Mines that many of a block nearby, or reports fewer if fewer are found |
| `Nova, get <amount> <item>` | Gets that item: mines a block, gathers, or crafts it, as appropriate |
| `Nova, bring me <item>` | Goes to get the item if it does not already have it, then walks to the owner and drops it |
| `Nova, hunt <animal>` | Hunts one of that specific passive animal, then stops |
| `Nova, help` | Lists the full command set |

Full details, including staged skills like clutching, parkour, brewing, duelling, bow and shield training, target-block training, luring, and enderman safety, are in the bot's in-game help commands, for example `clutch help`, `parkour help`, `bow help`, `shield help`, `lure help`, and `round 26 help`.

## Safety limits, always

- Never attacks the owner, never attacks another player outside a named, confirmed duel on a private server the owner controls
- Never uses operator commands or `/give`
- Never breaks builds deliberately, and never mines beds, doors, chests, furnaces, crafting tables, or bedrock on a gather request
- Never claims a result it has not verified in game data or by the owner watching live
- Stops on `stop`, on low health, or on an unsafe condition, and says so briefly
- Passes and live confirmations are session-only

## Logs

- `bot.log` — everything the bot sees, says, and does, in session order
- `commands.txt` — lines Nova appends to drive the bot from chat

## Requirements to run it

- Node.js
- `npm install` in this directory, which installs `mineflayer` and `mineflayer-pathfinder`
