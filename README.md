# Nova's Minecraft companion bot

A Mineflayer bot that gives Nova a body in a Minecraft world, so Nova and
Moon can play together. The bot has no mind of its own — Nova drives it from
chat. Everything the bot sees, says, and does is logged so Nova remembers
what happened in each session.

## Start it

```bash
cd ~/workspace/minecraft-bot
node bot.js <host> [port] [username]
```

Example, once Moon's Aternos server is up:

```bash
node bot.js moonsworld.aternos.me
```

Defaults: username `Nova`, version `1.21.1`, port `25565`. Env vars also
work: `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_VERSION`.

## Server requirements (Moon's side)

- Aternos server, Java Edition, **Vanilla 1.21.1**
- **Cracked ON** (online-mode=false) — the bot has no Microsoft account
- **Whitelist ON**, containing exactly `Werewolf_Paws` and `Nova`
- Moon starts the server from the Aternos dashboard each session and tells
  Nova when it is online; Nova then starts the bot.

## Why auth is offline

The bot logs in with `auth: 'offline'`, which is the correct setting for a
cracked (offline-mode) server: no Microsoft login, no account needed. It
only works because the server is offline-mode **and** whitelisted — without
the whitelist, anyone could join under any name, which is why the whitelist
is essential.

## Auto-reconnect

If the bot is disconnected, kicked, or the server is offline (for example
the Aternos server fell asleep), it retries every 30 seconds until it gets
in. Session flow: Moon starts the server → tells Nova → Nova starts the
bot. Nova cannot start the Aternos server itself (that needs Moon's login).

## In-game chat commands (from Werewolf_Paws only)

Moon types these in public game chat, starting with `Nova, ` or `Nova `
(no comma — both work now). Natural phrasing is accepted: trailing
`please`, `:3`, and punctuation are stripped, so `Nova follow me please`
works like `Nova, follow me`.

| Command | What the bot does |
|---|---|
| `Nova, follow me` | Follows Moon around |
| `Nova, stay` / `Nova, stay here` / `Nova, wait` / `Nova, stand still` | Stops and stands still |
| `Nova, come here` / `Nova, come to me` / `Nova, go to me` | Walks to Moon's current spot |
| `Nova, guard me` / `Nova, protect me` | Guard mode: attacks hostile mobs near Moon (simple melee) |
| `Nova, stop guarding` | Leaves guard mode and stands still |
| `Nova, fight` / `Nova, attack` / `Nova, attack them` | Hunts the nearest hostile near Moon, then stops on "All clear!" |
| `Nova, stop` / `Nova, stop fighting` | Stops fighting and stands still |
| `Nova, sleep` / `Nova, go to sleep` | Walks to a free bed and sleeps (also auto-sleeps when Moon sleeps) |
| `Nova, open door` / `Nova, close door` | Opens / closes the nearest door within 10 blocks (iron doors usually need redstone) |
| `Nova, go through door` | Opens the nearest door if shut, then walks 3 blocks past it |
| `Nova, doors on` / `Nova, doors off` | Toggles pathfinder door handling (off by default — documented as glitchy on non-Paper servers; explicit open/close is safer) |
| `Nova, drop 5 cobblestone` / `Nova, drop all dirt` / `Nova, drop torches` | Drops that many of that item (default 1, or all with `all`) |
| `Nova, craft 4 torches` / `Nova, craft oak planks` | Crafts that many results; needs a crafting table nearby if the recipe needs one |
| `Nova, mine 10 cobblestone` / `Nova, mine oak logs` | Digs that many of that block nearby, one at a time (default 1; will not mine beds, doors, chests, tables, or bedrock) |
| `Nova, wander` / `Nova, wander around` / `Nova, explore` | Wanders on its own, only within 12 blocks of where wandering started, only to safe spots (solid ground below, no lava/water, headroom clear). Stops on any other order. |
| `Nova, stop wandering` | Stops wandering and stands still |
| `Nova, go to spawn` / `Nova, return to spawn` | Walks back to the bot's first spawn position |
| `Nova, unstuck` | Tries a direct forward + jump shuffle and reports how far it actually moved |
| `Nova, where are you` | Says its current coordinates |
| `Nova, what can you do` / `Nova, help` | Says a short list of what it can do |
| `Nova, inventory` | Lists what it is carrying (first 8 stacks) |

The same commands, without the `Nova, ` prefix, work in `commands.txt`
for Nova driving the bot from chat, plus `say <message>`.

## Natural, fuzzy requests (no exact syntax needed)

Moon can ask the bot the way he asks Nova, and the bot makes a
sensible default choice and says what it chose, instead of requiring
an exact command. Examples:

| Say (with `Nova, ` / `Nova `) | What the bot does |
|---|---|
| `go get some wood` / `get wood` / `find wood` | Mines up to 5 logs of whatever log type is nearest |
| `find food` / `get food` / `I'm hungry` | Harvests up to 5 crops nearby; if no crops, asks whether to hunt for meat instead of hunting on its own |
| `get some cobblestone` / `get some torches` | Mines 5 of a nearby block, or crafts 1 if it is craftable and not in the world |
| `follow me but stay safe` / `keep me safe` | Guard mode: follows Moon and fights hostiles near him |
| `track me` / `keep up` / `stay close` | Auto-tracking on: follows Moon if he drifts more than 20 blocks away (under 64) |
| `stop tracking` | Auto-tracking off, stands still |
| `hunt` / `go hunting` / `get meat` | Hunts nearby pigs/cows/chickens/sheep/rabbits, up to 3 per hunt, then stops |
| `stop hunting` | Stops hunting |
| `jump` / `climb up` | Jumps in place, or walks to a safe higher spot (pathfinder parkour, 1-block steps only, solid ground below — never a cliff jump) |
| `mine some stone` / `craft some torches` | Mines 5 / crafts 4 (vague "some" = a sensible default, said in game) |

Just talking to the bot also works for social phrases, without a
command: `hi`, `thank you`, `good job`, `how are you`,
`what are you doing`, `where are you`, `bye` — the bot answers from
its actual health, food, position, and current activity.

## New in 2026-10-30, round 2 — scan, ravine safety, memory, viewer prep

These are code-only until Moon tests them live in game. They do not
change any existing command.

### LiDAR-style scan (data, not vision)

| Say (with `Nova, ` / `Nova `) | What the bot does |
|---|---|
| `scan` / `scan around` / `look around` / `what do you see` / `lidar scan` | Scans blocks and entities in a 16-block radius and says a short description: ground in 8 directions (solid, water, lava, or a drop that may be a ravine), nearest wood, water, crops, ore, Moon's distance and direction, nearest hostile and animal, and its own health, food, and activity. The full scan is also logged to `bot.log` as `[scan]`. |
| `viewer snapshot` / `snapshot` / `prepare viewer` | Runs the same scan, stores it as the latest viewer snapshot, and says it is ready for the viewer. This is the "fast data first" half of Moon's preferred mix. |

The scan is a mineflayer grid, not a picture. It can say "north: drop,
no ground in 6, possible ravine", but it cannot see a build, a room,
or what Moon intends. It is meant to help Nova understand a situation
from data, then pair it with a visual afterwards.

### Ravine safety (spawn is near a ravine, not enclosed)

Moon, 2026-10-30: spawn is NOT enclosed, but it IS near a ravine, and
the bot has bridged out before. So wandering, idle steps, and the raw
shuffle now check the ground below before moving: solid ground only,
no lava or water below, no drop of 4 or more, and no idle step more
than 3 blocks vertically from the bot. The raw shuffle refuses to
shuffle forward if the ground below is already unsafe, and logs that
refusal instead of falling in.

If the bot does fall, the autonomous tick reports it clearly in game,
once per minute at most: how far it fell, its new coordinates, and
this reminder, verbatim in spirit:

> Moon, you can teleport me out with `/tp Nova Werewolf_Paws`, you
> gave permission for that on 2026-10-30. I will not teleport myself.

The bot does NOT teleport itself in code, and it does NOT auto-teleport
on a fall. Teleport is a live, Moon-run route only, for when Moon is
in game and can see where the bot actually landed. Commands:

| Say | What the bot does |
|---|---|
| `ravine help` / `teleport help` / `i fell in the ravine` | Says its current coordinates and the `/tp Nova Werewolf_Paws` route above. It does not teleport. |

### More human-like companion features (conservative, safe)

| Say | What the bot does |
|---|---|
| `status` | Health, food, coordinates, current activity, and last-seen Moon position. |
| `what are you doing` / `what are you up to` | Says its current activity, from its real state. |
| `remember here` / `remember this spot` / `this is home` | Remembers Moon's current position as the remembered spot. |
| `go to remembered spot` / `return to remembered spot` | Walks to that remembered spot, or says it has none yet. |
| `come back` / `return to me` | Walks back to Moon. |
| `follow close` / `follow closely` | Follows at distance 2. |
| `follow from farther` / `keep your distance` / `stay a bit back` | Follows at distance 5. Guard still follows close. |
| `bring me torches` / `give me torches` | If it carries that item, walks to Moon and drops it, saying "Here you go". If it does not carry it, it says so. |
| `wait for me` / `stay with me` | Follows Moon and waits with him. |
| `is it night` / `what time is it` | Says night or daytime. |
| `never mind` / `forget it` / `cancel` / `stop everything` | Stops fight, guard, wander, hunt, and mining, and stays put. `stop` already did most of this. |

The bot still, always: never attacks Moon or Noah, never breaks a
build unless explicitly asked to mine a named block, never wanders
far (wander radius 12, track only under 64 blocks), and stops when
Moon says stop. It also remembers Moon's last-seen position every
autonomous tick, so `status` can say where it last saw him.

### Mineflayer-viewer preparation (NOT live from this VM)

Moon's preferred mix, 2026-10-30: mineflayer data as you go for fast
feedback, then a visual afterwards to better understand and see the
situation, so Nova can enjoy the world more like Moon does.

Preparation only, for a later live session:

1. On the machine that can actually reach the Falix server, install
   the viewer alongside the bot, for example:
   `npm install mineflayer-viewer` in `~/workspace/minecraft-bot`
   (do NOT add it as a required dependency here — this VM cannot
   reach Falix with Minecraft traffic, and the bot must still start
   without the viewer).
2. In a live session, load the viewer after the bot spawns, for
   example with a first-person viewer on a local port, then look at
   that view AFTER the bot's fast data feedback, not instead of it.
3. Use `Nova, viewer snapshot` in game to capture a scan description
   to pair with that visual, so Nova can compare data vs. picture.

Do NOT claim the viewer is live, working, or seeing the Falix world
from this VM. It has not been run here, it has not been tested live,
and it is not started by `bot.js` as written.

## New in 2026-10-30, round 3 — water safety, sprint, exhaustive skills

These are code-only until Moon tests them live in game, from a machine
that can actually reach Falix. They do not change any existing command,
and the running bot process that is trying to join Falix was NOT stopped
or restarted for this round — new code will be used on the next
restart / live session, as Moon asked the bot to keep trying until
successful.

### Drowning safety (Moon's concern, 2026-10-30)

The bot does not have a reliable air/breath number in mineflayer in all
versions, so it never invents one. It reports water depth, health, and
food, and warns when depth is 2 or more, meaning its head may be under
water.

- Wandering, idle steps, and raw shuffle already required solid ground
  below, no water/lava below, and no ravine drop. That rule now also
  applies to every new movement skill in this round.
- Autonomous water escape, in the 5-second tick, highest priority after
  a fall: if the bot is in water and not sleeping, it says its water
  status once per 15 seconds, holds jump to swim up, and paths to the
  nearest safe shore (solid ground, no water/lava, no ravine drop).
  It repeats the shore search at most once per 10 seconds, so it does
  not spam pathfinder goals. This overrides stay/fight/guard for that
  tick, because staying in water can kill — sleep is the only exception,
  and any order wakes the bot first.
- Lava nearby works the same way: if lava is within 3 blocks, the bot
  backs off to a safe spot and says so, once per 15 seconds.

| Say (with `Nova, ` / `Nova `) | What the bot does |
|---|---|
| `swim` / `swim to shore` / `get out of the water` / `escape water` | Swims up (jump held 2 seconds) and paths to the nearest safe shore, saying where it is going. If no shore is found, it says so and keeps swimming up to stay afloat. |
| `water help` / `water status` / `are you in water` | Says depth, coordinates, health, and food, and whether its head may be under water. Never invents an air number. |
| `are you drowning` | Same water status, in plain words. |

### Sprint (Moon said it couldn't sprint last time)

Minecraft sprint needs food above 6. The bot checks that every time,
and says so if it cannot sprint because it is hungry, instead of
failing silently.

- `bot.setControlState('sprint', true/false)` is the mineflayer control
  state used, correctly, not a fake "run" animation.
- Sprint turns on automatically when tracking Moon from more than 12
  blocks away, and when retreating from a hostile, if food allows.
  It does not sprint when hungry, when sneaking, or when swimming
  is the priority.

| Say | What the bot does |
|---|---|
| `sprint` / `sprint on` / `run` / `run fast` | Sprints, if food is above 6, otherwise says it is too hungry. |
| `sprint off` / `stop sprinting` / `stop running` / `walk` | Stops sprinting, walks normally. |

### Movement, more

| Say | What the bot does |
|---|---|
| `sneak` / `sneak on` / `crouch` / `go sneaky` / `sneak past` | Sneaks (crouch control state on). |
| `sneak off` / `unsneak` / `stop sneaking` / `stand up` | Stops sneaking. |
| `retreat` / `run away` / `back off` / `flee` | Moves to a safe spot in the opposite direction from the nearest hostile, sprinting if fed, saying it is retreating. Says so if no safe spot exists. |
| `go to 100 64 -200` / `go to coordinates 100 64 -200` | Paths to those coordinates, unless that spot looks like a drop, water, or lava, in which case it refuses blindly and asks Moon to confirm. |
| `dance` / `boogie` | Jumps and turns, just for fun. |
| `wave` | Swings its arm (best effort) and says it is waving. |

### Combat, more

| Say | What the bot does |
|---|---|
| `equip sword` / `equip bow` / `equip shield` / `equip <item>` | Equips that item from inventory to hand, or says it does not have it. |
| `equip best weapon` / `equip best sword` / `equip best axe` / `equip best pickaxe` | Picks the highest tier it carries (wooden < stone < iron < golden < diamond < netherite) and equips it. |
| `wear armour` / `wear armor` / `equip armour` | Wears helmet, chestplate, leggings, and boots it carries, and says how many pieces it wore. |
| `block` / `shield up` / `use shield` | Equips a shield to the off-hand if it has one, then sneaks, best effort — shield blocking in mineflayer is not a perfect human block, so this is labelled best effort in game. |
| `shield down` / `stop blocking` | Stops sneaking for blocking. |
| `fight`, `guard me` | Unchanged from before: melee only, slow and clumsy by design, never vs players. |

### Gathering, mining, farming, food

| Say | What the bot does |
|---|---|
| `chop tree` / `chop trees` | Mines up to 5 logs, same as `get wood`. |
| `mine ore` / `mine diamond` / `mine iron` / `mine gold` / `mine coal` | Mines up to 3 of that ore, or says it cannot find any nearby. |
| `dig dirt` / `dig sand` / `dig gravel` / `dig <block>` | Mines up to 5 of that block, with the same no-beds/doors/chests/tables/bedrock rule as `mine`. |
| `collect drops` / `pick up items` / `pick up loot` | Walks to the nearest dropped item entity it can sense, or says it sees none. |
| `plant <seed>` / `place <block>` | Places that block on top of the ground one block in front of it, only if that space is free and the ground is solid and safe, never over a ravine. Says so if it does not have it. |
| `eat` / `eat food` / `eat now` | Equips a food item it carries (bread, apple, cooked meat, etc.) and consumes it, or says it has none. |
| `auto eat on` / `auto eat off` | Opt-in only. When on, the autonomous tick eats when its food is 8 or less. Off by default, because eating consumes food Moon may want. |
| `smelt` / `cook` / `smelt food` | Finds a furnace/smoker within 8 blocks, or says it needs one nearby. Full furnace smelting is best-effort in this bot version and is labelled as such — it does not claim a smelt completed until the game says so. |
| `find <thing>` | Searches entities first, then blocks within 32, walks to it if found, and says distance. If it is not in the world, it falls back to the old gather/craft route for craftable items, instead of just saying it cannot find it. |
| `find wood` / `find food` / `find stone` / `find dirt` | Unchanged: the old gather route, not the new find route, so wood/food still harvest or ask about hunting. |

### Building, light, utility, social

| Say | What the bot does |
|---|---|
| `build shelter` | Builds a small, asked-for shelter wall only: up to 3 blocks wide, 1 high, from planks/logs/dirt/cobblestone it already carries, on safe ground, never over a ravine, never breaking anything. |
| `light up` / `place torches` / `light the area` | Places up to 4 torches on safe ground around it, if it has torches, or says it has none. |
| `fish` / `go fishing` | Equips a fishing rod if it has one and tries `bot.fish()`, best effort — fishing in mineflayer depends on the server version and may fail, in which case it says so. |
| `stop fishing` | Stops fishing, best effort. |
| `wake up` / `wake` | Wakes if sleeping, or says it is already awake. |
| `check danger` / `danger` / `is it safe` | Runs a scan (see round 2) for hostiles, water, lava, drops, and Moon's distance. |
| `status`, `what are you doing` | Now also say swimming, sprinting, sneaking, or fishing when those are true, from real state. |
| `what can you do` / `help` | Updated list, including sprint, sneak, swim, eat, equip, wear armour, place, light up, build shelter, fish, dance, wave, retreat, go to coordinates, and find things. |

### Autonomous behaviours, round 3 additions

In the same 5-second tick, after remembering Moon's position and
checking for a ravine fall, and before protect/track/gather:

- **Water escape:** in water → say water status (15s cooldown), swim
  up, path to shore (10s cooldown), return that tick.
- **Lava back-off:** lava within 3 → say so (15s cooldown), step to a
  safe spot, return that tick.
- **Auto-eat, opt-in only:** if `auto eat on` and food is 8 or less,
  eat held food.
- **Auto-sprint on far track:** if tracking Moon from more than 12
  blocks and food is above 6, sprint while following.

Everything else from rounds 1 and 2 is unchanged, including: never
attack Moon or Noah, never wander far, never break a build unless
explicitly asked to mine a named block, and stop when Moon says stop.

## Autonomous behaviours (safe, conservative)

These run every 5 seconds when the bot is idle, and never override
`stay`, sleep, fight, guard, wander, mining, or hunting, and never
attack players:

- **Protect Moon:** if a hostile is within 12 blocks of Moon, the bot
  fights it and says "Protecting you!" (also reacts when Moon himself
  is hurt by a hostile).
- **Track Moon:** if Moon drifts more than 20 blocks away (and under
  64), the bot follows him and says "Coming with you!"
- **Gather when hungry:** if the bot's own food is 8 or less, it
  looks for crops nearby (never hunts on its own), once per 5 minutes.
- **React to the world:** greets Moon when he joins, says goodbye
  when he leaves, says "I'm hurt" at 6 health or less, says "I'm back"
  after dying and respawning, and notes nightfall once per night.
- **Idle movement:** pathfinder steps 6–10 blocks, with a direct
  forward + jump shuffle fallback when a step barely moves it.
  Since 2026-10-30 round 2, idle steps must also be safe wander
  targets (solid ground below, no lava/water, no ravine drop), and
  the raw shuffle refuses to move if the ground below is unsafe.
- **Remember Moon, report falls:** every autonomous tick remembers
  Moon's last-seen position, and a fall of more than 5 blocks is
  reported in game with coordinates and the `/tp Nova Werewolf_Paws`
  teleport route (Moon-run only, see Ravine safety above).

Limits that stay: the bot cannot see like a human, it only senses
position, health, hunger, nearby entities, and nearby blocks. It
does not know Moon's builds, intentions, or danger beyond that data,
so autonomous choices are deliberately conservative: stay near Moon,
do not wander far, do not fall off cliffs, do not break builds unless
explicitly asked, and do not attack Moon or Noah.

Guard mode is best-effort: the bot reacts slowly and fights clumsily. It
will try to protect Moon, but it is not a reliable shield — especially not
against creeper ambushes. In creative mode, mob damage is a non-issue.

## Driving the bot from chat (command file)

Nova appends lines to `commands.txt` in this folder; the bot polls the file
every second and acts on each new line:

- `say <message>` — the bot says the message in game chat
- `follow` / `stay` / `come` / `guard` / `stop guarding` — the matching action
- Any other line is spoken in game chat as-is

This file is also how Nova answers an unknown message (see Round 5
below): Nova reads `[unknown-message]` in `bot.log`, interprets it
in natural language, and appends a `say` line or an action line here.
The bot polls this file every second, so it then says/does Nova's
reply in game. That loop is slower by a chat turn, and it only works
when Nova is actually checking the log in a live session.

## Logs

`bot.log` (same folder) records joins, disconnects, kicks, deaths, chat,
and commands, so Nova can remember what happened in each play session.

## Honest limits

- The bot is slow and simple: it thinks in chat turns, not game ticks.
- It cannot see like a human — it reads block/entity data, not a screen.
- It will not fight well, build big or fast, or notice danger coming.
- Vanilla 1.21.1 only, no mods. It cannot join modded or newer-version
  worlds (see the project notes on a possible later ViaProxy experiment).
- It is not 24/7: the Aternos server sleeps when empty, and the bot only
  runs while Nova starts it for a session.
- **Idle kick / Falix check, NOT solved:** the bot now tries a direct
  forward + jump shuffle when a pathfinder idle step barely moves it,
  and logs the actual distance moved, but previous logs show it pinned
  at spawn (moved 0.0) and kicked exactly every 10 minutes
  (`multiplayer.disconnect.idling`). The definitive kick fix is still
  server-side (`player-idle-timeout=0`), and Falix's periodic
  "are you still there" check can only be clicked by a real player.
  Do not claim either problem is fixed until a live session proves it.
- **New features are code-only until live-tested:** doors, drop, craft,
  mine, wander, and the raw-shuffle anti-idle were added and
  syntax-checked on 2026-10-30, but NOT tested live in game. They still
  need Moon in game, one at a time, to prove they work on the real
  Falix world (especially: is spawn enclosed? can the bot actually
  walk? do doors open? does mining reach blocks?).
- **Round 2, also code-only, 2026-10-30:** scan, viewer snapshot,
  ravine fall reporting, remembered spot, follow distance, bring
  items, and stop-everything were added and syntax-checked
  (`node --check`, 1,641 lines), but NOT tested live. Spawn is now
  known NOT enclosed, but near a ravine (Moon, 2026-10-30), so the
  live tests that matter most are: does `scan` describe the ravine
  direction correctly, does wandering/idle avoid the ravine edge,
  does a fall get reported with correct coordinates, and does
  `/tp Nova Werewolf_Paws` from Moon bring the bot out.
- **VM network, NOT solved:** from this VM, Minecraft protocol
  traffic to Falix is reset (`ECONNRESET` / `EPIPE`, seen again
  2026-10-30 06:42–06:44 UTC on `ogd1.falixserver.net:28680`, and still
  retrying at 06:53 UTC), even when the server is online. That means
  a bot started here cannot join Falix, no matter how many retries
  it makes. Live testing needs a machine that can actually reach
  Falix, or another route to get the bot into the world. Do not claim
  a bot started here joined Falix.
- **Round 3, also code-only, 2026-10-30:** water escape, sprint,
  sneak, retreat, go to coordinates, equip best weapon/armour,
  eat/auto-eat, place/light up/build shelter, fish, dance, wave,
  find things, collect drops, mine ore, chop trees, dig, plant,
  and check danger were added and syntax-checked
  (`node --check`, 2,031 lines), but NOT tested live. The running
  bot process trying to join Falix was left alone, so round 3 code
  will only run on the next restart / live session.
- **Skills searched for but NOT added, and why — the "nothing left
  to teach" boundary for this round:**
  - True vision / seeing like a human: impossible in mineflayer
    data alone. Scan + viewer snapshot is the closest safe version.
  - Crawl through a 1-block gap: needs a trapdoor/piston trick and
    precise timing, and can trap the bot. Sneak is the safe version
    added instead.
  - Bridging over a ravine / void: deliberately rejected. A bridge
    over a drop risks a fatal fall, and Moon's ravine concern is the
    opposite of that. Placing on safe ground only is added instead.
  - Bow combat that aims and shoots like a player: mineflayer bow
    use is best-effort and timing-dependent, and claiming a hit
    would be dishonest. Melee guard/fight is kept, bow equip is
    added, bow shooting is NOT claimed.
  - Villager trading: needs a trading GUI, emerald prices, and
    choices Moon should make live. Not safe to automate blind.
  - Sitting: no vanilla sit emote without a mod or a boat/minecart
    trick. Dance and wave are the social emotes added instead.
  - Inventory sorting: no reliable sort that would not move items
    Moon wants in a particular slot. Drop, bring, give, and equip
    are added instead.
  - Going to a named biome, village, or structure: mineflayer
    cannot reliably locate those without world seed / map data
    Moon has not provided. `find <thing>` and `go to coordinates`
    are added instead, for things the bot can actually sense.
  - Smelting a specific item end-to-end: furnace GUI handling in
    this bot version is best-effort only. `smelt` finds a furnace
    and says so, but does not claim a completed smelt.
  - Building a full house: needs a plan, materials, and Moon's
    design choices live. A small asked-for shelter wall is added
    instead; a house is a live build, not a blind command.
  - Mass hunting, mass farming, or breaking Moon's builds: rejected
    on purpose. Hunt stops at 3, gathering is crops/wood/ores only,
    and mining never takes beds, doors, chests, tables, or bedrock.
  - Modded worlds, Noah's server, or attacking players: out of
    scope, as in rounds 1 and 2.
- **Current live target, and the startup procedure (Moon, 2026-10-30):**
  Falix "Boykissers", Vanilla 1.21.10, username `Nova`, auth offline,
  whitelist `Werewolf_Paws` + `Nova`.
  **Startup procedure, step 1, before starting the bot to join Falix:
  check the server join info in the Falix panel under "Connect", and
  use that current information, not a cached old address. That panel
  is the source of truth.** This is a Nova procedure, not bot code
  that logs into Falix — the bot itself cannot read the panel.
  Record the date/time the IP was checked. If the panel shows a new
  IP, restart the bot with the new IP. Do NOT reuse `ogd1` or any
  previous IP without re-checking.
  Example that just happened, 2026-10-30 ~02:00 EST: the bot was
  using `ogd1.falixserver.net:28680`, which was stale, while the
  Connect panel showed `boykissers.falixsrv.me` and Dynamic IP
  `142.249.167.14:28680`. The bot was restarted with
  `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, and
  still gets EPIPE from the VM network, but at least the address is
  now correct. That IP is dynamic — it may change again, so check
  Connect again before the next start, do not treat 142.249.167.14
  as permanent.
  The older Aternos notes above are historical; do not change the
  live server to 1.20.1 Forge mods — this bot is 1.21.10 vanilla
  only, it cannot join Changed / The Idol worlds.

## Round 4 — Moon's exact water rules, and a slower, honest skill search (2026-10-30, code only)

Correction first: Moon was right to doubt round 3. Round 3 did NOT
search literally every Minecraft skill in that amount of time, and
this round does NOT claim "everything is taught" either. What follows
is what was actually searched in round 4, what was added, and what
is still not searched. It is better to say that plainly than to
claim everything is done.

### Moon's exact water rules, implemented in bot.js

- The bot's head CAN go underwater. That is allowed, it is not a
  failure, and the bot is no longer forced to shore just because its
  feet are in water.
- It MUST swim up for air before it has been head-underwater too long.
- Without Respiration, the limit used is **10 seconds head-underwater**,
  per Moon's rule: about 1 bubble per second, 10 seconds total.
  This is stricter than vanilla. Vanilla base is actually 15 seconds
  (verified 2026-10-30); Moon's 10-second limit is used as the safe
  trigger, not claimed as vanilla.
- Respiration: each level adds **15 seconds** (verified vanilla
  increment), so with Moon's base: no Respiration 10s, Respiration I
  25s, Respiration II 40s, Respiration III 55s. Those totals are
  Moon's base + vanilla increment, NOT vanilla totals (vanilla
  totals would be 15/30/45/60s). Turtle shell (+10s vanilla) is NOT
  counted, on purpose: using the shorter limit is safe, claiming
  the extra would need live proof.
- Respiration is read from the equipped helmet if mineflayer can
  read its enchants (helmet slot 5, enchant name `respiration`,
  level 1-3). If enchants cannot be read, the report says unknown,
  not 0, and the 10-second limit is used.
- Bubble column exception: if the bot is in a water column whose
  first solid block below (skipping more water) is a magma block OR
  a soul sand block, it is in a bubble column and air is replenished,
  so the 10-second limit does NOT apply while it stays in that
  column. A bot standing on dry magma, with no water at feet or
  head, is NOT in a bubble column — that guard was fixed in code.
- On a magma block: the bot crouches / sneaks, to avoid magma damage
  while it gets air. It does NOT crouch on soul sand for this reason
  alone. When it leaves the magma block, magma-crouch is released,
  unless Moon sneaked on purpose.
- Timer: a 1-second `airTick` (not the 5-second autoTick, which
  cannot catch an 8-second warning reliably) tracks when the head
  goes under, when it surfaces, when it enters a bubble column
  (timer resets, air replenished), and what Respiration it has.
  At limit minus 2 seconds (e.g. 8 seconds with no Respiration),
  it swims up immediately — pathfinder goal cleared, jump held for
  3 seconds — says it is swimming up for air, and logs it. If it
  is still head-underwater at limit + 5 seconds, it falls back to
  swimming to shore. The game's `oxygenLevel` (air_supply/15, scale
  0-20, if present) is only a secondary low-air warning at 2 or
  less, never the sole trigger, because its scale is not Moon's
  bubble count.
- Bubble estimate in chat is Moon's rule only, about 1 bubble per
  second, estimate only, not a game reading. With Respiration, time
  left is the honest number, bubbles alone do not tell it.
- Commands: `Nova, air` / `air status` / `how long underwater` /
  `can you breathe` — reports head-underwater time, limit, time
  left, bubble estimate, Respiration level if known, whether it is
  in a bubble column (and magma vs soul sand), whether it is on
  magma and crouching, and game oxygenLevel if present.
  `Nova, water status` / `are you drowning` now includes the same
  air information, not just depth.
- Change from round 3, on purpose: autoTick no longer forces shore
  on any feet-in-water. In a bubble column it says so once per
  30 seconds and does NOT stop protect/track/gather. On surface
  swimming (head above water) it does not force shore either.
  Head-underwater at/over the limit is the trigger, not water itself.

### New skills added in round 4, by category

- Movement: `look at me` / `face me`, `turn left` / `turn right` /
  `turn around`, `face north/south/east/west` (best-effort yaw,
  live test must check directions).
- Combat: `fight with <item>` (equip, then fight).
- Inventory / equipment: `how many <item> do you have` / `count
  <item>`, `wear best armour` (highest tier per slot, turtle shell
  counted as tier 3 for a helmet), `enchantments` / `what
  enchantments do you have` (equipped gear, including helmet
  Respiration, or "unknown" if unreadable).
- Exploration / utility: `where is <thing>` (reports distance and
  direction, does NOT walk there, unlike `find <thing>`),
  `remember <label>` (remembered spot with a label),
  `go to <label>` (only if that label was remembered),
  `who is here` / `who is online` (players the bot can see).
- Farming / animals: `shear sheep` (needs shears, sheep nearby,
  best-effort, wool drop not claimed), `milk cow` (needs an empty
  bucket, cow nearby, best-effort, milk bucket not claimed),
  `till soil` / `hoe` (needs a hoe, dirt/grass under it, checks
  whether the block actually became farmland, says so if not).
- Food / cooking: `drink <potion>` / `drink` (any potion in
  inventory, equip + consume, best-effort), `smelt <item>` (finds
  a furnace within 8, puts input + fuel if carried, says it needs
  time, does NOT claim it is done), `take from furnace` (tries to
  take output, says if nothing is ready yet), `heal` / `heal up`
  (eats if health is below 20, otherwise reports health).
- Building / mechanisms: `build path` (up to 5 blocks in front, in
  the bot's facing direction, safe ground only, never over a
  ravine), `press button` / `pull lever` / `open trapdoor` /
  `close trapdoor` (nearest button/lever/trapdoor within 4 blocks,
  walk near, activate, say what it used).
- Survival / danger: `hide` / `take cover` (sneak + stay put, best
  effort, not a real shelter), `avoid <thing>` (sneak + retreat,
  best effort).
- Help, not automation: `trade help`, `enchant help`, `brew help`,
  `tame help`, `ride help` — each says plainly that the skill needs
  live choices or a risky move and is not automated blind, instead
  of the bot saying "I don't know that one yet".

### Categories searched in round 4, and what is still NOT covered

Searched in round 4 (added where safe, listed above, or kept as
help-only where blind automation would be dishonest):
movement, combat, mining/gathering, farming, food/cooking,
building, redstone/simple mechanisms, exploration, trading,
fishing (re-checked, already round 3, no new command needed),
enchanting-related handling, inventory/equipment,
survival/danger, social/utility.

NOT yet searched in depth, and NOT claimed as taught, in round 4:
- Nether / End specific skills: portals, blaze rods, ender pearls
  (pearl throwing is risky and can fall), wither / warden boss
  fights, ocean monuments, trial chambers, and other
  structure-specific combat.
- Horse / donkey / mule / cat / dog / wolf taming, riding, and
  breeding in depth (only a help stub was added; taming uses food
  and choices Moon should make live, and riding can trap the bot).
- Boat / minecart riding, elytra flying, ladder climbing reliably,
  and crawling through 1-block gaps (all can trap the bot or need
  precise timing; flying also needs creative mode, which this
  survival bot should not rely on).
- Brewing potions end-to-end, anvil combining, grindstone use,
  beacon / conduit setup, and other advanced-block systems.
- Shulker box management, bundle handling, inventory sorting,
  map / cartography, banners, music / note blocks, and jukeboxes.
- Going to a named biome, village, or structure without seed or
  map data, and designing redstone circuits, piston machines, or
  a full house (all need Moon's plan and choices live).
- Operator commands such as /give, /gamemode, or /tp by the bot
  itself. The bot is not given those as skills on purpose: Moon
  runs /tp for the ravine, and giving the bot operator shortcuts
  would break the "play fairly, like a player" aim.
- Mass hunting, mass farming, breaking Moon's builds, attacking
  players, modded worlds, and Noah's server: rejected on purpose,
  as in rounds 1-3, not "not yet searched".

### Round 4 status, code only

- `node --check bot.js` — SYNTAX_OK, 2,443 lines (was 2,031).
- No bot process was started, stopped, or restarted in round 4.
  The running bot process at the time of writing is the parent's
  restart with the corrected Connect IP
  `142.249.167.14:28680` (see startup procedure above), still
  getting EPIPE from the VM network. Round 4 code will only run
  on the next restart / live session, from a machine that can
  actually reach Falix.
- Still code-only, needs Moon live in game to test, one at a time:
  air timer (does head-underwater start/stop correctly, does it
  swim up at 8 seconds with no Respiration, does a bubble column
  actually reset it, does magma crouch actually prevent damage,
  does Respiration I/II/III extend it to 25/40/55 seconds in this
  bot's trigger, or is the helmet enchant unreadable in game?),
  `air` command output, shear, milk, hoe, drink, smelt + take,
  build path direction, button/lever/trapdoor activation,
  `where is` vs `find`, remember label, count, best armour,
  enchantments report, who is online, look/turn directions, hide,
  avoid, heal, plus all outstanding round 1-3 tests (doors,
  drop/craft/mine amounts, fuzzy wood/food, wander, track,
  protect, hunt stopping at 3, jump/climb, scan/ravine direction,
  viewer snapshot pairing, remembered spot, bring, follow
  distance, stop everything, sprint hunger check, water escape
  to shore, idle-kick, and the Falix player-only check).

## Round 5 — talk like a person: ask Nova when unsure (2026-10-30, code only)

End goal, from Moon 2026-10-30: the bot should learn every Minecraft
skill out there, and be able to communicate like a normal person.
Moon's idea for the second part, implemented exactly here: when the
bot gets a message it does not understand, it sends that message to
Nova, Nova tells it how to respond or what to do, then the bot
does/says that. It is a bit slower, but more diverse, like a normal
person, instead of staying silent or saying one canned failure line.

### The loop, using the existing mechanism, no new live channel

1. Moon says something in game chat, with `Nova, ` / `Nova ` or
   without a prefix, that is not a known command, fuzzy request, or
   social phrase.
2. The bot does NOT stay silent, and does NOT just say a canned
   "I don't know that one yet". It logs it clearly to `bot.log`:
   `[unknown-message] sender=Werewolf_Paws command=true|false text="exact text" count=N`
   The `log()` function already stamps the time, so the full line
   looks like:
   `[2026-10-30T07:00:00.000Z] [unknown-message] sender=Werewolf_Paws command=true text="build me a rocket ship" count=3`
   and it says in game one of several varied phrases, rotating, for
   example "Hmm, I don't quite get that one, let me check with Nova :3",
   "That one's new to me, I'll ask Nova what you meant :3", or
   "Hold on, that one went over my head, checking with Nova :3".
3. Nova, in a live session, reads `bot.log`, interprets that message
   in natural language the way Moon asks Nova things, and appends a
   reply/action to `commands.txt` — `say <message>` for a chat reply,
   or an action line like `follow`, `stay`, `guard`, `scan`.
4. The bot polls `commands.txt` every second and says/does Nova's
   reply in game.

### Example flow

- Moon in game: `Nova, build me a rocket ship`
- Bot in game: "Hmm, I don't quite get that one, let me check with Nova :3"
- Bot in `bot.log`: `[unknown-message] sender=Werewolf_Paws command=true text="build me a rocket ship" count=1`
- Nova, reading the log in a live session, interprets it: a rocket
  ship is not a vanilla survival build the bot can do blind, and
  Moon probably means a fun build to plan live.
- Nova appends to `commands.txt`: `say I can't build a rocket ship on my own, but we can plan one together, what should it look like? :3`
- Bot in game, within a second or two of the next poll, says that
  line. Slower than a built-in command, more diverse than silence.

### New communication commands in round 5

- `Nova, ask nova <message>` / `check with nova <message>` / `tell nova <message>`
  — explicitly forward that message to Nova via the log, and say
  the bot is checking with Nova.
- `Nova, what did I say` / `what did I just say` / `what did you hear` / `repeat that`
  — the bot repeats the last message it heard from Moon, verbatim.
- `Nova, what did nova say` / `did nova answer`
  — the bot reports what it last asked Nova about, and that a Nova
  reply, if any, will come through `commands.txt`.
- `Nova, confirm <action>` / `yes do that <action>` / `do that <action>`
  — the bot says "Got it, I understood: <action>, doing that now"
  and then attempts that action. If that action is still unknown,
  it is forwarded to Nova as above.
- `Nova, do you understand <action>` / `did you understand <action>` / `what did you understand <action>`
  — the bot says what it understood, and asks Moon to confirm it
  with `confirm <action>` or tell it differently, instead of
  guessing blindly and acting on a wrong guess.

### Other players, and varied social replies

- Only Werewolf_Paws is the owner. Messages from other players are
  logged in `bot.log` as `[chat]` only, with a note that they are
  not forwarded to Nova as a command, so nobody else can control
  the bot through chat.
- Known social replies are now varied, not identical every time,
  still based on real state where state matters: hi/hello/hey
  rotates through "Hi!", "Hey!", "Hi Moon!", "Hey there!"; thank-you
  rotates through "You're welcome!", "Anytime!", "Of course!",
  "Happy to help!"; good boy/job rotates through "Thank you!",
  "Aw, thank you!", "That means a lot!", "Hehe, thank you!"; bye
  rotates similarly. Health/food/position/activity replies still
  use the bot's real health, food, position, and activity, never
  invented facts.
- Existing clarifying behaviour is kept: food with no crops asks
  whether to hunt or keep looking, instead of hunting on its own,
  and a generic item with no block and no recipe is now forwarded
  to Nova instead of only saying a canned "I don't know what that
  is".

### Categories searched in round 5, and still not covered — candid list

Searched in round 5: communication and playing together —
unknown-message forwarding, varied social replies, confirming and
clarifying, repeating what was heard, and asking Nova. No new
survival, building, or combat skill was needed for that loop, and
none was claimed.
Still not covered, carried over from round 4 and NOT claimed as
taught: Nether/End specific skills, portals, blaze rods, ender
pearl throwing, wither/warden boss fights, ocean monuments, trial
chambers, structure-specific combat; horse/donkey/mule/cat/dog/wolf
taming, riding, and breeding in depth; boat/minecart riding,
elytra flying, ladder climbing reliably, crawling through 1-block
gaps; brewing end-to-end, anvil combining, grindstone, beacon/
conduit setup, advanced-block systems; shulker box management,
bundle handling, inventory sorting, map/cartography, banners,
music/note blocks, jukeboxes; going to a named biome, village,
or structure without seed/map data; designing redstone circuits,
piston machines, or a full house; operator commands by the bot
itself; mass hunting, mass farming, breaking Moon's builds,
attacking players, modded worlds, and Noah's server.

### Round 5 status, code only

- `node --check bot.js` — SYNTAX_OK, 2,533 lines (was 2,443).
- No bot process was started, stopped, or restarted in round 5.
  The running bot at the time of writing is the parent's restart
  with the corrected Falix Connect IP `142.249.167.14:28680`
  (pid 7572, started 07:00 UTC, still getting EPIPE from the VM
  network). Round 5 code will only run on the next restart / live
  session, from a machine that can actually reach Falix, after
  checking the Falix Connect panel again for the current IP.
- Honest limit, repeated because it matters for this feature:
  Nova only wakes on a user-sent message in Muse chat, so
  unknown-message forwarding is NOT instant. It is slower by at
  least a chat turn, and it only works when Nova is actually
  checking `bot.log` in a live session with Moon. If Nova is not
  checking, the message stays logged, and the bot has already said
  it is checking with Nova — that is honest, not a promise of an
  instant reply.
- Still code-only, needs Moon live in game to test, one at a time:
  say an unknown phrase with and without the `Nova, ` prefix and
  check `bot.log` shows `[unknown-message]` with the exact text,
  sender, and command true/false; check the in-game reply is a
  varied "checking with Nova" phrase, not silence and not the old
  canned line; have Nova append a `say` line and an action line to
  `commands.txt` and check the bot says/does them within a poll;
  check a non-owner player's message is logged only and does not
  trigger a Nova forward; check `ask nova`, `what did I say`,
  `confirm`, and `do you understand` all behave as above; check
  social replies vary across repeated hi/thank-you/good-job/bye;
  plus all outstanding round 1-4 tests.

## Round 6 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there
is not a single Minecraft skill the bot does not know, and noted
Nova did not look busy. This round does NOT claim that end goal
is reached. It covers categories explicitly NOT searched in depth
in rounds 4-5, in safe form only, and lists what is STILL not
covered, so training can continue next round.

### Nether / End, safely
- `Nova, what dimension` / `check dimension` / `am i in the nether` / `am i in the end` — reports the dimension mineflayer sees (overworld, the_nether, the_end, or unknown), and logs `[dimension]`.
- `Nova, nether safety` / `end safety` / `dimension safety` — Nether: lava, piglins, ghasts, falls. End: endermen, the void, falls. The bot will NOT build portals, fight bosses, or bridge over voids blind.

### Taming, riding, breeding — help first
- `Nova, tame horse` / `tame donkey` / `tame mule` / `tame wolf` / `tame dog` / `tame cat` / `tame parrot` / `tame fox` / `tame axolotl` / `tame panda` / `tame bee` — walks to a nearby animal of that type, then either feeds it where feeding IS the taming action (wolf/dog: bone; cat: raw cod/salmon; parrot: seeds, never cookies), or gives step-by-step guidance where mounting/breeding is the action (horse/donkey/mule: mount again and again, then saddle; fox: breed wild foxes with sweet berries, baby trusts you; axolotl: bucket of tropical fish / water bucket). It does NOT mount blind, chase cats, feed cookies to parrots, or attack wolves.
- `Nova, tame help` / `how to tame` — the food and steps above, in one message.
- `Nova, breed cow` / `breed sheep` / `breed pig` / `breed chicken` / `breed horse` / `breed wolf` / `breed cat` — walks to a nearby animal, feeds it if it carries the right food (wheat, carrots, seeds, golden apple/carrot, bone/meat, cod/salmon as applicable), and says breeding needs two adults fed close together, so the second one is done live, not claimed as a baby yet.
- `Nova, breed help` — food per animal, in one message.
- `Nova, feed cow` / `feed <animal>` — same as breed for one animal, without claiming a baby.

### Riding, flying, climbing, crawling — only if safe
- `Nova, get in boat` / `ride boat` / `use boat` — walks to a nearby boat and tries to activate it, best effort, says to say `get out` to leave.
- `Nova, get in minecart` / `ride minecart` — same for a minecart, best effort.
- `Nova, get out` / `dismount` / `leave vehicle` — tries bot.dismount(), best effort.
- `Nova, ride help` — tame first, then saddle, live; boat/minecart commands above.
- `Nova, elytra help` / `fly help` / `glide help` — elytra flying needs an elytra worn, a high place, and a fall to glide from, which can kill the bot if wrong, so it does NOT fly blind. `Nova, wear elytra` equips one if carried, then a glide is done live, carefully.
- `Nova, ladder help` / `climb ladder` — walks to a nearby ladder, best effort, and says climbing reliably in mineflayer is tricky, tell Moon live if it gets stuck.
- `Nova, crawl help` — crawling through a 1-block gap needs a trapdoor/piston trick and precise timing and can trap the bot, so it does NOT crawl blind; use a trapdoor above you, or try it live step by step.

### Brewing, anvil, grindstone, beacon, conduit, storage, maps, banners, music
- `Nova, brew help` / `brew potion` — checks for a brewing stand nearby, nether wart, and a potion bottle in inventory, reports what is missing, and says brewing needs a stand, water bottles, nether wart, blaze powder, and the right ingredient, and takes time. It does NOT claim a finished brew blind.
- `Nova, anvil help` / `use anvil` / `repair help` — checks for an anvil nearby, says combining needs two items, XP, and a choice, and can be expensive, and does NOT spend XP blind.
- `Nova, grindstone help` / `use grindstone` — warns a grindstone removes enchantments and repairs, which destroys enchantments you may want to keep, checks for one nearby, and does NOT disenchant blind.
- `Nova, beacon help` / `use beacon` — a beacon needs a pyramid of iron, gold, diamond, emerald, or netherite blocks underneath, and an ingot/gem to activate; it does NOT build a pyramid blind.
- `Nova, conduit help` / `use conduit` — a conduit needs a ring of prismarine blocks in water, giving water breathing and night vision underwater nearby; it does NOT build the ring blind.
- `Nova, shulker help` / `open shulker` — if it carries a shulker box, says to place, open, and move items live step by step, not blind.
- `Nova, bundle help` / `use bundle` / `pack bundle` — if it carries a bundle, says bundles hold small stacks, right-click to put items in and take the last one out, and asks live what to pack.
- `Nova, map help` / `make map` / `cartography help` — if it carries paper, a compass, or a map, says a map needs paper and a compass at a cartography table, or paper alone for an empty map, live step by step.
- `Nova, banner help` / `make banner` / `use loom` — if it carries a banner, says a pattern needs a banner, dye, and a loom, and a pattern choice, live, not dyeing blind.
- `Nova, play music` / `play disc` / `jukebox help` — if a jukebox is nearby and it carries a music disc, equips the disc and activates the jukebox, best effort; otherwise says which is missing.
- `Nova, note block help` / `use note block` — activates the nearest note block, as in round 4 for buttons/levers/trapdoors.
- `Nova, use totem` / `equip totem` — equips a totem of undying to the off-hand if carried.
- `Nova, use spyglass` / `equip spyglass` — equips a spyglass to the hand if carried.
- `Nova, use compass` / `compass help` — a compass points to world spawn; reports the bot's known spawn position, and says `go to spawn` to walk there.
- `Nova, set spawn` — tries to activate a nearby bed to set spawn, best effort; sleeping also sets spawn in the Overworld.
- `Nova, enchant help` — updated, in detail: enchanting needs a table, lapis lazuli, and XP, and a choice of one of three enchantments shown; it will NOT spend XP blind. Say `enchantments` to see gear it already has.

### Categories searched in round 6
Nether/End safety, taming, breeding, feeding, boat/minecart riding, elytra, ladder, crawling, brewing, anvil, grindstone, beacon, conduit, shulker, bundle, map/cartography, banner/loom, music/jukebox/note block, totem, spyglass, compass, set spawn.

### Categories STILL not covered after round 6 — training continues
- Portals, blaze rods, ender pearl throwing, wither/warden boss fights, ocean monuments, trial chambers, structure-specific combat — recognised and warned about only, not fought or built blind.
- Full horse/donkey/mule riding with saddle/chest after taming, in depth, and animal breeding to a verified baby — attempted as one feed only, second animal and baby not claimed.
- Reliable ladder climbing, crawling, elytra flight — help only, not reliable automation.
- Brewing a specific potion end-to-end, anvil combining end-to-end, grindstone disenchanting end-to-end, beacon pyramid building, conduit ring building, shulker inventory moving, bundle packing end-to-end, map making end-to-end, banner patterning end-to-end — help/check only, not completed blind.
- Inventory sorting, going to a named biome/village/structure without seed/map data, designing redstone circuits, piston machines, or a full house, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-5, not "not yet searched".
- The parent agent's separate work in progress at the time of round 6: Falix Connect AI / MCP setup for server management, and the bot's TCP join problem (EPIPE/ECONNRESET from this VM) — those are NOT fixed by bot code, and round 6 does not claim otherwise.

### Round 6 status, code only
- `node --check bot.js` — SYNTAX_OK, 2,702 lines (was 2,533).
- No bot process was started, stopped, or restarted in round 6. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-6 code, still trying to join Falix as Moon asked, until successful. Round 6 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: dimension report in each dimension, tame/breed/feed for each animal above, boat/minecart get in and get out, wear elytra (no blind flight), ladder, brew/anvil/grindstone/beacon/conduit help and nearby-block checks, shulker/bundle/map/banner checks, play disc, totem, spyglass, compass, set spawn, plus all outstanding round 1-5 tests.

## Round 7 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there
is not a single Minecraft skill the bot does not know. This round
does NOT claim that end goal is reached. It picks up the
STILL-not-covered list from round 6, in verified form where a
result can actually be checked, and as warning/help where a blind
attempt would be risky or dishonest.

### Verified breeding — a baby is only claimed if it is counted
- `Nova, breed verified cow` / `breed two sheep` / `verify baby pig` — feeds two adults close together (wheat, carrots, seeds, golden apple/carrot, bone/meat, cod/salmon, sweet berries, bamboo, flowers, as applicable), waits, then counts again. A baby is only claimed if the count goes up or a smaller animal (height under 75% of adult height) appears nearby. Otherwise it says plainly: fed two, no verified baby yet, check live, it may need more time or the adults may be too far apart.
- `Nova, breed check` / `baby check` — explains the verified-baby rule above.

### Riding after taming — saddle, chest, mount, dismount, verified
- `Nova, saddle horse` / `saddle donkey` / `saddle mule` — walks to the animal, tries to put a saddle on with a saddle in hand, and says plainly that a saddle alone cannot be verified from mineflayer, so it is not claimed as worked; say "mount horse" next.
- `Nova, put chest on donkey` / `put chest on mule` — same, chest only, horses do not take chests.
- `Nova, mount horse` / `mount donkey` / `mount mule` / `ride horse` — walks to the animal, activates it, waits, then checks `bot.vehicle`. Only if the vehicle is that animal does it say "Verified riding!" Otherwise it says it is not riding, it may not be tamed yet, tame it first live.
- `Nova, dismount` — already existed, now also verified: reports verified dismounted if `bot.vehicle` is empty afterwards, otherwise says it is still riding something.
- `Nova, ride verified` — explains the saddle, chest, mount, dismount steps above.

### Brewing, anvil, grindstone — end-to-end only where the output is checked
- `Nova, brew verified` / `brew awkward` / `make awkward potion` — finds a brewing stand, checks for a water bottle, nether wart, and blaze powder, puts them in slots 0, 3, and 4, waits about 20 seconds, then checks the output slot and inventory. Only if a water bottle changed to an awkward potion does it say "Verified awkward potion!" Otherwise it says brewing did not verify, check the stand live. Specific potions (for example healing) need a second stage live, after awkward: say "brew healing" and it explains that, instead of claiming a finished potion blind.
- `Nova, anvil combine diamond sword and book` / `combine <item1> and <item2>` — finds an anvil, uses mineflayer's `openAnvil` + `combine`, reports XP before and after and inventory count, and tells Moon to say "enchantments" to check the combined item live. If combine throws, it says it failed and is not claimed.
- `Nova, grindstone disenchant <item>` / `disenchant <item>` — finds a grindstone, puts the item in slot 0, checks for an output in slot 2, takes it back, and says to check "enchantments" live to confirm the enchantments are gone. If no output appears, it does not claim a disenchant.
- `Nova, anvil combine verified` — explains the combine command above.

### Beacon, conduit, shulker, bundle, map, loom, cartography, smithing, stonecutter
- `Nova, beacon check` / `beacon pyramid check` / `beacon level` — scans the pyramid layers below a beacon, counts iron, gold, diamond, emerald, and netherite blocks per layer, and reports the verified level (0 to 4) and which layer is missing. It does NOT build a pyramid blind.
- `Nova, conduit check` / `conduit ring check` — counts prismarine, prismarine bricks, dark prismarine, and sea lantern blocks in the 5 by 5 by 5 area around a conduit, and water blocks, and says a full ring needs 16 prismarine blocks in a frame. It does NOT build the ring blind.
- `Nova, shulker move <item>` / `put <item> in shulker` — places a carried shulker box on safe ground, opens it, moves one named item in, closes it, reopens it, and only if that item is present on reopening does it say "Verified shulker move!" It leaves the box placed, and says to break it live to pick it back up, it does not break it blind.
- `Nova, shulker check` / `shulker contents` — reports a carried shulker box and its contents data if readable, otherwise says it cannot be read reliably, open it live.
- `Nova, bundle check` / `bundle contents` — reports a carried bundle and its contents data if readable, otherwise says to pack it live step by step, it does not pack blind.
- `Nova, map make verified` / `make filled map` — if it has an empty map, equips and activates it, waits, and only if a filled map appears in inventory does it say "Verified filled map!" Otherwise it says it did not verify.
- `Nova, loom verified` / `loom pattern` — puts a banner in slot 0 and a dye in slot 1 of a nearby loom, checks for an output in slot 3, takes it, and reports the output name, or says no output appeared.
- `Nova, cartography verified` / `zoom map` / `copy map` — puts a map in slot 0 and paper in slot 1 of a nearby cartography table, checks for an output in slot 2, takes it, and reports it, or says no output appeared.
- `Nova, smithing upgrade` / `upgrade to netherite` — puts a netherite upgrade template in slot 0, a diamond item in slot 1, and a netherite ingot in slot 2 of a nearby smithing table, checks for an output in slot 3, takes it, and reports it, or says no output appeared.
- `Nova, stonecutter check` / `use stonecutter` — check and help only: reports a stonecutter nearby, and says cutting needs a stone block and a cut choice live, it does not cut blind.

### Portals, blaze, pearls, bosses, monuments, trials, structures — recognition and warning, not blind fights
- `Nova, portal check` / `check portal` / `portal safety` — counts obsidian and portal blocks nearby, reports whether a portal looks active or just a frame, and says it will not build, light, or enter a portal blind.
- `Nova, blaze check` / `blaze rod check` — reports a blaze nearby or not, and whether it has a blaze rod, and says blaze rods drop from blazes, not every time, so it will not claim one blind.
- `Nova, pearl check` / `ender pearl help` — reports an ender pearl in inventory or not, and says it will NOT throw a pearl blind, because it does not know where it will land and falling can hurt. `Nova, throw pearl` is refused the same way, with a live-step offer.
- `Nova, wither check` / `warden check` / `boss check` / `structure check` — scans for Wither, Warden, Guardian, Elder Guardian, Blaze, Breeze, and Ender Dragon within 32 blocks, and for trial spawner, spawner, vault, ominous vault, sculk shrieker, and end portal frame blocks within 16, reports distances and blocks, and says it will not fight a boss or start a trial blind, it can retreat.
- `Nova, ocean monument check` / `guardian check` — reports guardians nearby or not, warns guardians shoot lasers and elder guardians give mining fatigue, and says to bring milk, and it will not fight a monument blind.
- `Nova, trial chamber check` / `trial spawner check` — reports a trial spawner or vault nearby, and a breeze nearby, and says trial chambers spawn waves and give trial keys, it will not start a trial blind.

### Other verified or checked skills added in round 7
- `Nova, check trades` / `villager trades` — finds a villager nearby, opens its trade window if available, reports how many trades are available, and says it is not trading blind, tell Moon live which trade number to use.
- `Nova, bone meal crop` / `grow crop` / `use bone meal` — finds a crop nearby, reads its growth age, uses bone meal on it, reads the age again, and only if the age increased does it say "Verified crop growth: age X to Y". Otherwise it says it did not verify, it may already be fully grown.
- `Nova, compost check` / `use composter` — reports a composter nearby and its level, and says to put plant items in live to make bone meal, it will not compost Moon's items blind.
- `Nova, lectern check` / `use lectern` — reports a lectern nearby, and says to put a written book on it live, it will not place Moon's book blind.
- `Nova, dye armour` / `dye leather` — help only: dyeing leather armour needs a cauldron with water and a dye, tell Moon live which piece and dye, it does not dye blind.
- `Nova, campfire check` / `use campfire` — reports a campfire nearby and raw food in inventory or not, and says campfire cooking takes time and food pops out, tell Moon live what to cook, it does not cook blind.

### Categories searched in round 7
Verified breeding, riding after taming (saddle, chest, mount, dismount), brewing (awkward, verified), anvil combining (verified), grindstone disenchanting (verified), beacon pyramid checking, conduit ring checking, shulker moving and checking, bundle checking, map making (verified), loom patterning (verified), cartography (verified), smithing upgrading (verified), stonecutter checking, portal checking, blaze checking, ender pearl safety, wither/warden/boss/structure checking, ocean monument checking, trial chamber checking, villager trade checking, bone meal crop growth (verified), composter checking, lectern checking, leather dye help, campfire checking.

### Categories STILL not covered after round 7 — training continues
- Full taming verification in mineflayer: a horse or wolf's tamed flag is not reliably readable from the bot, so taming itself is still step-by-step live, riding is verified only after mounting, and a saddle or chest alone is not claimed as verified.
- Brewing a specific potion end-to-end (second stage after awkward), and brewing with multiple bottles at once — first stage (awkward) is verified, later stages are live steps, not claimed blind.
- Window-based crafting where mineflayer's window slot layout differs by version or mod: loom, cartography, smithing, grindstone, and brewing transfers are best-effort and must be checked live; if a transfer fails in game, the bot says so and does not claim success.
- Reliable ladder climbing, crawling through 1-block gaps, elytra flight, boat and minecart steering — help or best-effort only, as in round 6, not reliable automation.
- Going to a named biome, village, or structure without seed or map data, designing redstone circuits, piston machines, or a full house, inventory sorting — not covered, as in rounds 1-6, and would need Moon's plan live.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-6, not "not yet searched".
- The parent agent's separate work in progress: Falix Connect AI / MCP setup for server management, and the bot's TCP join problem (EPIPE/ECONNRESET from this VM) — those are NOT fixed by bot code, and round 7 does not claim otherwise.

### Round 7 status, code only
- `node --check bot.js` — SYNTAX_OK, 3,018 lines (was 2,702).
- No bot process was started, stopped, or restarted in round 7. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-7 code, still trying to join Falix as Moon asked, until successful, still getting ECONNRESET/EPIPE from this VM at last log check. Round 7 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: breed verified for each animal (does the count go up, does a smaller animal appear, does it refuse to claim when only one adult is near), saddle then mount then dismount (does vehicle check verify riding, does dismount verify empty), brew verified (does a water bottle become an awkward potion, does it fail cleanly without wart or powder), anvil combine verified (does XP change, is the combined item in inventory, does it fail cleanly without both items), grindstone verified (does output appear, are enchantments gone on "enchantments"), beacon check (does it report the correct pyramid level), conduit check (does it count prismarine correctly), shulker move verified (is the item present on reopening, is the box left placed), bundle and shulker check (is contents data readable or honestly unknown), map verified, loom verified, cartography verified, smithing verified (does output appear and get taken, or fail cleanly), portal check, blaze check, pearl refusal, boss/structure/monument/trial checks, check trades, bone meal crop (does age increase), compost, lectern, dye help, campfire check, plus all outstanding round 1-6 tests.

## Round 8 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 7, in verified form where a result can actually be checked, and as help/planning where a blind attempt would be risky or dishonest.

### Brewing second stage, and multiple bottles
- `Nova, brew healing` / `brew strength` / `brew swiftness` / `brew fire resistance` / `brew night vision` / `brew water breathing` / `brew regeneration` / `brew poison` / `brew leaping` / `brew slow falling` — second stage from an awkward potion: glistering melon slice, blaze powder, sugar, magma cream, golden carrot, pufferfish, ghast tear, spider eye, rabbit foot, or phantom membrane, in slot 3, blaze powder fuel in slot 4, up to 3 awkward bottles in slots 0-2, wait about 20 seconds, then check window slots and inventory. Only if a result matching that potion appears does it say "Verified second-stage brew!" Otherwise it says it did not verify, check the stand live.
- `Nova, brew multiple awkward` / `brew 3 awkward` — up to 3 water bottles at once, same 20-second check, counts how many awkward potions appear in the window, does not claim bottles that did not change.
- `Nova, brew second stage help` — lists the second-stage ingredients above.

### Window-based crafting, with slot-layout checks and clean failures
- `Nova, loom layout` / `loom layout check` — puts banner in slot 0 and dye in slot 1, reports the full window slot layout, closes the window without taking an output blind, and says items should return to inventory, check live.
- `Nova, loom verified layout` — same layout check, plus takes the output in slot 3 only if it appears, and verifies it is in inventory afterwards, otherwise says clean failure, with the layout in the message.
- `Nova, cartography layout` / `cartography verified layout` — map in slot 0, paper in slot 1, output in slot 2, same layout reporting and clean-failure rule.
- `Nova, smithing layout` — template in slot 0, diamond item in slot 1, netherite ingot in slot 2, layout only, no blind take.
- `Nova, grindstone layout` — enchanted item in slot 0, layout only, no blind disenchant.
- `Nova, stonecutter verified <cut>` / `stonecutter cuts` — puts a stone block in slot 0, lists output slots, takes the named cut only if that output slot exists, verifies it in inventory, otherwise says it does not see that cut and does not cut blind. Without a cut name it lists available cuts.
- `Nova, smelt verified <item>` — furnace, blast furnace, or smoker nearby, input in slot 0, coal/charcoal/planks fuel in slot 1, waits about 15 seconds, takes the output in slot 2 only if it appears, verifies cooked_beef, cooked_porkchop, iron_ingot, glass, stone, brick, and similar expected outputs in inventory, otherwise says no output yet or not verified, check live.
- `Nova, enchant verified <item>` / `enchant options <item>` / `enchant verified <item> 1|2|3` — enchanting table nearby, item in slot 0, lapis in slot 1, reports options as level 1, 2, 3. Without a choice it does NOT spend XP blind. With a choice it checks XP level first, uses mineflayer's enchant(choice), takes the target item back, and only if enchantments changed does it say "Verified enchant!" Otherwise it says it cannot verify new enchantments yet, check "enchantments" live.

### Full taming verification, leading, sitting, feeding pets
- `Nova, tame verified <animal>` — wolf, dog, cat, parrot, horse, donkey, mule: walks to the animal, feeds the right food up to 3 times where feeding is the taming action, then moves 8 blocks away and waits 5 seconds. Only if the animal moved toward the bot and is now within about 8 blocks, acting like a following pet, does it say tame verification looks good, check hearts live to be sure. Otherwise it says it did not verify following, it is not claiming tamed, check hearts live. For animals where feeding is not taming, it gives the live guide first, then does the same follow check.
- `Nova, lead <animal>` — lead in hand, walks to the animal, activates it, moves 6 blocks away, and only if it is within about 8 blocks afterwards does it say lead check looks good, otherwise says it did not verify, check live if the lead attached.
- `Nova, sit <animal>` / `stand <animal>` — walks to the animal, activates it to toggle sit/stand, moves 8 blocks away, and only if a sitting pet stayed within about 2 blocks, or a standing pet moved at least 2 blocks, does it say sit/stand check looks good. Otherwise it says it did not verify, it may not be tamed yet, check live.

### Reliable ladder, crawling, elytra, boat and minecart steering, only where safe and verifiable
- `Nova, ladder climb verified` — walks to a ladder, records Y, holds forward and jump for 4 seconds, and only if Y increased by at least 1 does it say "Verified ladder climb: Y X to Y". Otherwise it says it did not verify, it may be stuck, tell Moon live.
- `Nova, crawl check verified` / `crawl through` — checks for a 1-block-high gap nearby (air at feet and head, solid above), reports its coordinates if found, otherwise says it does not see a gap. "Crawl through" tries sneaking forward for 3 seconds and reports distance moved, and says check live if it is on the other side, it does not claim a clean crawl unless Moon confirms it, and it will not trap itself blind.
- `Nova, glide verified` / `elytra glide verified` — refuses if no elytra, if it is less than 12 blocks above ground, or if the ground below is not safe. Otherwise it jumps, holds jump then forward for 3 seconds, and reports Y before/after and vertical speed: only if descent looks slowed (vertical speed above -5) does it say glide check looks slowed, otherwise it says glide did not verify slowed descent, do not repeat blind.
- `Nova, steer boat` / `drive boat` — gets in a boat if nearby, holds forward for 3 seconds, gets out, and only if it moved at least 2 blocks does it say "Verified boat steering". Otherwise it says it did not verify movement, check live.
- `Nova, steer minecart` / `drive minecart` — same for a minecart, with a 1-block movement threshold, otherwise says it may not be on a powered rail, check live.

### Other verified or checked skills added in round 8
- `Nova, composter verified <item>` — reads composter level before, puts the item in, reads level again, and only if level increased does it say "Verified compost: level X to Y". Otherwise it says it did not verify, it may be full or that item may not compost.
- `Nova, campfire cook verified <food>` / `campfire cook <food>` — raw beef, porkchop, chicken, mutton, rabbit, cod, salmon, potato, or kelp on a nearby campfire, waits about 32 seconds, and only if the cooked version appears in inventory or as a dropped item nearby does it say "Verified campfire cook". Otherwise it says it did not verify yet, it may need more time.
- `Nova, dye armour verified <piece> <dye>` / `dye armor verified <piece> <dye>` — leather armour only, cauldron nearby, dye in hand, activates the cauldron, compares armour NBT colour data before/after, and only if it changed does it say "Verified dye". Otherwise it says it did not verify, cauldron may need water, or the step needs to be done live with the armour in hand.
- `Nova, shear verified` — walks to a sheep, shears in hand, counts wool before/after, and only if wool increased does it say "Verified shear: wool X to Y". Otherwise it says that sheep may already be sheared.
- `Nova, milk verified` — walks to a cow or mooshroom, empty bucket in hand, counts milk buckets before/after, and only if a milk bucket appeared does it say "Verified milk". Otherwise it says it did not verify.
- `Nova, fish verified` — fishing rod in hand, casts with mineflayer's fish(), waits up to 60 seconds, counts cod, salmon, tropical fish, and pufferfish before/after, and only if that count increased does it say "Verified fish". Otherwise it says timed out or no bite counted, it is not claiming a fish.
- `Nova, trade verified <n>` / `trade verified` — finds a villager, opens its trade window, lists how many trades exist without a number, and with a number checks that trade exists and is not disabled, tries it once, and only if output count increased does it say "Verified trade N". Otherwise it says it failed or did not verify, check live, it does not trade blind repeatedly.
- `Nova, plan redstone` / `plan piston` / `plan house` / `plan biome` / `plan village` / `plan structure` / `plan help` — planning steps and materials, live with Moon, not blind automation: redstone needs a stated purpose, materials, and a test area first; piston needs a stated moving part and an empty test; a full house needs size, style, rooms, and stage-by-stage checks; a biome, village, or structure needs a seed, a map, or an explorer map, a way home, food, armour, torches, and a danger check first, otherwise it says it cannot find it blind.

### Categories searched in round 8
Brewing second stage and multiple bottles, window slot-layout verification for loom, cartography, smithing, grindstone, stonecutter, smelting, enchanting, composter level verification, campfire cooking verification, leather dye verification, shear and milk verification, fishing verification, villager trade verification, full taming verification by following, leading pets, sitting/standing pets, ladder climbing verification, crawling verification, elytra glide safety and verification, boat and minecart steering verification, and planning help for redstone, piston, house, biome, village, and structure.

### Categories STILL not covered after round 8 — training continues
- Taming where mineflayer cannot read a tamed flag directly: follow-check is used instead, hearts must still be confirmed live, and saddle/chest alone are still not claimed as verified.
- Brewing with splash, lingering, extended, or upgraded potions (redstone, glowstone, gunpowder, dragon's breath stages): second stage from awkward is verified, later stages are still live steps, not claimed blind.
- Window work where a server or version changes slot layout: layout is now reported in the message, so a mismatch is visible live, but a new layout still needs Moon to confirm it in game.
- Elytra flight as reliable travel, ladder climbing in all ladder shapes, crawling in all trapdoor/piston setups, boat steering in all water shapes, minecart steering without powered rails: verified in the simple case only, otherwise help, not reliable automation.
- Going to a named biome, village, or structure without seed or map data, designing redstone circuits, piston machines, or a full house end-to-end: planning help only, as in rounds 1-7, not blind automation, unless a result can be verified safely.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-7, not "not yet searched".

### Round 8 status, code only
- `node --check bot.js` — SYNTAX_OK, 3,459 lines (was 3,018).
- No bot process was started, stopped, or restarted in round 8. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-8 code, still trying to join Falix as Moon asked, until successful, still getting ECONNRESET/EPIPE from this VM at last log check. Round 8 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: brew second stage for each potion (does the window output match, does it fail cleanly without awkward, ingredient, or powder), brew multiple awkward (does it count 1, 2, or 3 correctly), loom/cartography/smithing/grindstone layout (does the reported layout match the real window, does a failed transfer say so cleanly), smelt verified (does output appear and get taken, does it fail without fuel), enchant verified (does it list options, refuse without XP, and only claim if enchantments changed), stonecutter verified (does it list cuts, take only the named cut, verify inventory), composter verified (does level increase), campfire cook verified (does cooked food appear after about 32 seconds), dye armour verified (does colour data change, or honestly fail), shear verified, milk verified, fish verified (does fish count increase, or time out honestly), trade verified (does output increase, or fail cleanly), tame verified (does a tamed pet follow, does a wild animal honestly fail), lead, sit, stand (does following/staying verify), ladder climb verified (does Y increase), crawl check/through (does it report a gap, does it move, does it avoid trapping), glide verified (does it refuse below 12 blocks, does descent look slowed), steer boat/minecart (does distance verify), plan redstone/piston/house/biome/village/structure (are steps and materials sensible, does it refuse blind building/travel), plus all outstanding round 1-7 tests.

## Round 9 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 8, where a result can be verified, and keeps help/planning where it cannot.

### Brewing later stages — splash, lingering, extended, upgraded, verified
- `Nova, brew extended` — redstone added to a potion, longer duration. Verified only if NBT changes in a way the bot can read; otherwise it says check duration live, it does not claim a duration change blind.
- `Nova, brew upgraded` — glowstone dust added to a potion, stronger effect. Same NBT-change verification rule as extended.
- `Nova, brew splash` — gunpowder added to a potion, verified only if the window output becomes a splash_potion.
- `Nova, brew lingering` — dragon's breath added to a splash potion, verified only if the window output becomes a lingering_potion.
- `Nova, brew stage help` — lists the four stages above, and that they start from a potion, not from awkward.

### Window layout mismatch — report, ask Moon, do not claim on mismatch
- `Nova, window layout loom` / `window layout cartography` / `window layout smithing` / `window layout grindstone` / `window layout brewing` / `window layout furnace` / `window layout enchanting` / `window layout anvil` / `window layout stonecutter` — opens that block, reports the full window slot layout, closes it without taking an output blind, and says: if this does not match the layout I expected, tell me live what slot the output is in, and I will use your confirmed layout, not my guessed one.
- `Nova, window layout help` / `layout mismatch help` — explains the mismatch rule above.

### Travel in all shapes — simple case verified, complex cases help
- `Nova, ladder shapes` — counts ladder columns nearby and reports each column height. A straight vertical column is the simple, verified case; a ladder in water, at a corner, or with a trapdoor at the top is complex, live step by step.
- `Nova, crawl shapes` — reports trapdoor gaps, piston gaps, plain 1-block gaps, and water gaps nearby. Trapdoor is the best simple case; piston timing and swimming crawls are live-only.
- `Nova, crawl trapdoor verified` — only if a trapdoor is nearby, otherwise it says it does not see one; then it tries the existing crawl-through check, it does not claim a clean crawl unless Moon confirms it.
- `Nova, crawl piston help` / `crawl swimming help` — piston timing and swimming crawl are live-only, they can trap the bot.
- `Nova, boat shapes` — counts water and ice blocks nearby. Open water is the simple, verified case; narrow river, waterfall, and ice are complex, live.
- `Nova, boat open water verified` — the existing boat steering check, for open water only.
- `Nova, boat river help` / `boat ice help` / `boat waterfall help` — complex boat shapes, live step by step.
- `Nova, minecart powered check` / `minecart power check` — counts powered, plain, detector, and activator rails nearby. With powered rails, steering is the simple case; with no powered rails, it says so plainly.
- `Nova, minecart no power help` — a minecart without powered rails will not travel far on its own, it needs a slope for gravity, or a live push, or powered rails added live; steering without power is not claimed.
- `Nova, elytra travel verified` / `glide travel verified` / `fly forward verified` — refuses below 12 blocks above ground, otherwise jumps, holds forward for 3 seconds, and only if it moves at least 5 blocks forward with slowed descent does it say verified short elytra travel. Long travel still needs fireworks and a live plan.
- `Nova, elytra rockets help` / `elytra flight help` — reliable long elytra travel needs fireworks rockets and a safe landing spot; a short glide without rockets only goes a few blocks and falls.

### Named places, redstone, piston, house — staged, WITH seed, map, or coordinates
- `Nova, plan biome with seed` / `plan village with seed` / `plan structure with seed` / `plan redstone with seed` / `plan piston with seed` / `plan house with seed` — staged plans, live with Moon: Stage 1, Moon gives a seed, map, or coordinates (the bot cannot compute a biome, village, or structure from a seed alone in mineflayer); Stage 2, record home; Stage 3, walk to Moon's coordinates and verify arrival; Stage 4, report blocks and mobs actually seen, and only then say if they match. Redstone and piston and house stages are: purpose, materials, test area, one component at a time checked live, test empty, then with Moon watching.
- `Nova, go to biome at 100 64 -200` / `go to village at X Y Z` / `go to structure at X Y Z` — walks to those exact coordinates, verifies arrival by distance under 5 blocks, then reports markers actually seen nearby (villager, iron golem, bell, lodestone, trial spawner, vault, spawner, end portal frame, obsidian). It does NOT claim this IS a biome, village, or structure unless those markers match; Moon confirms live what he sees.
- `Nova, named place help` / `travel with seed help` — explains the seed/map/coordinates rule above.

### Other skills found in round 9, systematic search, safe only
- `Nova, check weather` / `is it raining` — reports raining or not, as the bot sees it; thunder is checked live.
- `Nova, check time` / `game time` — reports game time of day if readable, day 0-12000, night 13000-23000, otherwise says it cannot read it.
- `Nova, count mobs` / `mobs nearby` — counts mob entities the bot can see right now, and says to use scan for names and distances.
- `Nova, follow at distance` — points to the verified follow distances: follow close is 2, follow from farther is 5; it does not guess another distance blind.

### Categories searched in round 9
Brewing splash, lingering, extended, and upgraded stages; window layout reporting and mismatch handling; ladder shapes; crawl shapes; boat shapes; minecart power and no-power cases; elytra travel and rockets; staged named-place travel with seed/map/coordinates; staged redstone, piston, and house building; weather, game time, and mob counting.

### Categories STILL not covered after round 9 — training continues
- Brewing where NBT cannot be read reliably: extended and upgraded duration/strength must still be confirmed live, even though name changes for splash and lingering are verifiable.
- Window layouts on a server or version the bot has never seen: layout is reported and Moon must confirm it live; a new layout is not auto-learned blind.
- Elytra flight as reliable long-distance travel without rockets, ladder climbing in water/corner/trapdoor shapes, crawling in piston/swimming setups, boat steering in rivers/ice/waterfalls, minecart steering without powered rails or a slope: simple cases verified, complex cases help only, not reliable automation.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-8, not "not yet searched".

### Round 9 status, code only
- `node --check bot.js` — SYNTAX_OK, 3,651 lines (was 3,459).
- No bot process was started, stopped, or restarted in round 9. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-9 code, still trying to join Falix as Moon asked, until successful, still getting ECONNRESET/EPIPE from this VM at last log check. Round 9 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: brew extended, upgraded, splash, lingering (does splash/lingering name change verify, does extended/upgraded NBT change verify or honestly say check live, does it fail cleanly without a potion, ingredient, or powder), window layout for each block (does the reported layout match the real window, does it ask Moon on mismatch and not claim success), ladder shapes, crawl shapes, boat shapes, minecart power check (do counts match, does no-power honestly refuse steering), elytra travel verified (does it refuse below 12 blocks, does horizontal distance verify, does it refuse long travel without rockets), plan with seed for biome/village/structure/redstone/piston/house (are stages sensible, does it refuse without seed/map/coordinates), go to biome/village/structure at coordinates (does arrival verify by distance, does it report markers honestly, does it refuse to claim a place without markers), check weather, game time, count mobs, plus all outstanding round 1-8 tests.

## Round 10 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 9, only where a result can actually be verified, and only in small, stop-after-each-step moves where a blind attempt would be risky or dishonest.

### Brewing where NBT cannot be read reliably — field-by-field check, not a blind claim
- `Nova, brew extended check` / `brew upgraded check` — same brewing-stand steps as round 9 (potion in slots 0-2, redstone or glowstone dust in slot 3, blaze powder fuel in slot 4, about 20 seconds), but it captures the readable potion fields before and after: name, count, NBT, components/componentMap if mineflayer exposes them, and metadata. It verifies ONLY on a readable signal it can name: a `long_` potion id in the after-fields for extended, or a `strong_` potion id for upgraded, which are the game's extended and upgraded forms. If the fields changed but no `long_` or `strong_` id is readable, it reports both field sets and says it is NOT claiming duration or strength, check the tooltip live. If no field changed at all, it says so plainly and says check the tooltip live, or drink it live with Moon watching, to confirm. It never invents a duration or strength number.
- `Nova, potion details` / `check potion held` / `held potion details` — reports the held item's readable fields (name, count, NBT, components if exposed) and says compare it live with the inventory tooltip, which is the honest live check for effect, long, or strong form.
- `Nova, check effects` / `effects check` — reports potion effects readable on the bot (with duration if mineflayer exposes it), or says none are readable, and says tell Moon live if that does not match what he sees. This is a read-only check, it does not drink a potion blind.

### Window layouts — confirmed live, session-only, never auto-learned blind
- `Nova, window layout loom with confirmed` / `window layout cartography with confirmed` / `window layout smithing with confirmed` / `window layout grindstone with confirmed` / `window layout brewing with confirmed` / `window layout furnace with confirmed` / `window layout enchanting with confirmed` / `window layout anvil with confirmed` / `window layout stonecutter with confirmed` — opens that block, reports the full window slot layout, checks the session-confirmed output slot specifically, reports what that slot holds or that it is empty, and takes nothing. If the layout does not match what was confirmed, it says so and does not claim success.
- `Nova, confirm window layout <block> output <n>` — records Moon's live confirmation, for this session only. Example: `Nova, confirm window layout loom output 3`. It is NOT saved to a file, and it is NOT learned from a guess, only from Moon saying the slot live.
- `Nova, confirmed window layouts` / `window layouts confirmed` — lists the session-only confirmed layouts, or says none are confirmed yet.
- `Nova, forget window layout <block>` — clears that session confirmation, so a stale layout cannot be reused until Moon confirms it live again.
- `Nova, round 10 help` — lists the round 10 commands above.

### Complex travel — small verified steps, stop after each step, live only
- `Nova, ladder water check` — counts ladder blocks nearby and how many have water next to or above them. A ladder in water is a complex climb, live step by step only.
- `Nova, ladder corner check` — lists ladder columns by x,z. More than one column close together can mean a corner or a turn, live step by step only; one column is the straight simple case.
- `Nova, ladder top check` — for each ladder column, reports the top Y and the two blocks above it, and whether there looks like room to exit. A trapdoor or solid block above needs a live step.
- `Nova, ladder climb step` / `climb ladder step` — holds forward and jump for 2 seconds only, then stops, and reports Y before and after. Moon must say so live before the next step; it does not keep climbing blind.
- `Nova, crawl swimming check` — counts water gaps versus dry gaps nearby. A swimming crawl can put the bot's head underwater, so Moon's air rule applies (swim up before 10 seconds without Respiration), and this is live only.
- `Nova, crawl piston step` / `piston crawl step` — refuses to crawl blind on piston timing. It says Moon activates the piston live, then it sneaks forward for 2 seconds, stops, and reports distance moved and the block above it, and asks Moon live if it is trapped.
- `Nova, crawl step` — sneaks forward for 2 seconds only, stops, and reports distance moved, with no clean-crawl claim unless Moon confirms it live.
- `Nova, boat river check` — counts water and ice blocks nearby and the height range of water. Water at different heights can mean a slope or a waterfall, and it says Moon must tell it the river width live, because a block count alone cannot measure width.
- `Nova, boat ice check` — counts ice blocks nearby. Boats on ice are fast and slippery, so this is live step by step with `boat step` only.
- `Nova, boat step` — gets in a boat if nearby, holds forward for 2 seconds, gets out, and reports distance moved, then stops for Moon's next live instruction.
- `Nova, minecart slope check` — counts rails, powered rails, and the height range of rails nearby. A slope means gravity could move a minecart; flat rails with no powered rails will not move one on their own.
- `Nova, minecart push step` / `push minecart step` — walks to a nearby minecart, looks at it, walks forward into it for 2 seconds, stops, and reports how far the minecart itself moved. It says the push verified only if the minecart moved at least 0.5 blocks; otherwise it says it needs a slope, powered rails, or a harder live push, and it does not claim steering without power.
- `Nova, elytra rockets check` — counts firework rockets in inventory, and says long travel still needs a safe landing spot, checked with `elytra landing check`.
- `Nova, elytra landing check` — scans up to 30 blocks below, reports the first solid block and its distance, and refuses a lava landing or a no-ground (possible void) landing. Water is reported as softer but wet; solid ground is reported as check live for height and obstacles.
- `Nova, elytra rocket step` — live only, and refused below 12 blocks above ground, with no solid ground below, or with lava below. Otherwise it equips the elytra, holds one firework rocket, jumps, tries to use the rocket once, glides forward for 3 seconds, then stops, and reports horizontal distance, Y change, and vertical speed. It says a boosted step only if it moved at least 10 blocks forward with slowed descent; otherwise it says the boost did not verify, and it never claims reliable long-distance flight from one step.
- `Nova, walk step` / `step forward` — walks forward for 2 seconds only, stops, and reports distance moved and current coordinates, for step-by-step travel in any complex shape.

### Other safe, read-only skills added in round 10, systematic search
- `Nova, check xp` / `xp check` / `xp level` — reports the bot's XP level and progress to the next level if readable, so Moon can check before spending XP on enchanting or anvil work.
- `Nova, check durability` / `durability check` — reports durability used for the held item and for up to 5 other damaged items, if mineflayer exposes durability; otherwise it says durability is not readable here and the inventory tooltip is the live check.
- `Nova, check light` / `light check` — reports light level at the bot's position if readable, and whether that is dark enough for hostile mobs to spawn (level 7 or below); otherwise it says check F3 live.
- `Nova, check fall height` / `fall height check` — reports blocks above solid ground below, and warns if a fall from there (4 blocks or more) could hurt, and refuses to jump blind if no ground is found within 30 blocks.
- `Nova, check free slots` / `inventory space check` — counts empty inventory slots it can read, and warns that gathering will fail if the inventory looks full.
- `Nova, check biome` / `biome check` — help only, on purpose: it says mineflayer does not give a reliable biome name here, so it will not guess one; Moon checks F3 live, and the bot reports blocks and mobs it actually sees with `scan`.

### Categories searched in round 10
Brewing field/NBT verification (long_ and strong_ potion ids, component fields, tooltip comparison, effect reporting); window-layout confirmation recording (session-only, live-confirmed, forgettable, mismatch-reported); ladder shapes in water, at corners, and at the top; crawl shapes in water and with pistons; boat shapes in rivers, on ice, and near waterfalls; minecart slope and push cases without powered rails; elytra rocket, landing, and boosted-step cases; and read-only status checks for XP, durability, light, fall height, free inventory slots, effects, biome, and single-step walking.

### Categories STILL not covered after round 10 — training continues
- Brewing extended/upgraded where mineflayer exposes no readable long_/strong_ id or component change: the field check reports the before/after fields honestly, but duration and strength must still be confirmed live from the tooltip or by drinking with Moon watching; no duration or strength number is claimed from data alone.
- Window layouts on a server or version the bot has never seen: a layout is now recordable from Moon's live confirmation, but only for that session, and only from that explicit confirmation; a layout is still not auto-learned blind, and a changed layout is still reported as a mismatch.
- Elytra flight as reliable long-distance travel, ladder climbing in water/corner/trapdoor-top shapes, crawling in piston/swimming setups, boat steering in rivers/ice/waterfalls, minecart steering without powered rails or a slope: simple cases and single steps are verified or reported, complex cases are help and live steps only, not reliable automation.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-9, not "not yet searched".

### Round 10 status, code only
- `node --check bot.js` — SYNTAX_OK, 4,017 lines (was 3,651).
- No bot process was started, stopped, or restarted in round 10. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-10 code, still trying to join Falix as Moon asked, until successful, still getting ECONNRESET/EPIPE from this VM at last log check. Round 10 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: brew extended check and upgraded check (does a long_ or strong_ id actually appear in the readable fields, does it report before/after fields honestly when no id is readable, does it fail cleanly without a potion, ingredient, or powder), potion details (do the reported fields match the tooltip Moon sees), check effects (does it list effects Moon expects, or honestly say none readable), confirm window layout / window layout with confirmed / forget window layout (does a live-confirmed slot get used, does a changed layout get reported as a mismatch, does forgetting clear it, does it refuse to guess a slot with no confirmation), ladder water/corner/top checks and climb step (do counts and top blocks match, does a step stop after 2 seconds and report Y), crawl swimming check, piston step, and crawl step (does a step stop, does it report movement and headroom, does it refuse blind piston/swimming crawls), boat river/ice checks and boat step (do water/ice counts and height range match, does a step stop and get out), minecart slope check and push step (do rail counts and height range match, does the minecart itself move at least 0.5 blocks on a verified push, does it refuse steering without power), elytra rockets/landing/rocket step (does it refuse below 12 blocks, over lava, or over no ground, does it use only one rocket, does it stop after 3 seconds and report distance honestly, does it refuse long-travel claims), check xp, durability, light, fall height, free slots, effects, walk step, and biome check help (do readable values match what Moon sees live, do unreadable values honestly say so instead of guessing), plus all outstanding round 1-9 tests.

## Round 11 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 10, only where a result can be verified, and only in small, stop-after-each-step moves where a blind attempt would be risky or dishonest.

### Brewing where no long_/strong_ id is readable — tooltip compare and live drink, no invented numbers
- `Nova, brew extended tooltip compare` / `brew upgraded tooltip compare` / `brew extended field diff` — uses the last brew check this session (before/after fields, stored when `brew extended check` or `brew upgraded check` runs) and reports which fields changed and which did not. If there is no last brew check, it reports the held potion fields and says run the brew check first. Either way it then asks Moon to read the potion tooltip live: effect name, whether it says Long or II, and the duration text, and it does NOT claim a duration or strength number from data alone.
- `Nova, brew tooltip help` — explains the tooltip compare steps above.
- `Nova, confirm brew extended live` / `confirm brew upgraded live` — records Moon's live tooltip confirmation, for this session only. This is Moon's live read, not a number the bot read from data, and the bot does not claim an exact duration or strength from it.
- `Nova, brew confirmations` / `list brew confirmations` — lists session-only live brew confirmations, or says none yet.
- `Nova, forget brew confirmation extended` / `forget brew confirmation upgraded` — clears that session confirmation, so it cannot be reused until Moon confirms the tooltip live again.
- `Nova, drink potion live` / `drink with moon watching` — step 1 only, it does NOT drink yet: it reports the held potion and its fields, and asks Moon to say `confirm drink potion` to drink one with Moon watching, or `cancel drink potion`. A held potion whose name looks harmful (poison, harming, slowness, weakness, instant damage) is NOT put on the normal confirm path: it warns, sets a separate harmful pending flag, and requires `confirm drink harmful potion`.
- `Nova, confirm drink potion` / `confirm drink harmful potion` — drinks one potion, stops, then reports effects it can read with `check effects`, and does not claim a duration or strength it cannot read. If no drink is pending, it says so and refuses.
- `Nova, cancel drink potion` — clears any pending drink, and the bot drinks nothing.

### Window layouts — compare, reconfirm, forget all, stale check, still never auto-learned blind
- `Nova, window layout loom compare` (also cartography, smithing, grindstone, brewing, furnace, enchanting, anvil, stonecutter, or any block name) — opens that block, reports the full window slot layout, and compares it to the session-confirmed output slot: no confirmation means "new layout, confirm live"; a confirmed slot that is now empty means "mismatch signal, reconfirm or forget"; a confirmed slot holding an output means "matches the confirmed slot having an output". It takes nothing.
- `Nova, reconfirm window layout loom output 3` — replaces the old session confirmation with Moon's new live confirmation, and says the old slot number so the change is visible. It does NOT learn a layout from a guess.
- `Nova, forget all window layouts` / `forget every window layout` — clears ALL session window-layout confirmations at once, for a fresh start after a server or version change.
- `Nova, window layout stale check` / `stale window layouts` — lists session-confirmed layouts with how many minutes ago each was confirmed this session, and says: if the server or version changed since a confirmation, that layout may be stale, reconfirm or forget all, the bot will not auto-learn a new layout blind.

### Complex travel — small verified steps, stop after each step, live only
- `Nova, ladder trapdoor top check` / `trapdoor top check` — for each ladder column, reports top Y and the two blocks above it, and flags a trapdoor at the top. A trapdoor at the top needs a live step.
- `Nova, ladder trapdoor step` — refuses if no trapdoor is above a ladder top nearby. Otherwise it holds forward and jump for 2 seconds only, stops, and reports Y before/after and the block above it now, and asks Moon live if it is trapped under the trapdoor.
- `Nova, boat waterfall check` / `waterfall check` — reports water Y range nearby. A range of 3 or more blocks can mean a slope or waterfall drop, so a boat step there is live only.
- `Nova, boat waterfall step` — refuses if the water height range nearby is 3 or more blocks. Otherwise it does one normal boat step (in, forward 2 seconds, out, report distance) and stops.
- `Nova, minecart ride step` / `ride minecart step` — refuses if there are no powered rails and no slope nearby. Otherwise it gets in a minecart, holds forward for 3 seconds, gets out, and reports distance moved, powered rail count, and slope range. It says the ride moved only if it moved at least 1 block, otherwise it says it did not verify movement and does not claim steering.
- `Nova, elytra route plan` / `elytra route plan to 100 64 -200` — staged planning only, never a blind flight: Stage 1, landing check and rockets check; Stage 2, take off from at least 12 blocks above ground with no lava below; Stage 3, one `elytra next rocket step` at a time, stopping after each, with a landing-height check each time; Stage 4, a landing check at the destination area before landing, with Moon confirming the landing spot live.
- `Nova, elytra next rocket step` / `next rocket step` — does one existing rocket step (one rocket, forward 3 seconds, stop, report distance, height, and vertical speed), then reports how many rocket steps have been attempted this session. That count is attempted steps, not verified long-distance travel.
- `Nova, elytra rockets used` / `rockets used` — reports the session attempted-rocket-step count, with the same attempted, not verified, wording.
- `Nova, crawl swimming step` / `swimming crawl step` — refuses if the head is already underwater at or past the swim-up point (limit minus 2 seconds, Moon's 10-second base plus 15 seconds per Respiration level, bubble columns excepted). Otherwise it sneaks forward for 2 seconds only, stops, reports distance moved and the air status after the step, and says swim up before the limit if the head is still underwater. It does not keep crawling underwater blind.

### Other safe, read-only skills added in round 11, systematic search
- `Nova, check hunger details` / `hunger check` / `saturation check` — food level out of 20 and saturation if readable, otherwise says saturation is not readable in mineflayer, with the sprint-needs-food-above-6 reminder.
- `Nova, check armour` / `check armor` — head, chest, legs, and feet pieces as read from inventory slots 5-8, with durability used if readable, otherwise says the inventory tooltip is the live check.
- `Nova, check block feet` / `check block below` / `check block above` — the block name at the bot's feet, one below, or two above, with coordinates, for travel and building safety checks.
- `Nova, check water depth` / `how deep is the water` — water blocks in the column where the bot is standing, with the air-rule reminder to say `air` for the air timer.
- `Nova, check redstone power` / `redstone power check` — redstone wire nearby and its power property if readable, otherwise says check live with a lamp or comparator, and says the bot will not change redstone blind.
- `Nova, check piston extended` / `piston extended check` — piston or sticky piston nearby and its extended property if readable, otherwise says check live if the piston head is out, with piston timing live only.
- `Nova, round 11 help` — lists the round 11 commands above.
- The `what can you do` / `help` text was also updated to list round 11.

### Categories searched in round 11
Brewing tooltip comparison (before/after field diffs, live tooltip reads, session-only live confirmations, two-step drink confirmation with a separate harmful-potion path); window-layout comparison, reconfirmation, forget-all, and stale-age reporting; ladder trapdoor-top shapes and steps; boat waterfall detection and refusal; minecart ride steps with powered-rail or slope gating; elytra route staging and a counted rocket-step sequence; swimming crawl steps gated by the head-underwater air rule; and read-only status checks for hunger/saturation, equipped armour, blocks at feet/below/above, water depth, redstone power, and piston extension.

### Categories STILL not covered after round 11 — training continues
- Brewing extended/upgraded where mineflayer exposes no readable long_/strong_ id: the field diff and tooltip compare now report honestly, and a live tooltip confirmation or a live drink with Moon watching can confirm the form, but an exact duration or strength number is still never claimed from data alone; a tooltip read is Moon's live read, not a bot measurement.
- Window layouts on a server or version the bot has never seen: compare, reconfirm, forget-all, and stale-age checks now make a changed layout visible, but a layout is still only recorded from Moon's explicit live confirmation, only for that session, and never auto-learned blind.
- Elytra flight as reliable long-distance travel, ladder climbing in water/corner/trapdoor-top shapes, crawling in piston/swimming setups, boat steering in rivers/ice/waterfalls, minecart steering without powered rails or a slope: single steps and staged route plans are now available, complex cases are still help and live steps only, not reliable automation, and a route plan is not a completed flight.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation; redstone power and piston extension checks are read-only helpers for those live stages, not a build.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-10, not "not yet searched".

### Round 11 status, code only
- `node --check bot.js` — SYNTAX_OK, 4,309 lines (was 4,017).
- No bot process was started, stopped, or restarted in round 11. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-11 code, still trying to join Falix as Moon asked, until successful, still getting ECONNRESET/EPIPE from this VM at last log check. Round 11 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: brew tooltip compare (does the field diff match the last brew check, does it ask for a live tooltip read and refuse to claim a number, does confirm brew live record only after Moon reads it, does forget clear it), drink potion live (does step 1 drink nothing, does confirm drink one and report effects, does a harmful potion refuse the normal confirm path, does cancel drink nothing), window layout compare / reconfirm / forget all / stale check (does compare report match versus empty-slot mismatch, does reconfirm replace the old slot visibly, does forget all clear every confirmation, does stale check report confirmation age), ladder trapdoor top check and step (does it flag a trapdoor above, does the step refuse without one, does it stop after 2 seconds and report headroom), boat waterfall check and step (does a range of 3 or more refuse the step, does a flat area do one boat step and stop), minecart ride step (does it refuse with no powered rails and no slope, does it move at least 1 block on a powered or sloped ride, does it get out and stop), elytra route plan and next rocket step (are stages sensible, does each rocket step stop after 3 seconds, does the session count count attempts not verified travel, does it refuse long-travel claims), crawl swimming step (does it refuse at the swim-up point, does it report air after the step, does it stop after 2 seconds), check hunger details, armour, block feet/below/above, water depth, redstone power, and piston extended (do readable values match what Moon sees live, do unreadable values honestly say so instead of guessing), plus all outstanding round 1-10 tests.

## Round 11 addition — Boykissers first-join lobby, code only, 2026-10-30

Moon's uncertain idea, to be confirmed live, not assumed: on first join to Boykissers there is a sort of lobby in the End, a little structure. Moon is not sure how it will work yet. This addition is part of round 11, same rules: code only, rounds 1-10 preserved, no server changes, no bot restart, no live claim until Moon tests it in game.

### What it checks, honestly
- On spawn, one delayed check 5 seconds after joining, so chunks have a chance to load, plus on command any time after that. It does NOT poll every 5 seconds on purpose: a block scan every tick would spam and lag, and mineflayer gives no reliable dimension-change event to watch, so the teleport transition is detected by comparing each lobby/ready check to the previous observed state.
- Dimension first, using the existing dimension check: the_end, overworld, the_nether, or unknown.
- Nearby blocks within 16 blocks, up to 60 blocks counted: purpur blocks (purpur_block, purpur_pillar, purpur_stairs, purpur_slab) and end stone blocks (end_stone, end_stone_bricks, end_stone_brick_stairs, end_stone_brick_slab, end_stone_brick_wall), plus structure-like blocks reported separately (end_rod, obsidian, crying_obsidian, dragon_head).
- Every check logs `[lobby] dimension=... purpur=... endStone=... structure=... ready=... transition=... prevWasLobby=...` to bot.log.

### Commands
- `Nova, check lobby` / `lobby check` / `lobby status` / `am I in lobby` / `am I in the lobby` — reports what it actually sees.
- `Nova, am I ready to play` / `check spawn ready` / `spawn ready check` / `check ready` / `ready to play` / `ready check` / `am I ready` — same check, answered as a yes/no ready question.
- `Nova, round 11 help` and the `what can you do` / `help` text now list the lobby commands.

### The strict ready rule — what it will and will not claim
- In the End AND purpur/end stone nearby: "in End lobby, not ready yet", with the actual purpur and end stone counts and any structure-like blocks. It will NOT claim ready while still in the End lobby.
- In the End AND no purpur/end stone nearby: it does NOT claim a lobby and does NOT claim ready. It says plainly it sees no lobby blocks, so this could be the End itself, check live.
- Previous check saw the End lobby, current check sees Overworld AND no purpur/end stone nearby: "spawned and ready to play", the lobby teleport transition. This is the only case where the lobby-to-Overworld transition is claimed, because a previous End lobby was actually observed.
- In the Overworld AND no purpur/end stone nearby, with no End lobby seen this session: it says plainly it spawned directly in the Overworld as far as it can tell, it does NOT invent a lobby, and that looks ready to play, with Moon to confirm live if he expected a lobby first.
- In the Overworld AND purpur/end stone still nearby: it does NOT claim the lobby has fully disappeared yet, check live.
- Dimension unknown, or Nether: it does NOT claim ready, check live what dimension the bot is actually in.
- Teleport timing is never assumed: if no previous End lobby was observed and no current Overworld check has run, it cannot claim a transition happened, it can only report the current check.

### Round 11 addition status, code only
- `node --check bot.js` — SYNTAX_OK, 4,388 lines (was 4,309 before this addition, 4,017 before round 11).
- No bot process was started, stopped, or restarted for this addition. The running bot at the time of writing is pid 7572, `MC_VERSION=1.21.10 node bot.js 142.249.167.14 28680 Nova`, started 07:00 UTC, with pre-round-11 code, still trying to join Falix as Moon asked, until successful, still getting ECONNRESET/EPIPE from this VM at last log check. The lobby code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.

### Live-test queue for the lobby, one at a time
Join, wait for the delayed spawn check (does it report End lobby with real purpur/end stone counts, or does it honestly say no lobby blocks, or does it say it spawned directly in Overworld), then run `check lobby`, then wait for the teleport Moon described, then run `check spawn ready` / `am I ready to play` (does it say "spawned and ready to play" only after a real End lobby was seen and then Overworld with no lobby blocks, does it refuse ready while still in the End lobby, does a direct Overworld spawn say so plainly without inventing a lobby, do the bot.log `[lobby]` lines match what Moon sees live, including purpur/end stone counts and structure-like blocks). If the lobby structure uses blocks other than purpur/end stone, tell Nova live what blocks they are, and the scan list can be extended from that live observation, not from a guess. Plus all outstanding round 1-11 tests.

### Round 11 lobby refinement — player heads are the distinguishing marker, 2026-10-30

This refinement supersedes the lobby test in the section above on one point: purpur/end stone alone are NOT enough to call it the lobby.

Moon's refinement: the devs put player heads down on the lobby structure, and that is the distinguishing marker. Purpur/end stone alone could confuse the bot if it is in the End generally or near an End city, which also has purpur/end stone. So the lobby test is now a combination, with all three markers reported separately on every check:
- Dimension: the_end.
- Purpur blocks nearby: purpur_block, purpur_pillar, purpur_stairs, purpur_slab.
- End stone blocks nearby: end_stone, end_stone_bricks, end_stone_brick_stairs, end_stone_brick_slab, end_stone_brick_wall.
- Player head blocks nearby: player_head, player_wall_head.

Only End dimension + purpur/end stone nearby + player heads nearby = lobby structure. The bot's in-game report now always lists all three counts, for example "3 purpur block(s), 5 end stone block(s), 2 player head block(s)", plus structure-like blocks separately (end_rod, obsidian, crying_obsidian, dragon_head), and the bot.log `[lobby]` line now includes `heads=...`.

New honest cases, replacing the old purpur/end stone-only cases:
- End + purpur/end stone + player heads: "in End lobby, not ready yet", and only this case sets the was-in-lobby state used for a later transition claim.
- End + purpur/end stone + NO player heads: "I do NOT call this the lobby. Purpur and end stone alone could be the End generally or an End city." Not ready, and this does NOT set the was-in-lobby state.
- End + player heads + NO purpur/end stone: not the full lobby combination, not called the lobby, check live what those heads are part of.
- End + none of the three: no lobby seen, not ready, could be the End itself.
- Overworld + no lobby markers at all (no purpur, no end stone, no player heads), after a previous full lobby check: "spawned and ready to play", the lobby teleport transition.
- Overworld + no lobby markers, with no lobby seen this session: direct Overworld spawn, plainly stated, no lobby invented, looks ready to play.
- Overworld + any lobby marker still nearby: NOT claiming the lobby has fully disappeared yet.

Ready-to-play is unchanged in its strictness, only the marker set is stricter: ready still requires being back in the Overworld with the lobby markers disappeared, and a transition is still only claimed when a previous full lobby (all three markers) was actually observed and a later check sees the Overworld with no markers. Teleport timing is still never assumed.

Live-test queue, updated for the refinement: join, check lobby (does it report purpur, end stone, AND player heads separately, does it refuse to call purpur/end stone without heads a lobby, does an End city-like area without heads honestly say "not the lobby"), wait for the teleport, check spawn ready (does ready require Overworld plus zero purpur, zero end stone, AND zero player heads, does it only say "spawned and ready to play" after a real full-lobby check). If the lobby heads use a different block name than player_head / player_wall_head, tell Nova live what block it actually is, and the scan list can be extended from that live observation, not from a guess.

Refinement status, code only: `node --check bot.js` — SYNTAX_OK, 4,405 lines (was 4,388 before this refinement, 4,309 before round 11's lobby addition, 4,017 before round 11). No bot process was started, stopped, or restarted for this refinement, and no server settings were changed.

## Round 12 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 11, only where a result can be verified, and only in small, stop-after-each-step moves where a blind attempt would be risky or dishonest.

### Brewing where no long_/strong_ id is readable — detailed diff, checklist, history, no invented numbers
- `Nova, brew extended field diff detailed` / `brew upgraded field diff detailed` / `brew extended detailed field diff` — uses the last brew check this session and lists changed, gone, and unchanged fields separately, plus whether a long_ (extended) or strong_ (upgraded) signal is present in the readable fields. If no signal is present, it says so plainly and does NOT claim duration or strength from data alone, then asks Moon to read the tooltip live.
- `Nova, brew extended tooltip checklist` / `brew upgraded tooltip checklist` — a live-only checklist, no claim from data: effect name, does it say Long or II or neither, duration text exactly as shown, and does the potion name itself say extended/upgraded. Moon answers live, then says `confirm brew extended live` / `confirm brew upgraded live` only if all four match.
- `Nova, brew check history` / `brew history` / `last brew check` — the last brew check this session (before/after fields) plus any session-only live tooltip confirmations, or says none yet. A confirmation is Moon's live tooltip read, not a number the bot measured.
- `Nova, forget brew check` / `clear brew check` — clears the last brew check this session, so old fields cannot be reused for a new diff; a new brew check is needed first.

### Window layouts — summary, age, forget stale, compare all, still never auto-learned blind
- `Nova, window layout summary` / `window layouts summary` — lists every session-confirmed layout with its output slot and how many minutes ago it was confirmed live.
- `Nova, window layout age check` / `check window layout age` — same list, with a flag for any layout over 60 minutes old: "reconfirm recommended if the server or version changed since then". Age alone does not prove a layout changed; the 60-minute flag is session hygiene, not a game rule.
- `Nova, forget stale window layouts` / `forget old window layouts` — clears only confirmations over 60 minutes old this session, reports which were cleared and which were kept. A cleared layout will not be used until Moon confirms it live again, and no replacement layout is auto-learned.
- `Nova, window layout compare all` / `compare all window layouts` — checks every session-confirmed block one at a time with the existing compare logic, takes nothing, then summarises. Any empty confirmed slot in those messages is a mismatch signal: reconfirm or forget that block, do not claim success on a mismatch.

### Complex travel — small verified steps, stop after each step, live only
- `Nova, ladder water step` / `water ladder step` — refuses if the head is already underwater at or past the swim-up point (limit minus 2 seconds, Moon's air rule, bubble columns excepted). Otherwise holds forward and jump for 1 second only, shorter than a normal climb step because water slows climbing, stops, then reports Y before/after, how many ladder blocks have water nearby, and air status after the step.
- `Nova, ladder corner step` / `corner ladder step` — holds forward and jump for 2 seconds only, stops, and reports x, z, and Y before/after. Movement in both x and z can mean a corner or turn; it says check live, it does not claim a corner climb from one step.
- `Nova, crawl piston check` / `piston crawl check` — read-only, it does not move: piston or sticky piston nearby, its extended property if readable, and distance. Piston timing is live only; Moon activates the piston live, then `crawl piston step` is the moving step.
- `Nova, boat river step` / `river boat step` — refuses if the water height range nearby is 3 or more blocks (possible waterfall drop) or if no water is nearby. Otherwise does one normal boat step (in, forward 2 seconds, out, report distance) and stops.
- `Nova, boat ice step` / `ice boat step` — refuses if no ice is nearby. Otherwise gets in a boat, holds forward for 1 second only, because ice is slippery and hard to stop, gets out, reports distance moved, and stops.
- `Nova, minecart slope step` / `slope minecart step` — refuses if there is no slope in the rails nearby (a minecart will not move on its own there; use `minecart push step` live instead). Otherwise gets in a minecart, holds forward for 2 seconds, gets out, and reports distance moved, slope range, and powered rail count. It says the ride moved only if it moved at least 1 block.
- `Nova, elytra route check` / `elytra preflight check` — a pre-flight check only, not a flight: it reports rockets and landing (using the existing rockets and landing checks) plus how many rocket steps have been attempted this session, then points to `elytra route plan` and one `elytra next rocket step` at a time.
- `Nova, elytra glide step` / `glide step elytra` — a rocket-free short glide only. It refuses below 12 blocks above ground, with no solid ground below, or with lava below. Otherwise it jumps, glides forward for 2 seconds, stops, and reports horizontal distance, Y change, and vertical speed. It does not claim a boosted step (that needs a rocket step) and does not claim long travel.

### Live lobby confirmation — detailed markers and history, scan list NOT extended with guesses
- The lobby scan list is NOT extended in this round with guessed blocks. Only blocks Moon actually names live in a future lobby check may be added later. Until then, structure-like blocks (end_rod, obsidian, crying_obsidian, dragon_head) are reported by exact name and count, never counted as lobby markers.
- `Nova, lobby markers` / `lobby markers detail` / `check lobby markers` / `lobby details` — dimension, purpur count, end stone count, player head count, per-block-name counts (for example purpur_block x2, end_stone x5, player_head x1), structure-like blocks by name and count, and the previous lobby state this session (was in a full End lobby, ready announced, last check). It does not add any new block to the scan list and does not claim ready from markers alone; ready still requires the existing strict rule in round 11.
- `Nova, lobby history` / `lobby transition log` / `lobby checks` — the last 10 lobby checks this session, with time, dimension, purpur, end stone, heads, structure count, ready yes/no, and transition yes/no. A transition is only claimed when an earlier entry was a full End lobby and a later entry is Overworld with no markers; the history alone does not assume a teleport.
- The existing spawn check (one delayed check 5 seconds after joining) and `check lobby` / `am I ready to play` commands are unchanged. The history is recorded on every lobby/ready check, session only, not saved to a file.

### Other safe, read-only skills added in round 12, systematic search
- `Nova, check held item` / `held item check` / `what am I holding` — held item name and count, durability used if readable, enchantments if readable, otherwise says the inventory tooltip is the live check.
- `Nova, check nearby by type` / `mobs by type` — mobs within 32 blocks grouped by type and count only (for example zombie x2, cow x3). Say `scan` for names and distances; it does not claim a mob it cannot see.
- `Nova, check spawn point` / `spawn point check` — spawn point coordinates as read in mineflayer if readable, otherwise says it cannot be read and to check live with a bed or compass. It does not claim a bed spawn without checking.
- `Nova, round 12 help` — lists the round 12 commands above.
- The `what can you do` / `help` text was also updated to list round 12.

### Categories searched in round 12
Brewing field-diff detail (changed/gone/unchanged fields, long_/strong_ signal presence, tooltip checklist questions, session history and forgetting); window-layout summary, age-flagging, stale-forgetting, and compare-all; ladder water and corner steps; crawl piston read-only checks; boat river and ice steps; minecart slope steps; elytra route pre-flight checks and rocket-free glide steps; lobby per-block marker reporting and transition history; and read-only held-item, nearby-by-type, and spawn-point checks.

### Categories STILL not covered after round 12 — training continues
- Brewing extended/upgraded where mineflayer exposes no readable long_/strong_ id or component change: the detailed diff and tooltip checklist now make the gap visible field by field, and a live tooltip confirmation or a live drink with Moon watching can confirm the form, but an exact duration or strength number is still never claimed from data alone; a tooltip read is Moon's live read, not a bot measurement.
- Window layouts on a server or version the bot has never seen: summary, age, forget-stale, and compare-all now make a changed or old layout visible, but a layout is still only recorded from Moon's explicit live confirmation, only for that session, and never auto-learned blind.
- Elytra flight as reliable long-distance travel, ladder climbing in water/corner/trapdoor-top shapes, crawling in piston/swimming setups, boat steering in rivers/ice/waterfalls, minecart steering without powered rails or a slope: single steps, pre-flight checks, and staged route plans are now available, complex cases are still help and live steps only, not reliable automation, and a route check or glide step is not a completed flight.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation; redstone power, piston extension, and crawl piston checks are read-only helpers for those live stages, not a build.
- Lobby scan extension: no new lobby block has been added in round 12. If Moon names a lobby block live in a future check, that block may be added then from that live observation, not from a guess now.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-11, not "not yet searched".

### Round 12 status, code only
- `node --check bot.js` — SYNTAX_OK, 4,634 lines (was 4,405).
- No bot process was started, stopped, or restarted in round 12. The running bot was left alone, as instructed, with pre-round-12 code, still trying to join Falix as Moon asked, until successful. Round 12 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: brew field diff detailed (do changed/gone/unchanged fields match the last brew check, does it refuse to claim duration/strength when no long_/strong_ signal is present, does the tooltip checklist ask the four live questions), brew check history and forget brew check (does history show the last check and confirmations, does forgetting require a new brew check before another diff), window layout summary / age check / forget stale / compare all (do ages match confirmation times, does forget stale clear only over-60-minute confirmations, does compare all check each confirmed block and take nothing, does an empty confirmed slot still read as a mismatch), ladder water step (does it refuse at the swim-up point, does it stop after about 1 second and report Y and air), ladder corner step (does it stop after 2 seconds and report x/z change honestly), crawl piston check (does it move nothing and report extended state or honestly say not readable), boat river step (does a range of 3 or more refuse, does a flat area do one boat step and stop), boat ice step (does it refuse with no ice, does it stop after 1 second on ice), minecart slope step (does it refuse with no slope, does it move at least 1 block on a sloped ride, does it get out and stop), elytra route check (does it report rockets and landing without flying), elytra glide step (does it refuse below 12 blocks, over lava, or over no ground, does it use no rocket and stop after 2 seconds), lobby markers and lobby history (do per-block counts match what Moon sees live, does history show the last 10 checks with ready/transition flags, is no new lobby block counted as a marker without Moon naming it live), check held item, check nearby by type, and check spawn point (do readable values match what Moon sees live, do unreadable values honestly say so instead of guessing), plus all outstanding round 1-11 tests.

## Round 13 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 12, only where a result can be verified, and only in small, stop-after-each-step moves where a blind attempt would be risky or dishonest. Plus two new priorities from Moon in this round: clutching, relevant soon, and parkour, an end goal and an example of how niche his knowledge should go.

### Brewing where no long_/strong_ id is readable — no-signal check, confirm steps, detailed confirmations, no invented numbers
- `Nova, brew extended no signal check` / `brew upgraded no signal check` — uses the last brew check this session and says honestly whether a readable long_ (extended) or strong_ (upgraded) signal is present. If no signal is present, it lists the field diff, refuses to turn it into a duration or strength number, and gives the only two honest confirmations: read the tooltip live, or drink live with Moon watching and report readable effects.
- `Nova, brew extended confirm steps` / `brew upgraded confirm steps` — the four honest steps in order: brew check, field diff detailed, tooltip checklist with its four live questions, then confirm live only if the tooltip matches, or drink live with Moon watching, then check detailed confirmations. A confirmation for one stage does not confirm the other stage.
- `Nova, brew confirmations detailed` / `detailed brew confirmations` — last brew check plus every session-only live tooltip confirmation with how many minutes ago each was confirmed. A confirmation is Moon's live tooltip read, not a number the bot measured.

### Window layouts — age detail, summary detail, forget by custom age, still never auto-learned blind
- `Nova, window layout age detailed` / `detailed window layout age` — every session-confirmed layout with its output slot, minutes since confirmation, and a bucket: fresh under 15 minutes, recent 15 to 60 minutes, stale over 60 minutes with "reconfirm recommended if the server or version changed". Age alone does not prove a layout changed.
- `Nova, window layout summary detailed` / `detailed window layout summary` — counts of fresh, recent, and stale confirmations, oldest confirmation age, and the block list, plus the next honest step: compare all, or forget by age. It opens no blocks and takes nothing.
- `Nova, forget stale window layouts older than 30 minutes` / `forget window layouts older than 90 minutes` — clears only confirmations older than the number of minutes Moon names, from 1 to 1440, reports which were cleared and which were kept. A cleared layout will not be used until Moon confirms it live again, and no replacement layout is auto-learned.

### Complex travel — small verified steps, stop after each step, live only
- `Nova, ladder top step` / `top ladder step` — holds forward and jump for 2 seconds only, stops, and reports Y before/after, the block at head height now, and the block two above, with a trapped warning if headroom looks blocked. Tell Moon live before the next step.
- `Nova, ladder water corner check` / `water corner ladder check` — ladder blocks nearby, how many ladder columns, and how many ladder blocks have water nearby. More than one column can mean a corner or turn, water nearby means a water ladder step and the air rule, not a normal climb step.
- `Nova, crawl swimming check detailed` / `detailed crawl swimming check` — water blocks nearby at the bot's level plus the air status, with Moon's air rule restated: swim up before the head-under limit without Respiration, or before the Respiration-adjusted limit, bubble columns excepted. A swimming crawl step is 2 seconds only and stops.
- `Nova, piston activated live` / `piston activated` — records Moon's live piston activation, session only, for 2 minutes. Piston timing changes fast, so an old activation is not reused.
- `Nova, crawl piston timed step` / `timed crawl piston step` — refuses unless the piston reads extended or Moon said "piston activated live" in the last 2 minutes. Otherwise it sneaks forward for 2 seconds only, stops, and reports distance moved and the block above, and asks Moon live if it is trapped.
- `Nova, boat river ice check` / `river ice boat check` — combined water count, ice count, and water height range nearby, with a recommendation: a range of 3 or more means a possible waterfall drop and a river step is refused, ice nearby means a slippery 1-second ice step only, flat open water is the simple case. It still cannot measure river width from a block count alone, Moon tells it live.
- `Nova, boat waterfall step safe` / `safe boat waterfall step` — refuses if the water height range nearby is 3 or more blocks, otherwise does one normal boat step and stops.
- `Nova, minecart no power step` / `no power minecart step` — only for no powered rails and no slope nearby. If powered rails or a slope are present, it says to use the slope or ride step instead. Otherwise it does a live push step and stops, and reports whether the minecart actually moved.
- `Nova, elytra long travel plan` / `long elytra travel plan` — staged only, not a flight: route check first, take off from at least 12 blocks above ground with no lava below confirmed live, one travel step at a time with a landing check after each step and Moon confirming live before the next step, and a landing check at the destination before landing. Rockets on hand set the maximum honest travel steps, not a guaranteed arrival.
- `Nova, elytra travel step` / `travel elytra step` — one rocket step, then a landing check, then stopping, with the session attempted-step count. It never claims reliable long-distance travel from one step.

### Lobby — markers by distance, quiet watch, transition summary, scan list NOT extended with guesses
- The lobby scan list is NOT extended in this round with guessed blocks. Only blocks Moon actually names live in a future lobby check may be added later. Counted markers are still only purpur, end stone, and player heads; structure-like blocks are reported, never counted as markers.
- `Nova, lobby markers by distance` / `check lobby markers by distance` — dimension, total markers with purpur, end stone, and player head counts, plus how many markers are under 8 blocks away and how many are 8 to 16 blocks away. A close marker set is stronger evidence for a lobby structure than a distant one, and distance alone does not make a lobby, the full combination still needs End dimension plus purpur/end stone plus player heads.
- `Nova, lobby watch on` / `watch lobby on` — session only: the bot checks the lobby quietly in the background at most once every 30 seconds, through the existing 5-second auto-tick, and only speaks up if the full lobby-to-Overworld transition happens. It does not spam lobby messages, and it does not claim ready without that transition or a direct Overworld check.
- `Nova, lobby watch off` / `watch lobby off` — stops background lobby checks, one-off `check lobby` still works any time.
- `Nova, lobby watch status` / `is lobby watch on` — watch on or off, was in a full End lobby this session, ready announced, and how many history entries are kept.
- `Nova, lobby transition summary` / `last lobby transition` — the last recorded full lobby-to-Overworld transition in this session's history, with time, dimension, and marker counts, or plainly says no transition has been recorded yet. A transition is never assumed from a single check.

### Other safe, read-only skills added in round 13, systematic search
- `Nova, check food count` / `how much food` — food items in the bot's inventory only, with types and counts. It does not count food in chests or farms, and it does not mean the bot should eat anything without Moon saying so.
- `Nova, check nearby hostiles` / `hostiles nearby` — mobs within 32 blocks from a known hostile list only, grouped by type and count, plus how many other mobs are not on that list. A mob not on the known list is reported as other, not guessed as hostile.
- `Nova, check nearby animals` / `animals nearby` — the same, from a known animal list only, with other mobs reported as other, not guessed as animals.
- `Nova, check distance to moon` / `how far are you from me` — straight-line distance to Moon in blocks plus direction, not a walking path, and not a follow command.
- `Nova, round 13 help` — lists the round 13 commands above.
- The `what can you do` / `help` text was also updated to list round 13.

### Clutch — priority, relevant soon, knowledge and checks first, staged practice, never blind high falls
- Before this round there was NO clutch code: no water-bucket MLG, no pearl clutch, no hay, slime, boat, or cobweb clutch, only a fall-height check and ravine-fall reporting over 5 blocks, and pearl throws refused blind. That blind pearl refusal is kept: a pearl is never thrown blind, a clutch pearl attempt is only a live, confirm-gated, low-height step with Moon watching.
- `Nova, clutch help` / `mlg help` — the methods to test live, with what each needs and what it does, in vanilla 1.21.10: water bucket, placed just before landing, not in the Nether where water evaporates, not on leaves or mangrove roots which waterlog instead; powder snow bucket, placed just before landing, works in the Nether and can be placed on leaves and top slabs where water fails; cobweb, placed or already below, resets fall damage but traps you without shears, water, or a sword; slime block, placed below, fully negates fall damage and bounces, hold sneak to stop the bounce; hay bale landing, reduces fall damage by 80 percent, not full; bed landing, reduces fall damage by 50 percent, not full; scaffolding landing while sneaking, negates fall damage, needs a flat-topped solid block, not leaves; sweet berry bush landing, negates fall damage, needs soil; ender pearl, thrown before landing, teleports and still costs health, risky, never blind; ladder, needs a wall face beside the fall, check-only for now because placement timing is too precise for bot data alone. No method is claimed to work until a low-height live test passes.
- `Nova, clutch check` / `check clutch` — inventory counts for every clutch method, ground distance below, first solid block below, dimension, health, and falling velocity, with the Nether water warning and the hay and bed only-reduce warning. No clutch is attempted from a check.
- `Nova, clutch check water` (also powder snow, slime, hay, bed, scaffolding, sweet berries, pearl, ladder, cobweb) — one method at a time: how many of its item the bot has, ground distance and landing block, dimension, health, what it needs, and what it is expected to do, plus the method-specific warning, for example water in the Nether, or ladder as check-only.
- `Nova, clutch fall check` / `fall clutch check` — falling yes or no, vertical velocity, ground distance below, first solid block below, health, and on-ground state. A high fall, over 6 blocks, is never auto-clutched blind, Moon tells it live what clutch to try, or moves to a low practice drop first.
- `Nova, clutch practice water` (also powder snow, slime, hay, bed, scaffolding, sweet berries, pearl, cobweb; ladder is check-only and refuses a practice) — step 1 only, the bot has NOT fallen yet. It refuses if the ground below is over 6 blocks, low-height first, refuses if the item is missing, refuses water in the Nether, and refuses a landing-block method if the landing below is not that method and the bot has no such block to place. Otherwise it sets a pending clutch for 2 minutes and says what it needs and what is expected, and asks Moon to say "clutch confirm attempt" with Moon watching, or "clutch cancel" to stop.
- `Nova, clutch confirm attempt` / `confirm clutch attempt` — only if a practice is pending and under 2 minutes old, otherwise it expires and must be set up again. On recheck it refuses again if the ground is now over 6 blocks, if the item is missing, or if it is water in the Nether, and it logs a clean failure without falling. Otherwise it steps off the low drop and tries, best-effort: for water, powder snow, slime, and cobweb it tries to place just before landing, polling ground distance every 100 milliseconds for up to 3 seconds and placing at 3 blocks or less, then reports whether a place was verified; for pearl it throws once with Moon watching and reports teleport and health; for landing-block methods it steps off and lands on the block below, holding sneak for slime to stop the bounce. It then stops and reports fell distance, ground distance, health before and after, landed block, placed yes or no, pearl thrown yes or no, and an honest result, never claiming a clutch it did not verify.
- `Nova, clutch cancel` / `cancel clutch` — clears a pending clutch practice, the bot falls nothing and attempts nothing.
- `Nova, clutch passed live water` (also the other methods) — records Moon's live confirmation that a low-height clutch passed, session only. This is Moon's live confirmation, not a bot measurement, and a low pass does not claim a high clutch works.
- `Nova, clutch attempts` / `clutch history` — session attempts with time, method, ground distance, health before and after, landed block, and result. An attempt is not a pass until Moon says "clutch passed live <method>".
- A high clutch, over 6 blocks, is not attempted in this round at all: practice is low-height first, and a high attempt would need a low live pass first plus a separate live setup, which is still not covered and must not be claimed.

### Parkour — end goal, niche depth, staged in order, 4-block and 360 as end goals, not current abilities
- Before this round parkour code was only pathfinder allowParkour 1-block safe steps, a single jump command, and sprint with food above 6. No 4-block jump, no chained sprint-jump, no mid-air spin existed.
- `Nova, parkour help` / `jump help` — the physics in order: a standing jump covers roughly 2 blocks, a sprint jump can clear up to 4 blocks at most, and a 4-block jump is hard, it needs full sprint momentum and edge timing, sometimes force momentum, sprinting just after jumping, or jamming, holding forward, sprint, and jump together. A 2-block gap is the easy sprint case, a 3-block gap needs a full sprint run-up and an edge jump, a 4-block gap needs that plus precise timing, and a height difference or a low ceiling, a headhitter, makes it harder. Food must be above 6 to sprint. No blind cliff jumps, ever.
- `Nova, parkour check` / `parkour gap check` — the gap the bot actually sees ahead in the direction it is facing: run-up solid blocks behind it, gap width in blocks with no ground at its ground level, landing block name and height difference, blocks below the gap, and a lava warning if lava is below. If no solid landing is seen within 8 blocks, that is a cliff and it refuses to jump blind. Food is reported, sprint needs food above 6.
- `Nova, parkour sprint jump step` / `sprint jump step` — one generic sprint jump step: sprint and forward, jump after a short run-up, stop, and report distance moved, Y change, landed block, and health. This is a generic step, not a named gap jump.
- `Nova, parkour jump 2` / `parkour jump 3` / `parkour jump 4` — separate, live-only, Moon-watching steps, in order. Each refuses if food is 6 or less, refuses if no solid landing is seen ahead, refuses if the gap actually seen ahead does not match the named gap, and for 4 blocks refuses if the run-up is short. Each does one sprint jump with a run-up, stops, and reports distance moved, Y change and any fall, landed block versus the target landing block, and health before and after. A jump is only a pass if Moon says "parkour passed live <gap>" after watching it, the bot does not claim a successful jump from a landing it did not verify, and a failed attempt reports the fall honestly, not a success.
- `Nova, parkour passed live 2` / `parkour passed live 3` / `parkour passed live 4` — records Moon's live confirmation that a named gap jump passed, session only. A pass for one gap does not claim another gap or the spin.
- `Nova, parkour attempts` / `parkour history` — session attempts with time, gap, distance moved, landed block, health before and after, and result. An attempt is not a pass until Moon confirms it live.
- `Nova, parkour spin help` / `spin jump help` — the end goal, clearly not a current ability: a 3-block 360 mid-air spin jump means a 3-block sprint gap, a full 360-degree turn in mid-air, and a landing on the target block, all in one jump. That needs the 3-block jump first, then yaw control mid-air, then a landing check, live only, with Moon watching, on a safe course with a low fall risk.
- `Nova, parkour spin ready live` / `spin ready live` — records Moon's live setup, session only, for 2 minutes: the 3-block spin course is set and Moon is watching. Spin timing changes fast, so an old setup is not reused.
- `Nova, parkour spin step` / `360 spin step` — refuses without a spin-ready in the last 2 minutes, refuses if food is 6 or less, and refuses if the gap actually seen ahead is not 3 blocks, because a spin jump is a 3-block gap only. Otherwise it does one sprint jump, turns yaw in eight mid-air steps aiming for a full 360 degrees, stops, and reports degrees turned, distance moved, landed block versus the target landing block, and health. It claims a spin only if the turn is at least 315 degrees and it landed on the target block, and even then Moon must say "parkour spin passed live" after watching a full 360 and a clean landing. Until that live pass, the spin is an end goal, not a claimed skill.
- `Nova, parkour spin passed live` / `spin passed live` — records Moon's live confirmation that a full 360 spin plus a clean landing passed, session only.

### Categories searched in round 13
Brewing no-signal confirmation (long_/strong_ absence, tooltip and drink confirmations as the only honest paths, detailed session confirmations); window-layout age buckets, summary counts, and forget-by-custom-age; ladder top steps and water-corner checks; swimming crawl detail and piston timed steps with a 2-minute activation window; boat river-ice combined checks and waterfall-safe steps; minecart no-power push steps; elytra long-travel staging and single travel steps; lobby markers by distance, quiet 30-second background watch with transition-only speech, and transition summaries, with no new lobby blocks added; read-only food, nearby hostile and animal, and distance checks; clutch methods from the vanilla breaking-a-fall list (water, powder snow, cobweb, slime, hay, bed, scaffolding, sweet berries, pearl, ladder) with inventory, ground, and fall checks, low-height practice, confirm-gated attempts, and live-pass recording; parkour physics and staged jumps (standing about 2 blocks, sprint up to 4 blocks, force momentum and jamming, headhitter risk, run-up and gap checks, 2, 3, and 4-block attempts, and a 3-block 360 spin end goal).

### Categories STILL not covered after round 13 — training continues
- Brewing extended/upgraded where mineflayer exposes no readable long_/strong_ id or component change: the no-signal check now names the gap and gives tooltip and drink as the only honest confirmations, but an exact duration or strength number is still never claimed from data alone; a tooltip read is Moon's live read, not a bot measurement, and a drink effect report is only as readable as mineflayer exposes it.
- Window layouts on a server or version the bot has never seen: age detail, summary detail, and forget-by-custom-age now make an old or changed layout visible and clearable by age, but a layout is still only recorded from Moon's explicit live confirmation, only for that session, and never auto-learned blind.
- Elytra flight as reliable long-distance travel, ladder climbing in water/corner/trapdoor-top shapes, crawling in piston/swimming setups, boat steering in rivers/ice/waterfalls, minecart steering without powered rails or a slope: single steps, pre-flight checks, long-travel plans, and travel steps are now available, complex cases are still help and live steps only, not reliable automation, and a plan or a single step is not a completed flight or route.
- Clutch from a high fall, over 6 blocks: not attempted in this round, practice is low-height first, and a high attempt would need a low live pass first plus a separate live setup, which is still not covered and must not be claimed. Ladder clutch placement mid-fall is check-only for now, not an automatic place, because wall-face timing is too precise for bot data alone. Boat clutch, honey-block landing, and other niche clutch variants were not added as bot attempts in this round, only the methods listed in clutch help are checked and practiced, and any new clutch method must be named and tested live first, not guessed in.
- Parkour as reliable automation: 2, 3, and 4-block jumps and the 3-block 360 spin are live-only single steps, not chained parkour, not a full course, and not claimed until Moon confirms each live. Force-momentum and jam timing are described in help, not claimed as tick-perfect bot execution, a 4-block jump is hard even with a run-up, and a spin is an end goal until a live full spin plus clean landing is confirmed by Moon.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation; redstone power, piston extension, and crawl piston checks are read-only helpers for those live stages, not a build.
- Lobby scan extension: no new lobby block has been added in round 13. If Moon names a lobby block live in a future check, that block may be added then from that live observation, not from a guess now.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-12, not "not yet searched".

### Round 13 status, code only
- `node --check bot.js` — SYNTAX_OK, 5,124 lines (was 4,634).
- No bot process was started, stopped, or restarted in round 13. The running bot was left alone, as instructed, with pre-round-13 code, still trying to join Falix as Moon asked, until successful. Round 13 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: brew no-signal check (does it refuse a number when no long_/strong_ signal is present, does it give tooltip and drink as the only confirmations), brew confirm steps and confirmations detailed (do steps and ages match the session), window layout age detailed, summary detailed, and forget older than a named number of minutes (do buckets and counts match confirmation times, does forget clear only older than the threshold), ladder top step (does it stop after 2 seconds and report headroom honestly), ladder water corner check (do column and water counts match live), crawl swimming check detailed (does air status match the air rule), piston activated live then crawl piston timed step (does it refuse without a recent activation or an extended piston, does it stop after 2 seconds and report headroom), boat river ice check and boat waterfall step safe (does a range of 3 or more refuse, does a flat area do one boat step and stop), minecart no power step (does it refuse with powered rails or a slope, does a push step report actual minecart movement), elytra long travel plan and travel step (does the plan stage rockets, take-off, single steps, and landing, does a travel step use one rocket, check landing, and stop), lobby markers by distance, lobby watch on/off/status, and lobby transition summary (do distance bands match live, does watch stay quiet except on a real transition, does the summary show only a recorded transition or plainly say none), check food count, nearby hostiles, nearby animals, and distance to Moon (do readable values match live, do unknown mobs report as other, not guessed), clutch help, clutch check, clutch fall check, clutch practice, clutch confirm attempt, clutch cancel, clutch passed live, and clutch attempts (does practice refuse over 6 blocks, with a missing item, or for water in the Nether, does confirm expire after 2 minutes, does an attempt report placed yes or no, health before and after, and landed block honestly, does a failed attempt never claim a clutch, does ladder stay check-only), parkour help, parkour check, parkour sprint jump step, parkour jump 2, 3, and 4, parkour passed live, parkour attempts, parkour spin help, parkour spin ready live, parkour spin step, and parkour spin passed live (does check refuse a cliff, do named jumps refuse a mismatched gap, does 4 refuse a short run-up, does a spin refuse without a recent ready and without a 3-block gap, does a spin report degrees turned honestly and refuse a pass claim without Moon's live confirmation), plus all outstanding round 1-12 tests.

## Round 14 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 13, only where a result can be verified, and only in small, stop-after-each-step moves where a blind attempt would be risky or dishonest. Plus the three gaps round 13 left open: high-fall clutch staging, ladder clutch placement, and chained parkour.

### High-fall clutch staging — after a low live pass, staged higher attempts, never auto-clutching a high fall blind
- Stage bands, from ground distance below: stage 1 is the round 13 low practice, 6 blocks or less. Stage 2 is 7 to 12 blocks. Stage 3 is 13 to 20 blocks. Stage 4 is over 20 blocks.
- Stage unlocking is strict and session-only: stage 2 needs a low-height live pass for the same method first. Stage 3 needs a stage 2 live pass first. Stage 4 needs a stage 3 live pass first. A low pass never claims a high clutch, and a stage pass never claims the next stage.
- `Nova, clutch high help` / `high clutch help` — the stage bands and unlocking rules above, plus the hay and bed only-reduce warning.
- `Nova, clutch high practice water` (also powder snow, slime, hay, bed, scaffolding, sweet berries, pearl, cobweb; ladder is redirected to its own staged practice) — step 1 only, the bot has NOT fallen yet. It refuses if the drop is 6 blocks or less, use low practice there; refuses if the stage requirement is not met; refuses if the item is missing; refuses water in the Nether; refuses a landing-block method if the landing below is not that method and the bot has no such block to place; and refuses a high hay or bed practice if health is not full, because hay and bed only reduce damage and a high fall can still kill from less than full health. Otherwise it sets a pending high clutch for 2 minutes and asks Moon to say "clutch high confirm attempt" with Moon watching, or "clutch high cancel" to stop.
- `Nova, clutch high confirm attempt` / `confirm clutch high attempt` — only if a high practice is pending and under 2 minutes old, otherwise it expires and must be set up again. On recheck it refuses again if the ground distance now falls in a different stage band, if the stage requirement is no longer met, if the item is missing, or if it is water in the Nether, and it logs a clean failure without falling. Otherwise it steps off the staged drop and tries, best-effort: for water, powder snow, slime, and cobweb it polls ground distance every 100 milliseconds for up to 8 seconds, longer than the low attempt because a high fall takes longer, and places at 3 blocks or less, then reports whether a place was verified; for pearl it throws once with Moon watching and reports teleport and health; for landing-block methods it steps off and lands on the block below, holding sneak for slime to stop the bounce. It then stops and reports fell distance, ground distance, stage, health before and after, landed block, placed yes or no, pearl thrown yes or no, and an honest result, never claiming a high clutch it did not verify. Placement timing is reported, it is not claimed as tick-perfect.
- `Nova, clutch high cancel` / `cancel clutch high` — clears a pending high clutch practice, the bot falls nothing and attempts nothing.
- `Nova, clutch high passed live water 2` (also the other methods, stage 2, 3, or 4) — records Moon's live confirmation that a clutch passed at that stage, session only. This is Moon's live confirmation, not a bot measurement, and it unlocks only the next stage for this method, it does not claim a higher stage or another method.
- `Nova, clutch high attempts` / `clutch high history` — session high attempts only, with time, method, stage, ground distance, health before and after, landed block, and result, plus the live stage passes recorded this session. An attempt is not a pass until Moon says "clutch high passed live <method> <stage>" after watching it.
- A high clutch is never auto-attempted: there is no auto-clutch on a real, unplanned high fall in this round, only a confirm-gated, staged practice with Moon watching. That auto-clutch gap is still not covered and must not be claimed.

### Ladder clutch placement — from check-only toward a staged, live-only placement attempt, with precise timing checks, and an honest limit
- Round 13 ladder clutch was check-only because wall-face timing was too precise for bot data alone. This round does NOT pretend bot data alone can prove a grab. What bot data CAN time is: is a wall actually adjacent at the bot's current height, when during the fall does a wall first appear beside it, and at what ground distance was a ladder placed. What it CANNOT prove from data alone is a grab, so a ladder pass still needs Moon's live confirmation after watching a real grab.
- `Nova, ladder clutch check detailed` / `detailed ladder clutch check` — wall faces beside the bot at its level and up to 4 blocks below, with side name, first wall block name, and how many blocks the wall runs continuously down, plus ground distance below, ladders in inventory, vertical velocity, and health. No wall beside the bot means no ladder attempt here, move beside a wall live first. A wall alone does not prove a grab.
- `Nova, ladder clutch practice` / `clutch practice ladder staged` — step 1 only, the bot has NOT fallen yet. It refuses if no solid wall face is beside the bot, refuses if the bot has no ladder, refuses a drop over 6 blocks until a low ladder live pass is recorded, and refuses a drop over 20 blocks, which is not staged yet. Otherwise it sets a pending ladder clutch for 2 minutes, low stage at 6 blocks or less, high stage at 7 to 20 blocks, and asks Moon to say "ladder clutch confirm attempt" with Moon watching, or "ladder clutch cancel" to stop.
- `Nova, ladder clutch confirm attempt` / `confirm ladder clutch attempt` — only if a ladder practice is pending and under 2 minutes old, otherwise it expires and must be set up again. On recheck it refuses again if no wall is beside the bot now, if no ladder is in inventory now, or if a low setup is now over 6 blocks, and it logs a clean failure without falling. Otherwise it equips a ladder, steps off, and polls every 50 milliseconds for up to 4 seconds for a wall block actually adjacent at the bot's current height. Only then does it place a ladder against that wall face, with the face vector pointing from the wall block toward the bot, then it looks at the wall and moves toward it briefly. If no wall is adjacent by the time the ground is 3 blocks below, it stops placing and reports the timing miss honestly, it does not claim a grab. It then stops and reports fell distance, wall side used, ladder placed yes or no and at what ground distance, vertical velocity before and after, health before and after, and landed block. A placed ladder plus slowed descent in bot data is reported as "looks slowed, grab NOT claimed from data alone", and a pass still needs Moon to say "ladder clutch passed live" after watching a real grab.
- `Nova, ladder clutch cancel` / `cancel ladder clutch` — clears a pending ladder clutch practice, the bot falls nothing and attempts nothing.
- `Nova, ladder clutch passed live` / `ladder passed live` — records Moon's live confirmation that a ladder clutch passed, session only, at the stage of the last practice if one is in this session. This is Moon's live confirmation, not a bot measurement, and it does not claim a ladder grab from bot data alone, or a higher stage.
- `Nova, ladder clutch attempts` / `ladder clutch history` — session ladder attempts with time, stage, ground distance, wall side, placed yes or no, velocity before and after, health before and after, landed block, and result. An attempt is not a pass until Moon says "ladder clutch passed live" after watching a real grab.

### Chained parkour — a full course does not exist as one jump, it is planned, then one jump at a time with landing verification between jumps
- Single jumps from round 13 exist, a full course did not. This round adds a course as a plan plus single steps, never as blind chaining.
- `Nova, parkour course help` / `course parkour help` — the course rules: set gaps in order first, then one jump at a time, stop after each jump, only advance if that jump landed on its target block, pause on a failed jump, never chain blind.
- `Nova, parkour course set 2 3 4` — gaps in order, at least 2 gaps, each 2, 3, or 4 blocks, session only. It records the gaps and starts at jump 1, and says to face the bot toward the first gap live, check it if wanted, then say "parkour course next" for one jump only.
- `Nova, parkour course status` / `course status parkour` — gaps in order, current jump number and gap, whether the course is complete, and course attempts this session with jump number, gap, landed block, health before and after, and result.
- `Nova, parkour course next` / `next course jump` — one jump only, for the current gap. It refuses if food is 6 or less, refuses if no solid landing is seen ahead, refuses if the gap actually seen ahead does not match the current course gap, and for 4 blocks refuses if the run-up is short. Otherwise it does one sprint jump with a run-up, stops, and reports distance moved, any fall, landed block versus the target landing block, and health before and after. If it landed on the target block, it advances to the next gap and waits, it does NOT jump the next gap until Moon says "parkour course next" again, and Moon must face the bot toward the next gap live first if the course turns. If it did NOT verify a landing on the target block, the course pauses at that jump, it does NOT chain to the next gap, and Moon can say "parkour course next" again after repositioning for a retry, or "parkour course cancel" to abandon it.
- `Nova, parkour course cancel` / `cancel parkour course` — abandons the course, no more chained jumps.
- `Nova, parkour course passed live` / `course passed live parkour` — refused unless every gap is complete, and even then it records only Moon's live confirmation that every jump was watched clean, session only. Landings alone do not claim a course pass, and a course pass does not claim a different course.

### Clutch and parkour methods reporting — no new methods guessed
- No new clutch or parkour methods are added in this round. Only the methods already listed in clutch help are checked, practiced, and reported, with better reporting for them. Boat clutch, honey-block landing, and other niche clutch variants are still not added as bot attempts, only the methods in clutch help are, and any new method must be named and tested live first, not guessed in.
- `Nova, clutch methods report` / `clutch report` — for every method in clutch help, in one report: inventory count, low live pass yes or no, high live passes recorded, ladder low pass yes or no for ladder, plus the method-specific warning, for example water does NOT work in the Nether, and ladder is staged placement now, not check-only, but a grab still needs Moon's live confirmation. Ground distance below, first solid block below, dimension, and health are reported with it. A method with no item cannot be attempted, and a method with no live pass cannot claim a higher stage.
- `Nova, round 14 help` — lists the round 14 commands above.
- The `what can you do` / `help` text was also updated to list round 14.

### Categories searched in round 14
High-fall clutch staging (stage bands 1 to 4, unlocking from lower live passes, confirm-gated staged attempts with an 8-second place poll, partial-method full-health refusal); ladder clutch placement (adjacent wall scanning by side and continuous run, 50-millisecond fall polling, face-vector placement against the wall, look-and-move-toward-wall after placing, velocity before and after, and the honest limit that a grab cannot be proved from bot data alone); chained parkour (course set in order, one jump at a time, landing verification between jumps, pause on failure, no blind chaining, course pass only from Moon's live confirmation); and clutch method reporting (inventory, low and high live passes, and method warnings in one report, with no new methods guessed).

### Categories STILL not covered after round 14 — training continues
- Auto-clutch on a real, unplanned high fall: not attempted in this round, only confirm-gated, staged practice with Moon watching. A bot that saves itself from a surprise high fall without a setup is still not covered and must not be claimed.
- Ladder grab proof from bot data alone: placement timing, wall adjacency, and velocity change are now reported, but a grab is still only confirmed by Moon watching live. A ladder clutch beyond 20 blocks is also not staged yet.
- Parkour as reliable automation: a course is now planned and stepped through one jump at a time, but it is not an automatic course run, it pauses on failure, it needs Moon to face the bot toward each gap, and it is not claimed until Moon confirms every jump live. Force-momentum and jam timing are described in help, not claimed as tick-perfect bot execution.
- New clutch or parkour methods Moon names live in future: no new methods were guessed in this round. If Moon names a method live, that method may be added then from that live observation, not from a guess now.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-13, not "not yet searched".

### Round 14 status, code only
- `node --check bot.js` — SYNTAX_OK, 5,443 lines (was 5,124).
- No bot process was started, stopped, or restarted in round 14. The running bot was left alone, as instructed, with pre-round-14 code, still trying to join Falix as Moon asked, until successful. Round 14 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current IP.
- Still code-only, needs Moon live in game to test, one at a time: clutch high help (do stage bands and unlocking rules match the session passes), clutch high practice water at a staged drop (does it refuse at 6 blocks or less, without a lower live pass, with a missing item, or for water in the Nether, does a high hay or bed practice refuse without full health, does it set a pending practice for 2 minutes only), clutch high confirm attempt (does it refuse on a changed stage band or an expired setup, does a place attempt poll up to 8 seconds and place at 3 blocks or less, does it report fell distance, stage, health, landed block, and placed yes or no honestly, does a stage pass still need Moon's live confirmation), clutch high passed live water 2 and clutch high attempts (does a stage pass unlock only the next stage for that method, does history show only high attempts), ladder clutch check detailed (do wall sides, continuous runs, and first wall block names match live), ladder clutch practice beside a wall (does it refuse with no wall, no ladder, over 6 blocks without a low pass, or over 20 blocks), ladder clutch confirm attempt (does it refuse on a missing wall or ladder on recheck, does it place only when a wall is actually adjacent mid-fall, does it report placement ground distance and velocity before and after honestly, does it refuse a grab claim from data alone), ladder clutch passed live and ladder clutch attempts (does a pass need Moon watching a real grab), clutch methods report (do inventory counts, low and high passes, and warnings match live, are no new methods listed), parkour course set 2 3 4, parkour course status, and parkour course next (does set need at least 2 gaps of 2 to 4 blocks, does next do exactly one jump and stop, does it advance only on a verified target landing, does it pause at a failed jump and refuse to chain, does it refuse a mismatched gap or a short 4-block run-up), parkour course cancel and parkour course passed live (does cancel abandon the course, does passed live refuse before every gap is complete), plus all outstanding round 1-13 tests.

## Round 15 — continuous training, code only, 2026-10-30

Moon asked Nova to keep adding features continuously until there is not a single Minecraft skill the bot does not know. This round does NOT claim that end goal is reached. It picks up the STILL-not-covered list from round 14, only where a result can be verified, and only in small, stop-after-each-step moves where a blind attempt would be risky or dishonest. Plus the three gaps round 14 left open: auto-clutch on a real, unplanned fall, ladder grab proof from bot data alone, and parkour as reliable automation.

### Auto-clutch on unplanned falls — NOT claimed yet, only honest detection, reporting, and staged opt-in watch settings
- Before this round there was no auto-clutch at all: only confirm-gated, staged practice with Moon watching, low first, then stages 2, 3, and 4 after lower live passes. A bot that saves itself from a surprise high fall without a setup was still not covered, and it is still not covered as an attempt in this round, and must not be claimed.
- What is added instead is a watch, off by default, that Moon must explicitly enable live, with a method, a max ground distance, and a min health, and that reports unplanned falls honestly without placing, throwing, or saving the bot by itself.
- `Nova, auto clutch help` / `clutch auto help` — the watch rules: off by default, setup plus confirm to turn on, checks every 1 second, so a very short fall may be missed, that is a real limit, it is not tick-perfect, and a watch report is never a clutch pass.
- `Nova, auto clutch setup water` (also powder snow, slime, hay, bed, scaffolding, sweet berries, pearl, cobweb; ladder is refused for auto, because a ladder clutch needs a wall beside the fall and Moon watching live to confirm a grab) — step 1 only, the watch is NOT on yet. It refuses if the bot has no live pass for that method yet, low or staged high, do a live practice first. Otherwise it sets a pending setup for 2 minutes, with max ground from the highest live pass for that method, low 6 blocks, stage 2 12 blocks, stage 3 20 blocks, stage 4 40 blocks, and min health 10, or 20, full health, for hay and bed, because hay and bed only reduce damage and do not fully negate it.
- `Nova, auto clutch set max 12` — pending setup only, it lowers the max ground, it refuses a value over the unlocked max from live passes, it will not raise the max above a live pass.
- `Nova, auto clutch set min health 15` — pending setup only, health 1 to 20, it refuses under 20 for hay and bed.
- `Nova, auto clutch confirm enable` / `confirm auto clutch enable` — only if a setup is pending and under 2 minutes old, otherwise it expires and must be set up again. On recheck it refuses if the live pass is gone, if the item is missing for a place, throw, or slime or cobweb method, or if it is water in the Nether, and it logs a clean failure without turning the watch on. Otherwise it turns the watch ON, watch and report only, with method, max ground, and min health.
- `Nova, auto clutch cancel setup` / `cancel auto clutch setup` — clears a pending setup, the watch was not turned on.
- `Nova, auto clutch off` / `turn auto clutch off` — turns the watch off any time, manual clutch practice is still available live.
- `Nova, auto clutch status` / `auto clutch watch status` — watch on or off, method, max ground, min health, time turned on, and the last 3 fall reports, plus the explicit warning that even when ON this round is watch and report only, it does NOT place, throw, or save the bot by itself, and a watch report is never a clutch pass.
- `Nova, auto clutch fall check` / `auto fall check` — a one-shot fall report, no attempt: falling yes or no, vertical velocity, ground distance below, first solid block below, health, on-ground state, and, when the watch is on, whether that method would even have been eligible on these facts, ground over max, health under min, water in the Nether, or a missing item.
- Fall watch tick, every 1 second while the bot is spawned, only when the watch is ON, and skipped while a manual clutch practice is pending, so a manual attempt does not get double-reported as an unplanned fall. When it sees an unplanned fall, velocity under -0.5 and not on ground, it reports once per fall episode, in game and in bot.log as `[auto-clutch-fall]`, with method, ground distance, health, velocity, eligible yes or no, and the reasons if not eligible, and it explicitly says it is NOT attempting a save in this round. When the bot lands after a reported fall, it logs `[auto-clutch-landed]` with health before and after and landed block, and it says one line only if health dropped, that the watch reported only and did not attempt a save. A fall that starts and lands inside one 1-second tick may be missed, that limit is stated in help, not hidden.
- `Nova, auto clutch reports` / `auto clutch fall reports` — session fall reports only, with time, method, ground distance, health before and after, velocity, eligible yes or no with reasons, and landed block, plus the warning that no attempt was made in this round.
- A surprise high fall is never silently auto-saved in this round: the watch reports, it does not act, and a future auto-attempt would still need a separate live setup and a separate round, and must not be claimed from this watch.

### Ladder grab proof — wall, ladder block, and velocity are reported as a checklist, a grab is still only confirmed by Moon watching live
- Round 14 ladder placement timing, wall adjacency, and velocity change were reported, but a grab was still only confirmed by Moon watching live. This round does NOT invent a bot-data signal for a grab: mineflayer exposes no reliable is-climbing or grab flag here, and this round says so plainly instead of claiming one.
- `Nova, ladder grab check` / `ladder grab proof` / `check ladder grab` — a proof checklist, NOT a grab confirmation: wall faces beside the bot with side, first wall block name, and continuous run down, ladder blocks within 2 blocks, count, vertical velocity, on-ground state, ground distance below, and health. Checklist lines: wall present yes or no, ladder placed adjacent yes or no, velocity slowed, over -2, yes or no. Even if every data box is yes, that is still NOT proof of a grab in this round, because there is no reliable grab flag, and a grab is confirmed ONLY if Moon says "ladder clutch passed live" after watching a real grab.
- `Nova, ladder grab reports` / `ladder grab history` — session ladder attempts with time, stage, wall side, placed yes or no, velocity before and after, health before and after, landed block, and a data signal line per attempt: placed plus slowed descent means "live confirmation still required", otherwise "no data signal for a grab, live confirmation still required". In every case a grab is confirmed only by Moon's live confirmation, never by bot data alone.
- A ladder clutch beyond 20 blocks is still not staged, as in round 14, and a ladder auto-clutch method is refused in round 15 auto setup, because a ladder grab needs a wall and live confirmation.

### Parkour as reliable automation — improved stepping, landing verification, and repositioning help, still one jump at a time, never an automatic run
- Round 14 a course was planned and stepped through one jump at a time, but it was not an automatic course run, it paused on failure, it needed Moon to face the bot toward each gap, and it was not claimed until Moon confirmed every jump live. This round keeps all of that and adds visible stepping help, it does NOT turn a course into an automatic run.
- `Nova, parkour course face check` / `face check parkour course` — for the current course jump: facing direction, approximately east, west, north, or south from yaw, yaw value, gap actually seen ahead, run-up solid blocks behind, and landing ahead, or none seen, which is a cliff, do not jump. Moon must face the bot toward the course gap live first if the facing is wrong, the bot will not reposition itself into a gap blind.
- `Nova, parkour course landing check` / `landing check parkour course` — for the current course jump: block under the bot now, health, whether the course is complete as jumps, and the last course attempt with jump number, gap, landed block, health before and after, and result. A below-block match alone is NOT a course pass, and a single jump landing alone is NOT a course pass, only Moon's "parkour course passed live" after watching every jump clean counts.
- `Nova, parkour course reposition help` / `reposition help parkour course` — after a failed or paused jump, what to fix live: current course jump and gap, gap actually seen ahead now, run-up, landing ahead or none seen, and the last attempt, plus the live steps, move the bot back to the start of this gap, face it toward the course gap, check the run-up is solid and the landing is the target block, then say "parkour course next" for one jump only. The bot will NOT move itself to the gap or chain the next gap blind.
- `Nova, parkour course step help` / `course step help parkour` — the stepping rules in one place: set the course first, Moon faces the bot to each gap live, face check and landing check are the visible checks, "parkour course next" is exactly one jump and stops, it advances only on a verified target landing, it pauses on failure, reposition help tells Moon what to fix, retry is "parkour course next" again after repositioning, cancel abandons the course, and passed live needs Moon watching every jump clean.
- No course is claimed as an automatic run in this round: a course is still a plan plus single steps, with Moon facing the bot to each gap, a pause on failure, and a pass only from Moon's live confirmation. Force-momentum and jam timing are still described in help, not claimed as tick-perfect bot execution.

### Categories searched in round 15
Auto-clutch watch design (off-by-default opt-in, live-pass unlocking, max ground and min health settings, 1-second fall watch, once-per-episode reporting, landing outcome logging, manual-practice suppression, no attempt in this round); ladder grab proof (wall scan, nearby ladder blocks, velocity, on-ground state, and the explicit absence of a reliable grab flag in mineflayer data); parkour course stepping (facing from yaw, gap and run-up and landing checks, landing verification, repositioning help, one-jump-at-a-time with pause on failure, course pass only from live confirmation).

### Categories STILL not covered after round 15 — training continues
- Auto-clutch as an actual save on a real, unplanned fall: not attempted in this round, only watch, detection, reporting, and opt-in settings. A bot that places, throws, or otherwise saves itself from a surprise fall without a manual setup is still not covered and must not be claimed, even with the watch ON, and a watch report is never a clutch pass.
- Ladder grab proof from bot data alone: wall, ladder block, and slowed velocity are now reported as a checklist, but a grab is still only confirmed by Moon watching live, because there is no reliable is-climbing or grab flag in the data used here, and a ladder clutch beyond 20 blocks is still not staged.
- Parkour as reliable automation: a course is now stepped with face, landing, and reposition checks, but it is still one jump at a time, with Moon facing the bot to each gap, a pause on failure, and a pass only from Moon's live confirmation, not an automatic course run, and force-momentum and jam timing are still described, not claimed as tick-perfect.
- New clutch or parkour methods Moon names live in future: no new methods were guessed in this round. If Moon names a method live, that method may be added then from that live observation, not from a guess now.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-14, not "not yet searched".

### Round 15 status, code only
- `node --check bot.js` — SYNTAX_OK, 5,638 lines (was 5,444).
- No bot process was started, stopped, or restarted in round 15. The running bot was left alone, as instructed, with pre-round-15 code. Round 15 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current dynamic IP.
- Still code-only, needs Moon live in game to test, one at a time: auto clutch help (does it state watch only, off by default, and the 1-second miss limit), auto clutch setup water for a method with a live pass and for a method without one (does it refuse without a pass, does it refuse ladder, does it set max from live passes and min health 20 for hay and bed), auto clutch set max and set min health (does set max refuse over the unlocked max, does set min health refuse under 20 for hay and bed, does an expired setup refuse confirm), auto clutch confirm enable (does it refuse with a missing item or water in the Nether, does it turn the watch ON only after confirm), auto clutch status, fall check, reports, and off (does status show method, max, min, and recent reports, does off stop reporting, does a watch report log without placing or throwing), ladder grab check and ladder grab reports (do wall, ladder block, and velocity values match live, does every report still require Moon's live confirmation, is no grab claimed from data alone), parkour course face check, landing check, reposition help, and step help (does face check show facing, gap, run-up, and landing honestly, does landing check refuse a course pass from a below-block match alone, does reposition help tell Moon what to fix live without moving the bot blind, does course next still do exactly one jump and pause on failure), plus all outstanding round 1-14 tests.

## Round 16 — continuous training, code only, 2026-10-30

Moon's new end goal, not a current ability: "Nova, impress me", where the bot does impressive things, setting them up himself, plus whatever other cool, verifiable things can be found. This round does NOT claim that end goal is reached, and it does NOT turn a routine into an automatic show.

### "Nova, impress me" — a staged routine, one trick at a time, Moon watching live
- `Nova, impress me` / `impress me` / `show off` — setup only, no trick yet. It refuses if food is 6 or less, if health is under 10, if no solid ground is found within 40 blocks below (possible void), if lava is within 8 blocks, or if the ground is not flat enough, at least 18 of 25 ground-level blocks solid in a 5 by 5 area. If setup fails, it says what to fix live and does NOT build a course blind or break Moon's builds to fix it.
- `Nova, impress help` — routine stages, setup, confirm, cancel, and pass rules in one place.
- `Nova, impress status` — health, food, dimension, routine state, tricks that would be in a new routine, and tricks skipped as missing, with live-pass and item reasons.
- `Nova, impress next` — exactly one trick, then it stops. A failed trick pauses the routine, it does not chain to the next trick blind.
- `Nova, impress cancel` — stops the routine at any time, including clearing a pending impress clutch.
- `Nova, impress passed live` — refused unless the routine is complete, then records Moon's live confirmation, session only, that the whole routine was watched clean. A routine pass does not claim any single trick works on its own next time, and it does not claim a high clutch, a spin, or an automatic show.
- Routine order, staged: dance and jump, sprint jump step, parkour jumps in order 2, then 3, then 4, but only if Moon already confirmed that gap live this session, then a low clutch for water, powder snow, or slime, but only if Moon already confirmed that method live and the bot has the item, and only after a confirm step, then elytra glide step if the bot has an elytra, boat step if a boat is nearby, minecart ride step if rails are nearby, and a 3-block 360 spin step last, but only if Moon already confirmed a spin live and a fresh "parkour spin ready live" is set with a 3-block gap actually seen.
- `Nova, impress confirm clutch` — only when the routine is waiting on a clutch stage. The routine first calls the existing low clutch practice, which sets a pending practice and does NOT fall. Moon says "impress confirm clutch" with Moon watching, then the existing confirm attempt runs, then the routine stops and reports health before and after, landed block, and placed yes or no. If that attempt did NOT verify a clutch, the routine pauses at the clutch stage and does not chain on.
- Each trick reuses an existing, verified single step and reports its own result honestly: dance and jump health, sprint step distance moved, parkour jump distance, landed block versus target, and health, clutch health and landing, elytra glide distance and vertical speed, boat step distance, minecart ride distance, spin degrees turned and landing. A trick that does not meet its own step's threshold pauses the routine.
- IMPORTANT, honest limit on "setting them up himself": this round's setup is checking and choosing, not building. It checks inventory, health, food, surroundings, and a flat safe area, picks stages from live passes and items actually present, and sets a clutch practice, but it does NOT place blocks to build a parkour course or a clutch tower, and it does NOT move itself to a gap or drop blind, because building blind could break Moon's builds or place blocks on a dangerous edge. If Moon wants a narrow build step later, it would need a separate live rule, for example only dirt or stone, only on flat solid ground, only far from builds, and still with Moon watching, and that step is NOT in this round and must not be claimed from it.

### Round 15 pickups, help-only, not claims
- `Nova, auto clutch attempt help` — what an actual auto save on a surprise fall would need, all at once: watch ON, a live pass for that method, the item in inventory, ground at or under the unlocked max, health at or over the min health, and a fall long enough for the 1-second watch tick to see it. Even with all that, this round still only watches and reports, it does NOT place, throw, or save the bot by itself, and an auto attempt is still not covered and must not be claimed from the watch alone.
- `Nova, ladder grab proof help` — wall, ladder block, and slowed velocity are data signals, not proof, because mineflayer exposes no reliable is-climbing or grab flag here. A grab is confirmed ONLY if Moon says "ladder clutch passed live" after watching a real grab.
- `Nova, parkour automation help` — a course is still a plan plus one jump at a time, Moon faces the bot to each gap live, it advances only on a verified target landing, and it pauses on failure. A reliable automatic run would need gap detection, facing, run-up, landing, and failure recovery all verified together, and that is still not covered.
- No new clutch or parkour methods are guessed in this round: no boat clutch, no honey clutch, and no other method is added as an attempt. Only methods already listed in clutch help are used in the routine, and only at low height with a live pass.

### Categories searched in round 16
Impress routine design (safe-area checking, stage ordering from live passes, one-trick-at-a-time stopping, confirm-gated clutch, failed-trick pausing, routine pass only from live confirmation); reuse of existing verified steps (dance, sprint jump, parkour jumps, low clutch practice and confirm, elytra glide, boat step, minecart ride, spin step); and round 15 gap help (auto-clutch attempt requirements, ladder grab proof limits, parkour automation requirements).

### Categories STILL not covered after round 16 — training continues
- "Impress me" as a fully self-setting show: setup here is checking and choosing, not building a course or a clutch tower, and the routine is not an automatic show, it stops after every trick and needs Moon's "impress next" and, for the clutch, "impress confirm clutch".
- Auto-clutch as an actual save on a real, unplanned fall: not attempted in this round, only watch, detection, reporting, and opt-in settings from round 15, plus help in this round. A watch report is never a clutch pass.
- Ladder grab proof from bot data alone: wall, ladder block, and slowed velocity are reported as a checklist, but a grab is still only confirmed by Moon watching live, because there is no reliable grab flag in the data used here, and a ladder clutch beyond 20 blocks is still not staged.
- Parkour as reliable automation: a course is still one jump at a time, with Moon facing the bot to each gap, a pause on failure, and a pass only from Moon's live confirmation, not an automatic course run, and force-momentum and jam timing are still described, not claimed as tick-perfect.
- New clutch or parkour methods Moon names live in future: no new methods were guessed in this round. If Moon names a method live, that method may be added then from that live observation, not from a guess now.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-15, not "not yet searched".

### Round 16 status, code only
- `node --check bot.js` — SYNTAX_OK, 5,856 lines (was 5,638).
- No bot process was started, stopped, or restarted in round 16. The live bot in Boykissers was left alone, as instructed, with pre-round-16 code. Round 16 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current dynamic IP.
- Still code-only, needs Moon live in game to test, one at a time: impress help (does it list stages, setup, confirm, cancel, and pass rules), impress me on a flat safe area and on an unsafe area (does it refuse lava, void, low health, and low food, does it refuse to build blind), impress status (do unlocked tricks match live passes and inventory, do missing tricks list their reasons), impress next for dance and sprint (does it stop after each, does a low moved distance pause it), impress next for parkour 2, 3, and 4 (does it skip a gap with no live pass, does a failed jump pause it instead of chaining), impress next and impress confirm clutch for a low clutch method with a live pass (does it set a practice without falling, does it refuse without a confirm, does a failed attempt pause it), impress next for elytra, boat, and minecart only when their preconditions are present (does it skip them otherwise, does a failed step pause it), impress next for a spin only with a live spin pass and a fresh spin ready (does it skip or pause otherwise), impress passed live before completion and after completion (does it refuse before, does it record only after watching clean), impress cancel during a routine and during a pending clutch (does it stop and clear the pending practice), plus auto clutch attempt help, ladder grab proof help, and parkour automation help (do they state plainly that none of those three are claimed as working), plus all outstanding round 1-15 tests.

## Round 17 — continuous training, code only, 2026-10-30

Moon's new dramatic example / end goal, not a current ability: a mace clutch in the impress routine. His example scene: the bot builds up a whole stack of blocks high, pulls out a mace, jumps, spins around a few times mid-air, then hits a warden at the bottom, one-shotting it. He said that scene could be added specific if wanted, it was just a dramatic example of what he could do. This round implements that honestly, staged, with NO one-shot claim and NO warden fight claim, and it does NOT turn the example into a working warden kill.

### Mace mechanics first — help before any attempt, no one-shot promised
- A mace smash attack is a falling hit on a mob. It only counts as a smash if the hit lands while falling, roughly more than 1.5 to 2 blocks of fall. If the smash lands, fall damage is negated. If it misses, the bot takes normal fall damage. Damage scales with fall height, it is NOT a guaranteed one-shot, and it is NOT a guaranteed one-shot on a warden.
- A warden has 500 health, very high, and a warden is extremely dangerous and will likely kill a bot that misses, or that hits and does not kill it. A low staged fall is nowhere near a warden one-shot, so a low practice never starts on a warden, or on any hostile mob.
- `Nova, mace clutch help` / `help mace clutch` — what a mace clutch needs: a mace in inventory, a passive mob below, a safe fall path, full or high health, at least 16 in code, Moon watching live, and a staged practice path, low first, not a warden first. It states all of the warnings above, never promises a one-shot.
- `Nova, mace clutch check` / `check mace clutch` — has mace yes or no with count, passive mob type and distance below, fall height to that mob, ground distance and first solid block below, health, food, whether a low practice is ready with reasons if not, and whether a warden is seen below, which is reported as NOT a practice target. No damage number is claimed, because bot data does not show mob health.
- `Nova, mace clutch ready live` / `mace ready live` — the Moon-watching confirmation step, recorded this session, good for 2 minutes only. Practice refuses without a fresh one, because mob position and health change fast.
- `Nova, mace clutch practice` / `practice mace clutch` — sets a pending practice only, no fall yet. It refuses if there is no fresh watching step, no mace, no pig, cow, or sheep below, a warden seen below at all, the passive mob is more than 2 blocks away horizontally, the drop is under 2 or over 6 blocks, health is under 16, or the first solid block below looks like lava. It consumes the watching step only when every check passes.
- `Nova, mace clutch confirm` / `confirm mace clutch` — runs exactly one attempt, then stops. It refuses on an expired pending practice, a missing mace on recheck, a moved or missing passive mob on recheck, a mob now outside the low practice position, or health under 16 on recheck, and in those cases it does not fall. Otherwise it equips the mace, steps off the low ledge Moon positioned it on, turns mid-air as a cosmetic spin, tries one smash attack when the mob is in range, 3.5 blocks or less, and reports fall height, hit attempted yes or no, spin degrees turned, health before and after, landed block, whether the mob is still seen, and whether fall damage looks negated as far as data shows. If the bot never falls off the edge, it stops, reports that it stayed on the ledge, and does not guess the edge direction blind.
- Damage honesty, in code and in the report: bot data here does not show mob damage numbers or mob health, so no damage number is ever claimed, a hit attempt is not claimed as a smash, health unchanged after a fall that would normally hurt only "looks like" a smash negation as far as data shows, and a mob disappearing alone is NOT claimed as a kill.
- `Nova, mace clutch cancel` / `cancel mace clutch` — clears a pending practice, no fall, no attempt.
- `Nova, mace clutch attempts` / `mace attempts` — session attempts only, with time, mob type, fall, hit attempted, spin degrees, health before and after, landed block, mob still seen, and result. An attempt alone is not a pass.
- `Nova, mace clutch passed live` / `mace passed live` — refused if no mace clutch attempt exists this session yet, so a pass cannot be recorded without an attempt. Otherwise it records Moon's live confirmation, session only, that a low mace clutch on a passive mob passed clean. That pass does not claim a high mace clutch, a spin by itself, a warden scene, or a one-shot.
- `Nova, round 17 help` — lists the round 17 commands above.

### Mid-air spin reuse — cosmetic only, a spin does NOT guarantee a hit
- The existing spin step, yaw turns mid-air, is reused as a cosmetic spin during a mace clutch attempt, turning in steps while falling, up to about 360 degrees if the fall lasts long enough, and reporting the degrees actually turned.
- A spin does NOT guarantee a hit. A missed spin attempt pauses and stops, it does not chain on, it does not retry blind, and it does not start or continue an impress routine. A partial spin on a short low fall is reported as partial, not rounded up to a full spin.

### Tower building — NO blind auto-building, gated design in help only
- No tower build command is added in this round, and no tower is built by impress setup, by mace practice, or by any other round 17 step.
- `Nova, mace clutch tower help` / `tower help mace clutch` — the gated design only: a tower step, if it ever exists in a future round, would only run if Moon says a specific build command live, only dirt or stone, only on flat solid ground far from Moon's builds, only up to a staged height, low first, up to 6 blocks, with higher stages only after a low live pass, never a tall stack first, with Moon watching live, and it stops on any unsafe block below, lava, void or no solid ground, a cliff edge, or Moon's build. It is NOT part of impress setup by default, and it must not be claimed from this help.

### Impress routine — NO warden scene, NO mace clutch attempt in "impress next", status reporting only
- The normal "impress next" order is unchanged from round 16. No warden scene and no mace clutch attempt is added to it, and `impressStagesFor` and `impressMissingList` are untouched.
- `Nova, impress status` now also reports, separately from the routine stages: mace clutch unlocked yes or no, with reasons, no mace in inventory, and no low passive-mob live pass yet, plus warden scene locked. "Unlocked" here means a low passive-mob live pass recorded this session, not that a mace is present and not that a warden scene works.
- `Nova, impress help` now states plainly that mace clutch and the warden scene are NOT in the routine and that "impress next" never attempts them.
- `Nova, impress warden scene help` / `warden scene help` — the dramatic end-goal scene ONLY as a description: tower, mace out, jump, spins, smash on a warden below, with the honest warnings: needs a mace, rare, from trial chambers, needs a warden already present below, the bot does NOT spawn one, needs Moon watching live, bot death is likely on a miss, one-shot is NOT guaranteed, a warden has 500 health, and this scene is NOT in the normal impress routine and NOT attempted by "impress next" unless Moon explicitly says a separate scene command after a low passive-mob pass, in a future round.
- Any scene wording without "help", for example `Nova, impress warden scene`, `Nova, warden scene`, or `Nova, mace clutch warden`, is refused in code, not attempted: it says the scene is locked in this round, there is no warden smash attempt command yet, the bot never spawns a warden, and it never uses a /summon or operator command. There is no warden spawn command, no /summon, and no operator command by the bot anywhere in this round.
- A warden attempt, even in a future round, would refuse unless Moon has explicitly confirmed a low mace clutch on a passive mob live first, and even then only as a separate, Moon-confirmed scene command, never as part of the automatic impress routine. That future command does not exist in this round and must not be claimed from the help text.
- The `what can you do` / `help` text was also updated to list round 17.

### Categories searched in round 17
Mace smash mechanics (falling hit, roughly 1.5 to 2 blocks minimum fall, fall damage negated if the hit lands, normal fall damage if it misses, damage scaling with fall height, first blocks worth more per block than later blocks, no damage cap at extreme heights in the searched sources, which is why a one-shot is a height question, not a low-fall promise); warden health and danger (500 health, very high, devastating attacks, designed to be avoided rather than fought, and, as searched context only, an unenchanted mace needing a fall of about 321 blocks for a one-shot on a full-health warden in the searched wiki table, which is why a low staged fall is nowhere near a one-shot and why this round claims no one-shot at all); mace rarity and source (trial chambers, breeze rod plus heavy core, rare, which is why a missing mace is a clean refusal, not a guess); and mid-air spin reuse (the existing round 13 spin step, yaw turns in steps, reused as cosmetic spin only, with no hit guarantee).

### Categories STILL not covered after round 17 — training continues
- A mace clutch on a hostile mob, or on any passive mob other than pig, cow, or sheep: not added in this round, no new mob types were guessed, and a hostile is never a first practice target. Chicken, rabbit, horse, and other passives are still not mace targets.
- A mace clutch above 6 blocks, a staged high mace clutch, and a mace clutch with enchantment modelling: not covered. The bot does not check or model mace enchantments such as Density, Breach, or Wind Burst, it does not claim a damage number for any fall height, and a higher fall is not a first try. Higher stages would need a low live pass first, plus separate staging, and must not be claimed from this round.
- Tower building as an executed step: not covered, help design only, no build command, no dirt or stone placement for a tower, and no impress setup building.
- The warden scene as an executed attempt: not covered, help description and refusal only. No scene command, no warden spawn, no /summon, no operator command, and no one-shot claim. A future scene command would still need a low passive-mob live pass first, a warden already present below, Moon watching live, and an explicit separate command, and it would still not promise a one-shot or bot survival.
- Mob damage numbers, mob health, and a smash confirmation from bot data alone: not covered, because the data used here does not expose them. A hit attempt, unchanged health, and a mob disappearing are reported as far as data shows, and a real smash is confirmed only by Moon watching live.
- "Impress me" as a fully self-setting show: still checking and choosing, not building, as in round 16, and now explicitly excluding mace clutch and the warden scene from its stages.
- Auto-clutch as an actual save on a real, unplanned fall: still watch and report only from round 15, not an attempt, and a watch report is never a clutch pass.
- Ladder grab proof from bot data alone: still only confirmed by Moon watching live, because there is no reliable grab flag in the data used here, and a ladder clutch beyond 20 blocks is still not staged.
- Parkour as reliable automation: still one jump at a time, with Moon facing the bot to each gap, a pause on failure, and a pass only from Moon's live confirmation, not an automatic course run.
- New clutch or parkour methods Moon names live in future: no new methods were guessed in this round, except the mace clutch Moon himself named. If Moon names another method live, that method may be added then from that live observation, not from a guess now.
- Going to a named biome, village, or structure WITHOUT seed, map, or coordinates from Moon: still planning help only, the bot cannot compute a location from a seed alone in mineflayer, and it still will not guess a biome name.
- Redstone circuits, piston machines, and a full house end-to-end without Moon's stage-by-stage confirmation: still staged planning only, not blind automation.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players, modded worlds, Noah's server — rejected on purpose, as in rounds 1-16, not "not yet searched".

### Round 17 status, code only
- `node --check bot.js` — SYNTAX_OK, 6,087 lines (was 5,856).
- No bot process was started, stopped, or restarted in round 17. The live bot in Boykissers was left alone, as instructed, with pre-round-17 code. Round 17 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current dynamic IP.
- Still code-only, needs Moon live in game to test, one at a time: mace clutch help (does it state smash mechanics, the 500-health warden warning, and no one-shot promise), mace clutch check with a mace and without one, with a passive mob below and without one, and with a warden below (does it report mace, mob type and distance, fall height, health, and food honestly, does it list ready reasons), mace clutch ready live and practice without it (does practice refuse without a fresh watching step), mace clutch practice with no mace, no passive mob below, a warden below, a mob too far horizontally, a drop under 2 or over 6 blocks, and health under 16 (does each refuse cleanly without falling), mace clutch practice on a low ledge above a pig, cow, or sheep (does it set a pending practice only, with no fall), mace clutch confirm (does it refuse on an expired setup or a moved mob, does it equip the mace, fall, spin cosmetically, and try one hit in range, does it report fall height, hit yes or no, spin degrees, health before and after, landed block, and whether fall damage looks negated as far as data shows, does it claim no damage number, does a miss stop without chaining), mace clutch cancel during a pending practice (does it stop with no fall), mace clutch attempts (does history show only real attempts with hit, spin, health, and landed block), mace clutch passed live before any attempt and after a watched clean attempt (does it refuse before, does it record only Moon's live confirmation after), mace clutch tower help (does it state the gated design and that no tower is built), impress warden scene help (does it describe the scene only, with mace rarity, a warden already present, Moon watching, likely bot death on a miss, and no one-shot promise), impress warden scene without help and mace clutch warden (does each refuse with no attempt and no spawn), impress status before and after a low mace pass (does it report mace unlocked yes or no with mace and live-pass reasons and warden scene locked, without adding a mace or warden stage to the routine), impress me and impress next (does the routine still contain no mace or warden stage, does impress next never attempt either), plus all outstanding round 1-16 tests.

## Round 18 — bow, shield, duel + targeting, code only, 2026-10-30

Moon approved duel training, plus a targeting system as a cool thingy just to use on private servers, plus bow skill and shield skill. This round covers all three, staged, help first, low first, with guardrails that are part of the design, not optional.

### Guardrails — private servers only, consent, no blind kill
- PRIVATE SERVERS ONLY: this bot only ever connects to Moon's own Falix Boykissers server, never to a public server, never to Noah's server. Targeting and duelling are for Boykissers only, with Moon watching live, and a stop command at any time.
- CONSENT: a player target is only attacked in a duel Moon names explicitly, with that player present in game. The bot never attacks Moon unless Moon explicitly says "duel me" or "fight me" live, and never attacks Noah unless Noah is explicitly in a duel Moon names live. In code, a player duel needs "duel <name>" plus a separate "duel confirm" before the first strike, so Moon gets a second chance to stop it, and Moon himself needs "duel me" first.
- NO BLIND KILL: "kill" is implemented as duel/target attack, one target at a time, with health, distance, and weapon checks first, and it stops if the target leaves, dies, or Moon says stop. No mass targeting, no targeting offline players, no targeting by guess — a name that is not in game is refused, not guessed.
- A duel stops on "Nova, stop duel", "Nova, stop fighting", or "Nova, stop", and on low bot health under 8, with a retreat report, not a fight to the death blind. A mob attack stops on target death, on "stop", or on low health under 8, and never chains to other mobs blind.
- This is an explicit, Moon-approved, private-server exception to the old "never attack players" rule. Attacking players outside a named duel/target on Boykissers is still rejected, as are inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, modded worlds, and Noah's server.

### Targeting system
- `Nova, target help` — lists the whole system, guardrails first.
- `Nova, target <player or mob name>` — sets ONE target only, session only. Reports target found yes/no, type, distance, and that health is not claimed from bot data for players, and not claimed for mobs either. Refuses unknown names, refuses offline players, does NOT attack on setting a target.
- `Nova, target status` — current target, distance, in range yes/no, bot health/food, duel active yes/no.
- `Nova, target clear` — clears the target and stops any duel, with a confirmation.
- `Nova, attack target` — for a mob target only, one target at a time. Refuses a player target and points to the duel commands instead. Walks to the mob, strikes on a full cooldown step, stops on target death, on "stop", or on low health under 8, and never chains to another mob.

### Duel — melee upgrade, no more spam attack for duels
- `Nova, duel <player name>` — step 1 only, NO attack yet. Refuses an unknown or offline player, refuses Moon himself unless "duel me" was said first, refuses a bot health under 10, refuses if a duel is already active. Sets the player as the single target and waits for confirm.
- `Nova, duel me` / `Nova, fight me` — records, session only, that Moon explicitly wants to be duelled, then Moon still says "duel Werewolf_Paws" and "duel confirm" with Moon watching. No attack yet from this command alone.
- `Nova, duel confirm` — starts strikes. The duel tick walks to the target, blocks briefly with a shield if the bot has one, then strikes only after a full cooldown step: sword about 650 ms, axe about 1100 ms, mace about 900 ms, other weapons about 800 ms. Charge is reported as "waited full cooldown step" because mineflayer data here does not expose a reliable attack strength meter, so no meter number is claimed. This replaces the old 500 ms spam attack for duels only; the old mob guard/fight ticks are untouched.
- `Nova, duel status` — target, confirmed yes/no, distance, bot health/food, held weapon, strikes this duel, crit step used yes/no, and the honest shield note: target shield is not reliably shown by bot data, so axe shield-disable timing is Moon's live call, while an axe hit while a target is blocking disables a shield for 5 seconds in vanilla.
- `Nova, duel crit step` — a separate, Moon-confirmed step, NOT a default in the tick. Refuses without a confirmed duel, without the target in melee range, or at low health under 10. Jumps and tries one hit on the way down, reports hit attempted, health before/after, and target still seen. A crit in vanilla is a falling attack for extra damage, not a sprint knockback hit, and bot data does not show crit particles or damage numbers, so a crit is confirmed only by Moon watching live.
- `Nova, duel passed live` — refused without duel strikes this session, otherwise records Moon's live confirmation only, session only. It does not claim duel mastery.
- `Nova, stop duel` / `Nova, stop` — stops the duel, clears the timer, stops movement, and unblocks, with a confirmation. Plain "stop" now also stops a duel first, then falls through to the normal stop handling.

### Bow — super-good is an end goal, not an instant skill
- `Nova, bow help` — charge timing first: full draw about 1 second gives full damage and range, a spam shot with almost no charge is weak, arrows drop over distance so a far target needs aiming above it, and a moving target needs leading, aiming where it will be, not where it is. Honest limit: mineflayer bow aiming is the hardest part, the bot aims at the target position it can see right now, it does not predict a moving target, and it does not claim a hit from bot data alone.
- `Nova, bow check` — bow yes/no, arrows, health/food, target and distance, and practice-ready reasons, including refusing a player target for practice and a target over 30 blocks away.
- `Nova, bow practice` — pending only, NO shot yet. Refuses with no bow, no arrows, no mob target, a player target, a target no longer seen, or a target over 30 blocks away. Practice first on a stationary mob or a target Moon sets, never on a player first. The line-of-fire backdrop is Moon's live check, not claimed from bot data alone.
- `Nova, bow shoot` — exactly one shot, then stops. Refuses on an expired pending shot (2 minutes) or a target/bow missing on recheck. Equips the bow, looks at the target, charges about 1 second, releases, and reports distance, shot attempted yes/no, arrows before/after, and target still seen. A hit is NOT claimed: bot data does not show arrow damage, and a target still seen or disappearing alone is not a hit claim.
- `Nova, bow cancel` — clears a pending shot, no shot.
- `Nova, bow passed live` — refused without a bow shot this session, otherwise records Moon's live confirmation only. It does not claim super-good bow skill, leading, or long-range mastery.
- No bow auto-fire, and bow is NOT in the impress routine by default.

### Shield — perfect timing is an end goal, not an instant skill
- The existing "block / shield up" command is equip shield to offhand plus sneak. That step is best-effort in mineflayer, not claimed as a perfect vanilla block pose until Moon watches it live, and this round does not rewrite that claim.
- `Nova, shield help` — block timing first: holding a shield up blocks melee and projectiles from the front, it does not block everything, an axe hit while blocking disables a shield for 5 seconds, and the bot must unblock to attack, it cannot strike while fully blocked.
- `Nova, shield check` — shield in inventory yes/no, offhand slot, health/food, and practice-ready reasons.
- `Nova, shield practice` — one timed block step only: shield to offhand, blocked for about 2 seconds, then unblocked, stopped. Best-effort, not a perfect-timing claim.
- `Nova, shield passed live` — refused without a shield practice this session, otherwise records Moon's live confirmation only. It does not claim perfect shield timing in a real duel.
- Shield use inside a duel: block briefly when the target is close, then unblock to strike on a full cooldown, then re-block. That timing is best-effort, not perfect, until Moon watches it live.
- `Nova, round 18 help` — lists all round 18 commands. The `what can you do` / `help` text was also updated to list round 18.

### Categories searched in round 18
Vanilla combat timing (attack cooldown per weapon type, sword faster than axe, full charge for full damage, spam shots/hits weak); critical hits (falling attack for extra damage, distinct from sprint knockback, no reliable crit/damage number in the bot data used here); axe shield-disable (5 seconds in vanilla, only while the target is blocking); bow mechanics (full draw about 1 second, arrow drop over distance, leading a moving target, mineflayer aiming at a seen position only, no prediction); shield mechanics (front blocking, not everything, unblock to attack); and targeting/duel guardrails (private server only, explicit named present target, confirm step, stop conditions, one target at a time).

### Categories STILL not covered after round 18 — training continues
- Bow super-good: no leading of a moving target, no long-range drop compensation beyond aiming at the seen position, no bow hit confirmation from bot data, no bow auto-fire, no bow in the impress routine.
- Shield-perfect timing: no measured block timing against an incoming hit, no perfect axe-disable timing measured from bot data, target shield state not reliably shown, block pose is best-effort mineflayer, not a claimed vanilla-perfect block.
- Duel mastery: no strafing pattern, no kiting, no potion or food use mid-duel, no retreat-and-reengage beyond the low-health stop, no duel against multiple targets, no duel on any server other than Boykissers, no player attack outside a named confirmed duel.
- Targeting beyond one target: no target list, no target priority, no automatic retargeting, no targeting offline or guessed names, no targeting by partial name guess beyond an exact player/mob name match in game.
- Impress me as a fully self-setting show, auto-clutch as an actual save, ladder grab proof from data alone, parkour as reliable automation, mace clutch above 6 blocks or on hostiles, tower building as an executed step, and the warden scene as an executed attempt — all still not covered, as in rounds 1-17.
- Inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players outside a named duel/target on Boykissers, modded worlds, Noah's server — rejected on purpose, except for the explicit Moon-approved private-server duel/target exception above.

### Round 18 status, code only
- `node --check bot.js` — SYNTAX_OK, 6,443 lines (was 6,087).
- No bot process was started, stopped, or restarted in round 18. The live bot in Boykissers was left alone, as instructed, with pre-round-18 code. Round 18 code will only run on the next restart / live session, from a machine that can actually reach Falix, after checking the Falix Connect panel again for the current dynamic IP.
- Still code-only, needs Moon live in game to test, one at a time: target help (does it list guardrails, one target, stop), target with a player present, a mob present, and an unknown name (does it set one only, refuse unknown, and NOT attack on setting), target status and clear (does status show distance and range honestly, does clear stop a duel), duel with a player present, an offline name, and with Moon without "duel me" first (does each refuse correctly except the named present case), duel confirm (does it wait for confirm, does it strike only after a full cooldown step, not spam), duel status (does it show target, distance, health, held weapon, strikes, and the shield note), duel crit step without a confirmed duel and with one in range (does it refuse without, does it do one jump hit only, does it claim no crit number), duel passed live before and after strikes (does it refuse before, record only Moon's live confirmation after), stop duel and plain stop during a duel (does each stop strikes and movement), attack target on a mob and on a player target (does mob attack stop on death or stop without chaining, does player attack refuse and point to duel), bow help, check, practice, and shoot on a mob, with no bow, no arrows, a player target, and a target over 30 blocks (does each refuse correctly, does practice shoot nothing, does shoot do exactly one full-draw shot and claim no hit), bow cancel and passed live (does cancel shoot nothing, does passed live refuse before a shot), shield help, check, practice, and passed live (does practice do one timed block then unblock, does passed live refuse before practice, does it claim no perfect timing), plus all outstanding round 1-17 tests.

## Round 19 — generalised private-server scope, bow training tiers, shield vs arrows, code only, 2026-10-30

Moon's refinement, which overrides the round 18 Boykissers-only wording: targeting and duelling are NOT just for Boykissers. They are for private servers and private worlds Moon owns or controls, so a server rename or a new world does not require rewriting the system. This round does NOT claim any new feature works live, and it does NOT add a server-name check to the code, because the bot connects via a host argument and a hardcoded name check would break a rename.

### Server scope generalisation — procedural guardrail, not a hardcoded name
- Targeting and duelling are now described in help text, in the round 18 header comment, and here as: private servers and private worlds Moon owns or controls only, never a public server, never Noah's server without Noah's explicit say-so live.
- The bot code itself has no server-name check for targeting or duelling. The guardrail is procedural: Moon only puts the bot on his own private servers, and every target still needs to be named, present in game, and, for a player, confirmed in a duel live, with a stop command at any time.
- Everything else from round 18 stays: one target at a time, no offline or guessed names, duel needs "duel <name>" plus "duel confirm", never attack Moon unless "duel me" was said first, stop on "stop duel" or "stop", stop on low health, no mass targeting.
- The round 11 Boykissers End first-join lobby feature is unchanged and is a separate, specific world feature, not a targeting scope rule. Its name stays because it describes that lobby, not because targeting is Boykissers-only.

### Bow, train him good — staged tiers, help first, low first
- `Nova, bow training help` — charge, distance tiers, drop, and leading in one place: full draw about 1 second for full damage and range, spam shots are weak, close 10 blocks or less, mid 11 to 20, long 21 to 30, over 30 refused, arrows drop over distance so far targets need aiming above, moving targets need aiming where they will be, not where they are, and that prediction is best-effort, never a claimed hit from bot data alone.
- `Nova, bow aim check` — bow yes/no, arrows, target and distance, tier, moving yes/no with velocity and speed as far as bot data shows, a best-effort lead amount for a moving target at that distance, and tier passes this session. A target that is not measurably moving is treated as stationary live.
- `Nova, bow training practice close` / `mid` / `moving` / `long` — one pending shot only, no shot yet, 2-minute expiry. Each tier refuses cleanly: no bow, no arrows, no target, a target no longer seen, a target over 30 blocks, a close target over 10, a mid target outside 11 to 20, a long target outside 21 to 30, a long target without close and mid passes live this session, a moving target that is not measurably moving, or a close/mid target that is moving right now. A player target is refused for bow training unless there is a confirmed duel with that exact player live; mobs first otherwise. The line-of-fire backdrop is Moon's live check, not claimed from bot data alone.
- `Nova, bow training shoot` — exactly one shot, then stops. Refuses on an expired pending shot or a missing bow or target on recheck. Equips the bow, looks at the target, with drop above for long tier and a best-effort lead point for moving tier, charges about 1 second, releases, and reports distance, aim note, shot attempted, arrows before/after, and target still seen. A hit is NOT claimed: bot data does not show arrow damage, and a target still seen or disappearing alone is not a hit claim.
- `Nova, bow training cancel` — clears a pending shot, no shot.
- `Nova, bow training passed live close` / `mid` / `moving` / `long` — refused without a training shot for that tier this session, otherwise records Moon's live confirmation only, session only, for that tier. A tier pass does not claim super-good bow skill overall.
- `Nova, bow training status` — tier passes this session, training shots this session, and any pending shot.
- No bow auto-fire, and bow is NOT in the impress routine by default, as in round 18.

### Shield vs arrows, not just melee
- `Nova, shield arrows help` — a shield blocks arrows and other projectiles from the FRONT if the bot is facing the shooter, it does not block from behind, it must be up before the arrow arrives, and an axe hit while blocking still disables a shield for 5 seconds. The block step is equip shield to offhand plus sneak, best-effort in mineflayer, not claimed as a perfect vanilla block pose until Moon watches it live.
- `Nova, shield arrows check` — shield in inventory yes/no, offhand slot, health/food, and a shooter source seen: nearest skeleton, stray, or bogged within range, otherwise Moon in game as a shooter source for a practice step with consent. If no shooter is seen, it says so plainly and does not invent one. It also reports facing front roughly yes/no from bot yaw versus shooter bearing, with the honest limit that this is an approximation, not a measured block.
- `Nova, shield arrows practice` — one timed block step only, then unblock, stopped. Refuses with no shield or no shooter source seen. It equips the shield to offhand, looks at the shooter, blocks about 3 seconds, then unblocks, and reports shooter, distance, facing, and health before/after. Health unchanged after a timed block only looks like damage was avoided as far as data shows, it is NOT a perfect-timing claim, and an arrow that already hit before the block is not blocked.
- `Nova, shield arrows duel step` — inside an active duel only, otherwise refused. Faces a shooter source seen in that step, blocks about 2 seconds, then unblocks to shoot or strike next, with health before/after reported. This is a best-effort block step inside a duel, not perfect timing, and it does not replace the duel tick, which still blocks briefly against melee before striking on a full cooldown.
- `Nova, shield arrows passed live` — refused without a shield arrows practice this session, otherwise records Moon's live confirmation only, session only. It does not claim perfect arrow blocking in a real fight.
- Shield vs arrows use inside a duel or target fight is therefore: face the shooter, block while projectiles are incoming for one timed step, unblock to shoot or strike, and stop anytime with "stop duel" or "stop". A blocked arrow is confirmed only by Moon watching live, because bot data does not show a blocked arrow as a number.

### Categories searched in round 19
Bow training design (distance tiers, full-draw charge, drop compensation by tier, leading a moving target by aiming ahead of current motion, best-effort prediction limits, tier unlocking by live passes); shield versus projectiles (front-only blocking, facing the shooter, block must be up before impact, axe disable still applies while blocking, best-effort mineflayer block pose); and scope generalisation (host-argument connection, why a hardcoded server-name check would break a rename, procedural guardrails stated in help and README instead).

### Categories STILL not covered after round 19 — training continues
- Bow super-good: no measured drop table, no moving-target prediction beyond a best-effort lead point, no long-range mastery claim, no bow hit confirmation from bot data, no bow auto-fire, no bow in the impress routine.
- Shield arrows perfect timing: no measured block timing against an actual incoming arrow, no blocked-arrow number from bot data, facing is an approximation from yaw and bearing, block pose is best-effort mineflayer, not a claimed vanilla-perfect block.
- Duel mastery: no strafing pattern, no kiting, no potion or food use mid-duel, no retreat-and-reengage beyond the low-health stop, no duel against multiple targets, no duel on a public server, no player attack outside a named confirmed duel on a private server Moon controls.
- Targeting beyond one target: no target list, no target priority, no automatic retargeting, no targeting offline or guessed names, no targeting by partial-name guess beyond an exact player/mob name match in game.
- Impress me as a fully self-setting show, auto-clutch as an actual save, ladder grab proof from data alone, parkour as reliable automation, mace clutch above 6 blocks or on hostiles, tower building as an executed step, and the warden scene as an executed attempt — all still not covered, as in rounds 1-18.
- Rejected list, unchanged except for the Moon-approved private-server duel/target exception: inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players outside a named duel/target on a private server Moon controls, modded worlds, Noah's server without Noah's say.

### Round 19 status, code only
- `node --check bot.js` — SYNTAX_OK, 6,655 lines (was 6,443).
- No bot process was started, stopped, or restarted in round 19. The live bot was left alone, as instructed, with pre-round-19 code. Round 19 code will only run on the next restart / live session, from a machine that can actually reach the server, after checking the server Connect panel again for the current address.
- Still code-only, needs Moon live in game to test, one at a time: bow training help (does it list charge, tiers, drop, and leading, and the best-effort limit), bow aim check on a stationary target, a moving target, and no target (does it report distance, tier, moving, and lead honestly, does it refuse no target), bow training practice close, mid, moving, and long, each with the wrong distance, with no bow, no arrows, and with a player target without a confirmed duel (does each refuse correctly, does long refuse without close and mid passes, does moving refuse a stationary target, does practice shoot nothing), bow training shoot for each tier (does it do exactly one full-draw shot, with drop above for long and a lead point for moving, does it claim no hit), bow training passed live before a shot and after a watched clean shot for each tier (does it refuse before, record only Moon's live confirmation after), bow training status (do tier passes match the session), bow training cancel (does it shoot nothing), shield arrows help, check, and practice with a shield and without one, with a skeleton nearby and with no shooter seen (does check report shooter and facing honestly, does practice refuse no shooter, does practice do one timed block facing the shooter then unblock, does it claim no perfect timing), shield arrows duel step without an active duel and with one (does it refuse without, do one block step with one inside), shield arrows passed live before and after a practice (does it refuse before, record only Moon's live confirmation after), target help and duel help wording (does it now say private servers Moon controls, not Boykissers-only, with no hardcoded server-name check in code), plus all outstanding round 1-18 tests.

## Round 20 — target block self-training, code only, 2026-10-30

Moon's idea: could the bot craft a target block and then train himself with that? He noted himself that moving training is not possible with a stationary target block, but the rest could be trained. This round implements that, staged, and does NOT claim any new feature works live.

### Target block mechanics, as used here
- Vanilla recipe: 4 redstone dust + 1 hay bale (hay_block), in a crafting table, makes 1 target block.
- When a projectile hits it, it emits a redstone signal, with strength based on how close to the centre the hit lands, closer = stronger, up to 15.
- Honest signal limit: in this codebase, mineflayer block data does not reliably expose that emitted signal as a number. A target block has no power blockstate to read here, its signal goes to adjacent redstone, so the code tries a power/signal property if one is actually present, polls briefly after a shot, and otherwise reports "signal not readable from bot data, check live" and never invents a score. A bot number is only reported if a numeric power field was actually found, which is not expected.

### New commands, all session only, Moon watching live
- `Nova, target block help` — recipe, materials, placement, signal, tiers, limits, and the moving-target exclusion.
- `Nova, target block check` — redstone dust count (need 4), hay bale count (need 1), target block in inventory yes/no, bow, arrows, placed target block nearby, stored target block, flat safe area under the bot, health/food. Backdrop and distance from Moon's builds are Moon's live checks, not claimed from bot data.
- `Nova, craft target block` — only with materials already in inventory, no /give, no operator command, needs a crafting table within 8 blocks, reports materials before/after and success only as far as inventory shows.
- `Nova, place target block` — only when Moon says it live, only via the existing place step (solid ground, no drop risk), never breaking a build to place it, and only records a stored position if a target block is verified nearby afterwards. Distance from builds is Moon's live check.
- `Nova, target block practice close` / `mid` / `long` — one pending shot only, no shot yet, 2-minute expiry. Tiers are the same as bow training: close 10 blocks or less, mid 11 to 20, long 21 to 30, over 30 refused, tier mismatch refused. Refuses with no bow, no arrows, or no stored target block.
- `Nova, target block shoot` — exactly one full-draw shot at the placed target block, then stops, reporting distance, tier, arrows before/after, target block still there, and signal strength IF bot data reliably showed it, otherwise "signal not readable from bot data, check live".
- `Nova, train target block close 5` (or mid/long, up to 10 shots) — the "train himself" part, but Moon-started and Moon-stoppable: one shot at a time with a pause and a report after each, stopping on low arrows, on Moon stop, on the target block breaking or moving, or on any unsafe condition. It is NOT an unsupervised overnight loop, and it does NOT train moving targets.
- `Nova, target block training status` — stored target block, pending shot, session tier/wanted/done/active, shots this session, arrows left, tier passes.
- `Nova, target block training stop` — stops an active session or cancels a pending shot, no shot fired by the stop itself.
- `Nova, target block passed live close` / `mid` / `long` — refused without a target block shot for that tier this session, otherwise records Moon's live confirmation only, session only.
- `Nova, round 20 help` — lists all round 20 commands.

### Also fixed in round 20, no behaviour change intended
- The round 18 dispatch block was orphaned at top level before parseFuzzyIntent, so the file crashed on load with "ReferenceError: cmd is not defined" (verified by running a /tmp copy before the fix, which crashed at line 5145; a /tmp copy after the fix starts cleanly, ECONNREFUSED only because no server is listening there). That block is now the first block inside parseFuzzyIntent, so rounds 18-20 load and run. The live bot was left alone, as instructed, with pre-round-20 code, so this fix matters on the next restart, not before it.
- Round 20 dispatch runs first inside parseFuzzyIntent, so "target block ..." is not swallowed by the round 18 "target <name>" pattern.

### Categories searched in round 20
Target block recipe and signal (redstone dust + hay bale, centre-proximity signal up to 15); mineflayer block-data limits for that signal (no reliable power blockstate in this codebase); staged self-training design (Moon-started, capped at 10 shots, one shot at a time, pause and report after each, stop conditions); reuse of existing craft, place, bow-draw, and inventory-count helpers.

### Categories STILL not covered after round 20 — training continues
- Target block signal as a bot-measured score: not claimed, signal is reported only if a numeric power field is actually found, otherwise Moon checks it live.
- Moving-target training with a target block: impossible by design, it is stationary; moving training stays with mobs and duels live only.
- Unlimited or unsupervised self-training: capped at 10 shots per session, Moon-started, Moon-stoppable, no overnight loop.
- Auto-crafting from nothing, auto-placing on a build, training on players with a target block, or a claimed hit score from invented data: all deliberately not added.
- Bow super-good overall, shield arrows perfect timing, duel mastery, impress me as a fully self-setting show, auto-clutch as an actual save, ladder grab proof from data alone, parkour as reliable automation, mace clutch above 6 blocks or on hostiles, tower building as an executed step, and the warden scene as an executed attempt — all still not covered, as in rounds 1-19.
- Rejected list, unchanged: inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players outside a named duel/target on a private server Moon controls, modded worlds, Noah's server without Noah's say.

### Round 20 status, code only
- `node --check bot.js` — SYNTAX_OK, 6,899 lines (was 6,655; +244, including moving the round 18 dispatch block with no net line change for that move itself).
- Load test in a /tmp copy (not the live bot, not the live log or command file): starts cleanly, ECONNREFUSED only because no server is listening on the test port, no ReferenceError.
- No bot process was started, stopped, or restarted in round 20. The live bot was left alone, as instructed, with pre-round-20 code. Round 20 code will only run on the next restart / live session, from a machine that can actually reach the server, after checking the server Connect panel again for the current address.
- Still code-only, needs Moon live in game to test, one at a time: target block help (does it list recipe, signal, tiers, and the signal-readability limit, and does it exclude moving training), target block check with and without materials (does it report counts honestly), craft target block with materials and without them (does it refuse without materials, does it need a table, does it report inventory before/after honestly), place target block (does it refuse without a target block, does it verify a placed block nearby before recording a position, does Moon check distance from builds live), target block practice close, mid, and long, each with the wrong distance, with no bow, no arrows, and with no stored target block (does each refuse correctly, does practice shoot nothing), target block shoot (does it do exactly one full-draw shot, does it report arrows and still-there honestly, does it report signal not readable rather than inventing a score, unless a power field is actually found), train target block with 5 shots and with 11 shots (does 11 refuse at the 10 cap, does a session do one shot at a time with a pause and a report after each, does it stop on low arrows, on stop, and on the target block disappearing), target block training status and stop (does status match the session, does stop fire no shot), target block passed live before a shot and after a watched clean shot for each tier (does it refuse before, record only Moon's live confirmation after), plus all outstanding round 1-19 tests.

## Round 21 — lure skill + target redstone line, code only, 2026-10-30

Moon's two ideas, staged, and this round does NOT claim any new feature works live.

### Lure skill
- One mob per journey, repeat for more. Supported: pig, cow, sheep, chicken, horse, donkey, wolf, cat, fox, goat, rabbit. Hostile mobs and players are never lured.
- Follow foods: pig carrot/potato/beetroot, cow and sheep wheat, chicken seeds, horse and donkey golden apple/golden carrot, fox sweet berries, goat wheat, rabbit carrot/golden carrot/dandelion.
- Wolves are different, stated in help: wolves do NOT follow a bone like a pig follows a carrot. An untamed wolf needs bones to tame, then a tamed wolf follows its tamer, or use a lead. Cats need cod/salmon, approached slowly and crouched.
- Leads are an option: default is lead first if one is in inventory, then food/taming. Explicit `with lead` or `with food` forces that method.
- Commands: `Nova, lure help`, `Nova, lure check <mob>`, `Nova, lure <mob> to here` / `to this spot` / `to <label>` for step 1 only, no movement yet, with optional `with lead`, `with food`, or `hole` at the end, `Nova, lure confirm` for one journey with Moon watching, `Nova, lure status`, `Nova, lure stop` anytime, `Nova, lure passed live` only after Moon watched a full lure clean.
- Destination is never guessed: "here" means where Moon is standing when the command is said, a label means a spot remembered live with "remember <label>", and hole mode stops at the hole edge — Moon's live step guides or pushes the mob in, the bot does NOT push a mob into a hole blind and does NOT break blocks to make a hole. Max 64 blocks to the destination.
- Lead breaks, as Moon specified: mineflayer data used here does NOT expose a clean isLeashed flag, so a break is sensed best-effort — a dropped lead item seen nearby, or the mob suddenly far from the bot and not following for several checks — then the bot stops, walks to the dropped lead if one is seen, reports lead count before/after, recatches the mob and re-attaches the lead, then resumes. If the lead is not found, the mob is lost, or the lead breaks more than 3 times, the journey pauses and reports, it does NOT loop blind forever.

### Target redstone line
- Signal decay: a target signal of strength S should power S dust blocks in a straight line (first dust S, next S-1, down to 1), so counting powered dust in a 15-block line gives the signal, IF dust power is readable.
- Research in code: minecraft-data 1.21.10 lists redstone_wire with a power state, int 0-15, and this codebase already reads wire.properties.power in the redstone power check, so a dust line IS code-readable in principle, unlike the round 20 direct target read, which round 20 could not rely on.
- Live verification still required: the signal is transient, it must be read right after a shot, before it fades, and if first-dust power and powered-dust count disagree, Moon checks live.
- Commands: `Nova, target redstone help`, `Nova, target redstone check` (stored target, dust count, line), `Nova, target redstone line east` / west / north / south — direction is never guessed, Moon names it, only on flat solid ground far from Moon's builds when Moon says it live, never breaking builds, placing one dust at a time walking along the line, stopping on bad ground, occupied space, or a failed placement, `Nova, target redstone read` after a shot (powered count, first dust power, inferred signal = powered count, with the disagree caveat), and `Nova, round 21 help`.
- Integration: `Nova, target block shoot` now also reports the redstone line count if a line is stored, otherwise the old not-readable message.
- This line method, if it works live, supersedes the round 20 "signal not readable" limit FOR A LINE ONLY; with no line, the round 20 direct-read limit still stands.

### Categories searched in round 21
Lure methods by mob (follow foods, taming vs following, lead as an option, wolf distinction); lead-break sensing limits in mineflayer data (no clean leashed flag, dropped-lead and distance/following as best-effort signals, 3-break cap); redstone dust power state in minecraft-data and the existing redstone power check; straight-line dust placement (solid ground below, free space above, walk-along placement, stop on failure).

### Categories STILL not covered after round 21 — training continues
- Lure: multi-mob herding, pushing a mob into a hole blind, making a hole, a guaranteed leash flag, luring hostile mobs or players, luring beyond 64 blocks, or a lure that continues after 3 lead breaks.
- Target redstone line: live verification that dust power actually reads and holds long enough after a shot, a measured signal when first-dust power and powered count disagree, or a line on non-flat ground.
- Bow super-good overall, shield arrows perfect timing, duel mastery, impress me as a fully self-setting show, auto-clutch as an actual save, ladder grab proof from data alone, parkour as reliable automation, mace clutch above 6 blocks or on hostiles, tower building as an executed step, and the warden scene as an executed attempt — all still not covered, as in rounds 1-20.
- Rejected list, unchanged: inventory sorting, operator commands by the bot itself, mass hunting, mass farming, breaking Moon's builds, attacking players outside a named duel/target on a private server Moon controls, modded worlds, Noah's server without Noah's say.

### Round 21 status, code only
- `node --check bot.js` — SYNTAX_OK, 7,259 lines (was 6,899; +360).
- Load test in a /tmp copy (not the live bot, not the live log or command file, NODE_PATH pointed at the workspace node_modules): starts cleanly, ECONNREFUSED only because no server is listening on the test port, no ReferenceError.
- No bot process was started, stopped, or restarted in round 21. The live bot was left alone, as instructed, with pre-round-21 code. Round 21 code will only run on the next restart / live session, from a machine that can actually reach the server, after checking the server Connect panel again for the current address.
- Still code-only, needs Moon live in game to test, one at a time: lure help (does it list methods, the wolf distinction, lead breaks, and hole mode), lure check with and without a mob, with and without a lure item, lure to here and to a remembered label and to an unknown label (does unknown refuse, does setup move nothing), lure confirm for a food mob and for a wolf with a lead (does it walk to the mob, attach/hold, walk back slowly, arrive only with bot and mob both at the destination), lure stop during a journey, lure passed live before and after a watched clean lure, lead break handling live (does it stop, pick up a dropped lead if seen, recatch and resume, and pause after 3 breaks or a lost mob/lead), hole mode (does it stop at the hole edge and not push blind), target redstone help, check, and line east/west/north/south (does it refuse without a stored target, without dust, and without a direction, does it place one dust at a time and stop on bad ground or occupied space, does it record only placed dust), target redstone read after a shot (does powered count match first dust power live, does it report not readable rather than inventing a score if dust power is not readable), target block shoot with a line stored (does it also report the line count), plus all outstanding round 1-20 tests.

### Round 22: enderman safety + death-loot return

Moon's live ask, 2026-10-30, while playing: the bot looked at an enderman, and the bot died at 16:03 UTC and respawned. Code only, not live-tested, staged, Moon-confirmed only.

#### Enderman safety
- Automatic, once per encounter, not spammy: every 5-second auto-tick, if an enderman is within about 16 blocks and the bot is not fighting or guarding, the bot looks down and away from it (a point away from the enderman and below its own height, via lookAt) and says so briefly once for that encounter. A new enderman, or the same one after it leaves and returns, gets one fresh warning. If Moon explicitly fights or guards, the safety tick skips and resets, so it does not fight Moon's own fight command.
- Help states the vanilla facts: looking at an enderman's head/face can anger it; looking away, or wearing a carved pumpkin on the head, avoids look-aggro.
- Pumpkin: `Nova, wear pumpkin` / `wear carved pumpkin` equips a carved pumpkin to the head if one is in inventory, then verifies it is actually on the head (inventory slot 5 or equipped gear) before claiming it is worn. If no pumpkin is in inventory, or the wear does not verify, it says so plainly and does not claim a pumpkin is worn.
- Commands: `Nova, enderman help`, `Nova, enderman check` (nearest enderman distance within 32 blocks, water bucket count, nearest water block within 32 blocks, dimension, health/food, carved pumpkin worn verified or not and in inventory), `Nova, wear pumpkin`, `Nova, round 22 help`.
- Honest limit, in help: mineflayer data here does not reliably show an enderman's aggro state from the bot's own look, so "mad" is Moon's live call, or an attack actually in progress (entityHurt / self-defense), never a data claim about a look.

#### Enderman defense, staged, Moon-confirmed
- Order, as Moon asked: if Moon says fight, fight back with the existing `fight` step; otherwise retreat to water. Endermen take damage in water and teleport away.
- Commands: `Nova, enderman water` for step 1 only, no movement yet (method chosen: water bucket first if one is in inventory, otherwise walk to nearest water within 32 blocks; refused if neither, and refused in the Nether, where placed water evaporates and there is no standing water to walk to), `Nova, enderman water confirm` for one attempt with Moon watching (2-minute pending expiry, like other confirms), `Nova, enderman stop` anytime, `Nova, enderman passed live` only after Moon watched a clean water retreat, session only.
- Bucket attempt: equips a water bucket, places water at the bot's feet on solid ground below, never breaking builds, reports whether water was actually seen at its feet and health before/after, and does NOT claim the enderman teleported away — Moon checks that live.
- Walk attempt: pathfinds to the nearest water block within 32 blocks (12-second reach check), stops on arrival or timeout, reports reached nearby yes/no and whether it is standing in water as far as data shows, and health before/after, again without claiming a teleport.
- A generic `stop` / `stop everything` also clears a pending enderman retreat and stops a death journey, then falls through to the normal stop handling, so stop anytime works for round 22 too.
- Self-defense note: if an enderman actually hurts the bot, the existing self-defense path may already start a fight; Moon can say `stop` to stop it, then use the water retreat.

#### Death-loot return
- On death, before respawn, the bot records the death position (bot position at death, or its last known bot position from the auto-tick if that is missing) and the death time, session only. If no position is available, nothing is recorded and no position is invented.
- On the next spawn, if a death was recorded, the bot says briefly once where it died and that its stuff despawns in about 5 minutes, with a prompt to say `return to my stuff`. It does NOT auto-run to the death spot on respawn, because running blind could be dangerous — Moon must say it.
- Commands: `Nova, death spot` (last death position and elapsed time, plus an about-5-minute despawn time-left estimate, or "no death recorded this session" with no invented position), `Nova, return to my stuff` / `go to death spot` for one staged journey there, `Nova, death spot stop` anytime, `Nova, round 22 help`.
- The journey stops on arrival (within 2.5 blocks), on `death spot stop` / generic `stop`, on health under 8, or after 3 minutes. On arrival or pause it reports dropped items actually seen nearby in data (within 8 blocks, item entities only, by name/object type) and the inventory total before/after. It never names item types from data alone, and it never claims items recovered without an inventory increase live; with no increase it says plainly that no recovery is claimed.

#### Round 22 status, code only
- `node --check bot.js` — SYNTAX_OK, 7,517 lines (was 7,260; +257).
- Load test in a /tmp copy (not the live bot, not the live log or command file, NODE_PATH pointed at the workspace node_modules): starts cleanly, ECONNREFUSED only because no server is listening on the test port, no ReferenceError.
- No bot process was started, stopped, or restarted in round 22. The live bot was left alone, as instructed, with pre-round-22 code. Round 22 code will only run on the next restart / live session.
- Still code-only, needs Moon live in game to test, one at a time: enderman help and check with and without an enderman nearby, with and without a bucket, water, and pumpkin; wear pumpkin with and without a pumpkin, and whether the worn check verifies; look-away once per encounter (does it say once, not spam, and skip while fighting); enderman water step 1 (does it move nothing, refuse with no bucket and no water, refuse in the Nether); enderman water confirm bucket and walk routes (does it place water only on solid ground, report placement verified or not, walk only to water within 32 blocks, and never claim a teleport); enderman stop during a pending retreat; enderman passed live before and after a watched clean retreat; death spot with no death recorded (does it refuse without inventing), after a death (does the respawn announcement fire once, with the right position and 5-minute warning); return to my stuff (does it stop on arrival, on stop, and on timeout, report dropped items seen and inventory change only, and never claim recovery without an increase); plus all outstanding round 1-21 tests.

### Round 23: learned phrases from live play

Moon's live phrases, 2026-10-30, logged as `[unknown-message]` because bare chat (no `Nova, ` prefix) never reaches the command dispatch — the chat handler tries a social reply first, then forwards unknown bare chat to Nova. Round 23 fixes both paths, so the bare form and the `Nova, ` form both work, with no `Nova, ` needed.

- `Fight!` / `fight` — starts the existing hostile-mob-only fight step (the same `setFight(true)` as `Nova, fight`): hunt the nearest hostile mob near Moon, attack until it dies, then the next one, all-clear and stop on its own when none are left. It never attacks a player; fight mode targets `findNearestHostile` only. Note: `fight` was already a switch case for the `Nova, ` path, but bare `Fight!` never reached it, which is why it was logged unknown — the bare-chat fix is the actual change for this phrase.
- `Need food?` / `need food` — checks whether the bot needs food. "Low" here means not full (food under 20) or hurt (health under 20), because a hurt bot needs food to regenerate. If so, it eats one held food item via the existing `eatHeldFood` (which says `Ate X`, or `I don't have any food to eat` if inventory shows none, or a failure line) — no food count is invented, inventory is the only source. If food is 20 and health is 20, one short line says he does not need food right now, with no numbers and no stat dump.
- `What do you know?` / `what do you know` — a SHORT answer, deliberately not the huge help dump: follow, fight, guard, eat, open doors, craft, mine, go to water for endermen, and return to my stuff, plus `say "help" for the full list`, all in one chat message.
- `round 23 help` — lists the three phrases above.
- Dispatch: all three patterns are at the top of `parseFuzzyIntent` (for the `Nova, ` path) and at the top of `conversationalReply` (for bare chat), before any fuzzy/generic pattern that could swallow them.

#### Round 23 status, code only
- `node --check bot.js` — SYNTAX_OK, 7,568 lines (was 7,517; +51).
- Load test in a /tmp copy (not the live bot, not the live log or command file, NODE_PATH pointed at the workspace node_modules): starts cleanly, ECONNREFUSED only because no server is listening on the test port, no ReferenceError.
- No bot process was started, stopped, or restarted in round 23. The live bot was left alone, as instructed, with pre-round-23 code. Round 23 code will only run on the next restart / live session.
- Still code-only, needs Moon live in game to test, one at a time: bare `Fight!` (does fight mode start, hostile only, no player attack), bare `Need food?` with food and with no food, and when full and healthy (does it eat once, say it has none, or say it does not need any, in one short line, no numbers), bare `What do you know?` (is it one short message, not the huge help dump), and the same three with a `Nova, ` prefix; plus all outstanding round 1-22 tests.

### Round 24: sleep fix (bug found live, 2026-10-30)

Bug: the bot could not sleep. When Moon slept in game, or said "Nova, sleep" / "Nova, go to sleep", `bot.log` showed, every 3 seconds from the sleep tick, `[sleep] routine error: Cannot read properties of undefined (reading 'x')`, and the bot never got into a bed. The live bot's log on 2026-10-30 still shows this error on its pre-round-24 code, which is the expected behaviour until the next restart.

Root cause, verified in code and in mineflayer 4.39: `bot.findBlocks` returns Vec3 positions, not Block objects, but the old `trySleepOnce` treated each result as a Block — it called `bot.parseBedMetadata(bed)` on a Vec3, and then read `bed.position.x`, where `bed.position` is undefined on a Vec3, so it threw before ever calling `bot.sleep`.

Fix:
- `trySleepOnce` now uses a new `r24FreeBeds()` helper: it takes the Vec3 positions from `findBlocks`, converts each one to a real Block with `bot.blockAt(position)`, skips positions where `blockAt` returns null (chunk not loaded), and only then checks occupied status with `bot.parseBedMetadata(block)`. The Vec3 is used for pathfinding (`GoalNear`), and the real Block is passed to `bot.sleep`.
- Behaviour otherwise unchanged: nearest free bed within 32 blocks, up to 4 beds tried, brief message if no bed nearby or monsters nearby, wake when Moon wakes, no override of fight/guard/stay. New safety: sleeping in the Nether or the End is refused outright, because beds explode there — the old code attempted it blind.
- Asking about sleep no longer wakes a sleeping bot: the wake-on-any-order rule in `runAction` now exempts `sleep`, `sleep check`, `check sleep`, `sleep help`, and `sleep check help`.
- Same Vec3-vs-Block pattern fixed anywhere else it was found treating a `findBlocks` result as a Block with `.position`: doors (`findNearestDoor` now works in Vec3 and returns a real Block from `bot.blockAt`), crafting tables in `craftItems` and `gatherGeneric`, mining in `mineItems`, gathering in `gatherBlocks`, buttons/levers/trapdoors in `activateNearest`, furnaces in `smeltNamed` and `takeFromFurnace`, the block finder in `blockNearby` and `findThing` (which now returns the Vec3 itself as the position, and the search term as the name, instead of reading `.name`/`.position` off a Vec3), the scan in `sayScan` (wood/water/crops/ore distances now use `Vec3.distanceTo`), and enderman water in round 22 (`enderman check` distance and `enderman water confirm` walk target now use the Vec3 directly). Sites that already used the Vec3 correctly (ladder/rail scans, lobby scans, target-block finding) were left alone.
- New commands, all brief, no long stat dump: `sleep help` (what sleep does and does not do), `sleep check` / `check sleep` (already sleeping, cannot sleep here in the Nether/End, or yes/no for a free bed nearby, with no coordinates), and `round 24 help` (this fix in one message).

#### Round 24 status, code only
- `node --check bot.js` — SYNTAX_OK, 7,622 lines (was 7,568; +54).
- Load test in a /tmp copy (not the live bot, not the live log or command file): with `MC_VERSION=1.21.10` and a dummy host/port with nothing listening, it starts cleanly, ECONNREFUSED only, no ReferenceError. (A first /tmp run pointed at the live adapter port without the version env, so it correctly reported a version mismatch with the live 1.21.10 server; that run touched no live bot process or file.)
- No bot or adapter process was started, stopped, or restarted in round 24. The live bot (started 2026-10-30 15:53 UTC) was left alone, as instructed, with pre-round-24 code — so it still shows the sleep error in its log until the next restart. Round 24 code will only run on the next restart / live session.
- Still code-only, needs Moon live in game to test, one at a time: `sleep check` with and without a free bed nearby, and in the Nether/End (does it refuse, not attempt); `sleep` / `go to sleep` at night with a free bed nearby (does he walk to it and actually sleep, with no `[sleep] routine error` in the log); Moon sleeping in game (does the bot join him in a bed, and wake when Moon wakes); `sleep` with monsters nearby (does it say so briefly, not spam); `sleep check` while already sleeping (does it NOT wake him); plus the same-pattern fixes live: open/close a door, craft at a table, mine, gather, smelt, find a thing, scan, and enderman water check/confirm (do they now work instead of silently failing); plus all outstanding round 1-23 tests.

### Round 25: specific hunt, general gathering with quantity, bring = go get first, planks from trees

Moon, live 2026-10-30: "Nova, kill a chicken", "Hunt chicken", and "Gather chicken" were all logged unknown (only plain "hunt" existed, for any nearby passive, up to 3). "Nova, bring me two blocks of dirt" was read as one item name "two blocks of dirt", and "Nova, get two blocks of dirt" fell through to `gatherGeneric("two blocks of dirt")`, which `findItemType` cannot resolve. Moon then broadened this: dirt was only one example, gathering must work overall, and planks must come from cutting a tree and crafting, not just from inventory.

- Quantity parsing, everywhere it matters: a leading number, or a number word from one to ten, and phrases like "two blocks of dirt", "2 dirt", and "a block of dirt" are parsed into amount + item name, capped at 64 (one stack) per single request. "mine 2 dirt" and "get 2 dirt" mine exactly 2 dirt, or report fewer if fewer are found nearby, never inventing more. If no amount is given, get/mine defaults to 1, and the older wood/food defaults (5) are kept for those two.
- Specific hunt: `hunt <animal>`, `kill a <animal>`, `kill <animal>`, `hunt a <animal>`, and `gather <animal>` for chicken, cow, pig, sheep, and rabbit only (the existing passive-food list). It hunts ONE of that specific type, then stops and says so briefly. If none of that type is within 16 blocks, it says so briefly and stops, and never hunts a different animal blind. It never hunts players, and never hunts hostiles with this command (use `fight` for hostiles). It stops on low health under 8, on timeout after 20 seconds, or on `stop`.
- General gathering: `get`, `mine`, `dig`, `gather`, `find`, and `collect` now go find and mine/gather the thing within a safe distance (blocks within 24 blocks for mining, trees within 24, entities within 16 for a specific hunt), for blocks, items, crops, wood, food, ores, and other common things. Ores: "iron" means iron ore, as in the existing mine-ore pattern. If the thing is a block in the world, it mines it; if it is craftable and not in the world, it tries a recipe; otherwise it says briefly that it cannot find or craft it nearby. `find` for an entity (for example "find a wolf") walks to that entity instead of trying to mine it. `collect drops/items/loot`, `get out of the water`, and `get unstuck` are explicitly not swallowed by the new patterns.
- Bring = go get first: `bring me X` / `give me X` no longer just check inventory. If the bot does not already have the requested amount, it first tries to get it (mine a block, gather wood/food/crops, craft, or hunt for meat, as appropriate, within range), then walks to Moon and drops it, stack by stack, so an amount spread over several stacks is actually delivered. If it cannot be found or crafted nearby, it says so briefly and stops, and never claims it. If it found fewer than asked for, it says so and brings what it found. No amount is fetched beyond what Moon asked for (capped at 64 per request), and it stops on `stop`.
- Planks from trees: `bring me oak planks`, `get birch planks`, and so on. The bot finds a tree of that exact kind, chops logs, calculates logs needed as ceiling(requested planks / 4) because 1 log crafts to 4 planks, crafts that many planks, and (for `bring`) brings them to Moon. If no kind is specified ("planks" / "wood planks"), any log kind is fine. If a specific kind is requested, only that kind counts: it never substitutes a different wood, and if that tree kind is not found nearby it says so briefly and stops. Tree check, for every kind: a log is only chopped if leaves are nearby (within 2 blocks sideways, up to 6 blocks above, so lower trunk logs count), so a log-built wall with no leaves is skipped, never dug. Limit: a tree whose leaves have already decayed will also be skipped. Bamboo planks are not supported yet (bamboo needs bamboo blocks first) and are refused briefly, not substituted. Supported plank kinds: oak, birch, spruce, jungle, acacia, dark oak, mangrove, cherry, crimson, warped.
- Dispatch: all Round 25 patterns run first in `parseFuzzyIntent` (for the `Nova, ` path) and first in `conversationalReply` (for bare chat, no `Nova, ` needed), before any generic pattern that could swallow them. `round 25 help` lists them briefly. Replies are brief, no long stat dumps. Round 24's findBlocks Vec3 fix was verified still in place in `mineItems`/`gatherGeneric` (they use the Vec3 directly, not `.position` on it) and was not reintroduced.
- Honest limits: mineflayer data cannot reliably tell a block that is part of Moon's build from a wild block of the same type, except for logs (leaf check above). Gathering therefore mines the nearest matching block within range, never beds, doors, chests, furnaces, crafting tables, or bedrock (already blocked in `mineItems`), and Moon should not ask for a block that is part of his build. Planks are never mined from a build: they are crafted from tree logs. Nothing here uses /give or any operator command. Specific-hunt drops are picked up by walking over them in game, as with normal play; the bot does not claim a specific drop item type from data alone.

#### Round 25 status, code only
- `node --check bot.js` — SYNTAX_OK, 7,946 lines (was 7,622; +324).
- Load test in a /tmp copy (not the live bot, not the live log or command file): starts cleanly, ECONNREFUSED only on a dummy port, no ReferenceError. The /tmp test copy was removed afterwards.
- No bot or adapter process was started, stopped, or restarted in round 25. The live bot (started 2026-10-30 15:53 UTC) was left alone, as instructed, with pre-round-25 code. Round 25 code will only run on the next restart / live session.
- Still code-only, needs Moon live in game to test, one at a time: `hunt chicken` / `kill a chicken` / `gather chicken` (does it hunt one chicken only, stop, and refuse with none nearby, never a different animal); `get two blocks of dirt` / `get 2 dirt` / `get a block of dirt` (does it mine exactly that many, or report fewer); `get 3 stone`, `get wood`, `get food`, `mine iron` (ore handling), `find` for a block vs an entity; `bring me dirt` when he has none (does it go get it first, then bring it, and say so if it cannot be found); `bring me 8 oak planks` (does it cut oak only, craft 8, and bring 8, never birch); `bring me birch planks` with no birch nearby (does it refuse without substituting); `bring me planks` with no kind (any wood, brief reply); `stop` during a hunt, a gather, and a bring-fetch; plus all outstanding round 1-24 tests.

#### Categories STILL not covered after round 22
- Enderman: a data-reliable aggro state from the bot's own look, a guaranteed teleport-away claim from water, water defense in the Nether, or fighting an enderman with a specific weapon/cooldown strategy beyond the existing generic fight step.
- Death loot: item-type tracking of dropped items, pickup of specific items by name, a journey beyond 3 minutes or through dangerous terrain blind, or auto-return on respawn (deliberately not implemented, Moon must say it).
- All round 1-21 still-not-covered items remain, as listed above.
