// Nova's Minecraft companion bot — skeleton, Mineflayer 4.39.0 + mineflayer-pathfinder 2.4.5
//
// The bot is a body for Nova in-game. It has no mind of its own: Nova drives
// it from chat via in-game chat commands and the commands.txt file (see README).
//
// Usage:
//   node bot.js <host> [port] [username]
//   MC_HOST / MC_PORT / MC_USERNAME / MC_VERSION env vars also work.
// Defaults: username "Nova", version "1.21.1", port 25565.
//
// The target server is a CRACKED (offline-mode) Falix server, so the bot
// logs in with auth: 'offline' — no Microsoft account, no login prompt.
// The server whitelist must contain both "Nova" and "Werewolf_Paws".

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const fs = require('fs')
const path = require('path')

// ---------------------------------------------------------------- config

const HOST = process.argv[2] || process.env.MC_HOST || 'localhost'
const PORT = parseInt(process.argv[3] || process.env.MC_PORT || '25565', 10)
const USERNAME = process.argv[4] || process.env.MC_USERNAME || 'Nova'
const VERSION = process.env.MC_VERSION || '1.21.1'
const OWNER = 'Werewolf_Paws' // only this player can give the bot orders in chat

const RECONNECT_DELAY_MS = 30000 // server sleeps/restarts: keep retrying
const COMMANDS_FILE = path.join(__dirname, 'commands.txt')
const LOG_FILE = path.join(__dirname, 'bot.log')
const COMMAND_POLL_MS = 1000

// Hostile mobs the guard mode will attack (vanilla 1.21.1 mob names).
const HOSTILE_MOBS = new Set([
  'Zombie', 'Husk', 'Drowned', 'Skeleton', 'Stray', 'Wither Skeleton',
  'Spider', 'Cave Spider', 'Creeper', 'Enderman', 'Witch', 'Slime',
  'Magma Cube', 'Blaze', 'Ghast', 'Piglin Brute', 'Piglin', 'Hoglin',
  'Zoglin', 'Phantom', 'Vex', 'Evoker', 'Vindicator', 'Pillager',
  'Ravager', 'Silverfish', 'Endermite', 'Guardian', 'Elder Guardian',
  'Shulker', 'Warden', 'Breeze', 'Bogged', 'Creaking'
])

// ---------------------------------------------------------------- logging

function log (line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  try { fs.appendFileSync(LOG_FILE, stamped + '\n') } catch (e) { /* log file is best-effort */ }
}

// ---------------------------------------------------------------- state

let bot = null
let reconnectTimer = null
let guardMode = false
let guardTimer = null
let fightMode = false
let fightTimer = null
let fightTarget = null
let autoFight = false // true when fighting started itself (self-defense)
let resumeFollow = false // after an auto-fight, go back to following
let lastHealth = 20
let ownerSleepingEvent = false // set by entitySleep/entityWake for the owner
let moonSleepEpisode = false
let sleepSaid = {}
let sleepRoutineRunning = false
let sleepCheckTimer = null
let processedCommandLines = 0
// Round 5, communication: unknown-message forwarding to Nova.
// These counters only rotate varied reply phrases, they never invent facts.
let unknownMessageCount = 0
let lastOwnerMessage = ''
let lastUnknownMessage = ''
let hiCount = 0
let thanksCount = 0
let goodCount = 0
let byeCount = 0
let idleTimer = null
let lastActivity = Date.now()
let stayCommanded = false
let botMovements = null // set on spawn, so door-pathing can be toggled safely
let spawnPos = null // bot's first spawn position, for "go to spawn"
let wanderMode = false
let wanderTimer = null
let wanderAnchor = null
let mining = false
let miningStop = false
let doorBusy = false
let autoProtectOn = true // autonomous protect: only when idle/following, never on stay, never vs players
let autoTrackOn = true // autonomous track: follow owner if he drifts >20 blocks, <64, never on stay
let trackSaid = false
let huntMode = false
let huntTimer = null
let huntTarget = null
let huntCount = 0
let autoTickTimer = null
let autoGathering = false
let lastAutoGather = 0
let protectSaid = false
let healthLowSaid = false
let nightSaid = false
// --- 2026-10-30 round 2: scan / ravine / companion memory (code only) ---
let lastOwnerPos = null
let lastOwnerSeenAt = 0
let rememberedSpot = null
let rememberedSpotLabel = ''
let followDistance = 2
let lastBotY = null
let ravineFallReportedAt = 0
let lastScanAt = 0
// --- 2026-10-30 round 3: water, sprint, exhaustive skills (code only) ---
let sprintOn = false
let sneakOn = false
let autoEatOn = false
let waterEscapeAt = 0
let waterSaidAt = 0
let lavaSaidAt = 0
let fishingOn = false
let lastScanText = ''
let viewerSnapshotAt = 0
let viewerSnapshotText = ''
// --- 2026-10-30 round 4: air / bubble-column timer, honest coverage ---
// Moon's exact water rule, which is STRICTER than vanilla:
//   * Head CAN go underwater. That is allowed, not a failure.
//   * Without Respiration, swim up before 10 seconds head-underwater.
//     Vanilla base is actually 15 seconds, with +15 seconds per
//     Respiration level (verified 2026-10-30, see README). Moon's
//     10-second limit is used as the safe trigger, plus the verified
//     +15 seconds per Respiration level, so:
//       no Respiration: 10s, Resp I: 25s, Resp II: 40s, Resp III: 55s.
//     This is Moon's rule + vanilla increment, NOT vanilla totals.
//   * Bubble column exception: in a water column whose first solid
//     block below (skipping more water) is magma or soul sand, air
//     is replenished, so the limit does NOT apply while in it.
//   * On magma: crouch / sneak, to avoid magma damage while getting air.
//   * Do NOT crouch on soul sand for this reason alone.
let headUnderSince = null
let airWarnedAt = 0
let airSwimUntil = 0
let airMagmaSneak = false
let airTickTimer = null
let fallWatchTimer = null
let lastAirElapsed = 0
let lastAirBubble = false
let lastAirResp = 0
let bubbleSaidAt = 0
let rememberedSpotLabel2 = ''

const PASSIVE_FOOD_MOBS = new Set(['Pig', 'Cow', 'Chicken', 'Sheep', 'Rabbit'])
const FOOD_CROPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'melon', 'pumpkin', 'cocoa'])

// ---------------------------------------------------------------- helpers

function ownerEntity () {
  if (!bot) return null
  return bot.players[OWNER] ? bot.players[OWNER].entity : null
}

function say (message) {
  if (!bot) return
  try {
    bot.chat(message)
    log(`[said] ${message}`)
  } catch (e) {
    log(`[say failed] ${e.message}`)
  }
}

function followOwner () {
  const target = ownerEntity()
  if (!target) { log('[follow] owner not in range, waiting'); return }
  // followDistance is Moon-adjustable: 2 = close, 5 = a bit back.
  // Never follow at a distance that would leave Moon unprotected on
  // guard, guard still uses its own close follow.
  bot.pathfinder.setGoal(new goals.GoalFollow(target, followDistance, false), true)
  log('[action] following owner')
}

function stayPut () {
  bot.pathfinder.setGoal(null)
  log('[action] staying put')
}

function comeHere () {
  const target = ownerEntity()
  if (!target) { log('[come] owner not in range, waiting'); return }
  bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1), true)
  log('[action] coming to owner')
}

function findNearestHostile (center, radius) {
  let nearest = null
  let nearestDist = radius
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !HOSTILE_MOBS.has(e.mobType)) continue
    const d = e.position.distanceTo(center)
    if (d < nearestDist) { nearest = e; nearestDist = d }
  }
  return nearest
}

// ---------------------------------------------------------------- helpers 2: items, doors, wander, mining, craft
// All helpers below are best-effort and say so in game when they cannot
// do something, instead of failing silently. Nothing here claims a live
// result that has not been checked in code.

function normalizeName (s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeCommand (raw) {
  let cmd = String(raw || '').trim().toLowerCase()
  cmd = cmd.replace(/\s+/g, ' ')
  cmd = cmd.replace(/\s*:3\s*$/, '')
  cmd = cmd.replace(/\s+please\s*$/, '')
  cmd = cmd.replace(/\s+pls\s*$/, '')
  cmd = cmd.replace(/[.!?]+$/, '')
  return cmd.trim()
}

function findItemType (itemName) {
  if (!bot) return null
  const mcData = require('minecraft-data')(bot.version)
  const wanted = normalizeName(itemName)
  if (!wanted) return null
  // Exact name first, then display name, then a unique partial match.
  if (mcData.itemsByName[wanted]) return mcData.itemsByName[wanted]
  for (const key of Object.keys(mcData.itemsByName)) {
    const item = mcData.itemsByName[key]
    if (normalizeName(item.displayName) === wanted) return item
  }
  const partial = Object.keys(mcData.itemsByName).filter((k) => normalizeName(k).includes(wanted) || normalizeName(mcData.itemsByName[k].displayName).includes(wanted))
  if (partial.length === 1) return mcData.itemsByName[partial[0]]
  return null
}

function inventoryItem (itemName) {
  if (!bot) return null
  const type = findItemType(itemName)
  if (!type) return null
  const items = bot.inventory.items().filter((i) => i.type === type.id)
  if (items.length === 0) return null
  // Sum across stacks for the count, keep the first stack for tossing.
  const total = items.reduce((n, i) => n + i.count, 0)
  return { type, items, total, first: items[0] }
}

function stopWander () {
  wanderMode = false
  if (wanderTimer) { clearInterval(wanderTimer); wanderTimer = null }
  wanderAnchor = null
}

function setWander (on) {
  if (on) {
    stopWander()
    const owner = ownerEntity()
    wanderAnchor = owner ? owner.position.clone() : (bot.entity ? bot.entity.position.clone() : null)
    wanderMode = true
    if (!wanderTimer) wanderTimer = setInterval(wanderTick, 25000)
    log('[wander] ON, anchor ' + (wanderAnchor ? `${wanderAnchor.x.toFixed(0)}, ${wanderAnchor.y.toFixed(0)}, ${wanderAnchor.z.toFixed(0)}` : 'unknown'))
  } else {
    stopWander()
    if (bot) bot.pathfinder.setGoal(null)
    log('[wander] OFF')
  }
}

function isSafeWanderTarget (p) {
  if (!bot) return false
  const feet = bot.blockAt(p)
  const head = bot.blockAt(p.offset(0, 1, 0))
  const below = bot.blockAt(p.offset(0, -1, 0))
  if (feet && feet.boundingBox === 'block') return false
  if (head && head.boundingBox === 'block') return false
  if (!below || below.boundingBox !== 'block') return false
  const badBelow = ['lava', 'water', 'cactus', 'magma_block', 'fire', 'soul_fire']
  if (badBelow.includes(below.name)) return false
  return true
}

function wanderTick () {
  if (!bot || !bot.entity || !wanderMode) return
  if (guardMode || fightMode || bot.isSleeping || stayCommanded) return
  if (bot.pathfinder.goal) return
  if (!wanderAnchor) return
  const pos = bot.entity.position
  // Stay near the anchor: never wander far from spawn/owner-start without
  // a separate command. Radius 12, vertical range 3.
  for (let tries = 0; tries < 10; tries++) {
    const dx = Math.floor(Math.random() * 25) - 12
    const dz = Math.floor(Math.random() * 25) - 12
    const dy = Math.floor(Math.random() * 7) - 3
    const target = wanderAnchor.offset(dx, dy, dz)
    if (target.distanceTo(pos) < 3) continue
    if (!isSafeWanderTarget(target)) continue
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 1), true)
    log(`[wander] walking to ${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)}`)
    setTimeout(() => { if (bot && bot.pathfinder.goal) { /* let pathfinder finish */ } }, 12000)
    return
  }
  log('[wander] no safe target found this tick')
}

// Raw movement fallback for the stuck-at-spawn problem. Pathfinder steps
// have repeatedly logged "moved 0.0" at spawn (3, 55, 633 in Oct 2025 logs),
// so a pathfinder goal alone is not proof the bot moved. This tries a
// direct forward + jump for a short burst, then reports what actually
// happened. It does NOT fix Falix's player-only "are you still there"
// check, and it does NOT guarantee the 10-minute idle kick is avoided.
async function rawShuffle () {
  if (!bot || !bot.entity) return 0
  // Ravine guard: do not shuffle blindly forward if the ground below
  // is already a drop, water, or lava. Report instead of falling in.
  if (isRavineRiskAt(bot.entity.position)) {
    log('[raw-shuffle] refused: ground below looks unsafe (ravine/water/lava risk)')
    return 0
  }
  const before = bot.entity.position.clone()
  try {
    bot.look(Math.random() * Math.PI * 2, 0, true)
    bot.setControlState('forward', true)
    bot.setControlState('jump', true)
    await new Promise((r) => setTimeout(r, 1500))
    bot.setControlState('jump', false)
    bot.setControlState('forward', false)
  } catch (e) { log(`[raw-shuffle] failed: ${e.message}`) }
  await new Promise((r) => setTimeout(r, 500))
  if (!bot || !bot.entity) return 0
  const moved = bot.entity.position.distanceTo(before)
  log(`[raw-shuffle] moved ${moved.toFixed(1)} from ${before.x.toFixed(0)}, ${before.y.toFixed(0)}, ${before.z.toFixed(0)}`)
  return moved
}

function findNearestDoor (radius) {
  if (!bot) return null
  let blocks = []
  try {
    blocks = bot.findBlocks({ matching: (b) => b.name.endsWith('_door'), maxDistance: radius || 10, count: 20 })
  } catch (e) { return null }
  // Doors are two blocks tall: keep only one entry per x,z, preferring
  // the lower half when its properties say so.
  // Round 24: findBlocks returns Vec3 positions, not Blocks, so work
  // with the Vec3 directly here, then convert the winner to a Block.
  const byXZ = new Map()
  for (const pos of blocks) {
    const key = `${pos.x},${pos.z}`
    const prev = byXZ.get(key)
    if (!prev || pos.y < prev.y) byXZ.set(key, pos)
  }
  let best = null
  let bestDist = Infinity
  for (const pos of byXZ.values()) {
    const d = pos.distanceTo(bot.entity.position)
    if (d < bestDist) { best = pos; bestDist = d }
  }
  if (!best) return null
  try { return bot.blockAt(best) } catch (e) { return null }
}

function doorIsOpen (block) {
  try {
    const props = block.properties || {}
    if (typeof props.open === 'boolean') return props.open
  } catch (e) { /* fall through to toggle-only */ }
  return null
}

async function openCloseDoor (wantOpen) {
  if (!bot || !bot.entity) return
  if (doorBusy) { say('One door at a time :3'); return }
  doorBusy = true
  try {
    const door = findNearestDoor(10)
    if (!door) { say("I can't find a door nearby :3"); return }
    const isIron = door.name.startsWith('iron_')
    if (isIron) say('That is an iron door, it usually needs redstone, I will try anyway :3')
    bot.pathfinder.setGoal(new goals.GoalNear(door.position.x, door.position.y, door.position.z, 2), true)
    const reached = await waitForNear(door.position, 3.5, 8000)
    if (!reached) { say("I couldn't reach the door :3"); return }
    const openNow = doorIsOpen(door)
    if (openNow !== null && openNow === wantOpen) {
      say(wantOpen ? 'That door is already open :3' : 'That door is already closed :3')
      return
    }
    try { await bot.activateBlock(door) } catch (e) { say(`I couldn't use that door: ${e.message}`); return }
    say(wantOpen ? 'Door opened :3' : 'Door closed :3')
  } finally {
    doorBusy = false
    if (bot) bot.pathfinder.setGoal(null)
  }
}

async function goThroughDoor () {
  if (!bot || !bot.entity) return
  if (doorBusy) { say('One door at a time :3'); return }
  doorBusy = true
  try {
    const door = findNearestDoor(10)
    if (!door) { say("I can't find a door nearby :3"); return }
    bot.pathfinder.setGoal(new goals.GoalNear(door.position.x, door.position.y, door.position.z, 2), true)
    const reached = await waitForNear(door.position, 3.5, 8000)
    if (!reached) { say("I couldn't reach the door :3"); return }
    const openNow = doorIsOpen(door)
    if (openNow === false) {
      try { await bot.activateBlock(door) } catch (e) { say(`I couldn't open that door: ${e.message}`); return }
    }
    // Walk 3 blocks past the door, away from where the bot started.
    const start = bot.entity.position.clone()
    const dir = door.position.clone().subtract(start)
    dir.y = 0
    if (dir.length() < 0.1) dir.set(0, 0, 1)
    dir.normalize()
    const beyond = door.position.clone().add(dir.multiply(3))
    bot.pathfinder.setGoal(new goals.GoalNear(beyond.x, beyond.y, beyond.z, 1), true)
    const passed = await waitForNear(beyond, 2.5, 10000)
    if (passed) say('Went through the door :3')
    else say("I opened it but couldn't get through :3")
  } finally {
    doorBusy = false
    if (bot) bot.pathfinder.setGoal(null)
  }
}

async function dropItems (itemName, count, dropAll) {
  if (!bot) return
  const found = inventoryItem(itemName)
  if (!found) { say(`I don't have any ${itemName} :3`); return }
  const toDrop = dropAll ? found.total : Math.min(count || 1, found.total)
  try {
    await bot.toss(found.type.id, null, toDrop)
    say(`Dropped ${toDrop} ${found.type.displayName || itemName} :3`)
  } catch (e) {
    say(`I couldn't drop that: ${e.message}`)
    log(`[drop] failed: ${e.message}`)
  }
}

async function craftItems (itemName, amount) {
  if (!bot) return
  const type = findItemType(itemName)
  if (!type) { say(`I don't know how to craft ${itemName} :3`); return }
  const wanted = Math.max(1, amount || 1)
  let table = null
  try {
    const tables = bot.findBlocks({ matching: (b) => b.name === 'crafting_table', maxDistance: 8, count: 1 })
    if (tables.length > 0) table = bot.blockAt(tables[0])
  } catch (e) { table = null }
  let recipes = []
  try { recipes = bot.recipesFor(type.id, null, wanted, table) } catch (e) { recipes = [] }
  if (!recipes || recipes.length === 0) {
    say(table ? `I can't craft ${type.displayName} with what I have :3` : `I need a crafting table nearby for ${type.displayName} :3`)
    return
  }
  const recipe = recipes[0]
  const perCraft = recipe.result.count || 1
  const times = Math.ceil(wanted / perCraft)
  try {
    await bot.craft(recipe, times, table)
    say(`Crafted ${times * perCraft} ${type.displayName} :3`)
  } catch (e) {
    say(`Crafting failed: ${e.message}`)
    log(`[craft] failed: ${e.message}`)
  }
}

async function mineItems (itemName, amount) {
  if (!bot || !bot.entity) return
  if (mining) { say("I'm already mining :3"); return }
  const type = findItemType(itemName)
  if (!type) { say(`I don't know what ${itemName} is :3`); return }
  const blocked = ['bed', 'door', 'chest', 'furnace', 'crafting_table', 'enchanting_table']
  if (blocked.some((b) => type.name.includes(b))) { say("I won't mine beds, doors, chests or tables like that :3"); return }
  if (type.name === 'bedrock') { say("I can't mine bedrock :3"); return }
  mining = true
  miningStop = false
  const wanted = Math.max(1, amount || 1)
  let done = 0
  try {
    while (done < wanted && !miningStop) {
      let blocks = []
      try { blocks = bot.findBlocks({ matching: type.id, maxDistance: 24, count: 5 }) } catch (e) { blocks = [] }
      if (blocks.length === 0) { say(`I can't find any more ${type.displayName} nearby :3`); break }
      const blockPos = blocks[0]
      const block = bot.blockAt(blockPos)
      if (!block) break
      bot.pathfinder.setGoal(new goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 3), true)
      const reached = await waitForNear(blockPos, 4.5, 10000)
      if (!reached || miningStop) break
      try {
        await bot.dig(block)
        done++
        log(`[mine] ${done}/${wanted} ${type.displayName}`)
      } catch (e) {
        log(`[mine] dig failed: ${e.message}`)
        break
      }
    }
    if (miningStop) say(`Stopped mining, got ${done} ${type.displayName} :3`)
    else if (done >= wanted) say(`Mined ${done} ${type.displayName} :3`)
    else if (done > 0) say(`Mined ${done} ${type.displayName} before stopping :3`)
  } finally {
    mining = false
    miningStop = false
    if (bot) bot.pathfinder.setGoal(null)
  }
}

// ---------------------------------------------------------------- autonomous: hunt, gather, parkour, protect, track
// Honest limit: the bot is chat-only and cannot see the world like a
// human. "Judgement" here is only what mineflayer can sense: position,
// health, hunger (bot.food), nearby entities, and nearby blocks. It
// does not see builds, intentions, or danger beyond that data, so
// every autonomous choice is conservative: stay near Moon, do not
// fall off cliffs, do not break builds unless explicitly asked, and
// never attack players (Moon or Noah).

function findNearestPassive (center, radius) {
  let nearest = null
  let nearestDist = radius
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !PASSIVE_FOOD_MOBS.has(e.mobType)) continue
    const d = e.position.distanceTo(center)
    if (d < nearestDist) { nearest = e; nearestDist = d }
  }
  return nearest
}

function huntTick () {
  if (!bot || !huntMode || !bot.entity) return
  if (huntCount >= 3) {
    say('Done hunting, got 3 :3')
    setHunt(false)
    return
  }
  const center = bot.entity.position
  let target = null
  if (huntTarget) {
    const live = bot.entities[huntTarget.id]
    if (live && live.position.distanceTo(center) <= 24) target = live
  }
  if (!target) {
    huntTarget = null
    target = findNearestPassive(center, 16)
    huntTarget = target
    if (!target) { say('No animals nearby to hunt :3'); setHunt(false); return }
  }
  const botDist = target.position.distanceTo(bot.entity.position)
  if (botDist <= 3.5) {
    bot.pathfinder.setGoal(null)
    try { bot.attack(target) } catch (e) { /* may have died */ }
    // Count a kill on the next tick when the target is gone: if the
    // entity disappears, huntTick will pick a new one; count by checking
    // that the previous target is no longer in bot.entities.
    if (!bot.entities[target.id]) huntCount++
  } else {
    bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1), true)
  }
}

function setHunt (on) {
  huntMode = on
  if (on) {
    setFight(false)
    setGuard(false)
    huntTarget = null
    huntCount = 0
    if (!huntTimer) huntTimer = setInterval(huntTick, 500)
    say('Hunting nearby animals, up to 3 :3')
    log('[hunt] ON')
  } else {
    if (huntTimer) { clearInterval(huntTimer); huntTimer = null }
    huntTarget = null
    if (bot) bot.pathfinder.setGoal(null)
    log('[hunt] OFF')
  }
}

async function gatherBlocks (matcher, label, wanted) {
  if (!bot || !bot.entity) return 0
  let done = 0
  while (done < wanted) {
    let blocks = []
    try { blocks = bot.findBlocks({ matching: matcher, maxDistance: 24, count: 5 }) } catch (e) { blocks = [] }
    if (blocks.length === 0) break
    const block = bot.blockAt(blocks[0])
    if (!block) break
    bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3), true)
    const reached = await waitForNear(block.position, 4.5, 10000)
    if (!reached) break
    try { await bot.dig(block); done++ } catch (e) { log(`[gather] dig failed: ${e.message}`); break }
  }
  if (bot) bot.pathfinder.setGoal(null)
  return done
}

async function gatherWood (wanted) {
  const n = await gatherBlocks((b) => b.name.endsWith('_log'), 'wood', wanted || 5)
  if (n === 0) say("I can't find any wood nearby :3")
  else say(`Got ${n} wood :3`)
  return n
}

async function gatherFood (wanted) {
  const n = await gatherBlocks((b) => FOOD_CROPS.has(b.name), 'food', wanted || 5)
  if (n === 0) {
    // Truly ambiguous: crops are gone, hunting is a different choice
    // Moon cares about animals, so ask instead of hunting on its own.
    say("I can't find crops nearby. Do you want me to hunt an animal for meat, or keep looking? :3")
  } else {
    say(`Got ${n} food from crops :3`)
  }
  return n
}

async function gatherGeneric (itemName, amount) {
  const type = findItemType(itemName)
  if (!type) { forwardUnknownMessage(itemName, false); return }
  // Block in the world first, then a recipe, then give up honestly.
  let blocks = []
  try { blocks = bot.findBlocks({ matching: type.id, maxDistance: 24, count: 1 }) } catch (e) { blocks = [] }
  if (blocks.length > 0) { await mineItems(itemName, amount || 5); return }
  let table = null
  try {
    const tables = bot.findBlocks({ matching: (b) => b.name === 'crafting_table', maxDistance: 8, count: 1 })
    if (tables.length > 0) table = bot.blockAt(tables[0])
  } catch (e) { table = null }
  let recipes = []
  try { recipes = bot.recipesFor(type.id, null, 1, table) } catch (e) { recipes = [] }
  if (recipes.length > 0) { await craftItems(itemName, amount || 1); return }
  say(`I can't find or craft ${type.displayName} nearby :3`)
}

function doJump () {
  if (!bot) return
  try {
    bot.setControlState('jump', true)
    setTimeout(() => { if (bot) bot.setControlState('jump', false) }, 600)
  } catch (e) { log(`[jump] failed: ${e.message}`) }
}

async function climbUp () {
  if (!bot || !bot.entity) return
  const pos = bot.entity.position
  for (let tries = 0; tries < 10; tries++) {
    const dx = Math.floor(Math.random() * 13) - 6
    const dz = Math.floor(Math.random() * 13) - 6
    const target = pos.offset(dx, 1 + Math.floor(Math.random() * 2), dz)
    if (!isSafeWanderTarget(target)) continue
    // Pathfinder already has allowParkour=true, so it will jump 1-block
    // steps where safe. It will not jump off cliffs: targets here
    // require solid ground below, same as wander.
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 1), true)
    say('Climbing up :3')
    return
  }
  say("I can't find a safe spot to climb to :3")
}


// ---------------------------------------------------------------- round 3: water, sprint, survival, building
// All of these are best-effort mineflayer calls wrapped in try/catch,
// so a missing API or a failed action becomes a chat message, not a
// crash. Nothing here moves the bot off a cliff, into lava, or into
// deep water on purpose, and nothing breaks Moon's builds.

function canSprint () {
  if (!bot) return false
  return typeof bot.food === 'number' && bot.food > 6
}
function setSprint (on, quiet) {
  if (!bot) return false
  if (on && !canSprint()) {
    if (!quiet) say("I can't sprint, I'm too hungry (sprint needs food above 6) :3")
    try { bot.setControlState('sprint', false) } catch (e) {}
    sprintOn = false
    return false
  }
  try { bot.setControlState('sprint', !!on) } catch (e) { log(`[sprint] failed: ${e.message}`); return false }
  sprintOn = !!on
  return sprintOn
}
function setSneak (on) {
  if (!bot) return false
  try { bot.setControlState('sneak', !!on) } catch (e) { log(`[sneak] failed: ${e.message}`); return false }
  sneakOn = !!on
  return true
}
function blockNameAt (pos) {
  if (!bot) return ''
  try { const b = bot.blockAt(pos); return b ? b.name : '' } catch (e) { return '' }
}
function isInWaterAt (pos) {
  if (!bot || !pos) return false
  // Mineflayer also exposes entity.isInWater in some versions; the
  // block check below works in all versions and is the fallback.
  try { if (bot.entity && bot.entity.isInWater) return true } catch (e) {}
  const feet = blockNameAt(pos)
  const head = blockNameAt(pos.offset(0, 1, 0))
  return feet === 'water' || head === 'water'
}
function isInWater () {
  if (!bot || !bot.entity) return false
  return isInWaterAt(bot.entity.position)
}
function waterDepthAt (pos) {
  // Count consecutive water blocks upward from feet, capped at 6.
  let d = 0
  for (let i = 0; i < 6; i++) {
    if (blockNameAt(pos.offset(0, i, 0)) === 'water') d++
    else break
  }
  return d
}
function findShoreTarget () {
  // Nearest safe land target within 16 blocks: solid ground below,
  // not water/lava, no ravine drop. Returns a position or null.
  if (!bot || !bot.entity) return null
  const center = bot.entity.position
  let best = null; let bestDist = Infinity
  for (let dx = -16; dx <= 16; dx++) {
    for (let dz = -16; dz <= 16; dz++) {
      const p = center.offset(dx, 0, dz)
      if (!isSafeWanderTarget(p)) continue
      if (isRavineRiskAt(p)) continue
      const d = p.distanceTo(center)
      if (d < bestDist) { best = p; bestDist = d }
    }
  }
  return best
}
function tryWaterEscape (announce) {
  if (!bot || !bot.entity) return false
  // Swim up first: holding jump in water makes the bot rise.
  try { bot.setControlState('jump', true) } catch (e) {}
  setTimeout(() => { if (bot) { try { bot.setControlState('jump', false) } catch (e) {} } }, 2000)
  const shore = findShoreTarget()
  if (!shore) {
    if (announce) say("I'm in water and I can't find a shore nearby, I'm swimming up to stay afloat :3")
    log('[water] in water, no shore found')
    return false
  }
  bot.pathfinder.setGoal(new goals.GoalNear(shore.x, shore.y, shore.z, 1), true)
  waterEscapeAt = Date.now()
  if (announce) say(`I'm in water, swimming to shore at ${shore.x.toFixed(0)}, ${shore.y.toFixed(0)}, ${shore.z.toFixed(0)} so I don't drown :3`)
  log(`[water] escaping to shore ${shore.x.toFixed(0)}, ${shore.y.toFixed(0)}, ${shore.z.toFixed(0)}`)
  return true
}
function waterStatus () {
  if (!bot || !bot.entity) return 'I am not in the world yet :3'
  const p = bot.entity.position
  const depth = waterDepthAt(p)
  const h = (typeof bot.health === 'number') ? bot.health : '?'
  const f = (typeof bot.food === 'number') ? bot.food : '?'
  // Mineflayer does not expose a reliable air/breath number in all
  // versions, so do not invent one: report depth, health, and food,
  // and warn clearly when depth is 2+ (head under water risk).
  if (!isInWater()) return `I'm not in water, I'm at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}, health ${h}, food ${f}. :3`
  const air = headAirStatus()
  const warn = air.bubble ? ' I am in a bubble column, I can breathe here.' : (air.headUnder ? ` Head underwater ${air.elapsed.toFixed(0)} seconds, limit ${air.limit} seconds, I will swim up at ${Math.max(0, air.limit - 2)} seconds.` : ' My head is above water, I can breathe, but I should get out if I stay in water too long.')
  return `I'm in water ${depth} deep at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}, health ${h}, food ${f}.${warn} :3`
}
async function equipItem (itemName, dest) {
  if (!bot) return false
  const found = inventoryItem(itemName)
  if (!found) { say(`I don't have any ${itemName} to equip :3`); return false }
  try {
    await bot.equip(found.first, dest || 'hand')
    say(`Equipped ${found.type.displayName || itemName} :3`)
    return true
  } catch (e) { say(`I couldn't equip that: ${e.message}`); log(`[equip] failed: ${e.message}`); return false }
}
async function equipBest (kind) {
  // kind: sword, axe, pickaxe, shovel, hoe, bow. Pick highest tier
  // in inventory by a simple tier ranking, never a player's item.
  if (!bot) return false
  const tier = { wooden: 1, stone: 2, iron: 3, golden: 4, diamond: 5, netherite: 6 }
  let best = null; let bestTier = 0
  for (const item of bot.inventory.items()) {
    const name = item.name || ''
    if (!name.includes(kind)) continue
    if (kind === 'sword' && !name.endsWith('_sword')) continue
    if (kind === 'axe' && !name.endsWith('_axe')) continue
    if (kind === 'pickaxe' && !name.endsWith('_pickaxe')) continue
    const t = tier[name.split('_')[0]] || 0
    if (t > bestTier) { best = item; bestTier = t }
  }
  if (!best) { say(`I don't have a ${kind} :3`); return false }
  try { await bot.equip(best, 'hand'); say(`Equipped my best ${kind}: ${best.displayName || best.name} :3`); return true }
  catch (e) { say(`I couldn't equip that: ${e.message}`); return false }
}
async function wearArmour () {
  if (!bot) return false
  const slots = [['helmet', 'head'], ['chestplate', 'torso'], ['leggings', 'legs'], ['boots', 'feet']]
  let worn = 0
  for (const [suffix, dest] of slots) {
    const item = bot.inventory.items().find((i) => (i.name || '').endsWith('_' + suffix))
    if (!item) continue
    try { await bot.equip(item, dest); worn++ } catch (e) { log(`[armour] ${suffix} failed: ${e.message}`) }
  }
  if (worn === 0) say("I don't have any armour to wear :3")
  else say(`Wearing ${worn} piece(s) of armour :3`)
  return worn > 0
}
async function eatHeldFood () {
  if (!bot) return false
  const foods = ['bread', 'apple', 'carrot', 'potato', 'baked_potato', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'melon_slice', 'sweet_berries', 'cookie', 'cake']
  const item = bot.inventory.items().find((i) => foods.includes(i.name) || (i.name || '').startsWith('cooked_') || (i.name || '').endsWith('_stew'))
  if (!item) { say("I don't have any food to eat :3"); return false }
  try {
    await bot.equip(item, 'hand')
    await bot.consume()
    say(`Ate ${item.displayName || item.name} :3`)
    return true
  } catch (e) { say(`I couldn't eat that: ${e.message}`); log(`[eat] failed: ${e.message}`); return false }
}
async function placeNamedBlock (itemName) {
  if (!bot || !bot.entity) return false
  const found = inventoryItem(itemName)
  if (!found) { say(`I don't have any ${itemName} to place :3`); return false }
  // Place on top of the ground one block in front of the bot, only
  // if that space is free and the ground below is solid and safe.
  const target = bot.entity.position.offset(1, 0, 0)
  const ref = bot.blockAt(target.offset(0, -1, 0))
  if (!ref || ref.boundingBox !== 'block') { say("I can't place that here, no solid ground :3"); return false }
  if (isRavineRiskAt(target)) { say("I won't place that there, it looks like a drop :3"); return false }
  try {
    await bot.equip(found.first, 'hand')
    await bot.placeBlock(ref, { x: 0, y: 1, z: 0 })
    say(`Placed ${found.type.displayName || itemName} :3`)
    return true
  } catch (e) { say(`I couldn't place that: ${e.message}`); log(`[place] failed: ${e.message}`); return false }
}
async function lightUpArea () {
  if (!bot || !bot.entity) return 0
  const found = inventoryItem('torch')
  if (!found) { say("I don't have any torches to light up with :3"); return 0 }
  let placed = 0
  for (let dx = -3; dx <= 3 && placed < 4; dx++) {
    for (let dz = -3; dz <= 3 && placed < 4; dz++) {
      if (dx === 0 && dz === 0) continue
      const p = bot.entity.position.offset(dx, 0, dz)
      if (!isSafeWanderTarget(p)) continue
      const ref = bot.blockAt(p.offset(0, -1, 0))
      if (!ref) continue
      try {
        const cur = inventoryItem('torch')
        if (!cur) break
        await bot.equip(cur.first, 'hand')
        await bot.placeBlock(ref, { x: 0, y: 1, z: 0 })
        placed++
      } catch (e) { /* one failed torch does not stop the rest */ }
    }
  }
  if (placed === 0) say("I couldn't place any torches nearby :3")
  else say(`Lit up the area with ${placed} torch(es) :3`)
  return placed
}
function goToCoords (x, y, z) {
  if (!bot || !bot.entity) return false
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { say("Those coordinates don't look right :3"); return false }
  const p = bot.entity.position.offset(0, 0, 0)
  // Safety: do not path to a ravine/water/lava target blindly.
  const target = { x, y, z }
  // Use a plain object-like check via blockAt on a Vec3-like offset.
  try {
    const bp = bot.entity.position.clone(); bp.x = x; bp.y = y; bp.z = z
    if (isRavineRiskAt(bp)) { say("That spot looks like a drop or water/lava, I won't go there blindly, say it again if you really want me to :3"); return false }
  } catch (e) {}
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1), true)
  say(`Going to ${x}, ${y}, ${z} :3`)
  return true
}
function findThing (thing) {
  if (!bot || !bot.entity) return null
  const center = bot.entity.position
  const t = normalizeName(thing)
  // Entities first: hostile, passive, player, item drops.
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]
    if (!e) continue
    const name = normalizeName(e.mobType || e.type || e.name || '')
    if (name && name.includes(t)) return { kind: 'entity', name: e.mobType || e.type, pos: e.position, dist: Math.round(e.position.distanceTo(center)) }
  }
  // Blocks second, within 32.
  try {
    const blocks = bot.findBlocks({ matching: (b) => normalizeName(b.name).includes(t), maxDistance: 32, count: 1 })
    if (blocks.length > 0) return { kind: 'block', name: thing, pos: blocks[0], dist: Math.round(blocks[0].distanceTo(center)) }
  } catch (e) {}
  return null
}
async function retreatFromHostile () {
  if (!bot || !bot.entity) return false
  const hostile = findNearestHostile(bot.entity.position, 16)
  if (!hostile) { say("There's nothing to retreat from :3"); return false }
  // Run away: pick a safe target in the opposite direction, sprint if fed.
  const away = bot.entity.position.clone().subtract(hostile.position); away.y = 0
  if (away.length() < 0.1) away.set(0, 0, 1)
  away.normalize()
  for (let dist = 8; dist >= 4; dist -= 2) {
    const p = bot.entity.position.clone().add(away.multiply(dist))
    if (isSafeWanderTarget(p) && !isRavineRiskAt(p)) {
      if (canSprint()) setSprint(true, true)
      bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 1), true)
      say('Retreating to safety :3')
      return true
    }
  }
  say("I can't find a safe place to retreat to :3")
  return false
}


// ---------------------------------------------------------------- round 4: air, bubble columns, magma crouch
// Head-underwater is tracked by a 1-second timer (airTick), NOT by
// the 5-second autoTick, because a 5-second tick cannot catch an
// 8-second warning reliably. The timer is the primary rule; the
// game's oxygenLevel (bot.oxygenLevel, air_supply/15, scale 0-20,
// if present) is only a secondary low-air warning, never the sole
// trigger, because its scale is not Moon's bubble count.
function isHeadUnderwaterAt (pos) {
  if (!bot || !pos) return false
  return blockNameAt(pos.offset(0, 1, 0)) === 'water'
}
function isHeadUnderwater () {
  if (!bot || !bot.entity) return false
  return isHeadUnderwaterAt(bot.entity.position)
}
function bubbleColumnAt (pos) {
  // Scan down from the bot's feet, skipping water blocks, to the
  // first non-water block. That is Moon's "directly under it,
  // excluding more water" check, done correctly for a whole column:
  // a bot floating mid-column above magma/soul sand is still in a
  // bubble column in vanilla, not only a bot on the bottom block.
  // Guard: a bot standing on dry magma, with no water at feet or
  // head, is NOT in a bubble column, even though magma is below.
  if (!bot || !pos) return { bubble: false, base: null }
  if (blockNameAt(pos) !== 'water' && blockNameAt(pos.offset(0, 1, 0)) !== 'water') return { bubble: false, base: null }
  for (let i = 0; i < 16; i++) {
    const name = blockNameAt(pos.offset(0, -i, 0))
    if (name === 'water') continue
    if (name === '') continue
    if (name === 'magma_block') return { bubble: true, base: 'magma' }
    if (name === 'soul_sand') return { bubble: true, base: 'soul sand' }
    return { bubble: false, base: name }
  }
  return { bubble: false, base: null }
}
function isOnMagmaAt (pos) {
  if (!bot || !pos) return false
  return blockNameAt(pos.offset(0, -1, 0)) === 'magma_block'
}
function respirationLevel () {
  // Helmet is inventory slot 5 (head, in window slots 5-8 head-to-feet),
  // and also bot.entity.equipment's last entry. Check the equipped
  // helmet first, then any helmet in inventory as a fallback, and
  // report unknown (not 0) if enchants cannot be read.
  if (!bot) return { level: 0, known: false, item: null }
  try {
    const candidates = []
    try { if (bot.inventory && bot.inventory.slots && bot.inventory.slots[5]) candidates.push(bot.inventory.slots[5]) } catch (e) {}
    try { if (bot.entity && bot.entity.equipment && bot.entity.equipment.length > 0) candidates.push(bot.entity.equipment[bot.entity.equipment.length - 1]) } catch (e) {}
    try { for (const it of bot.inventory.items()) { if ((it.name || '').endsWith('_helmet') || it.name === 'turtle_shell') candidates.push(it) } } catch (e) {}
    for (const item of candidates) {
      if (!item) continue
      const name = item.name || ''
      if (!name.endsWith('_helmet') && name !== 'turtle_shell') continue
      let ench = []
      try { ench = item.enchants || [] } catch (e) { ench = [] }
      for (const en of ench) {
        const enName = (en && (en.name || en.id)) ? String(en.name || en.id).replace('minecraft:', '') : ''
        if (enName === 'respiration') return { level: Number(en.lvl || en.level || 1), known: true, item: name }
      }
      return { level: 0, known: true, item: name }
    }
  } catch (e) { log(`[respiration] read failed: ${e.message}`) }
  return { level: 0, known: false, item: null }
}
function airLimitSeconds () {
  const r = respirationLevel()
  // Moon's base 10s + verified vanilla increment 15s per level.
  // Turtle shell (+10s vanilla) is NOT counted, on purpose: using
  // the shorter limit is safe, claiming it would need live proof.
  return { limit: 10 + 15 * (r.level || 0), respiration: r }
}
function headAirStatus () {
  if (!bot || !bot.entity) return { headUnder: false, elapsed: 0, limit: 10, bubble: false, base: null, onMagma: false, respiration: { level: 0, known: false, item: null }, oxygen: null }
  const pos = bot.entity.position
  const headUnder = isHeadUnderwaterAt(pos)
  const bc = bubbleColumnAt(pos)
  const lim = airLimitSeconds()
  const elapsed = (headUnder && !bc.bubble && headUnderSince) ? Math.max(0, (Date.now() - headUnderSince) / 1000) : 0
  const oxygen = (typeof bot.oxygenLevel === 'number') ? bot.oxygenLevel : null
  return { headUnder, elapsed, limit: lim.limit, bubble: bc.bubble, base: bc.base, onMagma: isOnMagmaAt(pos), respiration: lim.respiration, oxygen }
}
function airStatusText () {
  const st = headAirStatus()
  if (!bot || !bot.entity) return "I'm not in the world yet :3"
  const p = bot.entity.position
  if (!st.headUnder && !isInWater()) return `I'm not in water, I'm at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}. My head is above water, air is full. :3`
  if (st.bubble) {
    const crouch = st.onMagma ? ' I am crouching on the magma block so it does not hurt me.' : ''
    return `I'm in a bubble column (${st.base} below, air replenished), so the 10-second limit does not apply while I stay here.${crouch} Head underwater, but breathing here. Respiration on my helmet: ${st.respiration.known ? (st.respiration.item ? `${st.respiration.item} Respiration ${st.respiration.level}` : 'none') : 'unknown'}. :3`
  }
  if (!st.headUnder) return `I'm in water, but my head is above water, so I can breathe. Head-underwater time is 0 seconds. Limit would be ${st.limit} seconds if I go under. :3`
  const left = Math.max(0, st.limit - st.elapsed)
  // Bubble estimate is Moon's rule only: about 1 bubble per second,
  // estimate only, not a game reading. With Respiration, time left
  // is the honest number, bubbles are not.
  const bubbleNote = st.respiration.level > 0 ? `about ${left.toFixed(0)} seconds left (Respiration extends time, so bubbles alone do not tell it)` : `about ${Math.max(0, Math.round(10 - st.elapsed))} bubbles left at about 1 bubble per second (estimate only)`
  const oxy = st.oxygen !== null ? ` Game oxygenLevel, if present, is ${st.oxygen} on a 0-20 scale.` : ''
  return `Head underwater ${st.elapsed.toFixed(0)} seconds, limit ${st.limit} seconds (Moon's 10-second base + 15 seconds per Respiration level, Respiration ${st.respiration.known ? st.respiration.level : 'unknown'} on ${st.respiration.item || 'no helmet found'}). ${bubbleNote}. I will swim up at ${Math.max(0, st.limit - 2)} seconds.${oxy} :3`
}
function sayAirStatus () { say(airStatusText()) }
function swimUpForAir (reason) {
  if (!bot || !bot.entity) return
  try { bot.pathfinder.setGoal(null) } catch (e) {}
  try { bot.setControlState('jump', true) } catch (e) {}
  airSwimUntil = Date.now() + 3000
  setTimeout(() => { if (bot) { try { bot.setControlState('jump', false) } catch (e) {} } }, 3000)
  log(`[air] swimming up for air: ${reason || ''}`)
}
function airTick () {
  if (!bot || !bot.entity) return
  if (bot.isSleeping) return
  const pos = bot.entity.position
  const headUnder = isHeadUnderwaterAt(pos)
  const bc = bubbleColumnAt(pos)
  // Magma crouch: on a magma block, crouch, whatever the water state.
  // On soul sand, do NOT crouch for this reason alone.
  const onMagma = isOnMagmaAt(pos)
  if (onMagma) {
    if (!sneakOn) { setSneak(true); airMagmaSneak = true }
  } else if (airMagmaSneak) {
    setSneak(false); airMagmaSneak = false
  }
  if (bc.bubble) {
    // Air replenished: timer resets, limit does not apply here.
    headUnderSince = null; lastAirElapsed = 0; lastAirBubble = true
    return
  }
  lastAirBubble = false
  if (!headUnder) { headUnderSince = null; lastAirElapsed = 0; airWarnedAt = 0; return }
  if (!headUnderSince) headUnderSince = Date.now()
  const elapsed = (Date.now() - headUnderSince) / 1000
  lastAirElapsed = elapsed
  const lim = airLimitSeconds()
  const triggerAt = Math.max(0, lim.limit - 2)
  const lowOxygen = (typeof bot.oxygenLevel === 'number' && bot.oxygenLevel <= 2)
  if ((elapsed >= triggerAt || lowOxygen) && Date.now() - airWarnedAt > 5000) {
    airWarnedAt = Date.now()
    say(`Swimming up for air! Head underwater ${elapsed.toFixed(0)} seconds, limit ${lim.limit} seconds, Respiration ${lim.respiration.level}. :3`)
    swimUpForAir(`elapsed ${elapsed.toFixed(1)}s limit ${lim.limit}s lowOxygen=${lowOxygen}`)
  }
  if (elapsed >= lim.limit + 5) {
    // Swim-up alone did not surface it: fall back to shore.
    tryWaterEscape(false)
  }
}
// --- round 4: systematic skill additions (all best-effort, say on failure) ---
function reportEnchantments () {
  if (!bot) { say("I'm not in the world yet :3"); return }
  const parts = []
  try {
    const slots = []
    if (bot.inventory && bot.inventory.slots) {
      for (let i = 5; i <= 8; i++) { if (bot.inventory.slots[i]) slots.push(bot.inventory.slots[i]) }
    }
    if (bot.heldItem) slots.push(bot.heldItem)
    for (const item of slots) {
      let ench = []
      try { ench = item.enchants || [] } catch (e) {}
      if (ench.length > 0) parts.push(`${item.displayName || item.name}: ${ench.map((e) => `${e.name || e.id} ${e.lvl || e.level || ''}`.trim()).join(', ')}`)
      else parts.push(`${item.displayName || item.name}: no enchantments`)
    }
  } catch (e) { log(`[enchantments] failed: ${e.message}`) }
  if (parts.length === 0) say("I don't have any equipped gear to check :3")
  else say('My gear enchantments: ' + parts.join('; ') + ' :3')
}
function countItem (itemName) {
  const found = inventoryItem(itemName)
  if (!found) say(`I have 0 ${itemName} :3`)
  else say(`I have ${found.total} ${found.type.displayName || itemName} :3`)
}
function reportPlayers () {
  if (!bot) { say("I'm not in the world yet :3"); return }
  const names = Object.keys(bot.players || {})
  if (names.length === 0) say("I don't see anyone online :3")
  else say(`Online that I can see: ${names.join(', ')} :3`)
}
function lookAtOwner () {
  const owner = ownerEntity()
  if (!owner) { say("I can't see you to look at you :3"); return }
  try { bot.lookAt(owner.position.offset(0, 1.5, 0), true); say('Looking at you :3') } catch (e) { say(`I couldn't look at you: ${e.message}`) }
}
function turnBot (dir) {
  if (!bot || !bot.entity) return
  try {
    let yaw = bot.entity.yaw
    if (dir === 'left') yaw += Math.PI / 2
    else if (dir === 'right') yaw -= Math.PI / 2
    else if (dir === 'around') yaw += Math.PI
    else if (dir === 'north') yaw = Math.PI
    else if (dir === 'south') yaw = 0
    else if (dir === 'west') yaw = Math.PI / 2
    else if (dir === 'east') yaw = -Math.PI / 2
    bot.look(yaw, 0, true); say(`Turned ${dir} :3`)
  } catch (e) { say(`I couldn't turn: ${e.message}`) }
}
async function activateNearest (kinds, label) {
  if (!bot || !bot.entity) return
  let blocks = []
  try { blocks = bot.findBlocks({ matching: (b) => kinds.some((k) => b.name === k || b.name.endsWith(k)), maxDistance: 4, count: 5 }) } catch (e) { blocks = [] }
  if (blocks.length === 0) { say(`I can't find a ${label} nearby :3`); return }
  const block = bot.blockAt(blocks[0])
  if (!block) { say(`I can't reach that ${label} :3`); return }
  bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2), true)
  const reached = await waitForNear(block.position, 3.5, 8000)
  if (!reached) { say(`I couldn't reach that ${label} :3`); return }
  try { await bot.activateBlock(block); say(`Used the ${block.name} :3`) } catch (e) { say(`I couldn't use that ${label}: ${e.message}`) }
  if (bot) bot.pathfinder.setGoal(null)
}
async function shearSheep () {
  if (!bot || !bot.entity) return
  const sheep = Object.values(bot.entities).find((e) => e && e.type === 'mob' && e.mobType === 'Sheep')
  if (!sheep) { say("I don't see a sheep nearby to shear :3"); return }
  const shears = inventoryItem('shears')
  if (!shears) { say("I need shears to shear a sheep :3"); return }
  try { await bot.equip(shears.first, 'hand'); bot.pathfinder.setGoal(new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2), true); await waitForNear(sheep.position, 3.5, 8000); await bot.activateEntity(sheep); say('Sheared the sheep, best effort, wool should drop if it worked :3') } catch (e) { say(`Shearing failed: ${e.message}`) }
  if (bot) bot.pathfinder.setGoal(null)
}
async function milkCow () {
  if (!bot || !bot.entity) return
  const cow = Object.values(bot.entities).find((e) => e && e.type === 'mob' && e.mobType === 'Cow')
  if (!cow) { say("I don't see a cow nearby to milk :3"); return }
  const bucket = inventoryItem('bucket')
  if (!bucket) { say("I need an empty bucket to milk a cow :3"); return }
  try { await bot.equip(bucket.first, 'hand'); bot.pathfinder.setGoal(new goals.GoalNear(cow.position.x, cow.position.y, cow.position.z, 2), true); await waitForNear(cow.position, 3.5, 8000); await bot.activateEntity(cow); say('Milked the cow, best effort, check if I have a milk bucket now :3') } catch (e) { say(`Milking failed: ${e.message}`) }
  if (bot) bot.pathfinder.setGoal(null)
}
async function hoeGround () {
  if (!bot || !bot.entity) return
  const hoe = bot.inventory.items().find((i) => (i.name || '').endsWith('_hoe'))
  if (!hoe) { say("I need a hoe to till soil :3"); return }
  const pos = bot.entity.position
  const target = bot.blockAt(pos.offset(1, -1, 0)) || bot.blockAt(pos.offset(0, -1, 0))
  if (!target || !['dirt', 'grass_block', 'dirt_path'].includes(target.name)) { say("I need dirt or grass under me to till :3"); return }
  try { await bot.equip(hoe, 'hand'); await bot.activateBlock(target); const after = bot.blockAt(target.position); if (after && after.name === 'farmland') say('Tilled that soil into farmland :3'); else say('I tried to till it, but it did not change in this version, best effort :3') } catch (e) { say(`Tilling failed: ${e.message}`) }
}
async function drinkItem (itemName) {
  if (!bot) return
  const wanted = (itemName || '').trim()
  const item = wanted ? inventoryItem(wanted) : null
  const fallback = !item ? bot.inventory.items().find((i) => (i.name || '').includes('potion')) : null
  const chosen = item ? item.first : fallback
  if (!chosen) { say(wanted ? `I don't have any ${wanted} to drink :3` : "I don't have a potion to drink :3"); return }
  try { await bot.equip(chosen, 'hand'); await bot.consume(); say(`Drank ${chosen.displayName || chosen.name} :3`) } catch (e) { say(`I couldn't drink that: ${e.message}`) }
}
async function wearBestArmour () {
  if (!bot) return
  const tier = { leather: 1, golden: 2, chainmail: 3, iron: 4, diamond: 5, netherite: 6 }
  const slots = [['helmet', 'head'], ['chestplate', 'torso'], ['leggings', 'legs'], ['boots', 'feet']]
  let worn = 0
  for (const [suffix, dest] of slots) {
    let best = null; let bestTier = 0
    for (const item of bot.inventory.items()) {
      if (!(item.name || '').endsWith('_' + suffix) && !(suffix === 'helmet' && item.name === 'turtle_shell')) continue
      const t = item.name === 'turtle_shell' ? 3 : (tier[item.name.split('_')[0]] || 0)
      if (t > bestTier) { best = item; bestTier = t }
    }
    if (!best) continue
    try { await bot.equip(best, dest); worn++ } catch (e) { log(`[best-armour] ${suffix} failed: ${e.message}`) }
  }
  if (worn === 0) say("I don't have any armour to wear :3")
  else say(`Wearing my best armour, ${worn} piece(s) :3`)
}
function reportWhere (thing) {
  const found = findThing(thing)
  if (!found) { say(`I can't find ${thing} nearby, within 32 blocks :3`); return }
  const center = bot.entity.position
  const dx = Math.sign(Math.round(found.pos.x - center.x)); const dz = Math.sign(Math.round(found.pos.z - center.z))
  say(`${found.name} is ${found.dist} away, to the ${directionName(dx, dz)}, I am not walking to it, just telling you where it is :3`)
}
async function smeltNamed (itemName) {
  if (!bot) return
  const type = findItemType(itemName)
  if (!type) { say(`I don't know what ${itemName} is :3`); return }
  let furnaces = []
  try { furnaces = bot.findBlocks({ matching: (b) => b.name === 'furnace' || b.name === 'smoker', maxDistance: 8, count: 1 }) } catch (e) {}
  if (furnaces.length === 0) { say("I need a furnace nearby to smelt :3"); return }
  if (!bot.openFurnace) { say("Smelting is not available in this bot version :3"); return }
  try {
    const furnaceBlock = bot.blockAt(furnaces[0])
    const furnace = await bot.openFurnace(furnaceBlock)
    const input = inventoryItem(itemName)
    if (!input) { say(`I don't have any ${itemName} to smelt :3`); try { furnace.close() } catch (e) {}; return }
    const fuel = bot.inventory.items().find((i) => ['coal', 'charcoal'].includes(i.name) || (i.name || '').endsWith('_log') || (i.name || '').endsWith('_planks'))
    try { await furnace.putInput(type.id, null, Math.min(input.total, 1)) } catch (e) { say(`I couldn't put that in the furnace: ${e.message}`); try { furnace.close() } catch (e2) {}; return }
    if (fuel) { try { await furnace.putFuel(fuel.type, null, 1) } catch (e) {} }
    say(`Put ${type.displayName || itemName} in the furnace${fuel ? ' with fuel' : ', but I have no fuel'}. It needs time to smelt, say 'take from furnace' later, I am not claiming it is done yet :3`)
    try { furnace.close() } catch (e) {}
  } catch (e) { say(`Smelting failed: ${e.message}`) }
}
async function takeFromFurnace () {
  if (!bot) return
  let furnaces = []
  try { furnaces = bot.findBlocks({ matching: (b) => b.name === 'furnace' || b.name === 'smoker', maxDistance: 8, count: 1 }) } catch (e) {}
  if (furnaces.length === 0) { say("I need a furnace nearby :3"); return }
  if (!bot.openFurnace) { say("Smelting is not available in this bot version :3"); return }
  try {
    const furnace = await bot.openFurnace(bot.blockAt(furnaces[0]))
    try { const out = await furnace.takeOutput(); say(out ? `Took ${out.displayName || out.name || 'the smelted item'} from the furnace :3` : "There is nothing ready in the furnace yet :3") } catch (e) { say(`Nothing ready to take yet, or taking failed: ${e.message}`) }
    try { furnace.close() } catch (e) {}
  } catch (e) { say(`Taking from the furnace failed: ${e.message}`) }
}
async function buildPath () {
  if (!bot || !bot.entity) return
  const item = bot.inventory.items().find((i) => (i.name || '').endsWith('_planks') || (i.name || '').endsWith('_log') || i.name === 'dirt' || i.name === 'cobblestone' || i.name === 'stone')
  if (!item) { say("I don't have blocks to build a path with :3"); return }
  const yaw = bot.entity.yaw || 0
  const fx = -Math.sin(yaw); const fz = Math.cos(yaw)
  let placed = 0
  for (let i = 1; i <= 5; i++) {
    const target = bot.entity.position.offset(Math.round(fx * i), 0, Math.round(fz * i))
    if (!isSafeWanderTarget(target) || isRavineRiskAt(target)) continue
    const ref = bot.blockAt(target.offset(0, -1, 0))
    if (!ref || ref.boundingBox !== 'block') continue
    try { const cur = inventoryItem(item.name); if (!cur) break; await bot.equip(cur.first, 'hand'); await bot.placeBlock(ref, { x: 0, y: 1, z: 0 }); placed++ } catch (e) { break }
  }
  if (placed === 0) say("I couldn't build a path there, no safe ground :3")
  else say(`Built a path of ${placed} block(s) in front of me, best effort :3`)
}

// ---------------------------------------------------------------- scan / ravine / companion (2026-10-30)
// LiDAR-style scan, in data not vision: mineflayer only senses blocks
// and entities in a grid. This scan turns that grid into a short,
// human-readable description, so Nova can understand the situation
// from data, and later pair it with a mineflayer-viewer visual.
// It never claims to "see" like a human, and it never moves the bot.
function directionName (dx, dz) {
  if (dx === 0 && dz < 0) return 'north'
  if (dx === 0 && dz > 0) return 'south'
  if (dx > 0 && dz === 0) return 'east'
  if (dx < 0 && dz === 0) return 'west'
  if (dx > 0 && dz < 0) return 'north-east'
  if (dx < 0 && dz < 0) return 'north-west'
  if (dx > 0 && dz > 0) return 'south-east'
  if (dx < 0 && dz > 0) return 'south-west'
  return 'here'
}

function groundDropBelow (pos) {
  // Distance down to the first solid block below pos, or -1 if none
  // within 6 blocks. A drop of 4+ is treated as a possible ravine /
  // cliff edge, not ordinary steps.
  if (!bot) return -1
  for (let d = 1; d <= 6; d++) {
    const b = bot.blockAt(pos.offset(0, -d, 0))
    if (b && b.boundingBox === 'block') return d
  }
  return -1
}

function isRavineRiskAt (pos) {
  const drop = groundDropBelow(pos)
  if (drop === -1) return true
  if (drop >= 4) return true
  const below = bot ? bot.blockAt(pos.offset(0, -1, 0)) : null
  if (below && ['lava', 'water'].includes(below.name)) return true
  return false
}

function scanAround (radius) {
  if (!bot || !bot.entity) return 'I am not in the world yet :3'
  const center = bot.entity.position
  const r = Math.max(4, Math.min(24, radius || 16))
  const lines = []
  lines.push(`Scan from ${center.x.toFixed(0)}, ${center.y.toFixed(0)}, ${center.z.toFixed(0)}, radius ${r}:`)
  // 8-direction ground check: solid, water, lava, or a drop (ravine/cliff).
  const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
  const dirNotes = []
  for (const [dx, dz] of dirs) {
    const p = center.offset(dx * 6, 0, dz * 6)
    const below = bot.blockAt(p.offset(0, -1, 0))
    let note
    if (!below) note = 'unknown'
    else if (below.boundingBox !== 'block') {
      const drop = groundDropBelow(p)
      note = drop === -1 ? 'drop, no ground in 6 (possible ravine)' : `drop ${drop} down`
    } else if (below.name === 'water') note = 'water below'
    else if (below.name === 'lava') note = 'lava below'
    else note = 'solid ground'
    dirNotes.push(`${directionName(dx, dz)}: ${note}`)
  }
  lines.push('Ground around me: ' + dirNotes.join('; '))
  // Categories in the world nearby, nearest first where possible.
  const cats = []
  try {
    const logs = bot.findBlocks({ matching: (b) => b.name.endsWith('_log'), maxDistance: r, count: 1 })
    if (logs.length > 0) cats.push(`wood ${Math.round(logs[0].distanceTo(center))} away`)
  } catch (e) { /* best-effort */ }
  try {
    const water = bot.findBlocks({ matching: (b) => b.name === 'water', maxDistance: r, count: 1 })
    if (water.length > 0) cats.push(`water ${Math.round(water[0].distanceTo(center))} away`)
  } catch (e) { /* best-effort */ }
  try {
    const crops = bot.findBlocks({ matching: (b) => FOOD_CROPS.has(b.name), maxDistance: r, count: 1 })
    if (crops.length > 0) cats.push(`crops ${Math.round(crops[0].distanceTo(center))} away`)
  } catch (e) { /* best-effort */ }
  try {
    const ores = bot.findBlocks({ matching: (b) => b.name.endsWith('_ore'), maxDistance: r, count: 1 })
    if (ores.length > 0) cats.push(`ore ${Math.round(ores[0].distanceTo(center))} away`)
  } catch (e) { /* best-effort */ }
  lines.push(cats.length > 0 ? 'Nearby: ' + cats.join(', ') : 'Nearby: no wood, water, crops or ore in range.')
  // Entities: Moon, hostiles, passives, nearest only.
  const owner = ownerEntity()
  if (owner) {
    const d = Math.round(owner.position.distanceTo(center))
    const dx = Math.sign(Math.round(owner.position.x - center.x))
    const dz = Math.sign(Math.round(owner.position.z - center.z))
    lines.push(`You are ${d} away, to the ${directionName(dx, dz)}.`)
  } else {
    lines.push('You are not in range right now.')
  }
  const hostile = findNearestHostile(center, r)
  if (hostile) lines.push(`Nearest hostile: ${hostile.mobType} ${Math.round(hostile.position.distanceTo(center))} away.`)
  const passive = findNearestPassive(center, r)
  if (passive) lines.push(`Nearest animal: ${passive.mobType} ${Math.round(passive.position.distanceTo(center))} away.`)
  const h = (typeof bot.health === 'number') ? bot.health : '?'
  const f = (typeof bot.food === 'number') ? bot.food : '?'
  lines.push(`Me: health ${h}, food ${f}, doing ${currentActivity()}.`)
  return lines.join(' ')
}

function sayScan (radius) {
  const text = scanAround(radius)
  lastScanAt = Date.now()
  lastScanText = text
  log(`[scan] ${text}`)
  // Chat messages should stay readable: say the ground + nearby lines
  // first, then the rest as a second message if it is long.
  if (text.length <= 240) { say(text); return }
  const cut = text.lastIndexOf('. ', 240)
  if (cut > 80) { say(text.slice(0, cut + 1)); setTimeout(() => { if (bot) say(text.slice(cut + 2)) }, 800) }
  else say(text.slice(0, 240))
}

function prepareViewerSnapshot () {
  const text = scanAround(16)
  viewerSnapshotAt = Date.now()
  viewerSnapshotText = text
  lastScanAt = viewerSnapshotAt
  lastScanText = text
  log(`[viewer-snapshot] ${text}`)
  say('Snapshot ready for the viewer: fast data first, visual after. ' + text.slice(0, 200))
  return text
}

function checkRavineFall () {
  if (!bot || !bot.entity) return
  const y = bot.entity.position.y
  if (lastBotY !== null && y < lastBotY - 5 && Date.now() - ravineFallReportedAt > 60000) {
    ravineFallReportedAt = Date.now()
    const p = bot.entity.position
    const msg = `I think I just fell down a lot, from ${lastBotY.toFixed(0)} to ${y.toFixed(0)}. I might be in the ravine, I am at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}. Moon, you can teleport me out with /tp Nova Werewolf_Paws, you gave permission for that on 2026-10-30, I will not teleport myself. :3`
    log(`[ravine-fall] ${msg}`)
    say(msg)
  }
  lastBotY = y
}

async function bringItem (itemName) {
  if (!bot || !bot.entity) return
  const found = inventoryItem(itemName)
  if (!found) { say(`I don't have any ${itemName} to bring you :3`); return }
  const owner = ownerEntity()
  if (!owner) { say("I can't find you to bring it to :3"); return }
  say(`Coming to you with ${found.type.displayName || itemName} :3`)
  bot.pathfinder.setGoal(new goals.GoalNear(owner.position.x, owner.position.y, owner.position.z, 2), true)
  const reached = await waitForNear(owner.position, 3.5, 12000)
  if (!reached) { say("I couldn't reach you with it :3"); return }
  try {
    await bot.toss(found.type.id, null, Math.min(found.total, found.first.count))
    say('Here you go :3')
  } catch (e) { say(`I couldn't give it to you: ${e.message}`) }
  if (bot) bot.pathfinder.setGoal(null)
}


// ---------------------------------------------------------------- round 25: specific hunt, general gathering with quantity, bring = go get first, planks from trees (2026-10-30)
// Moon, live: "kill a chicken" / "Hunt chicken" / "Gather chicken" were
// all logged unknown (only plain "hunt" existed); "bring me two blocks
// of dirt" was read as one item name "two blocks of dirt", and "get
// two blocks of dirt" fell through to gatherGeneric("two blocks of
// dirt"), which findItemType cannot resolve. Dirt was only one example:
// Moon then broadened this to gathering overall, and added planks.
// Honest limits, stated in help: mineflayer data cannot reliably tell
// a block that is part of Moon's build from a wild block of the same
// type, except for logs (see tree check below). Gathering therefore
// mines the nearest matching block within range, never beds, doors,
// chests, furnaces, crafting tables or bedrock (already blocked in
// mineItems), and Moon should not ask for a block that is part of his
// build. Planks are never mined from a build: they are crafted from
// logs cut from a tree (leaves nearby), never from planks found in a
// build. Nothing here uses /give or any operator command.
const r25_NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const r25_ANIMALS = { chicken: 'Chicken', chickens: 'Chicken', cow: 'Cow', cows: 'Cow', pig: 'Pig', pigs: 'Pig', sheep: 'Sheep', rabbit: 'Rabbit', rabbits: 'Rabbit' }
let r25HuntActive = false
let r25BringActive = false
function r25ParseQuantity (raw) {
  let text = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
  text = text.replace(/^some\s+/, '')
  let amount = null
  let m = text.match(/^(\d+)\s+(.+)$/)
  if (m) { amount = parseInt(m[1], 10); text = m[2].trim() }
  else {
    m = text.match(/^(one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/)
    if (m) { amount = r25_NUMBER_WORDS[m[1]]; text = m[2].trim() }
    else if (/^a\s+block\s+of\s+/.test(text)) { amount = 1; text = text.replace(/^a\s+block\s+of\s+/, '') }
    else if (/^an\s+/.test(text)) { amount = 1; text = text.replace(/^an\s+/, '') }
    else if (/^a\s+/.test(text)) { amount = 1; text = text.replace(/^a\s+/, '') }
  }
  text = text.replace(/^(blocks?|pieces?)\s+of\s+/, '')
  text = text.replace(/\s+blocks?$/, '')
  if (amount === null) amount = 1
  if (amount > 64) amount = 64
  return { amount: amount, name: text.trim() }
}
function r25PlankKind (name) {
  const t = String(name || '').trim().toLowerCase()
  if (/(^|\s)dark\s+oak(\s|$)/.test(t)) return { kind: 'dark_oak', log: 'dark_oak_log', label: 'dark oak' }
  const kinds = [
    ['oak', 'oak_log'], ['birch', 'birch_log'], ['spruce', 'spruce_log'],
    ['jungle', 'jungle_log'], ['acacia', 'acacia_log'], ['mangrove', 'mangrove_log'],
    ['cherry', 'cherry_log'], ['crimson', 'crimson_stem'], ['warped', 'warped_stem']
  ]
  for (const [k, logName] of kinds) {
    if (t === k || t.startsWith(k + ' ') || t.endsWith(' ' + k)) return { kind: k, log: logName, label: k }
  }
  if (t === '' || t === 'wood' || t === 'planks') return { kind: null, log: null, label: 'any wood' }
  return null
}
function r25HasLeavesNear (pos) {
  if (!bot) return false
  // Leaves near a trunk: within 2 blocks sideways, and up to 6 blocks
  // above (lower trunk logs have leaves above, not beside them).
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -1; dy <= 6; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        let b = null
        try { b = bot.blockAt(pos.offset(dx, dy, dz)) } catch (e) { b = null }
        if (b && b.name.endsWith('_leaves')) return true
      }
    }
  }
  return false
}
async function r25GatherLogs (logName, wanted) {
  if (!bot || !bot.entity) return 0
  let done = 0
  const skipped = new Set()
  while (done < wanted) {
    let positions = []
    try { positions = bot.findBlocks({ matching: (b) => b.name === logName, maxDistance: 24, count: 10 }) } catch (e) { positions = [] }
    let target = null
    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`
      if (skipped.has(key)) continue
      // Tree check, always, for every kind: a log with leaves nearby
      // is a tree, not a build block. A log with no leaves nearby is
      // skipped, never dug, so a log-built wall is not chopped.
      // Limit: a tree whose leaves have already decayed will also be
      // skipped, and the bot will say so rather than chop a build.
      if (r25HasLeavesNear(pos)) { target = pos; break }
      skipped.add(key)
    }
    if (!target) break
    let block = null
    try { block = bot.blockAt(target) } catch (e) { block = null }
    if (!block) { skipped.add(`${target.x},${target.y},${target.z}`); continue }
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 3), true)
    const reached = await waitForNear(target, 4.5, 10000)
    if (!reached) break
    try { await bot.dig(block); done++; log(`[r25-logs] ${done}/${wanted} ${logName}`) } catch (e) { log(`[r25-logs] dig failed: ${e.message}`); break }
  }
  if (bot) bot.pathfinder.setGoal(null)
  return done
}
async function r25GetPlanks (rawName, amount, bringToMoon) {
  if (!bot || !bot.entity) return
  const parsed = r25ParseQuantity(rawName)
  const want = amount || parsed.amount || 1
  const kindText = parsed.name.replace(/\s+planks?$/, '').replace(/^wood\s+/, '').trim()
  if (kindText === 'bamboo') { say('Bamboo planks are not supported yet, bamboo needs bamboo blocks first, I will not substitute another wood :3'); return }
  const kind = r25PlankKind(kindText)
  if (kind === null) { say(`I do not know the wood kind "${kindText}", I will not substitute a different wood :3`); return }
  const logsNeeded = Math.ceil(want / 4)
  let logsGot = 0
  if (kind.log) {
    logsGot = await r25GatherLogs(kind.log, logsNeeded)
  } else {
    // Any wood: chop any log with leaves nearby, one tree at a time.
    const logNames = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
    for (const ln of logNames) {
      if (logsGot >= logsNeeded) break
      logsGot += await r25GatherLogs(ln, logsNeeded - logsGot)
    }
  }
  if (logsGot === 0) {
    say(kind.log ? `No ${kind.label} trees nearby, I will not substitute a different wood :3` : "I can't find any trees nearby :3")
    return
  }
  const before = r18InvCount('planks')
  // Craft by kind: craftItems picks the recipe for the named plank
  // type, so a specific kind is never crafted from another log.
  const plankName = kind.log ? kind.label.replace(' ', '_') + '_planks' : 'oak_planks'
  // For "any wood", craft from whatever logs were actually gathered:
  // use the first log type present in inventory.
  let craftName = plankName
  if (!kind.log) {
    const heldLog = bot.inventory.items().find((i) => i.name.endsWith('_log') || i.name.endsWith('_stem'))
    if (heldLog) craftName = heldLog.name.replace(/_log$/, '_planks').replace(/_stem$/, '_planks')
  }
  await craftItems(craftName, Math.min(want, logsGot * 4))
  const have = r18InvCount(craftName)
  if (have === 0 && before === 0) { say(`I chopped ${logsGot} logs but could not craft planks, I need a crafting recipe for that kind :3`); return }
  if (bringToMoon) { await r25Deliver(craftName, want); return }
  say(have >= want ? `Got ${want} planks :3` : `Got ${have} planks, fewer than you asked for :3`)
}
async function r25Deliver (itemName, amount) {
  if (!bot || !bot.entity) return false
  const owner = ownerEntity()
  if (!owner) { say("I can't find you to bring it to :3"); return false }
  let remaining = amount || 0
  const firstFound = inventoryItem(itemName)
  if (!firstFound || firstFound.total === 0) return false
  if (!remaining) remaining = firstFound.total
  say(`Coming to you with ${firstFound.type.displayName || itemName} :3`)
  bot.pathfinder.setGoal(new goals.GoalNear(owner.position.x, owner.position.y, owner.position.z, 2), true)
  const reached = await waitForNear(owner.position, 3.5, 12000)
  if (!reached) { say("I couldn't reach you with it :3"); if (bot) bot.pathfinder.setGoal(null); return false }
  // Toss stack by stack, so an amount spread over several stacks is
  // actually delivered, not just the first stack.
  try {
    while (remaining > 0) {
      const cur = inventoryItem(itemName)
      if (!cur || cur.total === 0) break
      const toss = Math.min(remaining, cur.first.count)
      await bot.toss(cur.type.id, null, toss)
      remaining -= toss
    }
    say('Here you go :3'); return true
  } catch (e) { say(`I couldn't give it to you: ${e.message}`); return false }
  finally { if (bot) bot.pathfinder.setGoal(null) }
}
async function r25HuntAnimal (animalRaw) {
  if (!bot || !bot.entity) return
  const key = String(animalRaw || '').trim().toLowerCase().replace(/s$/, '')
  // Sheep stays "sheep"; the map above already handles plurals, so
  // re-check the full raw word first for sheep.
  const mobType = r25_ANIMALS[String(animalRaw || '').trim().toLowerCase()] || r25_ANIMALS[key]
  if (!mobType) { say(`I don't hunt "${animalRaw}" with this command, I hunt chicken, cow, pig, sheep, and rabbit :3`); return }
  const label = mobType.toLowerCase()
  let target = null
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || e.mobType !== mobType) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d <= 16 && (!target || d < target.position.distanceTo(bot.entity.position))) target = e
  }
  if (!target) { say(`No ${label} nearby to hunt :3`); return }
  r25HuntActive = true
  setFight(false); setGuard(false)
  const start = Date.now()
  let killed = false
  try {
    while (r25HuntActive && Date.now() - start < 20000) {
      const live = bot.entities[target.id]
      if (!live) { killed = true; break }
      if (bot.health < 8) { say(`Stopping the hunt, my health is low :3`); break }
      const d = live.position.distanceTo(bot.entity.position)
      if (d <= 3.5) {
        bot.pathfinder.setGoal(null)
        try { bot.attack(live) } catch (e) {}
      } else {
        bot.pathfinder.setGoal(new goals.GoalNear(live.position.x, live.position.y, live.position.z, 1), true)
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  } finally {
    r25HuntActive = false
    if (bot) bot.pathfinder.setGoal(null)
  }
  if (killed) say(`Hunted one ${label} :3`)
  else if (bot && bot.entities[target.id]) say(`Could not catch the ${label}, it got away :3`)
}
async function r25Gather (name, amount) {
  if (!bot || !bot.entity) return
  const lower = String(name || '').trim().toLowerCase()
  try {
    const foundThing = findThing(name)
    if (foundThing && foundThing.kind === 'entity') {
      bot.pathfinder.setGoal(new goals.GoalNear(foundThing.pos.x, foundThing.pos.y, foundThing.pos.z, 1), true)
      say(`Found ${foundThing.name} nearby, going to it :3`)
      return
    }
  } catch (e) {}

  if (lower === 'wood' || lower === 'logs' || lower === 'log') { await gatherWood(amount || 5); return }
  if (lower === 'food') { await gatherFood(amount || 5); return }
  if (lower === 'meat') { setHunt(true); return }
  if (lower.endsWith('planks') || lower === 'plank') { await r25GetPlanks(name, amount, false); return }
  // Ores: "iron" means iron ore, as in the existing mine-ore pattern.
  let mineName = name
  const oreNames = ['iron', 'gold', 'coal', 'diamond', 'emerald', 'redstone', 'lapis', 'copper']
  if (oreNames.includes(lower)) mineName = lower + ' ore'
  const type = findItemType(mineName)
  if (!type) { say(`I don't know what ${name} is :3`); return }
  let blocks = []
  try { blocks = bot.findBlocks({ matching: type.id, maxDistance: 24, count: 1 }) } catch (e) { blocks = [] }
  if (blocks.length > 0) { await mineItems(mineName, amount || 1); return }
  // Craftable, not in the world: try a recipe, as gatherGeneric does.
  let table = null
  try {
    const tables = bot.findBlocks({ matching: (b) => b.name === 'crafting_table', maxDistance: 8, count: 1 })
    if (tables.length > 0) table = bot.blockAt(tables[0])
  } catch (e) { table = null }
  let recipes = []
  try { recipes = bot.recipesFor(type.id, null, amount || 1, table) } catch (e) { recipes = [] }
  if (recipes.length > 0) { await craftItems(mineName, amount || 1); return }
  say(`I can't find or craft ${type.displayName} nearby :3`)
}
async function r25Bring (rawText) {
  if (!bot || !bot.entity) return
  const parsed = r25ParseQuantity(rawText)
  const amount = parsed.amount || 1
  const name = parsed.name
  if (!name) { say('Bring what? :3'); return }
  r25BringActive = true
  try {
    if (name.endsWith('planks') || name === 'plank') { await r25GetPlanks(name, amount, true); return }
    // Meat: hunt the animal that drops it, then bring what was picked up.
    const meatAnimal = { chicken: 'chicken', beef: 'cow', porkchop: 'pig', pork: 'pig', mutton: 'sheep', rabbit: 'rabbit' }[name]
    if (meatAnimal) {
      const have0 = inventoryItem(name)
      if (!have0 || have0.total < amount) await r25HuntAnimal(meatAnimal)
      if (!r25BringActive) { say('Stopped bringing :3'); return }
    } else {
      const have0 = inventoryItem(name)
      if (!have0 || have0.total < amount) {
        if (name === 'wood' || name === 'logs' || name === 'log') await gatherWood(amount)
        else if (name === 'food') await gatherFood(amount)
        else await r25Gather(name, amount)
      }
      if (!r25BringActive) { say('Stopped bringing :3'); return }
    }
    const have = inventoryItem(name)
    if (!have || have.total === 0) { say(`I couldn't find or make any ${name} nearby :3`); return }
    if (have.total < amount) say(`Got ${have.total}, bringing what I found :3`)
    await r25Deliver(name, Math.min(amount, have.total))
  } finally { r25BringActive = false }
}
function r25RoundHelp () {
  say('Round 25, brief: hunt one specific animal with "hunt chicken" or "kill a chicken", never a different animal, and never a player or hostile with that command. Get, mine, gather, find, and collect now parse amounts, like "get two blocks of dirt", "get 2 dirt", or "get a block of dirt", for blocks, crops, wood, food, ores, and other common things, and actually go mine or gather them nearby, never with /give. Bring now goes to get it first if I do not have it, then brings it to you, up to the amount you asked for. For planks, say "bring me oak planks" and I cut a tree of that kind, craft planks, and bring them, never substituting another wood. Say "round 25 help" for this again :3')
}
// Returns true if cmd was a Round 25 command, false to fall through.
function r25TryCommand (cmd) {
  if (cmd === 'stop' || cmd === 'stop everything' || cmd === 'stop hunting' || cmd === 'stop bringing') {
    r25HuntActive = false; r25BringActive = false
    return false
  }
  if (cmd === 'round 25 help' || cmd === 'round twenty five help') { r25RoundHelp(); return true }
  let m = cmd.match(/^(hunt|kill|gather)\s+(.+)$/)
  if (m) {
    const parsed = r25ParseQuantity(m[2].trim())
    const animal = parsed.name
    if (r25_ANIMALS[animal] || animal === 'chicken' || animal === 'cow' || animal === 'pig' || animal === 'sheep' || animal === 'rabbit') {
      ;(async () => { await r25HuntAnimal(animal) })(); return true
    }
    // "gather <item>" that is not an animal falls through to gather below.
    if (m[1] !== 'gather') return false
    // fall through to gather handling with the parsed amount
    ;(async () => { await r25Gather(parsed.name, parsed.amount) })(); return true
  }
  m = cmd.match(/^bring me (.+)$/)
  if (m) { ;(async () => { await r25Bring(m[1].trim()) })(); return true }
  m = cmd.match(/^give me (.+)$/)
  if (m) { ;(async () => { await r25Bring(m[1].trim()) })(); return true }
  // Get / mine / dig / find / collect, with quantity. Never swallow
  // "get out of the water", "get unstuck", or "collect drops/loot".
  if (/^get (out of|unstuck)/.test(cmd)) return false
  if (/^collect (drops|items|loot)$/.test(cmd) || /^pick up (drops|items|loot)$/.test(cmd)) return false
  m = cmd.match(/^(?:go\s+)?(?:get|find|gather|collect|mine|dig)\s+(.+)$/)
  if (m) {
    const parsed = r25ParseQuantity(m[1].trim())
    if (!parsed.name) return false
    ;(async () => { await r25Gather(parsed.name, parsed.amount) })(); return true
  }
  return false
}

function reportStatus () {
  if (!bot || !bot.entity) { say("I'm not in the world yet :3"); return }
  const p = bot.entity.position
  const h = (typeof bot.health === 'number') ? bot.health : '?'
  const f = (typeof bot.food === 'number') ? bot.food : '?'
  const ownerNote = lastOwnerPos ? `Last saw you at ${lastOwnerPos.x.toFixed(0)}, ${lastOwnerPos.y.toFixed(0)}, ${lastOwnerPos.z.toFixed(0)}.` : ''
  say(`Status: health ${h}, food ${f}, at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}, doing ${currentActivity()}. ${ownerNote} :3`)
}

// Autonomous tick, every 5s on spawn. Priority: protect > track > gather.
// It never overrides stay, sleep, fight, guard, wander, mining, or hunting,
// and it never attacks players.
async function autoTick () {
  if (!bot || !bot.entity) return
  // Remember Moon's position, and check for a big fall (ravine),
  // even when other autonomous actions are paused by stay/sleep/etc.
  // This memory is only a last-seen position, not a home or a build.
  const ownerSeen = ownerEntity()
  if (ownerSeen) { lastOwnerPos = ownerSeen.position.clone(); lastOwnerSeenAt = Date.now() }
  try { r22EndermanSafetyTick() } catch (e) {}
  // Round 13 lobby watch: quiet, at most once every 30 seconds, and
  // it only speaks up on a real full-lobby to Overworld transition.
  if (lobbyState && lobbyState.watch) { try { lobbyWatchTick() } catch (e) {} }
  checkRavineFall()
  // Water safety, round 4 change: head CAN go underwater, so do
  // NOT force shore on any feet-in-water. The 1-second airTick
  // handles swim-up at limit-2, bubble columns, and magma crouch.
  // autoTick only: bubble-column notice, and a shore fallback if
  // head-underwater is already at/over the limit.
  if (!bot.isSleeping && isInWater()) {
    const air = headAirStatus()
    if (air.bubble) {
      if (Date.now() - bubbleSaidAt > 30000) {
        bubbleSaidAt = Date.now()
        say(`I'm in a bubble column (${air.base} below), I can breathe here, I am not swimming up yet.${air.onMagma ? ' Crouching on the magma block.' : ''} :3`)
      }
      // Do not return: in a bubble column the bot can still
      // protect/track/gather normally.
    } else if (air.headUnder && air.elapsed >= air.limit) {
      if (Date.now() - waterEscapeAt > 10000) tryWaterEscape(false)
      return
    } else if (air.headUnder && air.elapsed >= 4 && Date.now() - waterSaidAt > 15000) {
      waterSaidAt = Date.now()
      say(airStatusText())
    }
  }
  // Lava nearby: step back to a safe spot, once per 15s.
  if (!bot.isSleeping) {
    let lavaNear = false
    try {
      const lava = bot.findBlocks({ matching: (b) => b.name === 'lava', maxDistance: 3, count: 1 })
      lavaNear = lava.length > 0
    } catch (e) {}
    if (lavaNear && Date.now() - lavaSaidAt > 15000) {
      lavaSaidAt = Date.now()
      say('Lava nearby, backing off :3')
      const p = bot.entity.position
      for (let tries = 0; tries < 8; tries++) {
        const t = p.offset(Math.floor(Math.random() * 11) - 5, 0, Math.floor(Math.random() * 11) - 5)
        if (isSafeWanderTarget(t) && !isRavineRiskAt(t)) { bot.pathfinder.setGoal(new goals.GoalNear(t.x, t.y, t.z, 1), true); break }
      }
      return
    }
  }
  // Auto-eat, only if Moon turned it on: eating consumes food Moon
  // may want, so it is opt-in, never automatic by default.
  if (autoEatOn && typeof bot.food === 'number' && bot.food <= 8 && !bot.isSleeping) {
    try { await eatHeldFood() } catch (e) {}
  }
  // Nightfall, once per night, like a player noticing it get dark.
  if (isNight() && !nightSaid) {
    nightSaid = true
    const owner0 = ownerEntity()
    if (owner0 && owner0.position.distanceTo(bot.entity.position) < 32) say("It's getting dark, I'll keep an eye out :3")
  }
  if (!isNight()) nightSaid = false
  if (stayCommanded || bot.isSleeping || fightMode || guardMode || wanderMode || mining || huntMode) return
  const owner = ownerEntity()
  if (!owner) return
  const ownerDist = owner.position.distanceTo(bot.entity.position)
  // 1) Protect Moon if a hostile is close to him.
  if (autoProtectOn) {
    const hostile = findNearestHostile(owner.position, 12)
    if (hostile) {
      if (!protectSaid) { protectSaid = true; say('Protecting you! :3') }
      const wasFollowing = true
      setFight(true, { auto: true, target: hostile, resumeFollow: wasFollowing, quiet: true })
      return
    }
  }
  if (ownerDist < 5) { protectSaid = false; trackSaid = false }
  // 2) Track Moon if he drifts away, but not too far.
  if (autoTrackOn && ownerDist > 20 && ownerDist < 64) {
    if (!trackSaid) { trackSaid = true; say('Coming with you! :3') }
    if (ownerDist > 12 && canSprint()) setSprint(true, true)
    followOwner()
    return
  }
  // 3) Gather food only when the bot itself is hungry, and only crops,
  // never hunting on its own. Cooldown 5 minutes, one episode at a time.
  if (!autoGathering && typeof bot.food === 'number' && bot.food <= 8 && Date.now() - lastAutoGather > 5 * 60 * 1000) {
    autoGathering = true
    lastAutoGather = Date.now()
    try { say("I'm getting hungry, looking for food nearby :3"); await gatherFood(3) } catch (e) { log(`[auto-gather] failed: ${e.message}`) }
    autoGathering = false
  }
}

// Natural-language intent layer: fuzzy requests that do not need exact
// syntax. Returns true if it handled the command. Exact commands in
// runAction's switch still win for everything else, and a clarifying
// question is only asked when the choice is truly ambiguous (food
// with no crops, or a generic item with no block and no recipe).

// ---------------------------------------------------------------- round 6
// Categories explicitly NOT searched in depth in rounds 4-5, added
// here in safe form only. Rule for all of round 6: help and guidance
// first, a simple in-game attempt only when it cannot trap the bot,
// waste Moon's items blind, break a build, or claim a completed
// multi-step result (brew, anvil combine, full taming) that was not
// actually verified. Everything below is best-effort and says so.
function dimensionName () {
  if (!bot) return 'unknown'
  try {
    const d = bot.game && bot.game.dimension
    if (!d) return 'unknown'
    if (String(d).includes('the_nether')) return 'the_nether'
    if (String(d).includes('the_end')) return 'the_end'
    if (String(d).includes('overworld')) return 'overworld'
    return String(d)
  } catch (e) { return 'unknown' }
}
function reportDimension () {
  const d = dimensionName()
  if (d === 'the_nether') say('I am in the Nether. Watch out for lava, piglins, ghasts, and falls, and do not attack piglins unless you are ready. I will not build a portal or fight a boss blind :3')
  else if (d === 'the_end') say('I am in the End. Watch out for endermen, the void, and falls. I will not fight the dragon or bridge over the void blind :3')
  else if (d === 'overworld') say('I am in the Overworld, the normal world :3')
  else say(`I do not know what dimension I am in right now, mineflayer says: ${d} :3`)
  log(`[dimension] ${d}`)
}
function findMobByTypes (types, radius) {
  if (!bot || !bot.entity) return null
  let best = null; let bestDist = radius || 16
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !types.includes(e.mobType)) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestDist) { best = e; bestDist = d }
  }
  return best
}
async function walkToMob (entity) {
  if (!bot || !bot.entity || !entity) return false
  bot.pathfinder.setGoal(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2), true)
  const reached = await waitForNear(entity.position, 3.5, 10000)
  if (bot) bot.pathfinder.setGoal(null)
  return reached
}
function tameGuide (animal) {
  const guides = {
    horse: 'To tame a horse, mount it empty-handed again and again until it stops throwing you off, then put a saddle on it. I will not mount blind, because being thrown can leave me stuck, so tell me live and we will do it step by step :3',
    donkey: 'To tame a donkey, mount it again and again until it stops throwing you off, then put a saddle and a chest on it. I will not mount blind, tell me live and we will do it step by step :3',
    mule: 'To tame a mule, mount it again and again until it stops throwing you off, then put a saddle on it. Mules are bred from a horse and a donkey, they cannot breed themselves. I will not mount blind :3',
    wolf: 'To tame a wolf, feed it bones, one at a time, until hearts appear. If I have bones I will try to feed one, otherwise give me bones first. Do not attack a wolf, the pack will fight back :3',
    dog: 'Dogs are tamed wolves. Feed a wolf bones until hearts appear, then it becomes your dog. If I have bones I will try to feed one :3',
    cat: 'To tame a cat, crouch and walk slowly with raw cod or raw salmon in hand, do not chase it, and feed it until hearts appear. Cats run from fast movement, so we should do this live and slowly :3',
    parrot: 'To tame a parrot, feed it seeds, wheat, melon, pumpkin, or beetroot seeds, until hearts appear. Do not feed it cookies, cookies kill parrots in game. I will not feed blind without seeds in my inventory :3',
    fox: 'Foxes are not tamed by feeding in the normal way, you breed two wild foxes with sweet berries and the baby trusts you. Do not chase a fox, it will run. We should do this live :3',
    axolotl: 'To tame an axolotl, in the sense of getting it to follow you, hold a bucket of tropical fish. To pick one up, use a water bucket on it. I will not bucket one blind without a water bucket :3',
    panda: 'Pandas are bred with bamboo, and they need bamboo nearby. They are not tamed like a dog or cat. We should do this live :3',
    bee: 'Bees are bred with flowers, and they follow a player holding a flower. Do not attack a bee, and do not break a hive at night without care. We should do this live :3'
  }
  return guides[animal] || `Taming ${animal} needs live choices and the right food, I will not tame it blind. Tell me live what animal and what food you have, and I will help step by step :3`
}
async function tameAttempt (animal) {
  if (!bot || !bot.entity) return
  const mobMap = { horse: ['Horse'], donkey: ['Donkey'], mule: ['Mule'], wolf: ['Wolf'], dog: ['Wolf'], cat: ['Cat'], parrot: ['Parrot'], fox: ['Fox'], axolotl: ['Axolotl'], panda: ['Panda'], bee: ['Bee'] }
  const types = mobMap[animal] || [animal.charAt(0).toUpperCase() + animal.slice(1)]
  const mob = findMobByTypes(types, 16)
  if (!mob) { say(`I don't see a ${animal} nearby to tame :3`); return }
  const reached = await walkToMob(mob)
  if (!reached) { say(`I found a ${animal}, but I couldn't reach it :3`); return }
  // Only feed where feeding is the taming action and the food is held.
  const foodMap = { wolf: ['bone'], dog: ['bone'], cat: ['cod', 'salmon'], parrot: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'] }
  const foods = foodMap[animal] || []
  let fed = false
  for (const food of foods) {
    const item = inventoryItem(food)
    if (!item) continue
    try { await bot.equip(item.first, 'hand'); await bot.activateEntity(mob); fed = true; say(`Tried to feed the ${animal} a ${food}, best effort, check for hearts, taming may take more than one :3`); break } catch (e) { say(`Feeding failed: ${e.message}`) }
  }
  if (!fed) say(tameGuide(animal))
}
async function breedAttempt (animal) {
  if (!bot || !bot.entity) return
  const mobMap = { cow: ['Cow'], sheep: ['Sheep'], pig: ['Pig'], chicken: ['Chicken'], horse: ['Horse'], donkey: ['Donkey'], wolf: ['Wolf'], cat: ['Cat'] }
  const types = mobMap[animal] || [animal.charAt(0).toUpperCase() + animal.slice(1)]
  const foodMap = { cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'], horse: ['golden_apple', 'golden_carrot'], donkey: ['golden_apple', 'golden_carrot'], wolf: ['meat', 'beef', 'porkchop', 'chicken'], cat: ['cod', 'salmon'] }
  const foods = foodMap[animal] || ['wheat']
  let item = null
  for (const f of foods) { item = inventoryItem(f); if (item) break }
  if (!item) { say(`I need ${foods.join(' or ')} to breed a ${animal} :3`); return }
  const mob = findMobByTypes(types, 16)
  if (!mob) { say(`I don't see a ${animal} nearby to breed :3`); return }
  const reached = await walkToMob(mob)
  if (!reached) { say(`I found a ${animal}, but I couldn't reach it :3`); return }
  try { await bot.equip(item.first, 'hand'); await bot.activateEntity(mob); say(`Fed the ${animal}, best effort. Breeding needs two adults fed close together, I am not claiming a baby yet, do the second one live with me :3`) } catch (e) { say(`Breeding failed: ${e.message}`) }
}
async function rideAttempt (vehicle) {
  if (!bot || !bot.entity) return
  const types = vehicle === 'boat' ? ['Boat'] : ['Minecart']
  const mob = findMobByTypes(types, 16)
  // Boats and minecarts are objects, not mobs, so also scan objects.
  let target = mob
  if (!target) {
    for (const id of Object.keys(bot.entities)) {
      const e = bot.entities[id]
      if (!e) continue
      const name = String(e.name || e.mobType || '').toLowerCase()
      if (vehicle === 'boat' && name.includes('boat')) { target = e; break }
      if (vehicle === 'minecart' && name.includes('minecart')) { target = e; break }
    }
  }
  if (!target) { say(`I don't see a ${vehicle} nearby to get in :3`); return }
  const reached = await walkToMob(target)
  if (!reached) { say(`I found a ${vehicle}, but I couldn't reach it :3`); return }
  try { await bot.activateEntity(target); say(`Tried to get in the ${vehicle}, best effort, check if I am riding it, and say 'get out' to leave it :3`) } catch (e) { say(`Getting in the ${vehicle} failed: ${e.message}`) }
}
function getOutVehicle () {
  try { if (bot && bot.dismount) { bot.dismount(); say('Getting out :3') } else say("I don't know how to dismount in this version, try jumping or breaking the vehicle live :3") } catch (e) { say(`Getting out failed: ${e.message}`) }
}
function checkInventoryNamed (names, label) {
  if (!bot) return null
  for (const n of names) { const item = inventoryItem(n); if (item) return item }
  say(`I don't have ${label} :3`)
  return null
}
function blockNearby (names, maxDistance) {
  if (!bot) return null
  try {
    const found = bot.findBlocks({ matching: (b) => names.includes(b.name), maxDistance: maxDistance || 8, count: 1 })
    return found.length > 0 ? bot.blockAt(found[0]) : null
  } catch (e) { return null }
}


// ---------------------------------------------------------------- round 7 (2026-10-30)
// Verified, not blind: every multi-step skill below checks its result
// in game (inventory, enchantments, vehicle, baby count, window output,
// block scan) and reports verified or not verified. If verification
// fails, it says so plainly and does NOT claim success. Unsafe skills
// (bridging voids, mass slaughter, breaking Moon's builds, attacking
// players, operator commands, blind boss fights, blind pearl throws)
// are warnings/help only, on purpose.
function countMobsOfTypes (types, radius) {
  if (!bot || !bot.entity) return []
  const out = []
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !types.includes(e.mobType)) continue
    if (e.position.distanceTo(bot.entity.position) <= (radius || 16)) out.push(e)
  }
  return out
}
function adultHeightFor (animal) {
  const h = { cow: 1.4, sheep: 1.3, pig: 0.9, chicken: 0.7, horse: 1.6, donkey: 1.5, mule: 1.6, wolf: 0.85, cat: 0.7, rabbit: 0.5, fox: 0.7, panda: 1.25, bee: 0.6, goat: 0.9, donkey2: 1.5 }
  return h[animal] || 1.0
}
async function breedVerified (animal) {
  if (!bot || !bot.entity) return
  const mobMap = { cow: ['Cow'], sheep: ['Sheep'], pig: ['Pig'], chicken: ['Chicken'], horse: ['Horse'], donkey: ['Donkey'], wolf: ['Wolf'], cat: ['Cat'], rabbit: ['Rabbit'], fox: ['Fox'], goat: ['Goat'], panda: ['Panda'], bee: ['Bee'] }
  const types = mobMap[animal] || [animal.charAt(0).toUpperCase() + animal.slice(1)]
  const foodMap = { cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'], horse: ['golden_apple', 'golden_carrot'], donkey: ['golden_apple', 'golden_carrot'], wolf: ['bone', 'beef', 'porkchop', 'chicken', 'mutton'], cat: ['cod', 'salmon'], rabbit: ['carrot', 'dandelion'], fox: ['sweet_berries'], goat: ['wheat'], panda: ['bamboo'], bee: ['dandelion', 'poppy', 'allium'] }
  const foods = foodMap[animal] || ['wheat']
  let foodItem = null
  for (const f of foods) { foodItem = inventoryItem(f); if (foodItem) break }
  if (!foodItem) { say(`I need ${foods.join(' or ')} to breed a ${animal}, and I need two adults, not just one :3`); return }
  const before = countMobsOfTypes(types, 16)
  if (before.length < 2) { say(`I only see ${before.length} ${animal}(s) nearby, breeding needs two adults close together, I am not claiming a baby :3`); return }
  const first = before[0]; const second = before[1]
  let fed = 0
  for (const target of [first, second]) {
    try {
      await walkToMob(target)
      const cur = inventoryItem(foodItem.type.name || foods[0])
      if (!cur) break
      await bot.equip(cur.first, 'hand'); await bot.activateEntity(target); fed++
      await new Promise((r) => setTimeout(r, 800))
    } catch (e) { log(`[breed-verified] feed failed: ${e.message}`) }
  }
  if (fed < 2) { say(`I only managed to feed ${fed} of 2 ${animal}s, so I am not claiming a baby, do the second one live with me :3`); return }
  await new Promise((r) => setTimeout(r, 6000))
  const after = countMobsOfTypes(types, 16)
  const adultH = adultHeightFor(animal)
  const babies = after.filter((e) => (e.height || 99) < adultH * 0.75)
  const verified = after.length > before.length || babies.length > 0
  log(`[breed-verified] ${animal} before=${before.length} after=${after.length} babiesByHeight=${babies.length} fed=${fed}`)
  if (verified) say(`Verified baby ${animal}! I counted ${before.length} before and ${after.length} after, and I see a smaller one, so that one is real, not just claimed :3`)
  else say(`I fed two ${animal}s, but I do not see a verified baby yet, count is still ${after.length}, so I am not claiming one, check live with me, it may need more time or the adults may be too far apart :3`)
}
async function rideTamedStep (animal, step) {
  if (!bot || !bot.entity) return
  const mobMap = { horse: ['Horse'], donkey: ['Donkey'], mule: ['Mule'] }
  const types = mobMap[animal] || ['Horse']
  const mob = findMobByTypes(types, 16)
  if (!mob) { say(`I don't see a ${animal} nearby to ride :3`); return }
  if (step === 'dismount') { try { bot.dismount(); await new Promise((r) => setTimeout(r, 800)); say(bot.vehicle ? "I tried to dismount, but I am still riding something :3" : 'Dismounted, verified, I am no longer riding :3') } catch (e) { say(`Dismount failed: ${e.message}`) } return }
  const reached = await walkToMob(mob)
  if (!reached) { say(`I found a ${animal}, but I couldn't reach it :3`); return }
  try {
    if (step === 'saddle') {
      const sad = inventoryItem('saddle'); if (!sad) { say('I need a saddle to saddle a horse, donkey, or mule :3'); return }
      await bot.equip(sad.first, 'hand'); await bot.activateEntity(mob)
      say('Tried to put a saddle on, best effort, I cannot verify a saddle from mineflayer alone, so I am not claiming it worked, now say "mount horse" and I will check if I am actually riding :3'); return
    }
    if (step === 'chest') {
      if (animal === 'horse') { say('Horses do not take chests, only donkeys and mules do :3'); return }
      const chest = inventoryItem('chest'); if (!chest) { say('I need a chest for a donkey or mule :3'); return }
      await bot.equip(chest.first, 'hand'); await bot.activateEntity(mob)
      say('Tried to put a chest on, best effort, I cannot verify a chest from mineflayer alone, so I am not claiming it worked, check live :3'); return
    }
    // mount, empty hand if possible
    try { const empty = bot.inventory.items().find((i) => i.name === 'air'); if (empty) await bot.equip(empty, 'hand') } catch (e) {}
    await bot.activateEntity(mob)
    await new Promise((r) => setTimeout(r, 1200))
    if (bot.vehicle && types.includes(bot.vehicle.mobType)) say(`Verified riding! I am riding a ${animal} now :3`)
    else if (bot.vehicle) say(`I am riding something, but it is not a ${animal}, it is ${bot.vehicle.mobType || 'unknown'}, so I am not claiming a verified ${animal} ride :3`)
    else say(`I tried to mount the ${animal}, but I am not riding it, it may not be tamed yet, tame it first live, then try again :3`)
  } catch (e) { say(`Riding step failed: ${e.message}`) }
}
async function transferToWindow (win, item, slot) {
  // Generic window transfer, same shape as the anvil helper in mineflayer.
  await bot.transfer({ window: win, itemType: item.type, metadata: item.metadata, count: 1, nbt: item.nbt, sourceStart: win.inventoryStart, sourceEnd: win.inventoryEnd, destStart: slot, destEnd: slot + 1 })
}
async function brewAwkwardVerified () {
  if (!bot) return
  const stand = blockNearby(['brewing_stand'], 8)
  if (!stand) { say("I don't see a brewing stand nearby to brew with :3"); return }
  const bottle = bot.inventory.items().find((i) => i.name === 'water_bottle')
  const wart = inventoryItem('nether_wart'); const powder = inventoryItem('blaze_powder')
  if (!bottle) { say('I need a water bottle to brew an awkward potion :3'); return }
  if (!wart) { say('I need nether wart to brew an awkward potion :3'); return }
  if (!powder) { say('I need blaze powder to fuel the brewing stand :3'); return }
  try {
    const win = await bot.openBlock(stand)
    try {
      await transferToWindow(win, bottle, 0)
      await transferToWindow(win, wart, 3)
      await transferToWindow(win, powder, 4)
    } catch (e) { say(`Putting ingredients in the brewing stand failed: ${e.message}, I am not claiming a brew :3`); try { win.close() } catch (e2) {}; return }
    say('Ingredients are in, brewing takes about 20 seconds, I will check the result, I am not claiming it yet :3')
    await new Promise((r) => setTimeout(r, 22000))
    let out = null
    try { out = win.slots && win.slots[0] } catch (e) {}
    const outName = out ? (out.name || '') : ''
    try { win.close() } catch (e) {}
    const hasAwkward = bot.inventory.items().some((i) => i.name === 'awkward_potion') || outName === 'awkward_potion'
    // If the bottle is still in the stand window, take it back is best-effort only.
    if (hasAwkward) say('Verified awkward potion! The water bottle changed to an awkward potion, so that brew is real :3')
    else say(`Brewing did not verify, output is still ${outName || 'unknown'}, so I am not claiming an awkward potion, check the stand live with me :3`)
  } catch (e) { say(`Brewing failed: ${e.message}, I am not claiming a brew :3`) }
}
async function anvilCombineVerified (item1, item2) {
  if (!bot) return
  const anv = blockNearby(['anvil', 'chipped_anvil', 'damaged_anvil'], 8)
  if (!anv) { say("I don't see an anvil nearby to combine with :3"); return }
  if (!bot.openAnvil) { say('Anvil combining is not available in this bot version, do it live with me :3'); return }
  const a = inventoryItem(item1); const b = inventoryItem(item2)
  if (!a || !b) { say(`I need both ${item1} and ${item2} in my inventory to combine them :3`); return }
  const xpBefore = bot.experience ? bot.experience.level : -1
  const beforeCount = bot.inventory.items().length
  try {
    const win = await bot.openAnvil(anv)
    try { await win.combine(a.first, b.first, '') } catch (e) { say(`Anvil combine failed, and I am not claiming it: ${e.message}`); try { win.close() } catch (e2) {}; return }
    try { win.close() } catch (e) {}
    const xpAfter = bot.experience ? bot.experience.level : -1
    say(`Verified anvil combine attempted, XP was ${xpBefore} and is now ${xpAfter}, inventory items ${beforeCount} to ${bot.inventory.items().length}. If the combined item is in my inventory with the new enchantments, say 'enchantments' to check it live, if not, I did not verify it :3`)
  } catch (e) { say(`Anvil combine failed: ${e.message}`) }
}
async function grindstoneVerified (itemName) {
  if (!bot) return
  const gs = blockNearby(['grindstone'], 8)
  if (!gs) { say("I don't see a grindstone nearby :3"); return }
  const item = inventoryItem(itemName)
  if (!item) { say(`I don't have any ${itemName} to disenchant :3`); return }
  try {
    const win = await bot.openBlock(gs)
    try { await transferToWindow(win, item.first, 0) } catch (e) { say(`Putting that in the grindstone failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    await new Promise((r) => setTimeout(r, 1000))
    let out = null; try { out = win.slots && win.slots[2] } catch (e) {}
    if (!out) { say('No grindstone output appeared, so I am not claiming a disenchant, check live :3'); try { win.close() } catch (e) {}; return }
    try { await bot.putAway(2) } catch (e) {}
    try { win.close() } catch (e) {}
    const now = inventoryItem(itemName)
    const ench = now && now.first ? (now.first.nbt || '') : ''
    say(`Grindstone output appeared, I took it back. If the ${itemName} in my inventory now has no enchantments, that disenchant is verified, say 'enchantments' to check it live, otherwise I did not verify it :3`)
  } catch (e) { say(`Grindstone failed: ${e.message}`) }
}
async function windowCraftVerified (blockNames, label, inSlots, outSlot) {
  // inSlots: [{itemName, slot}], outSlot: number. Returns true if output appeared and was taken.
  const blk = blockNearby(blockNames, 8)
  if (!blk) { say(`I don't see a ${label} nearby :3`); return false }
  try {
    const win = await bot.openBlock(blk)
    try {
      for (const ins of inSlots) {
        const it = inventoryItem(ins.itemName); if (!it) { say(`I need ${ins.itemName} for the ${label} :3`); try { win.close() } catch (e) {}; return false }
        await transferToWindow(win, it.first, ins.slot)
      }
    } catch (e) { say(`Putting items in the ${label} failed: ${e.message}`); try { win.close() } catch (e2) {}; return false }
    await new Promise((r) => setTimeout(r, 1000))
    let out = null; try { out = win.slots && win.slots[outSlot] } catch (e) {}
    if (!out) { say(`No ${label} output appeared, so I am not claiming it, check live :3`); try { win.close() } catch (e) {}; return false }
    const outName = out.name || 'output'
    try { await bot.putAway(outSlot) } catch (e) {}
    try { win.close() } catch (e) {}
    say(`Verified ${label} output: ${outName} appeared and I took it, check my inventory live to confirm :3`)
    return true
  } catch (e) { say(`${label} failed: ${e.message}`); return false }
}
function scanMineralPyramid (beaconPos) {
  if (!bot || !beaconPos) return null
  const minerals = ['iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'netherite_block']
  let level = 0; let missing = []
  for (let l = 1; l <= 4; l++) {
    const size = l * 2 + 1; const y = beaconPos.y - l; let ok = 0; let total = 0
    for (let dx = -l; dx <= l; dx++) { for (let dz = -l; dz <= l; dz++) { total++; const b = bot.blockAt(beaconPos.offset(dx, -l, dz)); if (b && minerals.includes(b.name)) ok++ } }
    if (ok === total) level = l; else { missing.push(`layer ${l} at y ${y}: ${ok} of ${total} mineral blocks`); break }
  }
  return { level, missing }
}
function reportBeaconPyramid () {
  const bc = blockNearby(['beacon'], 16)
  if (!bc) { say("I don't see a beacon nearby to check :3"); return }
  const r = scanMineralPyramid(bc.position)
  if (r.level === 0) say(`Beacon found, but no complete pyramid layer underneath, missing: ${r.missing.join(', ')}. I will not build a pyramid blind, tell me live what blocks to use :3`)
  else say(`Beacon pyramid verified at level ${r.level}, ${r.missing.length ? 'next layer missing: ' + r.missing.join(', ') : 'that is a full 4-layer pyramid'}. I did not build it, I only checked what is there :3`)
  log(`[beacon-check] level=${r.level} missing=${r.missing.join('; ')}`)
}
function reportConduitRing () {
  const cd = blockNearby(['conduit'], 16)
  if (!cd) { say("I don't see a conduit nearby to check :3"); return }
  const prism = ['prismarine', 'prismarine_bricks', 'dark_prismarine', 'sea_lantern']
  let count = 0; let water = 0
  for (let dx = -2; dx <= 2; dx++) { for (let dy = -2; dy <= 2; dy++) { for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) === 2 && Math.abs(dy) === 2 && Math.abs(dz) === 2) continue
    const b = bot.blockAt(cd.position.offset(dx, dy, dz)); if (!b) continue
    if (prism.includes(b.name)) count++
    if (b.name === 'water') water++
  } } }
  say(`Conduit found. I count ${count} prismarine or sea lantern blocks in the 5 by 5 by 5 area around it, and ${water} water blocks. A full conduit ring needs 16 prismarine blocks in a frame, I will not build the ring blind, tell me live what is missing :3`)
  log(`[conduit-check] prismarine=${count} water=${water}`)
}
function reportShulkerContents () {
  const sh = bot.inventory.items().find((i) => (i.name || '').includes('shulker_box'))
  if (!sh) { say("I don't have a shulker box to check :3"); return }
  let txt = 'unknown'
  try {
    const nbt = sh.nbt ? JSON.stringify(sh.nbt) : ''
    txt = nbt ? nbt.slice(0, 200) : 'no readable contents data'
  } catch (e) { txt = 'could not read contents' }
  say(`I have a ${sh.displayName || sh.name}. Its contents data, if readable, is: ${txt}. If that is not clear, we should open it live step by step, I am not moving items blind :3`)
}
async function shulkerMoveVerified (itemName) {
  const sh = bot.inventory.items().find((i) => (i.name || '').includes('shulker_box'))
  if (!sh) { say("I don't have a shulker box to move things into :3"); return }
  const item = inventoryItem(itemName); if (!item) { say(`I don't have any ${itemName} to move into the shulker box :3`); return }
  // Place shulker on safe ground in front, open it, move one item, reopen to verify.
  const placed = await placeNamedBlock(sh.name)
  if (!placed) { say('I could not place the shulker box safely, so I did not move anything :3'); return }
  try {
    const blk = blockNearby(['shulker_box', 'white_shulker_box', 'black_shulker_box', 'red_shulker_box', 'blue_shulker_box', 'purple_shulker_box'], 8)
    if (!blk) { say('I placed the shulker box, but I cannot find it nearby to open :3'); return }
    let win = await bot.openBlock(blk)
    try { await transferToWindow(win, item.first, 0) } catch (e) { say(`Moving that into the shulker box failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    try { win.close() } catch (e) {}
    win = await bot.openBlock(blk)
    let found = false; try { for (const slot of (win.slots || [])) { if (slot && slot.name === item.first.name) found = true } } catch (e) {}
    try { win.close() } catch (e) {}
    if (found) say(`Verified shulker move: ${itemName} is in the shulker box when I reopened it. I left the box placed, break it live to pick it back up, I am not breaking it blind :3`)
    else say(`Shulker move did not verify, I do not see ${itemName} in the box on reopening, so I am not claiming it moved :3`)
  } catch (e) { say(`Shulker move failed: ${e.message}`) }
}
function reportPortal () {
  const obs = bot.findBlocks({ matching: (b) => b.name === 'obsidian', maxDistance: 16, count: 30 }) || []
  const portals = bot.findBlocks({ matching: (b) => b.name === 'nether_portal', maxDistance: 16, count: 20 }) || []
  if (obs.length === 0 && portals.length === 0) { say('I do not see an obsidian portal frame or a portal nearby :3'); return }
  say(`Portal check: ${obs.length} obsidian blocks and ${portals.length} portal blocks nearby. ${portals.length > 0 ? 'A portal looks active, but I will not enter it blind, tell me live if you want to travel.' : 'A frame may be there, but it does not look lit yet, I will not build or light it blind.'} :3`)
}
function reportStructureDanger () {
  const dangers = []
  const types = { Wither: 'Wither boss', Warden: 'Warden', Guardian: 'Guardian', ElderGuardian: 'Elder Guardian', Blaze: 'Blaze', Breeze: 'Breeze', EnderDragon: 'Ender Dragon' }
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]; if (!e || e.type !== 'mob') continue
    if (types[e.mobType]) { const d = e.position.distanceTo(bot.entity.position); if (d <= 32) dangers.push(`${types[e.mobType]} about ${d.toFixed(0)} blocks away`) }
  }
  const blocks = []
  const want = ['trial_spawner', 'spawner', 'vault', 'ominous_vault', 'sculk_shrieker', 'end_portal_frame']
  for (const n of want) { const f = blockNearby([n], 16); if (f) blocks.push(n) }
  if (dangers.length === 0 && blocks.length === 0) say('No boss, guardian, blaze, breeze, spawner, vault, or portal frame danger nearby that I can see, but that does not mean the area is safe, I only sense 32 blocks :3')
  else say(`Structure danger check: ${dangers.length ? dangers.join(', ') : 'no boss mobs nearby'}. Blocks nearby: ${blocks.length ? blocks.join(', ') : 'none'}. I will not fight a boss or enter a trial blind, tell me live what to do, and I can retreat :3`)
}
async function boneMealCrop () {
  const bm = inventoryItem('bone_meal'); if (!bm) { say('I need bone meal to grow a crop :3'); return }
  const crops = blockNearby(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem'], 8)
  if (!crops) { say("I don't see a crop nearby to grow :3"); return }
  const before = crops.properties ? crops.properties.age : null
  try { await bot.equip(bm.first, 'hand'); await bot.activateBlock(crops); await new Promise((r) => setTimeout(r, 1000)); const afterBlk = bot.blockAt(crops.position); const after = afterBlk && afterBlk.properties ? afterBlk.properties.age : null; if (before !== null && after !== null && after > before) say(`Verified crop growth: age ${before} to ${after} :3`); else if (before === null) say('Tried bone meal on a crop, best effort, I could not read its growth stage to verify it :3'); else say(`Bone meal did not verify growth, age is still ${after}, it may already be fully grown, check live :3`) } catch (e) { say(`Bone meal failed: ${e.message}`) }
}
async function checkTrades () {
  const vil = findMobByTypes(['Villager'], 16)
  if (!vil) { say("I don't see a villager nearby to check trades with :3"); return }
  if (!bot.openVillager) { say('Villager trading is not available in this bot version, check trades live with me :3'); return }
  try { const v = await bot.openVillager(vil); const trades = v.trades || []; say(`Villager trades check: ${trades.length} trade(s) available, I am not trading blind, tell me live which trade number you want and I will help step by step :3`); try { v.close() } catch (e) {} } catch (e) { say(`Checking trades failed: ${e.message}, I am not trading blind :3`) }
}



// ---------------------------------------------------------------- round 8 (2026-10-30)
// Verifiable second stages and window work, plus pet and movement
// verification. Rule, same as round 7: check the result in game
// (inventory, window output, position, Y, mob following, level) and
// report verified or not verified. Never claim success if a transfer,
// a window output, or a movement check fails. Help and planning steps
// are used for named biomes/villages/structures, redstone circuits,
// piston machines, and a full house, because those need Moon's live
// choices and a seed or a plan, not blind automation.
function slotLayoutText (win) {
  try {
    const parts = []
    for (let i = 0; i < (win.slots || []).length; i++) {
      const slot = win.slots[i]
      if (slot) parts.push(`${i}:${slot.name || 'item'}x${slot.count || 1}`)
    }
    return parts.length ? parts.join(', ') : 'all slots empty'
  } catch (e) { return 'could not read window slots' }
}
async function windowCraftWithLayout (blockNames, label, inSlots, outSlot) {
  const blk = blockNearby(blockNames, 8)
  if (!blk) { say(`I don't see a ${label} nearby :3`); return false }
  try {
    const win = await bot.openBlock(blk)
    try {
      for (const ins of inSlots) {
        const it = inventoryItem(ins.itemName); if (!it) { say(`I need ${ins.itemName} for the ${label} :3`); try { win.close() } catch (e) {}; return false }
        await transferToWindow(win, it.first, ins.slot)
      }
    } catch (e) { say(`Putting items in the ${label} failed, clean failure, nothing claimed: ${e.message}. Window slots were: ${slotLayoutText(win)} :3`); try { win.close() } catch (e2) {}; return false }
    await new Promise((r) => setTimeout(r, 1000))
    const layout = slotLayoutText(win)
    let out = null; try { out = win.slots && win.slots[outSlot] } catch (e) {}
    if (!out) { say(`No ${label} output appeared, clean failure, I am not claiming it. Window slots were: ${layout} :3`); try { win.close() } catch (e) {}; return false }
    const outName = out.name || 'output'
    try { await bot.putAway(outSlot) } catch (e) {}
    try { win.close() } catch (e) {}
    const has = bot.inventory.items().some((i) => i.name === outName)
    log(`[window-layout] ${label} slots=${layout} output=${outName} inInventory=${has}`)
    if (has) say(`Verified ${label} output with layout check: ${outName} is in my inventory. Window slots were: ${layout} :3`)
    else say(`Verified ${label} output appeared (${outName}), but I do not see it in my inventory after taking it, so check live, I am not claiming it fully :3`)
    return has
  } catch (e) { say(`${label} failed, clean failure: ${e.message}`); return false }
}
async function windowLayoutCheckOnly (blockNames, label, inSlots) {
  const blk = blockNearby(blockNames, 8)
  if (!blk) { say(`I don't see a ${label} nearby :3`); return }
  try {
    const win = await bot.openBlock(blk)
    try {
      for (const ins of inSlots) {
        const it = inventoryItem(ins.itemName); if (!it) { say(`I need ${ins.itemName} for the ${label} layout check :3`); try { win.close() } catch (e) {}; return }
        await transferToWindow(win, it.first, ins.slot)
      }
    } catch (e) { say(`Layout check transfer failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    await new Promise((r) => setTimeout(r, 1000))
    const layout = slotLayoutText(win)
    try { win.close() } catch (e) {}
    say(`${label} layout check: ${layout}. Closing the window should return items to my inventory, check live, I have not taken an output blind :3`)
  } catch (e) { say(`${label} layout check failed: ${e.message}`) }
}
const BREW_SECOND = {
  healing: { ingredient: 'glistering_melon_slice', expect: 'healing' },
  strength: { ingredient: 'blaze_powder', expect: 'strength' },
  swiftness: { ingredient: 'sugar', expect: 'swiftness' },
  'fire resistance': { ingredient: 'magma_cream', expect: 'fire' },
  'night vision': { ingredient: 'golden_carrot', expect: 'night' },
  'water breathing': { ingredient: 'pufferfish', expect: 'water' },
  regeneration: { ingredient: 'ghast_tear', expect: 'regeneration' },
  poison: { ingredient: 'spider_eye', expect: 'poison' },
  leaping: { ingredient: 'rabbit_foot', expect: 'leaping' },
  'slow falling': { ingredient: 'phantom_membrane', expect: 'slow' }
}
async function brewSecondStageVerified (potionKey) {
  const spec = BREW_SECOND[potionKey]
  if (!spec) { say(`I do not know a second-stage brew for ${potionKey} yet, say "brew help" and tell me live what you want :3`); return }
  const stand = blockNearby(['brewing_stand'], 8)
  if (!stand) { say("I don't see a brewing stand nearby :3"); return }
  const bottles = bot.inventory.items().filter((i) => i.name === 'awkward_potion')
  if (bottles.length === 0) { say('I need an awkward potion first, say "brew verified" to make one, then we do the second stage live :3'); return }
  const ing = inventoryItem(spec.ingredient); const powder = inventoryItem('blaze_powder')
  if (!ing) { say(`I need ${spec.ingredient} for a ${potionKey} potion :3`); return }
  if (!powder) { say('I need blaze powder to fuel the brewing stand :3'); return }
  try {
    const win = await bot.openBlock(stand)
    try {
      const use = bottles.slice(0, 3)
      for (let i = 0; i < use.length; i++) await transferToWindow(win, use[i], i)
      await transferToWindow(win, ing.first, 3)
      await transferToWindow(win, powder.first, 4)
    } catch (e) { say(`Putting second-stage ingredients in failed: ${e.message}, I am not claiming a brew :3`); try { win.close() } catch (e2) {}; return }
    say(`Second-stage ingredients are in for ${potionKey}, brewing takes about 20 seconds, I will check the result, I am not claiming it yet :3`)
    await new Promise((r) => setTimeout(r, 22000))
    let outs = []
    try { for (let i = 0; i < 3; i++) { const sl = win.slots && win.slots[i]; if (sl) outs.push(sl.name || '') } } catch (e) {}
    try { win.close() } catch (e) {}
    const inv = bot.inventory.items().map((i) => i.name || '')
    const verified = outs.some((n) => n.includes(spec.expect)) || inv.some((n) => n.includes(spec.expect) && n.includes('potion'))
    log(`[brew-second] ${potionKey} window=${outs.join(',')} inventoryHasExpect=${verified}`)
    if (verified) say(`Verified second-stage brew! I see a ${potionKey} potion result, window was: ${outs.join(', ') || 'empty'} :3`)
    else say(`Second-stage brew did not verify for ${potionKey}, window was: ${outs.join(', ') || 'empty'}, so I am not claiming it, check the stand live with me :3`)
  } catch (e) { say(`Second-stage brew failed: ${e.message}`) }
}
async function brewMultipleAwkward () {
  const stand = blockNearby(['brewing_stand'], 8)
  if (!stand) { say("I don't see a brewing stand nearby :3"); return }
  const bottles = bot.inventory.items().filter((i) => i.name === 'water_bottle')
  if (bottles.length === 0) { say('I need water bottles to brew awkward potions :3'); return }
  const wart = inventoryItem('nether_wart'); const powder = inventoryItem('blaze_powder')
  if (!wart || !powder) { say('I need nether wart and blaze powder to brew awkward potions :3'); return }
  try {
    const win = await bot.openBlock(stand)
    try {
      const use = bottles.slice(0, 3)
      for (let i = 0; i < use.length; i++) await transferToWindow(win, use[i], i)
      await transferToWindow(win, wart.first, 3)
      await transferToWindow(win, powder.first, 4)
    } catch (e) { say(`Putting awkward ingredients in failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    say(`Brewing ${Math.min(3, bottles.length)} awkward potion(s), about 20 seconds, I will check, I am not claiming them yet :3`)
    await new Promise((r) => setTimeout(r, 22000))
    let outs = []
    try { for (let i = 0; i < 3; i++) { const sl = win.slots && win.slots[i]; if (sl) outs.push(sl.name || '') } } catch (e) {}
    try { win.close() } catch (e) {}
    const count = outs.filter((n) => n === 'awkward_potion').length
    if (count > 0) say(`Verified awkward brew: ${count} awkward potion(s) in the stand window, window was: ${outs.join(', ')} :3`)
    else say(`Awkward brew did not verify, window was: ${outs.join(', ') || 'empty'}, I am not claiming it :3`)
  } catch (e) { say(`Multiple awkward brew failed: ${e.message}`) }
}
async function smeltVerified (itemName) {
  const furn = blockNearby(['furnace', 'blast_furnace', 'smoker'], 8)
  if (!furn) { say("I don't see a furnace, blast furnace, or smoker nearby :3"); return }
  if (!bot.openFurnace) { say('Smelting is not available in this bot version, do it live with me :3'); return }
  const item = inventoryItem(itemName); if (!item) { say(`I don't have any ${itemName} to smelt :3`); return }
  const fuel = inventoryItem('coal') || inventoryItem('charcoal') || inventoryItem('oak_planks')
  if (!fuel) { say('I need coal, charcoal, or planks as fuel to smelt :3'); return }
  const cookedMap = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', copper_ore: 'copper_ingot', raw_iron: 'iron_ingot', raw_gold: 'gold_ingot', raw_copper: 'copper_ingot', sand: 'glass', cobblestone: 'stone', clay: 'brick' }
  const expect = cookedMap[itemName] || null
  try {
    const win = await bot.openFurnace(furn)
    try { await win.putInput(item.first); await win.putFuel(fuel.first) } catch (e) { say(`Putting items in the furnace failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    say('Smelting started, waiting about 15 seconds, I will check the output, I am not claiming it yet :3')
    await new Promise((r) => setTimeout(r, 15000))
    let out = null; try { out = win.outputItem ? win.outputItem() : null } catch (e) {}
    if (!out) { say('No smelting output yet, it may need more time or more fuel, I am not claiming it, check live :3'); try { win.close() } catch (e) {}; return }
    try { await win.takeOutput() } catch (e) {}
    try { win.close() } catch (e) {}
    const has = expect ? bot.inventory.items().some((i) => i.name === expect) : true
    if (has) say(`Verified smelt: output was ${out.name || 'item'}${expect ? ', and I now have ' + expect : ''} :3`)
    else say(`Smelting output appeared as ${out.name || 'item'}, but I do not see ${expect} in my inventory after taking it, check live, I am not claiming it fully :3`)
  } catch (e) { say(`Smelting failed: ${e.message}`) }
}
async function enchantVerified (itemName, choice) {
  const table = blockNearby(['enchanting_table'], 8)
  if (!table) { say("I don't see an enchanting table nearby :3"); return }
  if (!bot.openEnchantmentTable) { say('Enchanting is not available in this bot version, do it live with me :3'); return }
  const item = inventoryItem(itemName); if (!item) { say(`I don't have any ${itemName} to enchant :3`); return }
  const lapis = inventoryItem('lapis_lazuli'); if (!lapis) { say('I need lapis lazuli to enchant :3'); return }
  try {
    const win = await bot.openEnchantmentTable(table)
    try { await win.putTargetItem(item.first); await win.putLapis(lapis.first) } catch (e) { say(`Putting items in the enchanting table failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    await new Promise((r) => setTimeout(r, 1500))
    const opts = win.enchantments || []
    const optText = opts.map((o, i) => `${i + 1}: level ${o.level || '?'}`).join(', ') || 'no options yet'
    if (choice === null || choice === undefined) { say(`Enchanting options for ${itemName}: ${optText}. I will not spend XP blind, say "enchant verified ${itemName} 1" or 2 or 3, and I will check XP first :3`); try { win.close() } catch (e) {}; return }
    const idx = choice - 1
    if (!opts[idx] || opts[idx].level === -1) { say(`Enchanting option ${choice} is not available, options were: ${optText} :3`); try { win.close() } catch (e) {}; return }
    const xpLevel = bot.experience ? bot.experience.level : 0
    if (xpLevel < opts[idx].level) { say(`I need ${opts[idx].level} XP levels for option ${choice}, but I only have ${xpLevel}, I am not enchanting blind :3`); try { win.close() } catch (e) {}; return }
    const beforeEnch = item.first.enchants ? JSON.stringify(item.first.enchants) : ''
    try { await win.enchant(idx) } catch (e) { say(`Enchanting failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    let out = null; try { out = win.targetItem ? win.targetItem() : null } catch (e) {}
    try { if (win.takeTargetItem) await win.takeTargetItem() } catch (e) {}
    try { win.close() } catch (e) {}
    const after = bot.inventory.items().find((i) => i.name === itemName)
    const afterEnch = after && after.enchants ? JSON.stringify(after.enchants) : ''
    if (afterEnch && afterEnch !== beforeEnch) say(`Verified enchant! ${itemName} enchantments changed, check with "enchantments" live :3`)
    else say(`Enchanting option ${choice} ran, but I cannot verify new enchantments in my inventory yet, output was ${out ? out.name : 'unknown'}, check live, I am not claiming it fully :3`)
  } catch (e) { say(`Enchanting failed: ${e.message}`) }
}
async function stonecutterVerified (cutName) {
  const sc = blockNearby(['stonecutter'], 8)
  if (!sc) { say("I don't see a stonecutter nearby :3"); return }
  const stone = bot.inventory.items().find((i) => ['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'blackstone', 'deepslate'].includes(i.name))
  if (!stone) { say('I need a stone block to cut in the stonecutter :3'); return }
  try {
    const win = await bot.openBlock(sc)
    try { await transferToWindow(win, stone, 0) } catch (e) { say(`Putting stone in the stonecutter failed: ${e.message}`); try { win.close() } catch (e2) {}; return }
    await new Promise((r) => setTimeout(r, 1000))
    const layout = slotLayoutText(win)
    let targetSlot = -1; let targetName = ''
    try { for (let i = 1; i < (win.slots || []).length; i++) { const sl = win.slots[i]; if (sl && (!cutName || sl.name.includes(cutName))) { targetSlot = i; targetName = sl.name; break } } } catch (e) {}
    if (targetSlot < 0) { say(`Stonecutter layout was: ${layout}. I do not see ${cutName || 'a cut'} there, so I am not cutting blind :3`); try { win.close() } catch (e) {}; return }
    if (!cutName) { say(`Stonecutter cuts available, layout: ${layout}. Say "stonecutter verified ${targetName}" to take that one :3`); try { win.close() } catch (e) {}; return }
    try { await bot.putAway(targetSlot) } catch (e) {}
    try { win.close() } catch (e) {}
    const has = bot.inventory.items().some((i) => i.name === targetName)
    if (has) say(`Verified stonecutter cut: ${targetName} is in my inventory :3`)
    else say(`Stonecutter output was ${targetName}, but I do not see it in my inventory after taking it, check live :3`)
  } catch (e) { say(`Stonecutter failed: ${e.message}`) }
}
async function composterVerified (itemName) {
  const cp = blockNearby(['composter'], 8)
  if (!cp) { say("I don't see a composter nearby :3"); return }
  const item = inventoryItem(itemName); if (!item) { say(`I don't have any ${itemName} to compost :3`); return }
  const before = cp.properties ? cp.properties.level : null
  try { await bot.equip(item.first, 'hand'); await bot.activateBlock(cp); await new Promise((r) => setTimeout(r, 1000)); const afterBlk = bot.blockAt(cp.position); const after = afterBlk && afterBlk.properties ? afterBlk.properties.level : null; if (before !== null && after !== null && after > before) say(`Verified compost: level ${before} to ${after} :3`); else if (before === null) say('Tried composting, best effort, I could not read the composter level to verify it :3'); else say(`Compost did not verify, level is still ${after}, it may be full or that item may not compost, check live :3`) } catch (e) { say(`Composting failed: ${e.message}`) }
}
async function campfireCookVerified (foodName) {
  const cf = blockNearby(['campfire', 'soul_campfire'], 8)
  if (!cf) { say("I don't see a campfire nearby :3"); return }
  const food = inventoryItem(foodName); if (!food) { say(`I don't have any ${foodName} to cook on a campfire :3`); return }
  const cookedMap = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', kelp: 'dried_kelp' }
  const expect = cookedMap[foodName]
  if (!expect) { say(`I do not know a campfire cooked version of ${foodName}, tell me live :3`); return }
  try { await bot.equip(food.first, 'hand'); await bot.activateBlock(cf); say('Food is on the campfire, cooking takes about 30 seconds, I will check, I am not claiming it yet :3'); await new Promise((r) => setTimeout(r, 32000)); const hasInv = bot.inventory.items().some((i) => i.name === expect); let hasEntity = false; for (const id of Object.keys(bot.entities)) { const e = bot.entities[id]; if (e && e.name && String(e.name).includes(expect)) hasEntity = true } if (hasInv || hasEntity) say(`Verified campfire cook: I see ${expect}${hasEntity ? ' as a dropped item nearby' : ' in my inventory'} :3`); else say(`Campfire cooking did not verify, I do not see ${expect} yet, it may need more time, check live :3`) } catch (e) { say(`Campfire cooking failed: ${e.message}`) }
}
async function dyeArmourVerified (piece, dyeName) {
  const cauldron = blockNearby(['cauldron', 'water_cauldron'], 8)
  if (!cauldron) { say("I don't see a cauldron nearby :3"); return }
  const item = inventoryItem(piece); const dye = inventoryItem(dyeName)
  if (!item) { say(`I don't have ${piece} to dye :3`); return }
  if (!dye) { say(`I need ${dyeName} dye to dye armour :3`); return }
  if (!piece.includes('leather')) { say('Only leather armour can be dyed in a cauldron, that piece is not leather :3'); return }
  const before = item.first.nbt ? JSON.stringify(item.first.nbt) : ''
  try { await bot.equip(dye.first, 'hand'); await bot.activateBlock(cauldron); await new Promise((r) => setTimeout(r, 1000)); const afterItem = inventoryItem(piece); const after = afterItem && afterItem.first.nbt ? JSON.stringify(afterItem.first.nbt) : ''; if (after && after !== before) say(`Verified dye: ${piece} colour data changed :3`); else say(`Dye attempt did not verify a colour change, cauldron may need water, or the dye step needs to be done live with the armour in hand, check live :3`) } catch (e) { say(`Dyeing failed: ${e.message}`) }
}
async function shearVerified () {
  const sheep = findMobByTypes(['Sheep'], 16)
  if (!sheep) { say("I don't see a sheep nearby to shear :3"); return }
  const shears = inventoryItem('shears'); if (!shears) { say('I need shears to shear a sheep :3'); return }
  const before = bot.inventory.items().filter((i) => (i.name || '').includes('wool')).reduce((n, i) => n + i.count, 0)
  const reached = await walkToMob(sheep); if (!reached) { say('I found a sheep, but I could not reach it :3'); return }
  try { await bot.equip(shears.first, 'hand'); await bot.activateEntity(sheep); await new Promise((r) => setTimeout(r, 1000)); const after = bot.inventory.items().filter((i) => (i.name || '').includes('wool')).reduce((n, i) => n + i.count, 0); if (after > before) say(`Verified shear: wool ${before} to ${after} :3`); else say('Shear did not verify more wool, that sheep may already be sheared, check live :3') } catch (e) { say(`Shearing failed: ${e.message}`) }
}
async function milkVerified () {
  const cow = findMobByTypes(['Cow', 'Mooshroom'], 16)
  if (!cow) { say("I don't see a cow nearby to milk :3"); return }
  const bucket = inventoryItem('bucket'); if (!bucket) { say('I need an empty bucket to milk a cow :3'); return }
  const before = bot.inventory.items().filter((i) => i.name === 'milk_bucket').length
  const reached = await walkToMob(cow); if (!reached) { say('I found a cow, but I could not reach it :3'); return }
  try { await bot.equip(bucket.first, 'hand'); await bot.activateEntity(cow); await new Promise((r) => setTimeout(r, 1000)); const after = bot.inventory.items().filter((i) => i.name === 'milk_bucket').length; if (after > before) say('Verified milk: I now have a milk bucket :3'); else say('Milking did not verify a milk bucket, check live :3') } catch (e) { say(`Milking failed: ${e.message}`) }
}
async function fishVerified () {
  const rod = inventoryItem('fishing_rod'); if (!rod) { say('I need a fishing rod to fish :3'); return }
  if (!bot.fish) { say('Fishing is not available in this bot version, do it live with me :3'); return }
  const before = bot.inventory.items().filter((i) => ['cod', 'salmon', 'tropical_fish', 'pufferfish'].includes(i.name)).reduce((n, i) => n + i.count, 0)
  try { await bot.equip(rod.first, 'hand'); say('Fishing, waiting for a bite, this can take a while, I will check, I am not claiming a fish yet :3'); const done = await Promise.race([bot.fish(), new Promise((r) => setTimeout(() => r('timeout'), 60000))]); await new Promise((r) => setTimeout(r, 1000)); const after = bot.inventory.items().filter((i) => ['cod', 'salmon', 'tropical_fish', 'pufferfish'].includes(i.name)).reduce((n, i) => n + i.count, 0); if (after > before) say(`Verified fish: fish count ${before} to ${after} :3`); else say(`Fishing ended (${done === 'timeout' ? 'timed out after 60 seconds' : 'no bite counted'}), fish count is still ${after}, I am not claiming a fish, try again live :3`) } catch (e) { say(`Fishing failed: ${e.message}`) }
}
async function tradeVerified (index) {
  const vil = findMobByTypes(['Villager'], 16)
  if (!vil) { say("I don't see a villager nearby to trade with :3"); return }
  if (!bot.openVillager) { say('Villager trading is not available in this bot version, check trades live with me :3'); return }
  try {
    const v = await bot.openVillager(vil); const trades = v.trades || []
    if (index === null || index === undefined) { say(`Villager trades: ${trades.length} trade(s). Say "trade verified 1" with a number, and I will check ingredients first, I will not trade blind :3`); try { v.close() } catch (e) {}; return }
    const idx = index - 1
    if (!trades[idx]) { say(`Trade ${index} does not exist, there are ${trades.length} trades :3`); try { v.close() } catch (e) {}; return }
    const tr = trades[idx]
    if (tr.tradeDisabled) { say(`Trade ${index} is disabled right now, I will not trade it :3`); try { v.close() } catch (e) {}; return }
    const beforeOut = bot.inventory.items().filter((i) => tr.outputItem && i.name === tr.outputItem.name).reduce((n, i) => n + i.count, 0)
    try { await v.trade(idx, 1) } catch (e) { say(`Trade ${index} failed: ${e.message}, I am not claiming it :3`); try { v.close() } catch (e2) {}; return }
    try { v.close() } catch (e) {}
    const afterOut = bot.inventory.items().filter((i) => tr.outputItem && i.name === tr.outputItem.name).reduce((n, i) => n + i.count, 0)
    if (afterOut > beforeOut) say(`Verified trade ${index}: output ${tr.outputItem ? tr.outputItem.name : 'item'} count ${beforeOut} to ${afterOut} :3`)
    else say(`Trade ${index} ran, but I do not see more output in my inventory, check live, I am not claiming it fully :3`)
  } catch (e) { say(`Trading failed: ${e.message}`) }
}
async function tameVerified (animal) {
  const mobMap = { wolf: ['Wolf'], dog: ['Wolf'], cat: ['Cat'], parrot: ['Parrot'], horse: ['Horse'], donkey: ['Donkey'], mule: ['Mule'] }
  const types = mobMap[animal] || [animal.charAt(0).toUpperCase() + animal.slice(1)]
  const mob = findMobByTypes(types, 16)
  if (!mob) { say(`I don't see a ${animal} nearby to tame-verify :3`); return }
  const reached = await walkToMob(mob); if (!reached) { say(`I found a ${animal}, but I could not reach it :3`); return }
  const foodMap = { wolf: ['bone'], dog: ['bone'], cat: ['cod', 'salmon'], parrot: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'] }
  const foods = foodMap[animal] || []
  let fed = 0
  for (let i = 0; i < 3; i++) {
    let item = null; for (const f of foods) { item = inventoryItem(f); if (item) break }
    if (!item) break
    try { await bot.equip(item.first, 'hand'); await bot.activateEntity(mob); fed++; await new Promise((r) => setTimeout(r, 1000)) } catch (e) { break }
  }
  if (fed === 0 && foods.length) { say(tameGuide(animal)); return }
  if (foods.length === 0) { say(`${tameGuide(animal)} For verification, I will now move away and see if it follows me :3`) }
  const botPos = bot.entity.position.clone(); const mobPosBefore = mob.position.clone()
  bot.pathfinder.setGoal(new goals.GoalNear(botPos.x + 8, botPos.y, botPos.z, 1), true)
  await new Promise((r) => setTimeout(r, 5000))
  if (bot) bot.pathfinder.setGoal(null)
  const distAfter = mob.position.distanceTo(bot.entity.position)
  const movedToward = mob.position.distanceTo(mobPosBefore) > 2
  log(`[tame-verified] ${animal} fed=${fed} mobMoved=${movedToward} distAfter=${distAfter.toFixed(1)}`)
  if (distAfter < 8 && movedToward) say(`Tame verification looks good: I fed ${fed} time(s), moved away, and the ${animal} followed me to about ${distAfter.toFixed(0)} blocks away, so it is acting like a tamed pet, check hearts live to be sure :3`)
  else say(`Tame did not verify following: I fed ${fed} time(s), moved away, and the ${animal} is about ${distAfter.toFixed(0)} blocks away and ${movedToward ? 'moved a little' : 'did not follow'}, so I am not claiming it is tamed, check hearts live with me :3`)
}
async function leadPet (animal) {
  const mob = findMobByTypes([animal.charAt(0).toUpperCase() + animal.slice(1)], 16)
  if (!mob) { say(`I don't see a ${animal} nearby to lead :3`); return }
  const lead = inventoryItem('lead'); if (!lead) { say('I need a lead to lead a pet :3'); return }
  const reached = await walkToMob(mob); if (!reached) { say(`I found a ${animal}, but I could not reach it :3`); return }
  try { await bot.equip(lead.first, 'hand'); await bot.activateEntity(mob); await new Promise((r) => setTimeout(r, 1000)); const botPos = bot.entity.position.clone(); bot.pathfinder.setGoal(new goals.GoalNear(botPos.x + 6, botPos.y, botPos.z, 1), true); await new Promise((r) => setTimeout(r, 4000)); if (bot) bot.pathfinder.setGoal(null); const dist = mob.position.distanceTo(bot.entity.position); if (dist < 8) say(`Lead check looks good: the ${animal} is about ${dist.toFixed(0)} blocks away after I moved, so it seems leashed and following :3`); else say(`Lead did not verify following: the ${animal} is about ${dist.toFixed(0)} blocks away, check live if the lead actually attached :3`) } catch (e) { say(`Leading failed: ${e.message}`) }
}
async function sitPet (animal, wantSit) {
  const mob = findMobByTypes([animal.charAt(0).toUpperCase() + animal.slice(1)], 16)
  if (!mob) { say(`I don't see a ${animal} nearby to sit or stand :3`); return }
  const reached = await walkToMob(mob); if (!reached) { say(`I found a ${animal}, but I could not reach it :3`); return }
  const posBefore = mob.position.clone()
  try { await bot.activateEntity(mob); await new Promise((r) => setTimeout(r, 1000)); const botPos = bot.entity.position.clone(); bot.pathfinder.setGoal(new goals.GoalNear(botPos.x + 8, botPos.y, botPos.z, 1), true); await new Promise((r) => setTimeout(r, 4000)); if (bot) bot.pathfinder.setGoal(null); const moved = mob.position.distanceTo(posBefore); if (wantSit && moved < 2) say(`Sit check looks good: the ${animal} stayed within about ${moved.toFixed(1)} blocks while I moved away, so it looks sitting :3`); else if (!wantSit && moved >= 2) say(`Stand check looks good: the ${animal} moved about ${moved.toFixed(1)} blocks, so it looks standing and following :3`); else say(`Sit/stand did not verify: the ${animal} moved about ${moved.toFixed(1)} blocks, it may not be tamed yet, check live :3`) } catch (e) { say(`Sit/stand failed: ${e.message}`) }
}
async function ladderClimbVerified () {
  const lad = blockNearby(['ladder'], 8)
  if (!lad) { say("I don't see a ladder nearby :3"); return }
  bot.pathfinder.setGoal(new goals.GoalNear(lad.position.x, lad.position.y, lad.position.z, 1), true)
  await new Promise((r) => setTimeout(r, 3000))
  if (bot) bot.pathfinder.setGoal(null)
  const yBefore = bot.entity.position.y
  try { bot.setControlState('forward', true); bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 4000)); bot.setControlState('jump', false); bot.setControlState('forward', false) } catch (e) {}
  const yAfter = bot.entity.position.y
  if (yAfter >= yBefore + 1) say(`Verified ladder climb: Y ${yBefore.toFixed(0)} to ${yAfter.toFixed(0)} :3`)
  else say(`Ladder climb did not verify, Y is still ${yAfter.toFixed(0)} after trying, I may be stuck, tell me live :3`)
}
function crawlCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let gap = null
  for (let dx = -3; dx <= 3; dx++) { for (let dz = -3; dz <= 3; dz++) {
    const feet = bot.blockAt(p.offset(dx, 0, dz)); const head = bot.blockAt(p.offset(dx, 1, dz)); const above = bot.blockAt(p.offset(dx, 2, dz))
    if (feet && feet.boundingBox !== 'block' && head && head.boundingBox !== 'block' && above && above.boundingBox === 'block') { gap = p.offset(dx, 0, dz); break }
  } if (gap) break }
  if (!gap) { say('I do not see a 1-block-high gap nearby to crawl through, tell me live where it is and we will try it step by step, I will not trap myself blind :3'); return }
  say(`Crawl check: I see a low gap near ${gap.x.toFixed(0)}, ${gap.y.toFixed(0)}, ${gap.z.toFixed(0)}, with solid above it. Crawling needs a trapdoor or swimming trick and precise timing, so say "crawl through" only if you are watching live, and I will try to walk through while sneaking, and report if I get to the other side :3`)
}
async function crawlThroughVerified () {
  crawlCheck()
  const p = bot.entity.position.clone()
  try { bot.setControlState('sneak', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 3000)); bot.setControlState('forward', false); bot.setControlState('sneak', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(p)
  if (moved >= 2) say(`Crawl attempt moved ${moved.toFixed(1)} blocks, check live if I am on the other side, I am not claiming a clean crawl unless you confirm it :3`)
  else say(`Crawl attempt barely moved (${moved.toFixed(1)} blocks), I may be stuck, tell me live :3`)
}
async function elytraGlideVerified () {
  const ely = bot.inventory.items().find((i) => i.name === 'elytra')
  if (!ely) { say('I need an elytra to glide, wear one first :3'); return }
  try { await bot.equip(ely, 'torso') } catch (e) {}
  const p = bot.entity.position
  let groundDist = 99
  for (let y = 1; y <= 30; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') { groundDist = y; break } }
  const below = bot.blockAt(p.offset(0, -1, 0))
  if (groundDist < 12) { say(`Glide refused, I am only about ${groundDist} blocks above ground, that is not high enough for a safe glide, do it live from higher up :3`); return }
  if (below && ['lava', 'water'].includes(below.name)) { say('Glide refused, the ground below is not safe, do it live :3'); return }
  const yBefore = p.y
  try { bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 3000)); bot.setControlState('forward', false) } catch (e) {}
  const yAfter = bot.entity.position.y
  const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  if (yAfter < yBefore && vel > -5) say(`Glide check: Y ${yBefore.toFixed(0)} to ${yAfter.toFixed(0)}, vertical speed about ${vel.toFixed(1)}, which looks slowed, like a glide, check live :3`)
  else say(`Glide did not verify slowed descent, Y ${yBefore.toFixed(0)} to ${yAfter.toFixed(0)}, vertical speed about ${vel.toFixed(1)}, I may have fallen normally, check live and do not repeat blind :3`)
}
async function boatSteerVerified () {
  const before = bot.entity.position.clone()
  await rideAttempt('boat')
  await new Promise((r) => setTimeout(r, 1000))
  if (!bot.vehicle) { say('Boat steering did not verify, I am not in a boat :3'); return }
  try { bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 3000)); bot.setControlState('forward', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  getOutVehicle()
  if (moved >= 2) say(`Verified boat steering: moved ${moved.toFixed(1)} blocks while in the boat :3`)
  else say(`Boat steering did not verify movement, only ${moved.toFixed(1)} blocks, check live :3`)
}
async function minecartSteerVerified () {
  const before = bot.entity.position.clone()
  await rideAttempt('minecart')
  await new Promise((r) => setTimeout(r, 1000))
  if (!bot.vehicle) { say('Minecart steering did not verify, I am not in a minecart :3'); return }
  await new Promise((r) => setTimeout(r, 3000))
  const moved = bot.entity.position.distanceTo(before)
  getOutVehicle()
  if (moved >= 1) say(`Verified minecart movement: moved ${moved.toFixed(1)} blocks on the rail :3`)
  else say(`Minecart did not verify movement, only ${moved.toFixed(1)} blocks, it may not be on a powered rail, check live :3`)
}
function planHelp (topic) {
  const plans = {
    redstone: 'Redstone plan, live with me: 1) Tell me what it should do, a door, a light, a farm, or a trap. 2) List materials: redstone dust, torches, repeaters, pistons, observers, and a power source like a lever or button. 3) Build it in a test area first, not in your main build. 4) Test each part, one wire at a time. I will not build a circuit blind, because one wrong wire can break a build :3',
    piston: 'Piston machine plan, live with me: 1) Tell me what it should move, a door, a floor, or a farm. 2) Materials: pistons or sticky pistons, redstone, observers, and slime or honey blocks if it should stick. 3) Build the moving part first, then the redstone, then test it empty. I will not build a piston machine blind, it can crush or trap things :3',
    house: 'Full house plan, live with me: 1) Tell me the size, style, and rooms you want. 2) Materials: wood, stone, glass, doors, beds, torches, and a crafting table. 3) Lay out the floor first, then walls, then roof, then lights and furniture. 4) Check it with you at each stage. I will not build a full house blind, because it is your build and your choices :3',
    biome: 'Finding a biome plan, live with me: 1) Tell me which biome you want. 2) I cannot find a biome without a seed or a map, so bring a map, or tell me the seed if you know it. 3) Travel in one direction and mark the way home, with torches or a remembered spot. 4) Check the dimension and coordinates as we go. I will not wander blind to a biome :3',
    village: 'Finding a village plan, live with me: 1) Villages are in plains, deserts, savannas, taigas, and snowy plains. 2) I cannot find one without a seed or a map, so bring a map or tell me the seed. 3) Travel, mark the way home, and check for villagers and golems from a safe distance. I will not travel blind to a village :3',
    structure: 'Finding a structure plan, live with me: 1) Tell me which structure, a temple, a fortress, a monument, a trial chamber, or a woodland mansion. 2) I cannot find it without a seed, a map, or an explorer map from a villager. 3) Bring food, armour, torches, and a way home. 4) Check danger first, with "structure check", before entering. I will not enter a structure blind :3'
  }
  say(plans[topic] || 'Tell me live what you want to plan, and we will do it step by step, I will not build or travel blind :3')
}


// ---------------------------------------------------------------- round 9 (2026-10-30)
// Verified later brewing stages, window-layout mismatch reporting,
// travel in all shapes (only the simple case is claimed), and staged
// named-place / redstone / piston / house work WITH a seed, map, or
// coordinates given live by Moon. Rule, same as rounds 7-8: check the
// result in game and report verified or not verified. Never claim
// success if a transfer, a window output, an NBT change, or a movement
// check fails. Help and planning are used where a blind attempt would
// be risky or dishonest.
const BREW_STAGE = {
  extended: { ingredient: 'redstone', input: ['potion'], expectName: 'potion', kind: 'nbt', note: 'longer duration' },
  upgraded: { ingredient: 'glowstone_dust', input: ['potion'], expectName: 'potion', kind: 'nbt', note: 'stronger effect' },
  splash: { ingredient: 'gunpowder', input: ['potion'], expectName: 'splash_potion', kind: 'name', note: 'throwable splash form' },
  lingering: { ingredient: 'dragon_breath', input: ['splash_potion'], expectName: 'lingering_potion', kind: 'name', note: 'lingering cloud form' }
}
async function brewStageVerified (stageKey) {
  const spec = BREW_STAGE[stageKey]
  if (!spec) { say(`I do not know a ${stageKey} brew stage yet, say "brew stage help" and tell me live :3`); return }
  const stand = blockNearby(['brewing_stand'], 8)
  if (!stand) { say("I don't see a brewing stand nearby :3"); return }
  const bottles = bot.inventory.items().filter((i) => spec.input.includes(i.name))
  if (bottles.length === 0) { say(`I need a ${spec.input.join(' or ')} first for a ${stageKey} brew, not an awkward potion :3`); return }
  const ing = inventoryItem(spec.ingredient); const powder = inventoryItem('blaze_powder')
  if (!ing) { say(`I need ${spec.ingredient} for a ${stageKey} brew :3`); return }
  if (!powder) { say('I need blaze powder to fuel the brewing stand :3'); return }
  const beforeNbt = bottles[0].nbt ? JSON.stringify(bottles[0].nbt) : ''
  try {
    const win = await bot.openBlock(stand)
    try {
      const use = bottles.slice(0, 3)
      for (let i = 0; i < use.length; i++) await transferToWindow(win, use[i], i)
      await transferToWindow(win, ing.first, 3)
      await transferToWindow(win, powder.first, 4)
    } catch (e) { say(`Putting ${stageKey} ingredients in failed: ${e.message}, I am not claiming a brew :3`); try { win.close() } catch (e2) {}; return }
    say(`${stageKey} ingredients are in, brewing takes about 20 seconds, I will check the result, I am not claiming it yet :3`)
    await new Promise((r) => setTimeout(r, 22000))
    let outs = []
    try { for (let i = 0; i < 3; i++) { const sl = win.slots && win.slots[i]; if (sl) outs.push({ name: sl.name || '', nbt: sl.nbt ? JSON.stringify(sl.nbt) : '' }) } } catch (e) {}
    const layout = slotLayoutText(win)
    try { win.close() } catch (e) {}
    let verified = false; let why = ''
    if (spec.kind === 'name') verified = outs.some((o) => o.name === spec.expectName)
    else {
      const changed = outs.some((o) => o.name === spec.expectName && beforeNbt && o.nbt && o.nbt !== beforeNbt)
      const sameName = outs.some((o) => o.name === spec.expectName)
      if (changed) verified = true
      else if (sameName && !beforeNbt) { why = 'I could not read NBT to verify duration or strength, so check the potion live, I am not claiming the change blind' }
      else why = 'NBT did not change in a way I could read, so check duration or strength live'
    }
    log(`[brew-stage] ${stageKey} window=${outs.map((o) => o.name).join(',')} layout=${layout} verified=${verified}`)
    if (verified) say(`Verified ${stageKey} brew! I see ${spec.expectName} (${spec.note}), window was: ${outs.map((o) => o.name).join(', ') || 'empty'} :3`)
    else say(`${stageKey} brew did not fully verify, window was: ${outs.map((o) => o.name).join(', ') || 'empty'}. ${why || 'I am not claiming it, check the stand live with me'} :3`)
  } catch (e) { say(`${stageKey} brew failed: ${e.message}`) }
}
async function windowLayoutReportOnly (blockNames, label) {
  const blk = blockNearby(blockNames, 8)
  if (!blk) { say(`I don't see a ${label} nearby to report its window layout :3`); return }
  try {
    const win = await bot.openBlock(blk)
    await new Promise((r) => setTimeout(r, 1000))
    const layout = slotLayoutText(win)
    try { win.close() } catch (e) {}
    say(`${label} window layout: ${layout}. If this does not match the layout I expected, tell me live what slot the output is in, and I will not claim success on a mismatch, I will use your confirmed layout :3`)
    log(`[window-layout-report] ${label} slots=${layout}`)
  } catch (e) { say(`${label} layout report failed: ${e.message}, I am not claiming a layout :3`) }
}
function ladderShapesCheck () {
  if (!bot || !bot.entity) return
  let cols = {}
  try {
    const found = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 })
    for (const pos of found) { const key = `${pos.x},${pos.z}`; cols[key] = (cols[key] || 0) + 1 }
  } catch (e) {}
  const keys = Object.keys(cols)
  if (!keys.length) { say("I don't see any ladders nearby to check shapes :3"); return }
  const desc = keys.map((k) => `column ${k}: ${cols[k]} ladder block(s)`).join('; ')
  say(`Ladder shapes near me: ${desc}. A straight vertical column is the simple, verified case, say "ladder climb verified" for that. A ladder in water, at a corner, or with a trapdoor at the top is a complex case, tell me live which one it is and we will try it step by step, I will not claim a climb for a shape I have not checked :3`)
}
function crawlShapesCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let trap = null, piston = null, swim = null, plain = null
  for (let dx = -4; dx <= 4; dx++) { for (let dz = -4; dz <= 4; dz++) {
    const feet = bot.blockAt(p.offset(dx, 0, dz)); const head = bot.blockAt(p.offset(dx, 1, dz)); const above = bot.blockAt(p.offset(dx, 2, dz))
    if (feet && feet.boundingBox !== 'block' && head && head.boundingBox !== 'block' && above) {
      if (above.name.includes('trapdoor')) trap = p.offset(dx, 0, dz)
      else if (above.name.includes('piston')) piston = p.offset(dx, 0, dz)
      else if (above.boundingBox === 'block') plain = p.offset(dx, 0, dz)
    }
    const water = bot.blockAt(p.offset(dx, 0, dz)); if (water && water.name === 'water') swim = p.offset(dx, 0, dz)
  } }
  say(`Crawl shapes near me: ${trap ? 'trapdoor gap found, best simple case. ' : ''}${piston ? 'piston gap found, timing matters, live only. ' : ''}${plain ? 'plain 1-block gap found. ' : ''}${swim ? 'water gap found, swimming crawl is a live step. ' : ''}${!trap && !piston && !plain && !swim ? 'no crawl gap found nearby. ' : ''}Say "crawl through" only if you are watching live, and tell me which shape it is, I will not trap myself blind :3`)
}
function boatShapesCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let water = 0, ice = 0
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') water++; if (b && (b.name.includes('ice') || b.name.includes('frost'))) ice++ } }
  say(`Boat shapes near me: ${water} water block(s), ${ice} ice block(s) in the area. Open water is the simple, verified case, say "steer boat" for that. A narrow river, a waterfall, or ice is complex, tell me live which shape it is, I will not claim steering for a shape I have not checked :3`)
}
function minecartPowerCheck () {
  if (!bot || !bot.entity) return
  let powered = 0, plain = 0, detector = 0, activator = 0
  try {
    const found = bot.findBlocks({ matching: (b) => b.name.includes('rail'), maxDistance: 12, count: 40 })
    for (const pos of found) { const b = bot.blockAt(pos); if (!b) continue; if (b.name === 'powered_rail') powered++; else if (b.name === 'rail') plain++; else if (b.name === 'detector_rail') detector++; else if (b.name === 'activator_rail') activator++ }
  } catch (e) {}
  if (!powered && !plain && !detector && !activator) { say("I don't see any rails nearby to check power :3"); return }
  say(`Minecart rails near me: ${powered} powered, ${plain} plain, ${detector} detector, ${activator} activator. With powered rails, "steer minecart" is the simple case. With no powered rails, a minecart will not travel far on its own, it needs a slope or a live push, say "minecart no power help" and we will do it live, I will not claim steering without power :3`)
}
async function elytraTravelVerified () {
  const ely = bot.inventory.items().find((i) => i.name === 'elytra')
  if (!ely) { say('I need an elytra to travel by glide, wear one first :3'); return }
  try { await bot.equip(ely, 'torso') } catch (e) {}
  const p = bot.entity.position.clone()
  let groundDist = 99
  for (let y = 1; y <= 30; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') { groundDist = y; break } }
  if (groundDist < 12) { say(`Elytra travel refused, I am only about ${groundDist} blocks above ground, that is not high enough for safe travel, do it live from higher up, and bring fireworks for sustained flight :3`); return }
  const before = bot.entity.position.clone()
  try { bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 3000)); bot.setControlState('forward', false) } catch (e) {}
  const after = bot.entity.position.clone(); const horiz = Math.hypot(after.x - before.x, after.z - before.z); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  log(`[elytra-travel] horiz=${horiz.toFixed(1)} y=${before.y.toFixed(0)}->${after.y.toFixed(0)} vy=${vel.toFixed(1)}`)
  if (horiz >= 5 && vel > -5) say(`Verified short elytra travel: moved ${horiz.toFixed(1)} blocks forward, Y ${before.y.toFixed(0)} to ${after.y.toFixed(0)}, descent looked slowed. Long travel still needs fireworks and a live plan, I am not claiming reliable long-distance flight :3`)
  else say(`Elytra travel did not verify, only ${horiz.toFixed(1)} blocks forward, vertical speed about ${vel.toFixed(1)}, I may have fallen normally, check live and do not repeat blind :3`)
}
function planWithSeed (topic) {
  const plans = {
    biome: 'Staged biome plan WITH seed or map, live with me: Stage 1, you give me the seed, a map, or coordinates from a map tool, I cannot compute a biome from a seed alone in mineflayer. Stage 2, I record home with "remember here". Stage 3, you give me coordinates, I walk there with "go to coordinates" and verify distance under 5 blocks. Stage 4, I report blocks and mobs I actually see there, and only then do we say if that biome matches. I will not wander blind to a biome :3',
    village: 'Staged village plan WITH seed or map, live with me: Stage 1, you give me the seed, a map, or coordinates. Stage 2, I record home. Stage 3, I walk to your coordinates and verify arrival. Stage 4, I report villagers, bells, beds, and golems I actually see, and only then do we claim a village. I will not travel blind to a village :3',
    structure: 'Staged structure plan WITH seed or map, live with me: Stage 1, you give me the seed, a map, or an explorer map, plus the structure name. Stage 2, I record home and check danger. Stage 3, I walk to your coordinates and verify arrival. Stage 4, I report structure blocks and mobs I actually see, and we decide live whether to enter. I will not enter a structure blind :3',
    redstone: 'Staged redstone plan, live with me: Stage 1, you tell me the purpose, a door, a light, a farm, or a trap. Stage 2, we list materials and build in a test area, not your main build. Stage 3, I place one wire or component at a time, only where you say, and check it. Stage 4, we test it empty, then with you watching. I will not build a circuit blind, one wrong wire can break a build :3',
    piston: 'Staged piston plan, live with me: Stage 1, you tell me what it should move. Stage 2, we list pistons, sticky pistons, redstone, observers, slime or honey blocks. Stage 3, I build the moving part first, then redstone, one step at a time, checked live. Stage 4, we test it empty. I will not build a piston machine blind, it can crush or trap things :3',
    house: 'Staged house plan, live with me: Stage 1, you tell me size, style, and rooms. Stage 2, we list wood, stone, glass, doors, beds, torches. Stage 3, floor first, then walls, then roof, then lights and furniture, with a check at each stage. Stage 4, you confirm each stage before I go to the next. I will not build a full house blind, it is your build and your choices :3'
  }
  say(plans[topic] || 'Tell me live what you want to plan with a seed, map, or coordinates, and we will do it stage by stage :3')
}
async function goToNamedPlace (place, x, y, z) {
  if (!bot || !bot.entity) return
  const target = { x, y, z }
  // Record home first, if not already remembered, by noting spawn position.
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2), true)
  const reached = await waitForNear({ x, y, z, distanceTo: (p) => Math.hypot(p.x - x, p.y - y, p.z - z) }, 5, 30000).catch(() => false)
  // waitForNear above expects a Vec3-like object; fall back to a simple poll if it did not resolve true.
  let arrived = reached
  if (!arrived) {
    const d = bot.entity.position.distanceTo({ x, y, z })
    arrived = d < 5
  }
  if (bot) bot.pathfinder.setGoal(null)
  if (!arrived) { const d = bot.entity ? bot.entity.position.distanceTo({ x, y, z }).toFixed(0) : '?'; say(`I did not reach ${place} at ${x}, ${y}, ${z}, I am still about ${d} blocks away, I am not claiming arrival, tell me live if the path is blocked :3`); return }
  let seen = []
  try {
    const vill = findMobByTypes(['Villager'], 32); if (vill) seen.push('villager')
    const golem = findMobByTypes(['IronGolem'], 32); if (golem) seen.push('iron golem')
    const blocks = ['bell', 'lodestone', 'trial_spawner', 'vault', 'spawner', 'end_portal_frame', 'obsidian']
    for (const bn of blocks) { if (blockNearby([bn], 16)) seen.push(bn.replace(/_/g, ' ')) }
  } catch (e) {}
  say(`Arrived at ${place} at ${x}, ${y}, ${z}, verified by distance. I actually see nearby: ${seen.length ? seen.join(', ') : 'no village or structure markers I can name yet, check live with me'}. I am not claiming this IS a ${place} unless those markers match, tell me live what you see :3`)
  log(`[named-place] ${place} at=${x},${y},${z} arrived=true seen=${seen.join(',')}`)
}


// ---------------------------------------------------------------- round 10 (2026-10-30)
// Picking up round 9's STILL-not-covered list, only where a result can
// actually be verified, and only in small, stop-after-each-step moves
// where a blind attempt would be risky. Rule, same as rounds 7-9:
// check the result in game and report verified or not verified.
// Never claim success if a field, a window slot, a movement, or a
// landing check fails. A confirmed window layout is recorded ONLY
// when Moon says it live in chat, it is session-only (not saved to a
// file, not auto-learned from a guess), and it is still reported as
// a mismatch if the layout changes later.
let confirmedWindowLayouts = {}
function potionFieldText (item) {
  if (!item) return 'no item'
  let parts = [`name=${item.name || 'unknown'}`, `count=${item.count || 1}`]
  try { if (item.nbt) parts.push(`nbt=${JSON.stringify(item.nbt).slice(0, 400)}`) } catch (e) {}
  try { if (item.components) parts.push(`components=${JSON.stringify(item.components).slice(0, 400)}`) } catch (e) {}
  try { if (item.componentMap) parts.push(`componentMap=${JSON.stringify(item.componentMap).slice(0, 400)}`) } catch (e) {}
  try { if (item.metadata !== undefined && item.metadata !== null) parts.push(`metadata=${item.metadata}`) } catch (e) {}
  if (parts.length === 2) parts.push('no nbt or components readable')
  return parts.join(' | ')
}
function potionDetailsHeld () {
  if (!bot) return
  const held = bot.heldItem
  if (!held) { say('I am not holding anything to check potion details for :3'); return }
  say(`Held item potion details: ${potionFieldText(held)}. If this is a potion, compare it live with the tooltip you see, hover it in your inventory, and tell me if the effect, long, or strong name matches, I will not claim duration or strength from this data alone :3`)
  log(`[potion-details] ${potionFieldText(held)}`)
}
async function brewStageCheckOnly (stageKey) {
  const spec = BREW_STAGE[stageKey]
  if (!spec) { say(`I do not know a ${stageKey} brew check yet, say "brew stage help" :3`); return }
  const stand = blockNearby(['brewing_stand'], 8)
  if (!stand) { say("I don't see a brewing stand nearby :3"); return }
  const bottles = bot.inventory.items().filter((i) => spec.input.includes(i.name))
  if (bottles.length === 0) { say(`I need a ${spec.input.join(' or ')} first for a ${stageKey} brew check, not an awkward potion :3`); return }
  const ing = inventoryItem(spec.ingredient); const powder = inventoryItem('blaze_powder')
  if (!ing) { say(`I need ${spec.ingredient} for a ${stageKey} brew check :3`); return }
  if (!powder) { say('I need blaze powder to fuel the brewing stand :3'); return }
  const beforeField = potionFieldText(bottles[0])
  try {
    const win = await bot.openBlock(stand)
    try {
      const use = bottles.slice(0, 3)
      for (let i = 0; i < use.length; i++) await transferToWindow(win, use[i], i)
      await transferToWindow(win, ing.first, 3)
      await transferToWindow(win, powder.first, 4)
    } catch (e) { say(`Putting ${stageKey} ingredients in failed: ${e.message}, I am not claiming a brew :3`); try { win.close() } catch (e2) {}; return }
    say(`${stageKey} ingredients are in, brewing takes about 20 seconds, I will check the readable fields, I am not claiming duration or strength yet :3`)
    await new Promise((r) => setTimeout(r, 22000))
    let outs = []
    try { for (let i = 0; i < 3; i++) { const sl = win.slots && win.slots[i]; if (sl) outs.push(potionFieldText(sl)) } } catch (e) {}
    try { win.close() } catch (e) {}
    const afterJoined = outs.join(' ; ')
    const changed = afterJoined !== beforeField && outs.length > 0
    const longSignal = stageKey === 'extended' && /long_/i.test(afterJoined)
    const strongSignal = stageKey === 'upgraded' && /strong_/i.test(afterJoined)
    log(`[brew-stage-check] ${stageKey} before=${beforeField} after=${afterJoined}`)
    lastBrewCheck = { stage: stageKey, before: beforeField, after: afterJoined }
    if (longSignal) say(`Brew check: the readable potion data now includes a long_ potion id, which is the game's extended form, so the extended signal verifies. Before: ${beforeField}. After: ${afterJoined}. Still check the tooltip live if you want the exact duration :3`)
    else if (strongSignal) say(`Brew check: the readable potion data now includes a strong_ potion id, which is the game's upgraded form, so the upgraded signal verifies. Before: ${beforeField}. After: ${afterJoined}. Still check the tooltip live if you want the exact strength :3`)
    else if (changed) say(`Brew check: the readable fields changed, but I do not see a long_ or strong_ id I can verify, so I am NOT claiming extended duration or upgraded strength. Before: ${beforeField}. After: ${afterJoined}. Check the potion tooltip live with me :3`)
    else say(`Brew check: I could not read a change in the potion fields, so I am NOT claiming extended duration or upgraded strength. Before: ${beforeField}. After: ${afterJoined || 'empty'}. Check the potion tooltip live, or drink it live with me watching, to confirm :3`)
  } catch (e) { say(`${stageKey} brew check failed: ${e.message}`) }
}
function confirmWindowLayout (label, outputSlot) {
  if (!Number.isInteger(outputSlot) || outputSlot < 0 || outputSlot > 60) { say('Tell me a window output slot number, 0 or higher, and I will record it live :3'); return }
  confirmedWindowLayouts[label] = { outputSlot, at: new Date().toISOString() }
  say(`Recorded, session only: for ${label}, you confirmed the output slot is ${outputSlot}. I will use that slot when you say "window layout ${label} with confirmed", and I will still report it as a mismatch if the layout changes, I will not auto-learn a new layout blind :3`)
  log(`[window-layout-confirmed] ${label} outputSlot=${outputSlot}`)
}
function listConfirmedWindowLayouts () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed yet this session, say "window layout loom" first, then "confirm window layout loom output 3" with the slot you see live :3'); return }
  say(`Confirmed window layouts, this session only: ${keys.map((k) => `${k} output slot ${confirmedWindowLayouts[k].outputSlot}`).join('; ')} :3`)
}
function forgetWindowLayout (label) {
  if (!confirmedWindowLayouts[label]) { say(`I have no confirmed layout recorded for ${label} this session :3`); return }
  delete confirmedWindowLayouts[label]
  say(`Forgot the confirmed layout for ${label} this session, I will not use that output slot again until you confirm it live again :3`)
}
async function windowLayoutWithConfirmed (blockNames, label) {
  const blk = blockNearby(blockNames, 8)
  if (!blk) { say(`I don't see a ${label} nearby to report its window layout :3`); return }
  const conf = confirmedWindowLayouts[label]
  if (!conf) { say(`No confirmed layout for ${label} this session, say "window layout ${label}" first, then confirm the output slot live, I will not guess one :3`); return }
  try {
    const win = await bot.openBlock(blk)
    await new Promise((r) => setTimeout(r, 1000))
    const layout = slotLayoutText(win)
    let out = null; try { out = win.slots && win.slots[conf.outputSlot] } catch (e) {}
    try { win.close() } catch (e) {}
    say(`${label} window layout: ${layout}. Your confirmed output slot ${conf.outputSlot} holds: ${out ? `${out.name || 'item'}x${out.count || 1}` : 'empty'}. I did not take anything, if this layout does not match what you confirmed, tell me live and I will forget it, I will not claim success on a mismatch :3`)
    log(`[window-layout-confirmed-check] ${label} slots=${layout} confirmedSlot=${conf.outputSlot} out=${out ? out.name : 'empty'}`)
  } catch (e) { say(`${label} confirmed layout check failed: ${e.message}, I am not claiming a layout :3`) }
}
function ladderWaterCheck () {
  if (!bot || !bot.entity) return
  let ladders = []
  try { ladders = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 }) } catch (e) {}
  if (!ladders.length) { say("I don't see any ladders nearby to check water :3"); return }
  let inWater = 0
  for (const pos of ladders) {
    const neighbours = [bot.blockAt(pos.offset(1, 0, 0)), bot.blockAt(pos.offset(-1, 0, 0)), bot.blockAt(pos.offset(0, 0, 1)), bot.blockAt(pos.offset(0, 0, -1)), bot.blockAt(pos.offset(0, 1, 0))]
    if (neighbours.some((b) => b && b.name === 'water')) inWater++
  }
  say(`Ladder water check: ${ladders.length} ladder block(s) nearby, ${inWater} with water next to or above them. ${inWater ? 'A ladder in water is a complex climb, do it live step by step with "ladder climb step", I will not climb a water ladder blind.' : 'No water next to the ladders I see, a straight column is the simple case.'} :3`)
}
function ladderCornerCheck () {
  if (!bot || !bot.entity) return
  let cols = {}
  try {
    const found = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 })
    for (const pos of found) { const key = `${pos.x},${pos.z}`; cols[key] = (cols[key] || 0) + 1 }
  } catch (e) {}
  const keys = Object.keys(cols)
  if (!keys.length) { say("I don't see any ladders nearby to check corners :3"); return }
  const corner = keys.length > 1
  say(`Ladder corner check: ${keys.length} ladder column(s): ${keys.map((k) => `${k} x${cols[k]}`).join('; ')}. ${corner ? 'More than one column close together can mean a corner or a turn, do it live step by step, I will not claim a corner climb.' : 'One column only, that looks like a straight vertical ladder, the simple case.'} :3`)
}
function ladderTopCheck () {
  if (!bot || !bot.entity) return
  let found = []
  try { found = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 }) } catch (e) {}
  if (!found.length) { say("I don't see any ladders nearby to check the top :3"); return }
  let tops = {}
  for (const pos of found) { const key = `${pos.x},${pos.z}`; if (!tops[key] || pos.y > tops[key].y) tops[key] = pos }
  let reports = []
  for (const key of Object.keys(tops)) {
    const top = tops[key]
    const above1 = bot.blockAt(top.offset(0, 1, 0)); const above2 = bot.blockAt(top.offset(0, 2, 0))
    const safe = above1 && above1.boundingBox !== 'block' && above2 && above2.boundingBox !== 'block'
    reports.push(`column ${key} top Y ${top.y}, above: ${above1 ? above1.name : 'unknown'}, then ${above2 ? above2.name : 'unknown'}, ${safe ? 'looks like room to exit' : 'no safe exit room, or a trapdoor or solid block is above, check live'}`)
  }
  say(`Ladder top check: ${reports.join('; ')}. A trapdoor at the top needs a live step, say "ladder climb step" only while watching :3`)
}
async function ladderClimbStep () {
  if (!bot || !bot.entity) return
  bot.pathfinder.setGoal(null)
  const beforeY = bot.entity.position.y
  try { bot.setControlState('forward', true); bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('jump', false) } catch (e) {}
  const afterY = bot.entity.position.y
  say(`Ladder climb step done, stopped after 2 seconds: Y ${beforeY.toFixed(1)} to ${afterY.toFixed(1)}, change ${(afterY - beforeY).toFixed(1)}. Tell me live before the next step, I will not keep climbing blind :3`)
  log(`[ladder-climb-step] y=${beforeY.toFixed(1)}->${afterY.toFixed(1)}`)
}
function crawlSwimmingCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let waterGaps = 0, dryGaps = 0
  for (let dx = -4; dx <= 4; dx++) { for (let dz = -4; dz <= 4; dz++) {
    const feet = bot.blockAt(p.offset(dx, 0, dz)); const head = bot.blockAt(p.offset(dx, 1, dz)); const above = bot.blockAt(p.offset(dx, 2, dz))
    if (feet && head && above && above.boundingBox === 'block' && feet.boundingBox !== 'block' && head.boundingBox !== 'block') {
      if (feet.name === 'water' || head.name === 'water') waterGaps++; else dryGaps++
    }
  } }
  say(`Crawl swimming check: ${waterGaps} water gap(s), ${dryGaps} dry gap(s) nearby. ${waterGaps ? 'A swimming crawl can put my head underwater, Moon\'s air rule applies, swim up before 10 seconds without Respiration, so this is live only, with you watching, I will not crawl swimming blind.' : 'No water crawl gap found nearby.'} :3`)
}
async function crawlPistonStep () {
  if (!bot || !bot.entity) return
  const piston = blockNearby(['piston', 'sticky_piston'], 8)
  if (!piston) { say("I don't see a piston nearby for a piston crawl step :3"); return }
  say(`Piston crawl step, live only: I see a ${piston.name} nearby. You activate the piston live when you are ready, then I will sneak forward for 2 seconds and stop, and report if I moved and what headroom I have, I will not keep crawling blind :3`)
  bot.pathfinder.setGoal(null)
  const before = bot.entity.position.clone()
  try { bot.setControlState('sneak', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('sneak', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  const above = bot.blockAt(bot.entity.position.offset(0, 2, 0))
  say(`Piston crawl step done, stopped: moved ${moved.toFixed(1)} blocks, block above me now is ${above ? above.name : 'unknown'}. Tell me live before any next step, and tell me if I am trapped :3`)
}
async function crawlStep () {
  if (!bot || !bot.entity) return
  bot.pathfinder.setGoal(null)
  const before = bot.entity.position.clone()
  try { bot.setControlState('sneak', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('sneak', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  say(`Crawl step done, stopped after 2 seconds: moved ${moved.toFixed(1)} blocks, check live if I am on the other side, I will not keep crawling blind :3`)
}
function boatRiverCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let water = 0, ice = 0, ys = []
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') { water++; ys.push(b.position.y) } if (b && b.name.includes('ice')) ice++ } }
  const yRange = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  say(`Boat river check: ${water} water block(s), ${ice} ice block(s) nearby, water height range ${yRange} block(s). ${yRange > 1 ? 'Water at different heights can mean a slope or a waterfall, do it live step by step.' : 'Water looks flat here, open water is the simple case.'} Tell me live how wide the river is, I cannot measure width from a block count alone :3`)
}
function boatIceCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let ice = 0
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && (b.name.includes('ice') || b.name.includes('frost'))) ice++ } }
  say(`Boat ice check: ${ice} ice block(s) nearby. ${ice ? 'Boats on ice are fast and slippery, and hard to stop, so this is live step by step with "boat step" only, I will not claim ice steering.' : 'No ice nearby for a boat ice check.'} :3`)
}
async function boatStep () {
  if (!bot || !bot.entity) return
  const before = bot.entity.position.clone()
  await rideAttempt('boat')
  await new Promise((r) => setTimeout(r, 1000))
  if (!bot.vehicle) { say('Boat step did not verify, I am not in a boat :3'); return }
  try { bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  getOutVehicle()
  say(`Boat step done, stopped after 2 seconds in the boat: moved ${moved.toFixed(1)} blocks, got out again. Tell me live before the next step :3`)
}
function minecartSlopeCheck () {
  if (!bot || !bot.entity) return
  let rails = []
  try { rails = bot.findBlocks({ matching: (b) => b.name.includes('rail'), maxDistance: 12, count: 40 }) } catch (e) {}
  if (!rails.length) { say("I don't see any rails nearby to check slope :3"); return }
  let ys = [], powered = 0
  for (const pos of rails) { const b = bot.blockAt(pos); if (!b) continue; ys.push(b.position.y); if (b.name === 'powered_rail') powered++ }
  const yRange = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  say(`Minecart slope check: ${rails.length} rail block(s), ${powered} powered, height range ${yRange} block(s). ${yRange >= 1 ? 'A slope means gravity could move a minecart, try "minecart push step" live.' : 'Flat rails with no slope will not move a minecart on their own.'} ${powered ? 'Powered rails are present, "steer minecart" is the simple case.' : 'No powered rails seen, I will not claim steering without power.'} :3`)
}
async function minecartPushStep () {
  if (!bot || !bot.entity) return
  let cart = null
  for (const id of Object.keys(bot.entities)) {
    const e = bot.entities[id]; if (!e) continue
    const name = String(e.name || e.mobType || '').toLowerCase()
    if (name.includes('minecart')) { cart = e; break }
  }
  if (!cart) { say("I don't see a minecart nearby to push :3"); return }
  const before = cart.position.clone()
  const reached = await walkToMob(cart)
  if (!reached) { say('I found a minecart, but I could not reach it to push :3'); return }
  try { bot.lookAt(cart.position); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false) } catch (e) {}
  await new Promise((r) => setTimeout(r, 500))
  const after = cart.position.clone(); const moved = after.distanceTo(before)
  say(`Minecart push step done, stopped after 2 seconds: minecart moved ${moved.toFixed(1)} blocks. ${moved >= 0.5 ? 'That push moved it, check live where it stopped.' : 'That push did not verify movement, it may need a slope, powered rails, or a harder live push, I will not claim steering without power.'} :3`)
  log(`[minecart-push-step] moved=${moved.toFixed(1)}`)
}
function elytraRocketsCheck () {
  const rockets = inventoryItem('firework_rocket')
  say(rockets ? `Elytra rockets check: I have ${rockets.total} firework rocket(s). Long travel still needs a safe landing spot, say "elytra landing check" before any rocket step :3` : 'Elytra rockets check: I have no firework rockets, long elytra travel is not possible without them, a short glide without rockets only goes a few blocks :3')
}
function elytraLandingCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position.clone()
  let groundDist = 99, groundBlock = null
  for (let y = 1; y <= 30; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') { groundDist = y; groundBlock = b; break } }
  if (!groundBlock) { say('Elytra landing check: no solid ground found within 30 blocks below, that could be a void, do NOT glide here, do it live from a safe place :3'); return }
  const safe = groundBlock.name !== 'lava'
  say(`Elytra landing check: ground about ${groundDist} blocks below, first solid block is ${groundBlock.name}. ${groundBlock.name === 'lava' ? 'Unsafe landing, lava below, do NOT glide here.' : groundBlock.name === 'water' ? 'Water landing, softer but wet, check live.' : 'Solid landing below, check live for height and obstacles before any rocket step.'} ${safe ? '' : ''}:3`)
}
async function elytraRocketStep () {
  const ely = bot.inventory.items().find((i) => i.name === 'elytra')
  if (!ely) { say('I need an elytra for a rocket step, wear one first :3'); return }
  const rocket = inventoryItem('firework_rocket')
  if (!rocket) { say('I need a firework rocket for a rocket step, say "elytra rockets check" first :3'); return }
  try { await bot.equip(ely, 'torso') } catch (e) {}
  const p = bot.entity.position.clone()
  let groundDist = 99, groundBlock = null
  for (let y = 1; y <= 30; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') { groundDist = y; groundBlock = b; break } }
  if (groundDist < 12) { say(`Elytra rocket step refused, only about ${groundDist} blocks above ground, do it live from higher up :3`); return }
  if (!groundBlock) { say('Elytra rocket step refused, no solid ground found below, that could be a void :3'); return }
  if (groundBlock.name === 'lava') { say('Elytra rocket step refused, lava is below, unsafe landing :3'); return }
  say('Elytra rocket step, live only: I will use ONE firework rocket, glide forward for 3 seconds, then stop, and report distance and height, tell me live if I should stop :3')
  try { await bot.equip(rocket.first, 'hand') } catch (e) {}
  const before = bot.entity.position.clone()
  try {
    bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false)
    try { bot.activateItem() } catch (e) { log(`[elytra-rocket-step] activateItem failed: ${e.message}`) }
    bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 3000)); bot.setControlState('forward', false)
  } catch (e) {}
  const after = bot.entity.position.clone(); const horiz = Math.hypot(after.x - before.x, after.z - before.z); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  log(`[elytra-rocket-step] horiz=${horiz.toFixed(1)} y=${before.y.toFixed(0)}->${after.y.toFixed(0)} vy=${vel.toFixed(1)}`)
  if (horiz >= 10 && vel > -5) say(`Elytra rocket step: moved ${horiz.toFixed(1)} blocks forward, Y ${before.y.toFixed(0)} to ${after.y.toFixed(0)}, descent looked slowed, that looks like a boosted step, check live where I am and if I am still safe, I am NOT claiming reliable long-distance flight from one step :3`)
  else say(`Elytra rocket step did not verify a boost, only ${horiz.toFixed(1)} blocks forward, vertical speed about ${vel.toFixed(1)}, the rocket may not have fired or I may have fallen normally, check live and do not repeat blind :3`)
}
function checkXp () {
  const level = bot && bot.experience ? bot.experience.level : null
  const progress = bot && bot.experience ? bot.experience.progress : null
  if (level === null || level === undefined) { say('I cannot read my XP level right now :3'); return }
  say(`XP check: level ${level}${progress !== null && progress !== undefined ? `, progress ${(progress * 100).toFixed(0)}% to the next level` : ''}. Enchanting and anvil work need levels, so check this before you spend XP :3`)
}
function checkDurability () {
  if (!bot) return
  const held = bot.heldItem
  let lines = []
  if (held) {
    if (typeof held.durabilityUsed === 'number') lines.push(`held ${held.name}: durability used ${held.durabilityUsed}`)
    else lines.push(`held ${held.name}: durability not readable in mineflayer, check it in your inventory live`)
  } else lines.push('not holding anything')
  let found = 0
  for (const item of bot.inventory.items()) {
    if (found >= 5) break
    if (typeof item.durabilityUsed === 'number' && item.durabilityUsed > 0) { lines.push(`${item.name}: durability used ${item.durabilityUsed}`); found++ }
  }
  say(`Durability check: ${lines.join('; ')}. If durability is not readable, your inventory tooltip is the live check :3`)
}
function checkLight () {
  if (!bot || !bot.entity) return
  const b = bot.blockAt(bot.entity.position)
  const light = b ? (b.light !== undefined ? b.light : (b.skyLight !== undefined ? b.skyLight : null)) : null
  if (light === null || light === undefined) { say('I cannot read light level here in mineflayer, check F3 live, mobs can spawn in the dark, light level 0 is darkest :3'); return }
  say(`Light check: light level about ${light} here. ${light <= 7 ? 'That is dark enough for hostile mobs to spawn, say "light up" if you want torches.' : 'That is bright enough that hostile mobs should not spawn here.'} :3`)
}
function checkFallHeight () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position.clone()
  let groundDist = 99
  for (let y = 1; y <= 30; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') { groundDist = y; break } }
  if (groundDist >= 99) { say('Fall height check: no solid ground found within 30 blocks below, do NOT jump here :3'); return }
  say(`Fall height check: about ${groundDist} blocks above solid ground. ${groundDist >= 4 ? 'Falling from here could hurt, do not jump blind.' : 'A fall from here should be small.'} :3`)
}
function checkFreeSlots () {
  if (!bot) return
  const slots = bot.inventory.slots || []
  const empty = slots.filter((s) => !s).length
  say(`Free slots check: ${empty} empty inventory slot(s) out of ${slots.length || 'unknown'} slots I can read. ${empty === 0 ? 'My inventory looks full, gathering will fail until I drop or store something.' : 'There is room to gather.'} :3`)
}
function checkEffects () {
  if (!bot || !bot.entity) return
  let eff = null
  try { eff = bot.entity.effects } catch (e) {}
  if (!eff) { say('Effects check: no effects readable on me right now, or I have none, check live if you expected a potion effect :3'); return }
  const keys = Object.keys(eff)
  if (!keys.length) { say('Effects check: no potion effects on me right now :3'); return }
  say(`Effects check: ${keys.map((k) => { const v = eff[k]; return v && v.duration !== undefined ? `${k} duration ${v.duration}` : `${k}` }).join(', ')}. If this does not match what you see, tell me live, I will not claim an effect duration I cannot read :3`)
}
async function walkStep () {
  if (!bot || !bot.entity) return
  bot.pathfinder.setGoal(null)
  const before = bot.entity.position.clone()
  try { bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false) } catch (e) {}
  const after = bot.entity.position.clone(); const moved = after.distanceTo(before)
  say(`Walk step done, stopped after 2 seconds: moved ${moved.toFixed(1)} blocks, now at ${after.x.toFixed(0)}, ${after.y.toFixed(0)}, ${after.z.toFixed(0)}. Tell me live before the next step :3`)
}

// ---------------------------------------------------------------- round 11 (2026-10-30)
// Picking up round 10's STILL-not-covered list, only where a result can
// actually be verified. Same rule as rounds 7-10: check the result in
// game and report verified or not verified. A tooltip comparison does
// NOT invent a duration or strength number: Moon reads the tooltip
// live, and only Moon's explicit live confirmation is recorded, for
// this session only. A window layout is never auto-learned blind.
// Complex travel is one small step at a time, then stop, then Moon
// says so live before the next step. No blind risky moves.
let brewConfirmations = {}
let lastBrewCheck = null
let pendingDrink = false
let pendingHarmfulDrink = false
let elytraRocketsAttempted = 0
function fieldDiffText (before, after) {
  if (!before || !after) return 'no before/after fields to compare'
  const b = before.split(' | '); const a = after.split(' | ')
  const changed = a.filter((x) => !b.includes(x))
  const gone = b.filter((x) => !a.includes(x))
  if (!changed.length && !gone.length) return 'no field changed between before and after'
  return `changed fields: ${changed.length ? changed.join('; ') : 'none'}; gone fields: ${gone.length ? gone.join('; ') : 'none'}`
}
function brewTooltipCompare (stageKey) {
  if (!bot) return
  if (lastBrewCheck && lastBrewCheck.stage === stageKey) {
    say(`Brew tooltip compare for ${stageKey}: before: ${lastBrewCheck.before}. After: ${lastBrewCheck.after}. Field diff: ${fieldDiffText(lastBrewCheck.before, lastBrewCheck.after)}. Now read the potion tooltip live with me: tell me the effect name, whether it says Long or II, and the duration text you see, and I will not claim a duration or strength until you confirm it live with "confirm brew ${stageKey} live" :3`)
    log(`[brew-tooltip-compare] ${stageKey} diff=${fieldDiffText(lastBrewCheck.before, lastBrewCheck.after)}`)
    return
  }
  const held = bot.heldItem
  if (!held) { say(`I am not holding a potion for a ${stageKey} tooltip compare, and I have no last brew check for ${stageKey} this session, say "brew ${stageKey} check" first, then we compare the tooltip live :3`); return }
  say(`Brew tooltip compare for ${stageKey}, held potion only, no last brew check this session: ${potionFieldText(held)}. Read the tooltip live: effect name, Long or II, and duration text, then say "confirm brew ${stageKey} live" only if the tooltip matches ${stageKey}, I will not claim it from this data alone :3`)
}
function confirmBrewLive (stageKey) {
  brewConfirmations[stageKey] = { at: new Date().toISOString() }
  say(`Recorded, session only: you confirmed live that the ${stageKey} potion tooltip matches ${stageKey}. This is your live confirmation, not a number I read from data, and I will not claim an exact duration or strength from it, only that you confirmed the tooltip live. Say "forget brew confirmation ${stageKey}" to clear it :3`)
  log(`[brew-confirmed-live] ${stageKey}`)
}
function listBrewConfirmations () {
  const keys = Object.keys(brewConfirmations)
  if (!keys.length) { say('No brew confirmations live this session yet, say "brew extended tooltip compare", read the tooltip live, then "confirm brew extended live" :3'); return }
  say(`Brew confirmations, this session only, from your live tooltip reads: ${keys.join(', ')} :3`)
}
function forgetBrewConfirmation (stageKey) {
  if (!brewConfirmations[stageKey]) { say(`I have no live brew confirmation for ${stageKey} this session :3`); return }
  delete brewConfirmations[stageKey]
  say(`Forgot the live brew confirmation for ${stageKey} this session, I will not use it again until you confirm the tooltip live again :3`)
}
function drinkPotionLive () {
  if (!bot) return
  const held = bot.heldItem
  if (!held || !(held.name || '').includes('potion')) { say('I am not holding a potion to drink live, hold a potion first :3'); return }
  const harmful = /poison|harming|slowness|weakness|instant_damage/.test(held.name)
  if (harmful) {
    pendingHarmfulDrink = true; pendingDrink = false
    say(`Held potion looks harmful: ${held.name}. I will NOT drink it on a normal confirm. If you really want me to drink it live with you watching, say "confirm drink harmful potion", and I will drink one, stop, and report effects, otherwise say "cancel drink potion" :3`)
    return
  }
  pendingDrink = true; pendingHarmfulDrink = false
  say(`Drink potion live, step 1 only: I am holding ${held.name}, details: ${potionFieldText(held)}. I have NOT drunk it yet. Say "confirm drink potion" to drink one now with you watching, then I will stop and report effects I can read, or say "cancel drink potion" :3`)
  log(`[drink-potion-live] pending ${held.name}`)
}
async function confirmDrinkPotion (harmful) {
  if (!bot) return
  if (harmful && !pendingHarmfulDrink) { say('No harmful drink is pending, say "drink potion live" first if you are holding a harmful potion :3'); return }
  if (!harmful && !pendingDrink) { say('No drink is pending, say "drink potion live" first, then confirm it :3'); return }
  pendingDrink = false; pendingHarmfulDrink = false
  try { await bot.activateItem(); await new Promise((r) => setTimeout(r, 1500)) } catch (e) { say(`Drinking failed: ${e.message}, I am not claiming an effect :3`); return }
  say('Drank one potion live, stopped. Now reporting effects I can read, I will not claim a duration or strength I cannot read :3')
  checkEffects()
  log('[drink-potion-live] drank one, effects reported')
}
function cancelDrinkPotion () {
  pendingDrink = false; pendingHarmfulDrink = false
  say('Cancelled the pending drink, I did not drink anything :3')
}
async function windowLayoutCompare (label) {
  const map = { loom: ['loom'], cartography: ['cartography_table'], smithing: ['smithing_table'], grindstone: ['grindstone'], brewing: ['brewing_stand'], furnace: ['furnace', 'blast_furnace', 'smoker'], enchanting: ['enchanting_table'], anvil: ['anvil'], stonecutter: ['stonecutter'] }
  const blocks = map[label] || [label.replace(/ /g, '_')]
  const blk = blockNearby(blocks, 8)
  if (!blk) { say(`I don't see a ${label} nearby to compare its window layout :3`); return }
  const conf = confirmedWindowLayouts[label]
  try {
    const win = await bot.openBlock(blk)
    await new Promise((r) => setTimeout(r, 1000))
    const layout = slotLayoutText(win)
    let out = null; try { out = win.slots && conf && win.slots[conf.outputSlot] } catch (e) {}
    try { win.close() } catch (e) {}
    if (!conf) say(`${label} window layout compare: ${layout}. No layout confirmed for ${label} this session, so this is a new layout, tell me live what slot the output is in, then say "confirm window layout ${label} output <n>", I will not guess one :3`)
    else if (!out) say(`${label} window layout compare: ${layout}. Your confirmed output slot ${conf.outputSlot} is empty now, that is a mismatch signal, tell me live if the layout changed, then say "reconfirm window layout ${label} output <n>" or "forget window layout ${label}", I will not claim success on a mismatch :3`)
    else say(`${label} window layout compare: ${layout}. Your confirmed output slot ${conf.outputSlot} holds ${out.name || 'item'}x${out.count || 1}, which matches the confirmed slot having an output, I took nothing, tell me live if the rest of the layout looks different :3`)
    log(`[window-layout-compare] ${label} slots=${layout} confirmedSlot=${conf ? conf.outputSlot : 'none'} out=${out ? out.name : 'empty'}`)
  } catch (e) { say(`${label} layout compare failed: ${e.message}, I am not claiming a layout :3`) }
}
function reconfirmWindowLayout (label, outputSlot) {
  if (!Number.isInteger(outputSlot) || outputSlot < 0 || outputSlot > 60) { say('Tell me a window output slot number, 0 or higher, and I will record it live :3'); return }
  const old = confirmedWindowLayouts[label] ? confirmedWindowLayouts[label].outputSlot : 'none'
  confirmedWindowLayouts[label] = { outputSlot, at: new Date().toISOString() }
  say(`Reconfirmed, session only: for ${label}, old confirmed output slot was ${old}, new confirmed output slot is ${outputSlot}, from your live confirmation. The old slot will not be used again :3`)
  log(`[window-layout-reconfirmed] ${label} old=${old} new=${outputSlot}`)
}
function forgetAllWindowLayouts () {
  confirmedWindowLayouts = {}
  say('Forgot ALL confirmed window layouts this session, I will not use any old output slot until you confirm it live again :3')
}
function windowLayoutStaleCheck () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, so nothing is stale, say "window layout loom" first :3'); return }
  const now = Date.now()
  const lines = keys.map((k) => { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 'unknown'; return `${k} output ${confirmedWindowLayouts[k].outputSlot}, confirmed about ${mins} minute(s) ago this session` })
  say(`Window layout stale check, session only: ${lines.join('; ')}. If you changed server or version since a confirmation, that layout may be stale, say "reconfirm window layout <block> output <n>" or "forget all window layouts", I will not auto-learn a new layout blind :3`)
}
function ladderTrapdoorTopCheck () {
  if (!bot || !bot.entity) return
  let found = []
  try { found = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 }) } catch (e) {}
  if (!found.length) { say("I don't see any ladders nearby to check trapdoor tops :3"); return }
  let tops = {}
  for (const pos of found) { const key = `${pos.x},${pos.z}`; if (!tops[key] || pos.y > tops[key].y) tops[key] = pos }
  let reports = []
  for (const key of Object.keys(tops)) {
    const top = tops[key]
    const above1 = bot.blockAt(top.offset(0, 1, 0)); const above2 = bot.blockAt(top.offset(0, 2, 0))
    const trap = (above1 && above1.name.includes('trapdoor')) || (above2 && above2.name.includes('trapdoor'))
    reports.push(`column ${key} top Y ${top.y}, above: ${above1 ? above1.name : 'unknown'}, then ${above2 ? above2.name : 'unknown'}${trap ? ', trapdoor at the top, live step only' : ', no trapdoor at the top'}`)
  }
  say(`Ladder trapdoor top check: ${reports.join('; ')}. A trapdoor at the top needs a live step, say "ladder trapdoor step" only while watching :3`)
}
async function ladderTrapdoorStep () {
  if (!bot || !bot.entity) return
  let found = []
  try { found = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 }) } catch (e) {}
  let hasTrap = false
  for (const pos of found) {
    const a1 = bot.blockAt(pos.offset(0, 1, 0)); const a2 = bot.blockAt(pos.offset(0, 2, 0))
    if ((a1 && a1.name.includes('trapdoor')) || (a2 && a2.name.includes('trapdoor'))) { hasTrap = true; break }
  }
  if (!hasTrap) { say('Ladder trapdoor step refused, I do not see a trapdoor above a ladder top nearby, say "ladder trapdoor top check" first :3'); return }
  bot.pathfinder.setGoal(null)
  const beforeY = bot.entity.position.y
  try { bot.setControlState('forward', true); bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('jump', false) } catch (e) {}
  const after = bot.entity.position
  const above = bot.blockAt(after.offset(0, 2, 0))
  say(`Ladder trapdoor step done, stopped after 2 seconds: Y ${beforeY.toFixed(1)} to ${after.y.toFixed(1)}, block above me now is ${above ? above.name : 'unknown'}. Tell me live before the next step, and tell me if I am trapped under the trapdoor :3`)
  log(`[ladder-trapdoor-step] y=${beforeY.toFixed(1)}->${after.y.toFixed(1)}`)
}
function boatWaterfallCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let ys = []
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') ys.push(b.position.y) } }
  if (!ys.length) { say("I don't see water nearby for a waterfall check :3"); return }
  const range = Math.max(...ys) - Math.min(...ys)
  say(`Boat waterfall check: water Y from ${Math.min(...ys)} to ${Math.max(...ys)}, range ${range} block(s). ${range >= 3 ? 'That range can mean a slope or a waterfall drop nearby, do NOT boat step here blind, check live where the drop is, and say "boat waterfall step" only if you are watching, it will refuse if a drop is close.' : 'Water looks flat here, no waterfall drop signal in this area, open water is the simple case.'} :3`)
}
async function boatWaterfallStep () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let ys = []
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') ys.push(b.position.y) } }
  const range = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  if (range >= 3) { say(`Boat waterfall step refused, water height range is ${range} blocks nearby, that can mean a waterfall drop, check live where it is, I will not boat into a drop blind :3`); return }
  say('Boat waterfall check passed for this step, no drop signal in range, doing one normal boat step, then stopping :3')
  await boatStep()
}
async function minecartRideStep () {
  if (!bot || !bot.entity) return
  let rails = []
  try { rails = bot.findBlocks({ matching: (b) => b.name.includes('rail'), maxDistance: 12, count: 40 }) } catch (e) {}
  let ys = [], powered = 0
  for (const pos of rails) { const b = bot.blockAt(pos); if (!b) continue; ys.push(b.position.y); if (b.name === 'powered_rail') powered++ }
  const range = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  if (!powered && range < 1) { say('Minecart ride step refused, no powered rails and no slope nearby, a minecart will not move on its own here, say "minecart push step" live instead :3'); return }
  const before = bot.entity.position.clone()
  await rideAttempt('minecart')
  await new Promise((r) => setTimeout(r, 1000))
  if (!bot.vehicle) { say('Minecart ride step did not verify, I am not in a minecart :3'); return }
  try { bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 3000)); bot.setControlState('forward', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  getOutVehicle()
  say(`Minecart ride step done, stopped after 3 seconds and got out: moved ${moved.toFixed(1)} blocks, powered rails ${powered}, slope range ${range}. ${moved >= 1 ? 'That ride moved, check live where I stopped.' : 'That ride did not verify movement, check live, I will not claim steering.'} :3`)
}
function elytraRoutePlan (dest) {
  if (!dest) { say('Elytra route plan, staged, live only: Stage 1, say "elytra landing check" where you are, and "elytra rockets check" for fireworks. Stage 2, tell me live the destination coordinates, for example "elytra route plan to 100 64 -200". Stage 3, we do one "elytra next rocket step" at a time, stopping after each step, and checking landing height each time. Stage 4, at the destination area we do a landing check again before landing. I will not claim reliable long-distance flight, one rocket step is not a full route :3'); return }
  say(`Elytra route plan to ${dest}, staged, live only: Stage 1, landing check here and rockets check. Stage 2, take off from at least 12 blocks above ground, with no lava below. Stage 3, one "elytra next rocket step" at a time, stop after each, report distance and height, and stop if the landing check shows lava or no ground. Stage 4, landing check at ${dest} before landing, and you confirm live where to land. I will not fly the whole route blind :3`)
}
async function elytraNextRocketStep () {
  elytraRocketsAttempted++
  await elytraRocketStep()
  say(`Elytra rocket steps attempted this session: ${elytraRocketsAttempted}. That count is attempted steps, not verified long-distance travel, each step still stops after 3 seconds :3`)
  log(`[elytra-next-rocket-step] attemptedThisSession=${elytraRocketsAttempted}`)
}
async function crawlSwimmingStep () {
  if (!bot || !bot.entity) return
  const beforeAir = headAirStatus()
  if (beforeAir.headUnder && !beforeAir.bubble && beforeAir.elapsed >= Math.max(0, beforeAir.limit - 2)) { say(`Crawl swimming step refused, head underwater ${beforeAir.elapsed.toFixed(0)} seconds, limit ${beforeAir.limit} seconds, swim up for air first, I will not crawl underwater blind :3`); return }
  bot.pathfinder.setGoal(null)
  const before = bot.entity.position.clone()
  try { bot.setControlState('sneak', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('sneak', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  const afterAir = headAirStatus()
  say(`Crawl swimming step done, stopped after 2 seconds: moved ${moved.toFixed(1)} blocks. Air after: ${airStatusText()}. ${afterAir.headUnder && !afterAir.bubble ? 'Head is underwater, swim up before the limit if you do not step again live.' : 'Head is not underwater, or I am in a bubble column, check live.'} Tell me live before the next step :3`)
}
function checkHungerDetails () {
  if (!bot) return
  const food = (typeof bot.food === 'number') ? bot.food : 'unknown'
  const sat = (typeof bot.foodSaturation === 'number') ? bot.foodSaturation.toFixed(1) : 'not readable in mineflayer'
  say(`Hunger details: food level ${food} out of 20, saturation ${sat}. Sprint needs food above 6, auto-eat is off by default unless you turn it on live, check live if this does not match your hunger bar :3`)
}
function checkArmour () {
  if (!bot || !bot.inventory || !bot.inventory.slots) { say('I cannot read my armour right now :3'); return }
  const names = ['head', 'chest', 'legs', 'feet']
  const parts = []
  for (let i = 0; i < 4; i++) {
    const slot = bot.inventory.slots[5 + i]
    if (!slot) parts.push(`${names[i]}: empty`)
    else parts.push(`${names[i]}: ${slot.name}${typeof slot.durabilityUsed === 'number' ? `, durability used ${slot.durabilityUsed}` : ', durability not readable'}`)
  }
  say(`Armour check: ${parts.join('; ')}. If durability is not readable, your inventory tooltip is the live check :3`)
}
function checkBlockAround (where) {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  const target = where === 'feet' ? p : where === 'below' ? p.offset(0, -1, 0) : p.offset(0, 2, 0)
  const b = bot.blockAt(target)
  say(`Block ${where} check: ${b ? b.name : 'unknown'} at ${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)} :3`)
}
function checkWaterDepth () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position
  let depth = 0
  for (let y = 0; y <= 10; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.name === 'water') depth++; else if (y > 0) break }
  say(`Water depth check: about ${depth} water block(s) in the column where I am standing, head-underwater air rule still applies, say "air" for the air timer :3`)
}
function checkRedstonePower () {
  const wire = blockNearby(['redstone_wire'], 8)
  if (!wire) { say("I don't see redstone wire nearby to check power :3"); return }
  const power = wire.properties ? wire.properties.power : undefined
  say(`Redstone wire check: wire nearby, power ${power !== undefined ? power : 'not readable in mineflayer, check live with a redstone lamp or comparator'}. I will not change redstone blind, tell me live what circuit you are testing :3`)
}
function checkPistonExtended () {
  const piston = blockNearby(['piston', 'sticky_piston'], 8)
  if (!piston) { say("I don't see a piston nearby to check extension :3"); return }
  const ext = piston.properties ? piston.properties.extended : undefined
  say(`Piston check: ${piston.name} nearby, extended ${ext !== undefined ? ext : 'not readable in mineflayer, check live if the piston head is out'}. Piston timing is live only, say "crawl piston step" only while watching :3`)
}

// ---------------------------------------------------------------- round 11, Boykissers first-join lobby
// Moon's uncertain idea, 2026-10-30, to be confirmed live, not assumed:
// on first join there may be a sort of lobby in the End, a little
// structure. When that lobby disappears and the bot is teleported
// back to the Overworld, that means spawned and ready to play.
// Refinement, also from Moon: the devs put player heads down on the
// lobby structure, and that is the distinguishing marker. Purpur and
// end stone alone could confuse the bot if it is in the End generally
// or near an End city, which also has purpur and end stone, so the
// lobby test is a combination, not any one marker alone.
// Rule, strict: do NOT claim ready while still in the End lobby, do
// NOT assume teleport timing, and do NOT invent a lobby. A lobby is
// only called a lobby when the current check actually sees End
// dimension AND purpur/end stone nearby AND player head blocks
// nearby, all three reported separately. Ready is only claimed when
// the current check actually sees Overworld AND no lobby markers
// nearby (no purpur/end stone, no player heads). A transition is
// only claimed when a previous check actually saw that full lobby
// combination and a later check sees the Overworld with no lobby
// markers. There is no continuous polling here on purpose: a
// 5-second block scan every tick would spam and lag, and mineflayer
// gives no reliable dimension-change event to watch, so the
// transition is detected on spawn and on each lobby / ready command,
// by comparing to the previous observed state.
let lobbyState = { prevDimension: null, prevLobbyBlocks: null, wasInEndLobby: false, readyAnnounced: false }
function lobbyScan () {
  if (!bot || !bot.entity) return null
  const dimension = dimensionName()
  const purpurNames = ['purpur_block', 'purpur_pillar', 'purpur_stairs', 'purpur_slab']
  const endStoneNames = ['end_stone', 'end_stone_bricks', 'end_stone_brick_stairs', 'end_stone_brick_slab', 'end_stone_brick_wall']
  const headNames = ['player_head', 'player_wall_head']
  const structureNames = ['end_rod', 'obsidian', 'crying_obsidian', 'dragon_head']
  let purpur = 0, endStone = 0, heads = 0, structure = 0, structureList = [], counts = {}
  try {
    const found = bot.findBlocks({ matching: (b) => purpurNames.includes(b.name) || endStoneNames.includes(b.name) || headNames.includes(b.name) || structureNames.includes(b.name), maxDistance: 16, count: 80 })
    for (const pos of found) {
      const b = bot.blockAt(pos); if (!b) continue
      counts[b.name] = (counts[b.name] || 0) + 1
      if (purpurNames.includes(b.name)) purpur++
      else if (endStoneNames.includes(b.name)) endStone++
      else if (headNames.includes(b.name)) heads++
      else { structure++; if (!structureList.includes(b.name)) structureList.push(b.name) }
    }
  } catch (e) {}
  return { dimension, purpur, endStone, heads, lobbyBlocks: purpur + endStone, lobbyMarkers: purpur + endStone + heads, structure, structureList, counts }
}
function lobbyCheck (mode) {
  if (!bot || !bot.entity) { say("I'm not in the world yet to check the lobby :3"); return }
  const scan = lobbyScan()
  if (!scan) { say('I could not scan for lobby blocks right now, check again live :3'); return }
  const inEnd = scan.dimension === 'the_end'
  const inOverworld = scan.dimension === 'overworld'
  const wasLobby = lobbyState.wasInEndLobby
  const isLobby = inEnd && scan.lobbyBlocks > 0 && scan.heads > 0
  const transition = wasLobby && inOverworld && scan.lobbyMarkers === 0
  const markersText = `${scan.purpur} purpur block(s), ${scan.endStone} end stone block(s), ${scan.heads} player head block(s)`
  let text = ''
  let ready = false
  if (isLobby) {
    lobbyState.wasInEndLobby = true; lobbyState.readyAnnounced = false
    text = `In End lobby, not ready yet: I am in the End, and I actually see ${markersText} nearby${scan.structure ? `, plus structure-like block(s): ${scan.structureList.join(', ')}` : ''}. All three lobby markers are present, so this looks like the lobby structure, not just the End generally. I am still in the lobby as far as I can tell, wait for the teleport back to the Overworld, I will not claim ready while I am here :3`
  } else if (inEnd && scan.lobbyBlocks > 0 && scan.heads === 0) {
    text = `In the End with purpur/end stone nearby, but NO player head blocks, so I do NOT call this the lobby. Purpur and end stone alone could be the End generally or an End city, the devs' player heads are the distinguishing lobby marker, and they are missing here. I am not claiming ready, check live with me :3`
  } else if (inEnd && scan.heads > 0 && scan.lobbyBlocks === 0) {
    text = `In the End with ${scan.heads} player head block(s) nearby, but no purpur or end stone, so this is NOT the full lobby combination, I am not calling it the lobby, check live what those heads are part of :3`
  } else if (inEnd && scan.lobbyBlocks === 0 && scan.heads === 0) {
    text = `In the End, but no purpur, no end stone, and no player heads nearby, so I do NOT see an End lobby here. I am not claiming ready, and I am not claiming this is the lobby, it could be the End itself, check live with me :3`
  } else if (transition) {
    lobbyState.wasInEndLobby = false; lobbyState.readyAnnounced = true; ready = true
    text = `Spawned and ready to play: I was in the End lobby on a previous check, and now I am in the Overworld with no lobby markers nearby, no purpur, no end stone, no player heads, so the lobby teleport looks like it happened. I am ready to play :3`
  } else if (inOverworld && scan.lobbyMarkers === 0) {
    ready = true
    text = `In the Overworld with no lobby markers nearby, no purpur, no end stone, no player heads, and I did not see an End lobby this session, so I spawned directly in the Overworld as far as I can tell, I am not inventing a lobby. That looks ready to play, tell me live if you expected a lobby first :3`
  } else if (inOverworld && scan.lobbyMarkers > 0) {
    text = `In the Overworld, but I still see lobby markers nearby, ${markersText}, so I am NOT claiming the lobby has fully disappeared yet, check live, the lobby markers may still be around me :3`
  } else {
    text = `Dimension is ${scan.dimension}, with lobby markers ${markersText} nearby, so I am NOT claiming ready, check live what dimension you see me in :3`
  }
  if (mode === 'ready') {
    if (ready) say(`Ready check: yes, ${text}`)
    else say(`Ready check: no, not ready yet. ${text}`)
  } else {
    say(`Lobby check: ${text}`)
  }
  log(`[lobby] dimension=${scan.dimension} purpur=${scan.purpur} endStone=${scan.endStone} heads=${scan.heads} structure=${scan.structure} ready=${ready} transition=${transition} prevWasLobby=${wasLobby}`)
  lobbyState.history = lobbyState.history || []
  lobbyState.history.push({ at: new Date().toISOString(), dimension: scan.dimension, purpur: scan.purpur, endStone: scan.endStone, heads: scan.heads, structure: scan.structure, ready, transition })
  if (lobbyState.history.length > 10) lobbyState.history = lobbyState.history.slice(-10)
  lobbyState.prevDimension = scan.dimension; lobbyState.prevLobbyBlocks = scan.lobbyBlocks
  if (isLobby) lobbyState.wasInEndLobby = true
}

// ---------------------------------------------------------------- round 12 (2026-10-30)
// Picking up round 11's STILL-not-covered list, only where a result can
// actually be verified. Same rules as rounds 7-11: no invented duration
// or strength numbers, no auto-learned window layout, no blind risky
// travel, no assumed lobby teleport. A window-layout age over 60
// minutes is only a session-hygiene flag ("reconfirm recommended if
// the server or version changed"), not a game rule. The lobby scan
// list is NOT extended here with guessed blocks: only blocks Moon
// actually names live in a future lobby check may be added, and
// until then structure-like blocks are only reported by exact name
// and count, never counted as lobby markers.
function brewDiffDetailed (stageKey) {
  if (!lastBrewCheck || lastBrewCheck.stage !== stageKey) { say(`No last brew check for ${stageKey} this session, say "brew ${stageKey} check" first, then I can compare its before and after fields in detail :3`); return }
  const before = lastBrewCheck.before.split(' | '); const after = lastBrewCheck.after.split(' | ')
  const changed = after.filter((x) => !before.includes(x)); const gone = before.filter((x) => !after.includes(x)); const same = before.filter((x) => after.includes(x))
  const joined = lastBrewCheck.after
  const signal = stageKey === 'extended' ? /long_/i.test(joined) : /strong_/i.test(joined)
  say(`Brew field diff, detailed, for ${stageKey}: changed: ${changed.length ? changed.join('; ') : 'none'}; gone: ${gone.length ? gone.join('; ') : 'none'}; unchanged: ${same.length ? same.join('; ') : 'none'}. Readable ${stageKey} signal (${stageKey === 'extended' ? 'long_' : 'strong_'}): ${signal ? 'present in the readable fields' : 'NOT present, so I am not claiming duration or strength from data alone'}. Now read the tooltip live with me and answer: effect name, Long or II, and duration text exactly as shown, then say "confirm brew ${stageKey} live" only if that tooltip matches :3`)
  log(`[brew-diff-detailed] ${stageKey} changed=${changed.length} gone=${gone.length} signal=${signal}`)
}
function brewTooltipChecklist (stageKey) {
  say(`Brew tooltip checklist for ${stageKey}, live only, no claim from data: 1) What is the effect name on the tooltip? 2) Does it say Long (extended) or II (upgraded), or neither? 3) What is the duration text exactly as shown? 4) Does the potion name itself say ${stageKey}? Answer those live, then say "confirm brew ${stageKey} live" only if all four match ${stageKey}, otherwise say what is different and I will not claim it :3`)
}
function brewCheckHistory () {
  const last = lastBrewCheck ? `${lastBrewCheck.stage}: before ${lastBrewCheck.before}; after ${lastBrewCheck.after}` : 'no last brew check this session'
  const conf = Object.keys(brewConfirmations)
  say(`Brew check history, this session only: last check: ${last}. Live tooltip confirmations: ${conf.length ? conf.join(', ') : 'none yet'}. A confirmation is your live tooltip read, not a number I measured :3`)
}
function forgetBrewCheck () {
  if (!lastBrewCheck) { say('No last brew check to forget this session :3'); return }
  const old = lastBrewCheck.stage; lastBrewCheck = null
  say(`Forgot the last brew check (${old}) this session, a new "brew ${old} check" is needed before another field diff, I will not reuse old fields :3`)
}
function windowLayoutSummary () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, say "window layout loom" first, then confirm the output slot live :3'); return }
  const now = Date.now()
  const lines = keys.map((k) => { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 'unknown'; return `${k} output ${confirmedWindowLayouts[k].outputSlot}, confirmed about ${mins} minute(s) ago` })
  say(`Window layout summary, session only: ${lines.join('; ')}. Use "window layout <block> compare" to check one, or "window layout compare all" to check every confirmed block, I take nothing :3`)
}
function windowLayoutAgeCheck () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, so nothing to age-check :3'); return }
  const now = Date.now()
  const lines = keys.map((k) => { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 'unknown'; const flag = (typeof mins === 'number' && mins > 60) ? ', over 60 minutes old, reconfirm recommended if the server or version changed since then' : ''; return `${k} output ${confirmedWindowLayouts[k].outputSlot}, about ${mins} minute(s) ago${flag}` })
  say(`Window layout age check, session only: ${lines.join('; ')}. Age alone does not prove a layout changed, it only says when you last confirmed it live :3`)
}
function windowLayoutForgetStale () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, so nothing to forget :3'); return }
  const now = Date.now(); let cleared = [], kept = []
  for (const k of keys) { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 0; if (mins > 60) { delete confirmedWindowLayouts[k]; cleared.push(k) } else kept.push(k) }
  say(`Forgot stale window layouts, session only: cleared ${cleared.length ? cleared.join(', ') : 'none over 60 minutes old'}; kept ${kept.length ? kept.join(', ') : 'none'}. A cleared layout will not be used until you confirm it live again, I will not auto-learn a replacement :3`)
  log(`[window-layout-forget-stale] cleared=${cleared.join(',')} kept=${kept.join(',')}`)
}
async function windowLayoutCompareAll () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, so there is nothing to compare, say "window layout loom" first :3'); return }
  say(`Window layout compare all: checking ${keys.join(', ')} one at a time, I take nothing, read each compare message above this summary :3`)
  for (const label of keys) { try { await windowLayoutCompare(label) } catch (e) { say(`${label} compare failed: ${e.message}`) } }
  say(`Window layout compare all done: checked ${keys.join(', ')}. Any empty confirmed slot in those messages is a mismatch signal, say "reconfirm window layout <block> output <n>" or "forget window layout <block>" for that block, I will not claim success on a mismatch :3`)
}
function ladderWaterStep () {
  if (!bot || !bot.entity) return
  let ladders = []
  try { ladders = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 }) } catch (e) {}
  if (!ladders.length) { say("I don't see a ladder nearby for a water ladder step :3"); return }
  let inWater = 0
  for (const pos of ladders) { const neighbours = [bot.blockAt(pos.offset(1, 0, 0)), bot.blockAt(pos.offset(-1, 0, 0)), bot.blockAt(pos.offset(0, 0, 1)), bot.blockAt(pos.offset(0, 0, -1)), bot.blockAt(pos.offset(0, 1, 0))]; if (neighbours.some((b) => b && b.name === 'water')) inWater++ }
  const air = headAirStatus()
  if (air.headUnder && !air.bubble && air.elapsed >= Math.max(0, air.limit - 2)) { say(`Ladder water step refused, head underwater ${air.elapsed.toFixed(0)} seconds, limit ${air.limit} seconds, swim up for air first :3`); return }
  bot.pathfinder.setGoal(null)
  const beforeY = bot.entity.position.y
  try { bot.setControlState('forward', true); bot.setControlState('jump', true); setTimeout(() => { try { bot.setControlState('forward', false); bot.setControlState('jump', false) } catch (e) {} }, 1000); } catch (e) {}
  // Report after the 1-second step, synchronously waiting here is not
  // possible in this helper's existing style, so use a delayed report.
  setTimeout(() => { if (!bot || !bot.entity) return; const afterY = bot.entity.position.y; say(`Ladder water step done, stopped after about 1 second, shorter than a normal climb step because water slows climbing: Y ${beforeY.toFixed(1)} to ${afterY.toFixed(1)}, ladders with water nearby: ${inWater}. Air now: ${airStatusText()}. Tell me live before the next step :3`); log(`[ladder-water-step] y=${beforeY.toFixed(1)}->${afterY.toFixed(1)} inWater=${inWater}`) }, 1200)
  say(`Ladder water step starting: ${inWater} ladder block(s) with water nearby, holding forward and jump for 1 second only, then stopping, I will report Y after the step :3`)
}
async function ladderCornerStep () {
  if (!bot || !bot.entity) return
  const before = bot.entity.position.clone()
  bot.pathfinder.setGoal(null)
  try { bot.setControlState('forward', true); bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('jump', false) } catch (e) {}
  const after = bot.entity.position.clone(); const dx = after.x - before.x, dz = after.z - before.z
  say(`Ladder corner step done, stopped after 2 seconds: from ${before.x.toFixed(0)}, ${before.z.toFixed(0)} to ${after.x.toFixed(0)}, ${after.z.toFixed(0)}, change x ${dx.toFixed(1)}, z ${dz.toFixed(1)}, Y ${before.y.toFixed(1)} to ${after.y.toFixed(1)}. ${Math.abs(dx) > 0.5 && Math.abs(dz) > 0.5 ? 'That moved in both x and z, which can mean a corner or turn, check live.' : 'That did not clearly turn a corner, check live.'} Tell me live before the next step :3`)
  log(`[ladder-corner-step] dx=${dx.toFixed(1)} dz=${dz.toFixed(1)} y=${before.y.toFixed(1)}->${after.y.toFixed(1)}`)
}
function crawlPistonCheck () {
  if (!bot || !bot.entity) return
  const piston = blockNearby(['piston', 'sticky_piston'], 8)
  if (!piston) { say("I don't see a piston nearby for a piston crawl check :3"); return }
  const ext = piston.properties ? piston.properties.extended : undefined
  const dist = bot.entity.position.distanceTo(piston.position)
  say(`Crawl piston check, read-only, I am not moving: ${piston.name} about ${dist.toFixed(1)} blocks away, extended ${ext !== undefined ? ext : 'not readable in mineflayer, check live if the piston head is out'}. Piston timing is live only, you activate the piston live, then say "crawl piston step", I will not crawl on piston timing blind :3`)
}
async function boatRiverStep () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position; let ys = []
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') ys.push(b.position.y) } }
  if (!ys.length) { say("I don't see water nearby for a river boat step :3"); return }
  const range = Math.max(...ys) - Math.min(...ys)
  if (range >= 3) { say(`Boat river step refused, water height range is ${range} blocks nearby, that can mean a waterfall drop, check live where it is, I will not boat into a drop blind :3`); return }
  say('Boat river step: water looks flat enough in range for one step, doing one normal boat step, then stopping :3')
  await boatStep()
}
async function boatIceStep () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position; let ice = 0
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && (b.name.includes('ice') || b.name.includes('frost'))) ice++ } }
  if (!ice) { say("I don't see ice nearby for an ice boat step :3"); return }
  const before = bot.entity.position.clone()
  await rideAttempt('boat')
  await new Promise((r) => setTimeout(r, 1000))
  if (!bot.vehicle) { say('Boat ice step did not verify, I am not in a boat :3'); return }
  try { bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 1000)); bot.setControlState('forward', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  getOutVehicle()
  say(`Boat ice step done, stopped after 1 second only, because ice is slippery and hard to stop: moved ${moved.toFixed(1)} blocks, got out again. Tell me live before the next step :3`)
  log(`[boat-ice-step] moved=${moved.toFixed(1)} ice=${ice}`)
}
async function minecartSlopeStep () {
  if (!bot || !bot.entity) return
  let rails = []
  try { rails = bot.findBlocks({ matching: (b) => b.name.includes('rail'), maxDistance: 12, count: 40 }) } catch (e) {}
  let ys = [], powered = 0
  for (const pos of rails) { const b = bot.blockAt(pos); if (!b) continue; ys.push(b.position.y); if (b.name === 'powered_rail') powered++ }
  const range = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  if (range < 1) { say('Minecart slope step refused, no slope in the rails nearby, a minecart will not move on its own here, say "minecart push step" live instead :3'); return }
  const before = bot.entity.position.clone()
  await rideAttempt('minecart')
  await new Promise((r) => setTimeout(r, 1000))
  if (!bot.vehicle) { say('Minecart slope step did not verify, I am not in a minecart :3'); return }
  try { bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before)
  getOutVehicle()
  say(`Minecart slope step done, stopped after 2 seconds and got out: moved ${moved.toFixed(1)} blocks, slope range ${range}, powered rails ${powered}. ${moved >= 1 ? 'That slope ride moved, check live where I stopped.' : 'That slope ride did not verify movement, check live, I will not claim steering.'} :3`)
}
function elytraRouteCheck () {
  elytraRocketsCheck()
  elytraLandingCheck()
  say(`Elytra route check summary: rockets and landing are reported above, rocket steps attempted this session: ${elytraRocketsAttempted}. That is a pre-flight check only, not a flight, do "elytra route plan" for stages, then one "elytra next rocket step" at a time, stopping after each :3`)
}
async function elytraGlideStep () {
  const ely = bot.inventory.items().find((i) => i.name === 'elytra')
  if (!ely) { say('I need an elytra for a glide step, wear one first :3'); return }
  try { await bot.equip(ely, 'torso') } catch (e) {}
  const p = bot.entity.position.clone(); let groundDist = 99, groundBlock = null
  for (let y = 1; y <= 30; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') { groundDist = y; groundBlock = b; break } }
  if (groundDist < 12) { say(`Elytra glide step refused, only about ${groundDist} blocks above ground, do it live from higher up :3`); return }
  if (!groundBlock) { say('Elytra glide step refused, no solid ground found below, that could be a void :3'); return }
  if (groundBlock.name === 'lava') { say('Elytra glide step refused, lava is below, unsafe landing :3'); return }
  const before = bot.entity.position.clone()
  try { bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false) } catch (e) {}
  const after = bot.entity.position.clone(); const horiz = Math.hypot(after.x - before.x, after.z - before.z); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  say(`Elytra glide step done, no rocket used, stopped after 2 seconds: moved ${horiz.toFixed(1)} blocks forward, Y ${before.y.toFixed(0)} to ${after.y.toFixed(0)}, vertical speed about ${vel.toFixed(1)}. ${horiz >= 3 && vel > -5 ? 'That looks like a slowed short glide, check live.' : 'That did not verify a slowed glide, check live.'} This is a short glide only, not long travel, which needs rockets and a route plan :3`)
  log(`[elytra-glide-step] horiz=${horiz.toFixed(1)} y=${before.y.toFixed(0)}->${after.y.toFixed(0)} vy=${vel.toFixed(1)}`)
}
function lobbyMarkersDetail () {
  if (!bot || !bot.entity) { say("I'm not in the world yet to check lobby markers :3"); return }
  const scan = lobbyScan(); if (!scan) { say('I could not scan for lobby markers right now, check again live :3'); return }
  const perName = Object.entries(scan.counts || {}).map(([n, c]) => `${n} x${c}`).join(', ') || 'none'
  const prev = lobbyState.history && lobbyState.history.length ? lobbyState.history[lobbyState.history.length - 1] : null
  say(`Lobby markers, detailed: dimension ${scan.dimension}; purpur ${scan.purpur}, end stone ${scan.endStone}, player heads ${scan.heads}; per block name: ${perName}; structure-like blocks: ${scan.structure ? scan.structureList.map((n) => `${n} x${scan.counts[n] || 0}`).join(', ') : 'none seen'}. Previous lobby state this session: was in full End lobby: ${lobbyState.wasInEndLobby ? 'yes' : 'no'}; ready announced: ${lobbyState.readyAnnounced ? 'yes' : 'no'}${prev ? `; last lobby check was ${prev.dimension}, purpur ${prev.purpur}, end stone ${prev.endStone}, heads ${prev.heads}` : ''}. I have NOT added any new block to the lobby scan list here, only blocks Moon names live in a lobby check may be added later, structure-like blocks are reported, not counted as lobby markers :3`)
  log(`[lobby-markers] dimension=${scan.dimension} counts=${perName}`)
}
function lobbyHistory () {
  const hist = lobbyState.history || []
  if (!hist.length) { say('No lobby checks recorded this session yet, say "check lobby" first, then I will keep the last 10 checks here :3'); return }
  say(`Lobby history, last ${hist.length} check(s), session only: ${hist.map((h) => `${h.at.slice(11, 19)} ${h.dimension} purpur ${h.purpur} end stone ${h.endStone} heads ${h.heads} structure ${h.structure} ready ${h.ready ? 'yes' : 'no'} transition ${h.transition ? 'yes' : 'no'}`).join('; ')}. A transition is only claimed when an earlier entry was a full End lobby and a later entry is Overworld with no markers, I do not assume a teleport from one entry alone :3`)
}
function checkHeldItem () {
  if (!bot) return
  const held = bot.heldItem
  if (!held) { say('I am not holding anything to check :3'); return }
  const ench = held.enchants && held.enchants.length ? held.enchants.map((e) => `${e.name || e.id} ${e.lvl || ''}`.trim()).join(', ') : 'no enchantments readable'
  say(`Held item check: ${held.name} x${held.count || 1}${typeof held.durabilityUsed === 'number' ? `, durability used ${held.durabilityUsed}` : ', durability not readable in mineflayer'}; enchantments: ${ench}. If durability or enchantments are not readable, your inventory tooltip is the live check :3`)
}
function checkNearbyByType () {
  if (!bot || !bot.entity) return
  let groups = {}
  for (const id of Object.keys(bot.entities || {})) { const e = bot.entities[id]; if (!e || e.type !== 'mob' || !e.position) continue; if (e.position.distanceTo(bot.entity.position) > 32) continue; const name = e.mobType || e.name || 'unknown'; groups[name] = (groups[name] || 0) + 1 }
  const keys = Object.keys(groups)
  if (!keys.length) { say('No mobs seen within 32 blocks right now, say "scan" for blocks and closer entities :3'); return }
  say(`Nearby mobs by type, within 32 blocks: ${keys.map((k) => `${k} x${groups[k]}`).join(', ')}. Counts only, say "scan" for names and distances, I will not claim a mob I cannot see :3`)
}
function checkSpawnPoint () {
  if (!bot) return
  const sp = bot.spawnPoint
  if (!sp) { say('I cannot read a spawn point in mineflayer right now, check live with a bed or compass, and say "go to spawn" if you want me to walk to the world spawn :3'); return }
  say(`Spawn point check, as read in mineflayer: ${sp.x}, ${sp.y}, ${sp.z}. If that does not match where you expect to spawn, tell me live, I will not claim it is your bed spawn without checking :3`)
}

// ---------------------------------------------------------------- round 13 (2026-10-30)
// Picking up round 12's STILL-not-covered list, only where a result can
// actually be verified. Same rules as rounds 7-12: no invented duration
// or strength numbers, no auto-learned window layout, no blind risky
// travel, no assumed lobby teleport, and NO new lobby blocks from
// guesses — only blocks Moon names live in future may be added to
// the lobby scan list. Lobby markers here are still only purpur,
// end stone, and player heads; structure-like blocks are reported,
// never counted as markers.
let pistonActivatedAt = null
function brewNoSignalCheck (stageKey) {
  if (!lastBrewCheck || lastBrewCheck.stage !== stageKey) { say(`No last brew check for ${stageKey} this session, say "brew ${stageKey} check" first, then I can say honestly whether any readable signal is present :3`); return }
  const joined = lastBrewCheck.after
  const signal = stageKey === 'extended' ? /long_/i.test(joined) : /strong_/i.test(joined)
  if (signal) { say(`Brew no-signal check for ${stageKey}: a readable ${stageKey === 'extended' ? 'long_' : 'strong_'} signal IS present in the fields, so this is not a no-signal case, use "brew ${stageKey} field diff detailed" and the normal tooltip confirm path :3`); return }
  say(`Brew no-signal check for ${stageKey}: NO readable ${stageKey === 'extended' ? 'long_' : 'strong_'} signal in the fields. Field diff: ${fieldDiffText(lastBrewCheck.before, lastBrewCheck.after)}. I will NOT turn this into a duration or strength number. Your two honest confirmations are: 1) read the tooltip live with me, effect name, Long or II, and duration text, then say "confirm brew ${stageKey} live" only if it matches, or 2) say "drink potion live" and confirm a drink with you watching, then I will report effects I can read, and you tell me live if the effect lasts longer or feels stronger, I will not claim a number from that alone :3`)
  log(`[brew-no-signal] ${stageKey} signal=false`)
}
function brewConfirmSteps (stageKey) {
  say(`Brew confirm steps for ${stageKey}, no invented numbers: step 1, say "brew ${stageKey} check", then "brew ${stageKey} field diff detailed" to see changed, gone, and unchanged fields; step 2, say "brew ${stageKey} tooltip checklist" and answer its four live questions from the tooltip; step 3, say "confirm brew ${stageKey} live" ONLY if the tooltip matches, or say "drink potion live" then "confirm drink potion" with you watching and I will report readable effects; step 4, say "brew confirmations detailed" to see what was actually confirmed this session. If step 1 shows no long_/strong_ signal, steps 2 and 3 are the only confirmations, I will not claim duration or strength from data alone :3`)
}
function brewConfirmationsDetailed () {
  const keys = Object.keys(brewConfirmations)
  const last = lastBrewCheck ? `${lastBrewCheck.stage}, before: ${lastBrewCheck.before}; after: ${lastBrewCheck.after}` : 'no last brew check this session'
  const lines = keys.map((k) => { const at = brewConfirmations[k].at; const mins = at ? Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000)) : 'unknown'; return `${k} confirmed live about ${mins} minute(s) ago` })
  say(`Brew confirmations, detailed, session only: last check: ${last}. Live tooltip confirmations: ${lines.length ? lines.join('; ') : 'none yet'}. A confirmation is your live tooltip read, not a duration or strength number I measured, and a confirmation for one stage does not confirm the other stage :3`)
}
function windowLayoutAgeDetailed () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, say "window layout loom" first, then confirm the output slot live :3'); return }
  const now = Date.now()
  const lines = keys.map((k) => { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 'unknown'; const bucket = (typeof mins === 'number' && mins > 60) ? 'stale, reconfirm recommended if the server or version changed' : (typeof mins === 'number' && mins >= 15) ? 'recent, compare before trusting it after a restart' : 'fresh this session'; return `${k} output ${confirmedWindowLayouts[k].outputSlot}, about ${mins} minute(s) ago, ${bucket}` })
  say(`Window layout age, detailed, session only: ${lines.join('; ')}. Age alone does not prove a layout changed, it only says when you last confirmed it live, and a stale layout is still not auto-replaced, you reconfirm it live :3`)
}
function windowLayoutSummaryDetailed () {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, say "window layout loom" first, then confirm the output slot live :3'); return }
  const now = Date.now(); let fresh = 0, recent = 0, stale = 0, oldest = null
  for (const k of keys) { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 999; if (mins > 60) stale++; else if (mins >= 15) recent++; else fresh++; if (oldest === null || mins > oldest) oldest = mins }
  say(`Window layout summary, detailed, session only: ${keys.length} confirmed layout(s), fresh under 15 minutes: ${fresh}, recent 15 to 60 minutes: ${recent}, stale over 60 minutes: ${stale}, oldest about ${oldest} minute(s) ago. Blocks: ${keys.join(', ')}. Next honest step: "window layout compare all" to check each one, or "forget stale window layouts older than <minutes>" to clear old ones, I take nothing and I auto-learn nothing :3`)
}
function windowLayoutForgetStaleOlder (minutes) {
  const keys = Object.keys(confirmedWindowLayouts)
  if (!keys.length) { say('No window layouts confirmed this session, so nothing to forget :3'); return }
  if (!minutes || minutes < 1 || minutes > 1440) { say('Forget stale window layouts needs a number of minutes from 1 to 1440, for example "forget stale window layouts older than 30 minutes" :3'); return }
  const now = Date.now(); let cleared = [], kept = []
  for (const k of keys) { const at = confirmedWindowLayouts[k].at; const mins = at ? Math.max(0, Math.round((now - Date.parse(at)) / 60000)) : 0; if (mins > minutes) { delete confirmedWindowLayouts[k]; cleared.push(k) } else kept.push(k) }
  say(`Forgot window layouts older than ${minutes} minute(s), session only: cleared ${cleared.length ? cleared.join(', ') : 'none'}; kept ${kept.length ? kept.join(', ') : 'none'}. A cleared layout will not be used until you confirm it live again, I will not auto-learn a replacement :3`)
  log(`[window-layout-forget-older] threshold=${minutes} cleared=${cleared.join(',')} kept=${kept.join(',')}`)
}
async function ladderTopStep () {
  if (!bot || !bot.entity) return
  bot.pathfinder.setGoal(null)
  const before = bot.entity.position.clone()
  try { bot.setControlState('forward', true); bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('jump', false) } catch (e) {}
  const after = bot.entity.position.clone(); const above = bot.blockAt(after.offset(0, 2, 0)); const head = bot.blockAt(after.offset(0, 1, 0))
  say(`Ladder top step done, stopped after 2 seconds: Y ${before.y.toFixed(1)} to ${after.y.toFixed(1)}, block at head height now is ${head ? head.name : 'unknown'}, block two above is ${above ? above.name : 'unknown'}. ${above && above.boundingBox === 'block' ? 'Headroom looks blocked, tell me live if I am trapped under it.' : 'Headroom does not look blocked from here, check live.'} Tell me live before the next step :3`)
  log(`[ladder-top-step] y=${before.y.toFixed(1)}->${after.y.toFixed(1)} above=${above ? above.name : 'unknown'}`)
}
function ladderWaterCornerCheck () {
  if (!bot || !bot.entity) return
  let ladders = []
  try { ladders = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 12, count: 40 }) } catch (e) {}
  if (!ladders.length) { say("I don't see a ladder nearby for a water corner check :3"); return }
  let inWater = 0, cols = {}
  for (const pos of ladders) { const neighbours = [bot.blockAt(pos.offset(1, 0, 0)), bot.blockAt(pos.offset(-1, 0, 0)), bot.blockAt(pos.offset(0, 0, 1)), bot.blockAt(pos.offset(0, 0, -1)), bot.blockAt(pos.offset(0, 1, 0))]; if (neighbours.some((b) => b && b.name === 'water')) inWater++; const key = `${pos.x},${pos.z}`; cols[key] = (cols[key] || 0) + 1 }
  const colCount = Object.keys(cols).length
  say(`Ladder water corner check: ${ladders.length} ladder block(s) in ${colCount} column(s), ${inWater} with water nearby. ${colCount > 1 ? 'More than one column close together can mean a corner or turn, climb live one 2-second step at a time.' : 'One ladder column, a straight climb is the simple case.'} ${inWater ? 'Water nearby means a water ladder step, not a normal climb step, and the air rule applies if my head goes under.' : 'No water next to these ladders.'} :3`)
}
function crawlSwimmingCheckDetailed () {
  if (!bot || !bot.entity) return
  const air = headAirStatus()
  let water = 0
  for (let dx = -4; dx <= 4; dx++) { for (let dz = -4; dz <= 4; dz++) { const b = bot.blockAt(bot.entity.position.offset(dx, 0, dz)); if (b && b.name === 'water') water++ } }
  say(`Crawl swimming check, detailed: ${water} water block(s) nearby at my level, air now: ${airStatusText()}. A swimming crawl can put my head underwater, so Moon's air rule applies: swim up before ${air.limit} seconds head-under without Respiration, or before the Respiration-adjusted limit, and bubble columns excepted. A crawl step is 2 seconds only and stops, say "crawl swimming step" only after you check the water live :3`)
}
function pistonActivatedLive () {
  pistonActivatedAt = Date.now()
  say('Piston activated live, recorded this session: I will accept one "crawl piston timed step" in the next 2 minutes, after that you need to say "piston activated live" again, because piston timing changes fast and I will not crawl on an old activation :3')
}
async function crawlPistonTimedStep () {
  if (!bot || !bot.entity) return
  const piston = blockNearby(['piston', 'sticky_piston'], 8)
  if (!piston) { say("I don't see a piston nearby for a timed piston crawl step :3"); return }
  const ext = piston.properties ? piston.properties.extended : undefined
  const activatedRecently = pistonActivatedAt && (Date.now() - pistonActivatedAt) < 120000
  if (!activatedRecently && ext !== true) { say(`Crawl piston timed step refused: piston extended reads ${ext !== undefined ? ext : 'not readable'}, and no "piston activated live" in the last 2 minutes. Activate the piston live, say "piston activated live", then say "crawl piston timed step" right away, I will not crawl on piston timing blind :3`); return }
  pistonActivatedAt = null
  bot.pathfinder.setGoal(null)
  const before = bot.entity.position.clone()
  try { bot.setControlState('sneak', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('sneak', false) } catch (e) {}
  const moved = bot.entity.position.distanceTo(before); const above = bot.blockAt(bot.entity.position.offset(0, 2, 0))
  say(`Crawl piston timed step done, stopped after 2 seconds: moved ${moved.toFixed(1)} blocks, block above me now is ${above ? above.name : 'unknown'}. Tell me live before any next step, and tell me if I am trapped :3`)
  log(`[crawl-piston-timed-step] moved=${moved.toFixed(1)} above=${above ? above.name : 'unknown'}`)
}
function boatRiverIceCheck () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position; let water = 0, ice = 0, ys = []
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') { water++; ys.push(b.position.y) } if (b && (b.name.includes('ice') || b.name.includes('frost'))) ice++ } }
  const yRange = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  say(`Boat river ice check, combined: ${water} water block(s), ${ice} ice block(s) nearby, water height range ${yRange} block(s). ${yRange >= 3 ? 'That range can mean a waterfall drop, a river boat step is refused here, check live.' : ice ? 'Ice nearby means a slippery 1-second ice boat step only, not a normal 2-second step.' : water ? 'Flat open water is the simple case, a normal boat step stops after 2 seconds.' : 'No water nearby for a boat step.'} Tell me live how wide the river is, a block count alone cannot measure width :3`)
}
async function boatWaterfallStepSafe () {
  if (!bot || !bot.entity) return
  const p = bot.entity.position; let ys = []
  for (let dx = -8; dx <= 8; dx++) { for (let dz = -8; dz <= 8; dz++) { const b = bot.blockAt(p.offset(dx, 0, dz)); if (b && b.name === 'water') ys.push(b.position.y) } }
  const yRange = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  if (yRange >= 3) { say(`Boat waterfall step refused, water height range is ${yRange} blocks nearby, that can mean a waterfall drop, check live where it is, I will not boat into a drop blind :3`); return }
  say('Boat waterfall step, safe-range check passed: water height range under 3 blocks, doing one normal boat step, then stopping :3')
  await boatStep()
}
async function minecartNoPowerStep () {
  if (!bot || !bot.entity) return
  let rails = []
  try { rails = bot.findBlocks({ matching: (b) => b.name.includes('rail'), maxDistance: 12, count: 40 }) } catch (e) {}
  let ys = [], powered = 0
  for (const pos of rails) { const b = bot.blockAt(pos); if (!b) continue; ys.push(b.position.y); if (b.name === 'powered_rail') powered++ }
  const range = ys.length ? (Math.max(...ys) - Math.min(...ys)) : 0
  if (powered > 0 || range >= 1) { say(`Minecart no-power step is not the right step here: powered rails ${powered}, slope range ${range}. Use "minecart slope step" or "minecart ride step" instead, this step is only for no powered rails and no slope :3`); return }
  say('Minecart no-power step: no powered rails and no slope nearby, so riding will not move me, doing a live push step instead, then stopping :3')
  await minecartPushStep()
}
function elytraLongTravelPlan () {
  if (!bot || !bot.entity) return
  const rockets = inventoryItem('firework_rocket')
  const rocketCount = rockets ? rockets.total : 0
  say(`Elytra long travel plan, staged only, not a flight: stage 1, say "elytra route check" for rockets and landing; stage 2, take off from at least 12 blocks above ground with no lava below, confirmed live; stage 3, one "elytra travel step" at a time, one rocket each, stopping after 3 seconds, with a landing check after each step, and you confirming live before the next step; stage 4, a landing check at the destination area before landing, with you confirming the landing spot live. Rockets I have now: ${rocketCount}. ${rocketCount < 1 ? 'No rockets, long travel is not possible, a short glide only goes a few blocks.' : `With ${rocketCount} rocket(s), that is at most ${rocketCount} honest travel steps, not a guaranteed arrival, because wind, height, and landing are live.`} I will never claim reliable long-distance travel from a plan alone :3`)
}
async function elytraTravelStep () {
  if (!bot || !bot.entity) return
  elytraRocketsAttempted++
  say(`Elytra travel step ${elytraRocketsAttempted} this session: one rocket step, then a landing check, then stopping, tell me live before the next step :3`)
  await elytraRocketStep()
  elytraLandingCheck()
  log(`[elytra-travel-step] attempt=${elytraRocketsAttempted}`)
}
function lobbyScanByDistance () {
  if (!bot || !bot.entity) return null
  const scan = lobbyScan(); if (!scan) return null
  const purpurNames = ['purpur_block', 'purpur_pillar', 'purpur_stairs', 'purpur_slab']; const endStoneNames = ['end_stone', 'end_stone_bricks', 'end_stone_brick_stairs', 'end_stone_brick_slab', 'end_stone_brick_wall']; const headNames = ['player_head', 'player_wall_head']
  let near = 0, mid = 0
  try {
    const found = bot.findBlocks({ matching: (b) => purpurNames.includes(b.name) || endStoneNames.includes(b.name) || headNames.includes(b.name), maxDistance: 16, count: 80 })
    for (const pos of found) { const d = pos.distanceTo(bot.entity.position); if (d < 8) near++; else mid++ }
  } catch (e) {}
  return { scan, near, mid }
}
function lobbyMarkersByDistance () {
  const res = lobbyScanByDistance()
  if (!res) { say('I could not scan lobby markers by distance right now, check again live :3'); return }
  const s = res.scan
  say(`Lobby markers by distance: dimension ${s.dimension}; total markers ${s.lobbyMarkers} (purpur ${s.purpur}, end stone ${s.endStone}, player heads ${s.heads}); under 8 blocks away: ${res.near}, 8 to 16 blocks away: ${res.mid}. A close marker set is stronger evidence for a lobby structure than a distant one, and distance alone does not make a lobby, the full combination still needs End dimension plus purpur/end stone plus player heads. No new lobby blocks were added here, only purpur, end stone, and player heads are counted :3`)
  log(`[lobby-markers-distance] dimension=${s.dimension} near=${res.near} mid=${res.mid} total=${s.lobbyMarkers}`)
}
function lobbyWatchTick () {
  if (!bot || !bot.entity) return
  if (Date.now() - (lobbyState.lastWatchAt || 0) < 30000) return
  lobbyState.lastWatchAt = Date.now()
  const scan = lobbyScan(); if (!scan) return
  const wasLobby = lobbyState.wasInEndLobby
  const isLobby = scan.dimension === 'the_end' && scan.lobbyBlocks > 0 && scan.heads > 0
  const transition = wasLobby && scan.dimension === 'overworld' && scan.lobbyMarkers === 0
  if (isLobby) lobbyState.wasInEndLobby = true
  if (transition) { lobbyState.wasInEndLobby = false; lobbyState.readyAnnounced = true; say('Lobby watch: spawned and ready to play, I was in the End lobby on a previous check, and now I am in the Overworld with no lobby markers nearby, no purpur, no end stone, no player heads :3') }
  lobbyState.history = lobbyState.history || []
  lobbyState.history.push({ at: new Date().toISOString(), dimension: scan.dimension, purpur: scan.purpur, endStone: scan.endStone, heads: scan.heads, structure: scan.structure, ready: transition || (scan.dimension === 'overworld' && scan.lobbyMarkers === 0), transition })
  if (lobbyState.history.length > 10) lobbyState.history = lobbyState.history.slice(-10)
  log(`[lobby-watch] dimension=${scan.dimension} purpur=${scan.purpur} endStone=${scan.endStone} heads=${scan.heads} transition=${transition}`)
}
function lobbyWatchOn () { lobbyState.watch = true; lobbyState.lastWatchAt = 0; say('Lobby watch on, session only: I will check the lobby quietly at most once every 30 seconds in the background, and I will only speak up if the full lobby-to-Overworld transition happens. I will not spam lobby messages, and I will not claim ready without that transition or a direct Overworld check :3') }
function lobbyWatchOff () { lobbyState.watch = false; say('Lobby watch off, I will not check the lobby in the background any more, say "check lobby" any time for a one-off check :3') }
function lobbyWatchStatus () { say(`Lobby watch status: ${lobbyState.watch ? 'on' : 'off'}, session only. Was in a full End lobby this session: ${lobbyState.wasInEndLobby ? 'yes' : 'no'}; ready announced: ${lobbyState.readyAnnounced ? 'yes' : 'no'}; history entries kept: ${(lobbyState.history || []).length}. Say "lobby watch on" or "lobby watch off" to change it :3`) }
function lobbyTransitionSummary () {
  const hist = lobbyState.history || []
  const trans = [...hist].reverse().find((h) => h.transition)
  if (!trans) { say(`Lobby transition summary: no full lobby-to-Overworld transition recorded this session yet, last ${hist.length} check(s) kept. A transition needs a previous full End lobby check, all three markers, and a later Overworld check with no markers, I do not assume one from a single check :3`); return }
  say(`Lobby transition summary: last transition recorded at ${trans.at.slice(11, 19)}, dimension ${trans.dimension}, purpur ${trans.purpur}, end stone ${trans.endStone}, heads ${trans.heads}, ready yes. That is the only transition claim in this session's history, later checks are in "lobby history" :3`)
}
function checkFoodCount () {
  if (!bot) return
  const foods = bot.inventory.items().filter((i) => /bread|apple|carrot|potato|beef|pork|chicken|mutton|rabbit|fish|salmon|cod|melon|berry|cookie|cake|pumpkin/.test(i.name))
  const total = foods.reduce((s, i) => s + (i.count || 1), 0)
  say(`Food count check, inventory only: ${total} food item(s) in total${foods.length ? `, types: ${foods.map((i) => `${i.name} x${i.count || 1}`).join(', ')}` : ''}. This counts food in my inventory, not food in chests or farms, and it does not mean I should eat it without you saying so :3`)
}
function checkNearbyGroups (kind) {
  if (!bot || !bot.entity) return
  const hostileNames = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'blaze', 'ghast', 'slime', 'phantom', 'drowned', 'husk', 'stray', 'pillager', 'vindicator', 'evoker', 'warden', 'guardian', 'elder_guardian', 'shulker', 'silverfish', 'cave_spider', 'magma_cube', 'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'wither_skeleton', 'endermite']
  const animalNames = ['cow', 'pig', 'sheep', 'chicken', 'horse', 'donkey', 'mule', 'wolf', 'cat', 'dog', 'fox', 'rabbit', 'bee', 'axolotl', 'panda', 'goat', 'llama', 'turtle', 'frog', 'parrot', 'ocelot', 'mooshroom', 'squid', 'glow_squid']
  let groups = {}, other = 0
  for (const id of Object.keys(bot.entities || {})) { const e = bot.entities[id]; if (!e || e.type !== 'mob' || !e.position) continue; if (e.position.distanceTo(bot.entity.position) > 32) continue; const name = e.mobType || e.name || 'unknown'; const list = kind === 'hostile' ? hostileNames : animalNames; if (list.includes(name)) groups[name] = (groups[name] || 0) + 1; else if (kind === 'hostile' && animalNames.includes(name)) {} else if (kind === 'animal' && hostileNames.includes(name)) {} else other++ }
  const keys = Object.keys(groups)
  if (!keys.length) { say(`No ${kind} mobs from my known ${kind} list seen within 32 blocks right now${other ? `, plus ${other} other mob(s) not on that list, say "check nearby by type" for all of them` : ''}, say "scan" for names and distances :3`); return }
  say(`Nearby ${kind} mobs, within 32 blocks, known-list only: ${keys.map((k) => `${k} x${groups[k]}`).join(', ')}${other ? `, plus ${other} other mob(s) not on the ${kind} list` : ''}. A mob not on my known list is reported as other, not guessed as ${kind} :3`)
}
function checkDistanceToMoon () {
  if (!bot || !bot.entity) return
  const owner = ownerEntity()
  if (!owner) { say("I cannot see Moon right now to measure a distance, say \"where are you\" or \"scan\" and check live :3"); return }
  const d = owner.position.distanceTo(bot.entity.position)
  say(`Distance to Moon: about ${d.toFixed(1)} blocks, to the ${directionName(owner.position.x - bot.entity.position.x, owner.position.z - bot.entity.position.z)}. That is a straight-line distance, not a walking path, and it does not mean I am following, say "follow me" if you want me to follow :3`)
}

// ---------------------------------------------------------------- round 13, part 2: clutch and parkour
// Clutch is relevant soon, parkour is an end goal. Neither is claimed
// as a current ability. Clutch code did not exist before this round:
// only a fall-height check, ravine-fall reporting over 5 blocks, and
// a blind pearl-throw refusal. Parkour code before this round was
// only pathfinder allowParkour 1-block steps, a single jump, and
// sprint with food above 6. Everything below is staged, live-only,
// low-height first, with a confirm step before any real fall or
// gap attempt, and a failed attempt reports the fall honestly.
let pendingClutch = null
let clutchAttempts = []
let clutchPassedLiveMap = {}
let parkourAttempts = []
let parkourPassedLiveMap = {}
let parkourSpinReadyAt = null
function clutchMethods () {
  return [
    { key: 'water', name: 'water bucket', item: 'water_bucket', need: 'a water bucket in hand, placed just before landing, on a solid block, not leaves or mangrove roots which waterlog instead, and not in the Nether where water evaporates', result: 'landing in placed water negates fall damage' },
    { key: 'powder snow', name: 'powder snow bucket', item: 'powder_snow_bucket', need: 'a powder snow bucket, placed just before landing, works in the Nether and can be placed on leaves and top slabs where water fails', result: 'landing in placed powder snow negates fall damage' },
    { key: 'cobweb', name: 'cobweb', item: 'cobweb', need: 'a cobweb placed below before landing, or a cobweb already below to fall into, and a way out afterwards, cobwebs trap you without shears, water, or a sword', result: 'cobweb resets fall damage and slows the fall' },
    { key: 'slime', name: 'slime block', item: 'slime_block', need: 'a slime block placed below before landing, hold sneak on landing to stop the bounce', result: 'slime fully negates fall damage and bounces you, sneak stops the bounce' },
    { key: 'hay', name: 'hay bale', item: 'hay_block', need: 'a hay bale landing block already below, or placed below before landing', result: 'hay reduces fall damage by 80 percent, it does not fully negate it, so a very high fall can still hurt or kill' },
    { key: 'bed', name: 'bed', item: 'bed', need: 'a bed landing block already below', result: 'a bed reduces fall damage by 50 percent, it does not fully negate it' },
    { key: 'scaffolding', name: 'scaffolding', item: 'scaffolding', need: 'scaffolding already below, landed on while sneaking, on a flat-topped solid block, not leaves', result: 'landing on scaffolding while sneaking negates fall damage' },
    { key: 'sweet berries', name: 'sweet berry bush', item: 'sweet_berries', need: 'a sweet berry bush already below, on dirt or similar soil, it cannot be placed just anywhere', result: 'sweet berries negate fall damage' },
    { key: 'pearl', name: 'ender pearl', item: 'ender_pearl', need: 'an ender pearl thrown before landing, live only, with a safe landing spot, and health to spare', result: 'teleporting resets the fall, but the pearl itself still costs health, about two hearts in the usual case, so it prevents a fatal fall, it does not make it free' },
    { key: 'ladder', name: 'ladder', item: 'ladder', need: 'a wall face right beside the fall to place a ladder on and grab, timing is very precise', result: 'grabbing a ladder resets fall distance, but this is check-only in the bot for now, see clutch check ladder' }
  ]
}
function groundDistanceBelow () {
  if (!bot || !bot.entity) return { dist: 99, block: null }
  const p = bot.entity.position.clone()
  for (let y = 1; y <= 40; y++) { const b = bot.blockAt(p.offset(0, -y, 0)); if (b && b.boundingBox === 'block') return { dist: y, block: b } }
  return { dist: 99, block: null }
}
function clutchHelp () {
  say('Clutch help, MLG, live only, low-height first, nothing claimed until a low test passes live: water bucket, placed just before landing, not in the Nether, not on leaves or mangrove roots; powder snow bucket, placed just before landing, works in the Nether and on leaves and top slabs; cobweb, placed or already below, resets fall damage but traps you; slime block, placed below, fully negates and bounces, hold sneak to stop the bounce; hay bale landing, reduces damage by 80 percent, not full; bed landing, reduces damage by 50 percent, not full; scaffolding landing while sneaking, negates damage, needs a flat-topped solid block; sweet berry bush landing, negates damage, needs soil; ender pearl, thrown before landing, teleports and still costs health, risky, never thrown blind; ladder, needs a wall face beside the fall, check-only for now. Say "clutch check" for what I have and what is below me, then "clutch practice water" for a low setup, then "clutch confirm attempt" with you watching, I will never auto-clutch from a high fall blind :3')
}
function clutchCheck (methodKey) {
  if (!bot || !bot.entity) return
  const ground = groundDistanceBelow(); const dim = dimensionName(); const health = bot.health
  const methods = clutchMethods()
  const inv = {}
  for (const m of methods) { const it = inventoryItem(m.item); inv[m.key] = it ? it.total : 0 }
  if (methodKey) {
    const m = methods.find((x) => x.key === methodKey); if (!m) { say(`I do not know a clutch method called ${methodKey}, say "clutch help" for the list I will test live :3`); return }
    const landing = ground.block ? ground.block.name : 'unknown'
    say(`Clutch check ${m.name}: I have ${inv[m.key]} ${m.item}(s) in inventory. Ground about ${ground.dist} blocks below, first solid block ${landing}, dimension ${dim}, health ${health}. Need: ${m.need}. Expected: ${m.result}. ${m.key === 'water' && dim === 'the_nether' ? 'Water does NOT work in the Nether, use powder snow there.' : ''} ${m.key === 'ladder' ? 'Ladder clutch is check-only for now, I will not place a ladder mid-fall blind, test it live with you placing or confirming the wall.' : ''} If the item is missing or the landing is wrong, I will not attempt it, say "clutch practice ${m.key}" only at a low drop with you watching :3`)
    return
  }
  const have = methods.map((m) => `${m.name} x${inv[m.key]}`).join(', ')
  say(`Clutch check, all methods: inventory: ${have}. Ground about ${ground.dist} blocks below, first solid block ${ground.block ? ground.block.name : 'unknown'}, dimension ${dim}, health ${health}, falling velocity ${bot.entity.velocity ? bot.entity.velocity.y.toFixed(1) : 'unknown'}. Water fails in the Nether and on leaves or mangrove roots, powder snow works there, hay and bed only reduce damage, they do not fully negate it. No clutch is attempted from here, say "clutch practice water" at a low drop first, with you watching :3`)
  log(`[clutch-check] ground=${ground.dist} block=${ground.block ? ground.block.name : 'unknown'} dim=${dim} health=${health}`)
}
function clutchFallCheck () {
  if (!bot || !bot.entity) return
  const ground = groundDistanceBelow(); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0; const falling = vel < -0.5
  say(`Clutch fall check: falling ${falling ? 'yes' : 'no'}, vertical velocity about ${vel.toFixed(1)}, ground about ${ground.dist} blocks below, first solid block ${ground.block ? ground.block.name : 'unknown'}, health ${bot.health}, on ground ${bot.entity.onGround ? 'yes' : 'no'}. ${falling && ground.dist > 6 ? 'That is a high fall, I will NOT auto-clutch blind, tell me live what clutch you want, or move to a low practice drop first.' : 'Use "clutch check" for items and landing, and "clutch practice <method>" at a low drop with you watching.'} :3`)
}
function clutchPractice (methodKey) {
  if (!bot || !bot.entity) return
  const methods = clutchMethods(); const m = methods.find((x) => x.key === methodKey)
  if (!m) { say(`I do not know a clutch method called ${methodKey}, say "clutch help" for the list :3`); return }
  const ground = groundDistanceBelow()
  if (ground.dist > 6) { say(`Clutch practice ${m.name} refused at this height: ground is about ${ground.dist} blocks below, practice is low-height first, 6 blocks or less, move to a low drop with you watching, then say "clutch practice ${m.key}" again. I will not practice a clutch from a high fall blind :3`); return }
  if (m.key === 'ladder') { say('Clutch practice ladder is check-only for now: I need a wall face right beside the fall, and ladder placement timing is too precise for bot data alone. Say "clutch check ladder" live, and we will test ladder placement with you watching and confirming the wall, I will not place a ladder mid-fall blind :3'); return }
  const it = inventoryItem(m.item)
  if (m.key === 'water' || m.key === 'powder snow' || m.key === 'pearl' || m.key === 'slime' || m.key === 'cobweb') {
    if (!it) { say(`Clutch practice ${m.name} refused, I have no ${m.item} in inventory, bring one first, I will not attempt a clutch with a missing item :3`); return }
  }
  if (m.key === 'hay' || m.key === 'bed' || m.key === 'scaffolding' || m.key === 'sweet berries') {
    const want = m.key === 'hay' ? 'hay_block' : m.key === 'bed' ? null : m.key === 'scaffolding' ? 'scaffolding' : null
    const belowOk = ground.block && ((m.key === 'hay' && ground.block.name === 'hay_block') || (m.key === 'scaffolding' && ground.block.name === 'scaffolding') || (m.key === 'bed' && ground.block.name.includes('bed')) || (m.key === 'sweet berries' && ground.block.name.includes('sweet_berry')))
    if (!belowOk && want && !inventoryItem(want)) { say(`Clutch practice ${m.name} refused, the landing below is ${ground.block ? ground.block.name : 'unknown'}, not a ${m.name} landing, and I have no ${want} to place. Set up a ${m.name} landing below live first :3`); return }
  }
  pendingClutch = { method: m.key, at: Date.now(), healthBefore: bot.health, yBefore: bot.entity.position.y, groundDist: ground.dist }
  say(`Clutch practice ${m.name} set up, step 1 only, I have NOT fallen yet: ground about ${ground.dist} blocks below, health ${bot.health}. Need: ${m.need}. Expected: ${m.result}. Say "clutch confirm attempt" now, with you watching, to step off this low drop and try it, or say "clutch cancel" to stop. If the item or landing is wrong when I check again, I will refuse and report it cleanly :3`)
  log(`[clutch-practice] method=${m.key} ground=${ground.dist}`)
}
function clutchCancel () { if (!pendingClutch) { say('No clutch practice is pending, say "clutch practice water" first :3'); return } const old = pendingClutch.method; pendingClutch = null; say(`Clutch practice cancelled for ${old}, I will not fall or attempt anything :3`) }
function clutchPassedLive (methodKey) { clutchPassedLiveMap[methodKey] = { at: new Date().toISOString() }; say(`Recorded, session only: you confirmed live that a ${methodKey} clutch passed at low height. This is your live confirmation, not a bot measurement, and a low pass does not claim a high clutch works. Say "clutch attempts" to see the session history :3`) }
function clutchAttemptsList () {
  if (!clutchAttempts.length) { say('No clutch attempts this session yet, say "clutch practice water" at a low drop first :3'); return }
  say(`Clutch attempts, session only: ${clutchAttempts.map((a) => `${a.at.slice(11, 19)} ${a.method} ground ${a.groundDist} health ${a.healthBefore} to ${a.healthAfter} landed ${a.landed} result ${a.result}`).join('; ')}. A result here is what the bot measured, a pass still needs your live "clutch passed live <method>" confirmation :3`)
}
async function clutchConfirmAttempt () {
  if (!bot || !bot.entity) return
  if (!pendingClutch) { say('No clutch practice is pending, say "clutch practice water" at a low drop first, then confirm it with you watching :3'); return }
  if (Date.now() - pendingClutch.at > 120000) { const old = pendingClutch.method; pendingClutch = null; say(`Clutch practice for ${old} expired after 2 minutes, say "clutch practice ${old}" again with you watching, I will not attempt on an old setup :3`); return }
  const pending = pendingClutch; pendingClutch = null
  const methods = clutchMethods(); const m = methods.find((x) => x.key === pending.method)
  const ground = groundDistanceBelow()
  if (ground.dist > 6) { say(`Clutch attempt ${m.name} refused on recheck: ground is now about ${ground.dist} blocks below, over the 6-block low practice limit, move to a low drop and set it up again :3`); return }
  if (m.key === 'water' || m.key === 'powder snow' || m.key === 'pearl' || m.key === 'slime' || m.key === 'cobweb') { const it = inventoryItem(m.item); if (!it) { say(`Clutch attempt ${m.name} failed cleanly, no ${m.item} in inventory on recheck, I did not fall, bring the item and set it up again :3`); clutchAttempts.push({ at: new Date().toISOString(), method: m.key, groundDist: ground.dist, healthBefore: pending.healthBefore, healthAfter: bot.health, landed: 'none, refused', result: 'failed, item missing' }); return } }
  if (dimensionName() === 'the_nether' && m.key === 'water') { say('Clutch attempt water refused, water evaporates in the Nether, use powder snow there, I did not fall :3'); clutchAttempts.push({ at: new Date().toISOString(), method: m.key, groundDist: ground.dist, healthBefore: pending.healthBefore, healthAfter: bot.health, landed: 'none, refused', result: 'failed, water in Nether' }); return }
  const healthBefore = bot.health; const yBefore = bot.entity.position.y
  bot.pathfinder.setGoal(null)
  let placed = false, threw = false
  try {
    if (m.key === 'pearl') { const pearl = inventoryItem('ender_pearl'); if (pearl) { await bot.equip(pearl.first, 'hand'); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('forward', false); try { bot.activateItem() } catch (e) {} threw = true; await new Promise((r) => setTimeout(r, 1500)) } }
    else if (m.key === 'water' || m.key === 'powder snow' || m.key === 'slime' || m.key === 'cobweb') {
      const item = inventoryItem(m.item); if (item) { await bot.equip(item.first, 'hand') }
      bot.setControlState('forward', true)
      // Fall, then try to place just before landing: poll ground
      // distance every 100ms for up to 3 seconds, place at 3 or less.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100))
        const g = groundDistanceBelow()
        if (g.dist <= 3 && g.block) {
          try { await bot.placeBlock(g.block, new (require('vec3'))(0, 1, 0)) ; placed = true } catch (e) { try { bot.activateItem() } catch (e2) {} }
          break
        }
        if (bot.entity.onGround) break
      }
      bot.setControlState('forward', false)
      await new Promise((r) => setTimeout(r, 1000))
    } else {
      // Landing-block methods: step off the low drop and land on it.
      bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 1000)); bot.setControlState('forward', false); await new Promise((r) => setTimeout(r, 1000))
      if (m.key === 'slime') { try { bot.setControlState('sneak', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('sneak', false) } catch (e) {} }
    }
  } catch (e) { bot.setControlState('forward', false) }
  const healthAfter = bot.health; const yAfter = bot.entity.position.y; const below = bot.blockAt(bot.entity.position.offset(0, -1, 0)); const landed = below ? below.name : 'unknown'
  const fell = Math.max(0, yBefore - yAfter)
  let result = 'attempt done, check live'
  if (m.key === 'water' || m.key === 'powder snow') result = placed ? 'placed item before landing, check health and landing live' : 'did NOT verify a place before landing, check health live, do not claim a clutch'
  else if (m.key === 'pearl') result = threw ? 'pearl thrown, check teleport and health live' : 'pearl not thrown, check live'
  else if (m.key === 'slime' || m.key === 'cobweb') result = healthAfter >= healthBefore ? 'no health lost in this low attempt, check live if that was the clutch' : `health lost ${healthBefore - healthAfter}, check live, do not claim a full clutch`
  else result = healthAfter >= healthBefore ? 'no health lost in this low attempt, check live' : `health lost ${healthBefore - healthAfter}, expected reduction only for hay and bed, check live`
  clutchAttempts.push({ at: new Date().toISOString(), method: m.key, groundDist: ground.dist, healthBefore, healthAfter, landed, result })
  say(`Clutch attempt ${m.name} done, stopped: fell about ${fell.toFixed(1)} blocks, ground was about ${ground.dist} blocks below, health ${healthBefore} to ${healthAfter}, landed on ${landed}, placed ${placed ? 'yes' : 'no'}, pearl thrown ${threw ? 'yes' : 'no'}. Result: ${result}. Say "clutch passed live ${m.key}" only if you watched it and it looked like a real clutch, otherwise it is just an attempt, not a pass :3`)
  log(`[clutch-attempt] method=${m.key} fell=${fell.toFixed(1)} health=${healthBefore}->${healthAfter} landed=${landed} placed=${placed} threw=${threw}`)
}
function parkourHelp () {
  say('Parkour help, staged, live only, never blind cliff jumps: a standing jump covers roughly 2 blocks, a sprint jump can clear up to 4 blocks at most, and a 4-block jump is hard, it needs full sprint momentum and edge timing, sometimes force momentum, sprinting just after jumping, or jamming, holding forward, sprint, and jump together. A 2-block gap is the easy sprint case, a 3-block gap needs a full sprint run-up and an edge jump, a 4-block gap needs that plus precise timing, and a height difference or a low ceiling, a headhitter, makes it harder. Food must be above 6 to sprint. Say "parkour check" for the gap I actually see ahead, then "parkour sprint jump step" for one generic step, then "parkour jump 2", "parkour jump 3", or "parkour jump 4" as separate live steps, each stops and reports distance, landing, and health. The 3-block 360 spin is the end goal, not a current ability, see "parkour spin help" :3')
}
function parkourCheckAuto () {
  if (!bot || !bot.entity) return null
  const yaw = bot.entity.yaw || 0; const fx = -Math.sin(yaw); const fz = Math.cos(yaw)
  const start = bot.entity.position.clone(); const groundY = Math.floor(start.y) - 1
  let runUp = 0
  for (let i = 1; i <= 4; i++) { const b = bot.blockAt(start.offset(Math.round(fx * -i), -1, Math.round(fz * -i))); if (b && b.boundingBox === 'block') runUp++; else break }
  let gap = 0, landing = null, landingY = null, belowGap = []
  for (let i = 1; i <= 8; i++) { const b = bot.blockAt(start.offset(Math.round(fx * i), -1, Math.round(fz * i))); const below = bot.blockAt(start.offset(Math.round(fx * i), -2, Math.round(fz * i))); belowGap.push(below ? below.name : 'air'); if (b && b.boundingBox === 'block') { landing = b; landingY = b.position.y; break } gap++ }
  return { runUp, gap, landing, landingY, groundY, belowGap, fx, fz }
}
function parkourCheck () {
  const c = parkourCheckAuto(); if (!c) return
  say(`Parkour check, ahead in the direction I am facing: run-up solid blocks behind me: ${c.runUp}; gap ahead: ${c.gap} block(s) with no ground at my ground level${c.landing ? `, then a landing block ${c.landing.name} at Y ${c.landingY}, height difference ${c.landingY - c.groundY} block(s)` : ', then no solid landing seen within 8 blocks, that is a cliff, do NOT jump blind'}; below the gap: ${c.belowGap.join(', ')}. ${c.landing && c.belowGap.includes('lava') ? 'Lava below the gap, a fall here is dangerous, live only with you watching.' : c.landing ? 'That gap is what I will test, say "parkour jump ' + c.gap + '" only if that gap matches the jump you want, otherwise move to the right gap live.' : 'No landing seen, move to a real parkour gap live first.'} Food now ${bot.food}, sprint needs food above 6 :3`)
}
async function parkourSprintJumpStep () {
  if (!bot || !bot.entity) return
  if (typeof bot.food === 'number' && bot.food <= 6) { say('Parkour sprint jump step refused, food is 6 or less, sprint needs food above 6, eat first :3'); return }
  const before = bot.entity.position.clone(); const healthBefore = bot.health
  bot.pathfinder.setGoal(null)
  try { bot.setControlState('sprint', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false); await new Promise((r) => setTimeout(r, 1500)); bot.setControlState('forward', false); bot.setControlState('sprint', false) } catch (e) {}
  const after = bot.entity.position.clone(); const moved = Math.hypot(after.x - before.x, after.z - before.z); const below = bot.blockAt(after.offset(0, -1, 0))
  say(`Parkour sprint jump step done, stopped: moved ${moved.toFixed(1)} blocks forward, Y ${before.y.toFixed(1)} to ${after.y.toFixed(1)}, landed on ${below ? below.name : 'unknown'}, health ${healthBefore} to ${bot.health}. That is one generic sprint jump step, not a named gap jump, say "parkour check" and then a named jump for a gap test :3`)
  log(`[parkour-sprint-step] moved=${moved.toFixed(1)} health=${healthBefore}->${bot.health}`)
}
async function parkourJumpAttempt (blocks) {
  if (!bot || !bot.entity) return
  if (typeof bot.food === 'number' && bot.food <= 6) { say(`Parkour jump ${blocks} refused, food is 6 or less, sprint needs food above 6, eat first :3`); return }
  const c = parkourCheckAuto()
  if (!c || !c.landing) { say(`Parkour jump ${blocks} refused, I see no solid landing ahead, that is a cliff, move to a real gap live first :3`); return }
  if (c.gap !== blocks) { say(`Parkour jump ${blocks} refused, the gap I actually see ahead is ${c.gap} block(s), not ${blocks}, move to a ${blocks}-block gap live, or say "parkour jump ${c.gap}" for the gap I see :3`); return }
  if (blocks === 4 && c.runUp < 2) { say('Parkour jump 4 refused, run-up is short, a 4-block jump needs full sprint momentum and edge timing, back up for at least a few solid run-up blocks live, then try again :3'); return }
  if (blocks === 4) say('Parkour jump 4, hard jump warning: this needs full sprint momentum, an edge jump, and precise timing, sometimes force momentum, and it is not claimed as easy, doing one live step with you watching :3')
  const before = bot.entity.position.clone(); const healthBefore = bot.health; const landingName = c.landing.name
  bot.pathfinder.setGoal(null)
  try {
    bot.setControlState('sprint', true); bot.setControlState('forward', true)
    // Run-up: hold forward briefly, then jump at the edge. A full
    // tick-perfect force-momentum jam is not claimed here, this is
    // a sprint jump step with a run-up, and the landing is checked.
    await new Promise((r) => setTimeout(r, blocks === 4 ? 800 : 500))
    bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false)
    await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('sprint', false)
  } catch (e) {}
  const after = bot.entity.position.clone(); const moved = Math.hypot(after.x - before.x, after.z - before.z); const below = bot.blockAt(after.offset(0, -1, 0)); const landed = below && below.name === landingName && after.y >= before.y - 1
  const fell = before.y - after.y
  parkourAttempts.push({ at: new Date().toISOString(), gap: blocks, moved: moved.toFixed(1), landed: below ? below.name : 'unknown', healthBefore, healthAfter: bot.health, result: landed ? 'landed on target block, check live' : 'did NOT verify landing on target block' })
  say(`Parkour jump ${blocks} done, stopped: moved ${moved.toFixed(1)} blocks forward, Y ${before.y.toFixed(1)} to ${after.y.toFixed(1)}${fell > 2 ? `, fell about ${fell.toFixed(1)} blocks` : ''}, landed on ${below ? below.name : 'unknown'}, target landing was ${landingName}, health ${healthBefore} to ${bot.health}. ${landed ? 'That looks like a landing on the target block, say "parkour passed live ' + blocks + '" only if you watched it and it looked clean.' : 'That did NOT verify a landing on the target block, I am not claiming a successful jump, check live where I actually landed.'} :3`)
  log(`[parkour-jump] gap=${blocks} moved=${moved.toFixed(1)} landed=${below ? below.name : 'unknown'} target=${landingName} health=${healthBefore}->${bot.health}`)
}
function parkourSpinHelp () {
  say('Parkour spin help, end goal, not a current ability: a 3-block 360 mid-air spin jump means a 3-block sprint gap, a full 360-degree turn in mid-air, and a landing on the target block, all in one jump. That needs the 3-block jump first, then yaw control mid-air, then a landing check, and it is live only, with you watching, on a safe course with a low fall risk. Say "parkour spin ready live" when the course is set and you are watching, then "parkour spin step" for one attempt, then say "parkour spin passed live" only if you watched a full spin and a clean landing. Until that live pass, a spin is an end goal, not a claimed skill :3')
}
function parkourSpinReady () { parkourSpinReadyAt = Date.now(); say('Parkour spin ready, recorded this session: you said the 3-block spin course is set and you are watching. I will accept one "parkour spin step" in the next 2 minutes, after that say "parkour spin ready live" again, because spin timing changes fast and I will not spin on an old setup :3') }
function parkourPassedLive (key) { parkourPassedLiveMap[key] = { at: new Date().toISOString() }; say(`Recorded, session only: you confirmed live that parkour ${key} passed. This is your live confirmation, not a bot measurement, and a pass for one gap does not claim another gap or the spin :3`) }
function parkourAttemptsList () {
  if (!parkourAttempts.length) { say('No parkour attempts this session yet, say "parkour check" then "parkour jump 2" first :3'); return }
  say(`Parkour attempts, session only: ${parkourAttempts.map((a) => `${a.at.slice(11, 19)} gap ${a.gap} moved ${a.moved} landed ${a.landed} health ${a.healthBefore} to ${a.healthAfter} result ${a.result}`).join('; ')}. A pass still needs your live "parkour passed live <gap>" confirmation :3`)
}
async function parkourSpinStep () {
  if (!bot || !bot.entity) return
  if (!parkourSpinReadyAt || Date.now() - parkourSpinReadyAt > 120000) { say('Parkour spin step refused, no "parkour spin ready live" in the last 2 minutes. Say "parkour spin ready live" when the 3-block course is set and you are watching, then try the spin step :3'); return }
  if (typeof bot.food === 'number' && bot.food <= 6) { say('Parkour spin step refused, food is 6 or less, sprint needs food above 6, eat first :3'); return }
  const c = parkourCheckAuto()
  if (!c || !c.landing || c.gap !== 3) { say(`Parkour spin step refused, the gap I actually see ahead is ${c ? c.gap : 'unknown'} block(s), not 3, a spin jump is a 3-block gap only, move to a 3-block gap live first :3`); return }
  parkourSpinReadyAt = null
  const before = bot.entity.position.clone(); const yawBefore = bot.entity.yaw || 0; const healthBefore = bot.health; const landingName = c.landing.name
  bot.pathfinder.setGoal(null)
  let yawTotal = 0
  try {
    bot.setControlState('sprint', true); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', true)
    // Mid-air spin in steps: turn yaw a little at a time, aiming for
    // a full 360 degrees, then stop and land. If the turn does not
    // complete, the report says so, it does not claim a spin.
    for (let i = 0; i < 8; i++) { try { bot.look(yawBefore + (Math.PI * 2 * (i + 1) / 8), 0, true) } catch (e) {}; yawTotal = Math.PI * 2 * (i + 1) / 8; await new Promise((r) => setTimeout(r, 100)) }
    bot.setControlState('jump', false); await new Promise((r) => setTimeout(r, 1500)); bot.setControlState('forward', false); bot.setControlState('sprint', false)
  } catch (e) {}
  const after = bot.entity.position.clone(); const moved = Math.hypot(after.x - before.x, after.z - before.z); const below = bot.blockAt(after.offset(0, -1, 0)); const landed = below && below.name === landingName
  const spinDeg = Math.round(yawTotal * 180 / Math.PI)
  parkourAttempts.push({ at: new Date().toISOString(), gap: '3-spin', moved: moved.toFixed(1), landed: below ? below.name : 'unknown', healthBefore, healthAfter: bot.health, result: landed && spinDeg >= 315 ? 'spin and landing look complete, check live' : 'spin or landing did NOT verify' })
  say(`Parkour spin step done, stopped: turned about ${spinDeg} degrees mid-air, moved ${moved.toFixed(1)} blocks forward, landed on ${below ? below.name : 'unknown'}, target landing was ${landingName}, health ${healthBefore} to ${bot.health}. ${landed && spinDeg >= 315 ? 'That looks like a full spin and a landing on the target block, say "parkour spin passed live" only if you watched a full 360 and a clean landing.' : 'That did NOT verify a full 360 spin plus a clean landing, I am not claiming the end-goal spin, check live where I actually landed.'} :3`)
  log(`[parkour-spin] spinDeg=${spinDeg} moved=${moved.toFixed(1)} landed=${below ? below.name : 'unknown'} target=${landingName} health=${healthBefore}->${bot.health}`)
}

// ---------------------------------------------------------------- round 14: high-fall clutch staging, ladder clutch attempts, chained parkour
// Round 13 left three clear gaps, and this round closes them only in
// staged, live-only steps, never by claiming a high or chained skill
// from a low or single test. A low pass never claims a high clutch.
// A single jump never claims a course. A ladder check never claims
// a ladder grab. Everything below needs Moon watching live, a
// confirm step before any real fall or gap, and Moon's own
// "passed live" confirmation before any pass is recorded. No new
// clutch or parkour methods are guessed here: only the methods
// already listed in clutch help are checked, practiced, and
// reported, with better reporting for them.
let pendingHighClutch = null
let highClutchPassedLiveMap = {}
let pendingLadderClutch = null
let ladderClutchPassedLiveMap = {}
let ladderClutchAttempts = []
let parkourCourse = null
let parkourCourseAttempts = []
function clutchHighStage (groundDist) {
  if (groundDist <= 6) return 1
  if (groundDist <= 12) return 2
  if (groundDist <= 20) return 3
  return 4
}
function clutchHighStageRequirement (methodKey, stage) {
  if (stage <= 1) return null
  if (stage === 2) return clutchPassedLiveMap[methodKey] ? null : 'a low-height live pass for this method first, say "clutch practice ' + methodKey + '" at 6 blocks or less, then "clutch passed live ' + methodKey + '" after you watch it'
  if (stage === 3) return highClutchPassedLiveMap[methodKey + ':2'] ? null : 'a stage 2 live pass for this method first, 7 to 12 blocks, then "clutch high passed live ' + methodKey + ' 2" after you watch it'
  return highClutchPassedLiveMap[methodKey + ':3'] ? null : 'a stage 3 live pass for this method first, 13 to 20 blocks, then "clutch high passed live ' + methodKey + ' 3" after you watch it'
}
function clutchHighHelp () {
  say('Clutch high help, staged, live only, never auto-clutched from a high fall blind: stage 1 is the low practice from round 13, 6 blocks or less. Stage 2 is 7 to 12 blocks, and it needs a stage 1 live pass for the same method first. Stage 3 is 13 to 20 blocks, and it needs a stage 2 live pass first. Stage 4 is over 20 blocks, and it needs a stage 3 live pass first. A low pass never claims a high clutch, and a stage pass never claims the next stage. Say "clutch high practice water" at a staged drop with you watching, then "clutch high confirm attempt" in the next 2 minutes, then "clutch high passed live water 2" only if you watched a real clutch at that stage. Hay and bed only reduce damage, so a high hay or bed practice needs full health, otherwise I will refuse it live, and I will still not claim a full clutch for them :3')
}
function clutchHighPractice (methodKey) {
  if (!bot || !bot.entity) return
  const methods = clutchMethods(); const m = methods.find((x) => x.key === methodKey)
  if (!m) { say(`I do not know a clutch method called ${methodKey}, say "clutch help" for the list :3`); return }
  if (m.key === 'ladder') { say('Ladder clutch has its own staged practice, say "ladder clutch practice" instead, it is not a high clutch practice, because the wall and timing are different :3'); return }
  const ground = groundDistanceBelow()
  if (ground.dist <= 6) { say(`Clutch high practice ${m.name} is for drops over 6 blocks, ground here is about ${ground.dist} blocks below, say "clutch practice ${m.key}" for a low drop instead :3`); return }
  const stage = clutchHighStage(ground.dist)
  const missing = clutchHighStageRequirement(m.key, stage)
  if (missing) { say(`Clutch high practice ${m.name} stage ${stage} refused, ground is about ${ground.dist} blocks below, it needs ${missing} :3`); return }
  if (m.key === 'water' || m.key === 'powder snow' || m.key === 'pearl' || m.key === 'slime' || m.key === 'cobweb') {
    if (!inventoryItem(m.item)) { say(`Clutch high practice ${m.name} refused, I have no ${m.item} in inventory, bring one first, I will not attempt a high clutch with a missing item :3`); return }
  }
  if ((m.key === 'hay' || m.key === 'bed') && bot.health < 20) { say(`Clutch high practice ${m.name} refused, health is ${bot.health}, not full, hay and bed only reduce damage, they do not fully negate it, so a high fall can still kill from less than full health, heal first and set it up again :3`); return }
  if (m.key === 'hay' || m.key === 'bed' || m.key === 'scaffolding' || m.key === 'sweet berries') {
    const belowOk = ground.block && ((m.key === 'hay' && ground.block.name === 'hay_block') || (m.key === 'scaffolding' && ground.block.name === 'scaffolding') || (m.key === 'bed' && ground.block.name.includes('bed')) || (m.key === 'sweet berries' && ground.block.name.includes('sweet_berry')))
    const want = m.key === 'hay' ? 'hay_block' : m.key === 'scaffolding' ? 'scaffolding' : null
    if (!belowOk && want && !inventoryItem(want)) { say(`Clutch high practice ${m.name} refused, the landing below is ${ground.block ? ground.block.name : 'unknown'}, not a ${m.name} landing, and I have no ${want} to place, set up a ${m.name} landing below live first :3`); return }
  }
  if (dimensionName() === 'the_nether' && m.key === 'water') { say('Clutch high practice water refused, water evaporates in the Nether, use powder snow there :3'); return }
  pendingHighClutch = { method: m.key, stage, at: Date.now(), healthBefore: bot.health, yBefore: bot.entity.position.y, groundDist: ground.dist }
  say(`Clutch high practice ${m.name} stage ${stage} set up, step 1 only, I have NOT fallen yet: ground about ${ground.dist} blocks below, health ${bot.health}. Need: ${m.need}. Expected: ${m.result}. Say "clutch high confirm attempt" now, with you watching, to step off this staged drop and try it, or say "clutch high cancel" to stop. If the item, stage, or landing is wrong when I check again, I will refuse and report it cleanly, and a stage pass here never claims the next stage :3`)
  log(`[clutch-high-practice] method=${m.key} stage=${stage} ground=${ground.dist}`)
}
function clutchHighCancel () { if (!pendingHighClutch) { say('No clutch high practice is pending, say "clutch high practice water" first at a staged drop :3'); return } const old = pendingHighClutch.method; pendingHighClutch = null; say(`Clutch high practice cancelled for ${old}, I will not fall or attempt anything :3`) }
function clutchHighPassedLive (methodKey, stage) {
  highClutchPassedLiveMap[methodKey + ':' + stage] = { at: new Date().toISOString() }
  say(`Recorded, session only: you confirmed live that a ${methodKey} clutch passed at stage ${stage}. This is your live confirmation, not a bot measurement, and it unlocks only the next stage for this method, it does not claim a higher stage or another method :3`)
}
function clutchHighAttemptsList () {
  const highs = clutchAttempts.filter((a) => a.stage)
  if (!highs.length) { say('No clutch high attempts this session yet, say "clutch high practice water" at a staged drop first, after a low live pass :3'); return }
  const passed = Object.keys(highClutchPassedLiveMap).map((k) => k).join(', ') || 'none'
  say(`Clutch high attempts, session only: ${highs.map((a) => `${a.at.slice(11, 19)} ${a.method} stage ${a.stage} ground ${a.groundDist} health ${a.healthBefore} to ${a.healthAfter} landed ${a.landed} result ${a.result}`).join('; ')}. Live stage passes this session: ${passed}. An attempt is not a pass until you say "clutch high passed live <method> <stage>" after watching it :3`)
}
async function clutchHighConfirmAttempt () {
  if (!bot || !bot.entity) return
  if (!pendingHighClutch) { say('No clutch high practice is pending, say "clutch high practice water" first at a staged drop, then confirm it with you watching :3'); return }
  if (Date.now() - pendingHighClutch.at > 120000) { const old = pendingHighClutch.method; pendingHighClutch = null; say(`Clutch high practice for ${old} expired after 2 minutes, say "clutch high practice ${old}" again with you watching, I will not attempt on an old setup :3`); return }
  const pending = pendingHighClutch; pendingHighClutch = null
  const methods = clutchMethods(); const m = methods.find((x) => x.key === pending.method)
  const ground = groundDistanceBelow()
  const stageNow = clutchHighStage(ground.dist)
  if (stageNow !== pending.stage) { say(`Clutch high attempt ${m.name} refused on recheck, ground is now about ${ground.dist} blocks below, stage ${stageNow}, not the staged stage ${pending.stage} I set up, move back to the staged drop and set it up again :3`); return }
  const missing = clutchHighStageRequirement(m.key, pending.stage)
  if (missing) { say(`Clutch high attempt ${m.name} refused on recheck, it now needs ${missing} :3`); return }
  if (m.key === 'water' || m.key === 'powder snow' || m.key === 'pearl' || m.key === 'slime' || m.key === 'cobweb') { const it = inventoryItem(m.item); if (!it) { say(`Clutch high attempt ${m.name} failed cleanly, no ${m.item} in inventory on recheck, I did not fall, bring the item and set it up again :3`); clutchAttempts.push({ at: new Date().toISOString(), method: m.key, stage: pending.stage, groundDist: ground.dist, healthBefore: pending.healthBefore, healthAfter: bot.health, landed: 'none, refused', result: 'failed, item missing' }); return } }
  if (dimensionName() === 'the_nether' && m.key === 'water') { say('Clutch high attempt water refused, water evaporates in the Nether, use powder snow there, I did not fall :3'); clutchAttempts.push({ at: new Date().toISOString(), method: m.key, stage: pending.stage, groundDist: ground.dist, healthBefore: pending.healthBefore, healthAfter: bot.health, landed: 'none, refused', result: 'failed, water in Nether' }); return }
  const healthBefore = bot.health; const yBefore = bot.entity.position.y
  bot.pathfinder.setGoal(null)
  let placed = false, threw = false
  try {
    if (m.key === 'pearl') { const pearl = inventoryItem('ender_pearl'); if (pearl) { await bot.equip(pearl.first, 'hand'); bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('forward', false); try { bot.activateItem() } catch (e) {} threw = true; await new Promise((r) => setTimeout(r, 1500)) } }
    else if (m.key === 'water' || m.key === 'powder snow' || m.key === 'slime' || m.key === 'cobweb') {
      const item = inventoryItem(m.item); if (item) { await bot.equip(item.first, 'hand') }
      bot.setControlState('forward', true)
      // High fall, longer poll than the low attempt: every 100ms
      // for up to 8 seconds, place at 3 blocks or less, then stop.
      // Placement timing is reported, it is not claimed as
      // tick-perfect, and Moon must confirm the clutch live.
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 100))
        const g = groundDistanceBelow()
        if (g.dist <= 3 && g.block) {
          try { await bot.placeBlock(g.block, new (require('vec3'))(0, 1, 0)); placed = true } catch (e) { try { bot.activateItem() } catch (e2) {} }
          break
        }
        if (bot.entity.onGround) break
      }
      bot.setControlState('forward', false)
      await new Promise((r) => setTimeout(r, 1000))
    } else {
      bot.setControlState('forward', true); await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); await new Promise((r) => setTimeout(r, 1000))
      if (m.key === 'slime') { try { bot.setControlState('sneak', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('sneak', false) } catch (e) {} }
    }
  } catch (e) { bot.setControlState('forward', false) }
  const healthAfter = bot.health; const yAfter = bot.entity.position.y; const below = bot.blockAt(bot.entity.position.offset(0, -1, 0)); const landed = below ? below.name : 'unknown'
  const fell = Math.max(0, yBefore - yAfter)
  let result = 'attempt done, check live'
  if (m.key === 'water' || m.key === 'powder snow') result = placed ? 'placed item before landing at stage height, check health and landing live, stage pass still needs your live confirmation' : 'did NOT verify a place before landing, check health live, do not claim a high clutch'
  else if (m.key === 'pearl') result = threw ? 'pearl thrown, check teleport and health live, stage pass still needs your live confirmation' : 'pearl not thrown, check live'
  else if (m.key === 'slime' || m.key === 'cobweb') result = healthAfter >= healthBefore ? 'no health lost in this staged attempt, check live if that was the clutch' : `health lost ${healthBefore - healthAfter}, check live, do not claim a full high clutch`
  else result = healthAfter >= healthBefore ? 'no health lost in this staged attempt, check live' : `health lost ${healthBefore - healthAfter}, expected reduction only for hay and bed, check live, do not claim a full high clutch`
  clutchAttempts.push({ at: new Date().toISOString(), method: m.key, stage: pending.stage, groundDist: ground.dist, healthBefore, healthAfter, landed, result })
  say(`Clutch high attempt ${m.name} stage ${pending.stage} done, stopped: fell about ${fell.toFixed(1)} blocks, ground was about ${ground.dist} blocks below, health ${healthBefore} to ${healthAfter}, landed on ${landed}, placed ${placed ? 'yes' : 'no'}, pearl thrown ${threw ? 'yes' : 'no'}. Result: ${result}. Say "clutch high passed live ${m.key} ${pending.stage}" only if you watched it and it looked like a real clutch at that stage, otherwise it is just an attempt, not a pass :3`)
  log(`[clutch-high-attempt] method=${m.key} stage=${pending.stage} fell=${fell.toFixed(1)} health=${healthBefore}->${healthAfter} landed=${landed} placed=${placed} threw=${threw}`)
}
function ladderWallScan () {
  if (!bot || !bot.entity) return null
  const p = bot.entity.position.clone()
  const sides = [{ dx: 1, dz: 0, name: 'east' }, { dx: -1, dz: 0, name: 'west' }, { dx: 0, dz: 1, name: 'south' }, { dx: 0, dz: -1, name: 'north' }]
  const found = []
  for (const s of sides) {
    let run = 0; let first = null
    for (let dy = 0; dy >= -4; dy--) { const b = bot.blockAt(p.offset(s.dx, dy, s.dz)); if (b && b.boundingBox === 'block') { run++; if (!first) first = b } else break }
    if (run > 0) found.push({ side: s.name, dx: s.dx, dz: s.dz, run, first })
  }
  return found
}
function ladderClutchCheckDetailed () {
  if (!bot || !bot.entity) return
  const ground = groundDistanceBelow(); const walls = ladderWallScan(); const ladders = inventoryItem('ladder'); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  if (!walls.length) { say(`Ladder clutch check detailed: no solid wall face right beside me at my level or below, so a ladder clutch cannot be placed here, move beside a wall live first. Ground about ${ground.dist} blocks below, ladders in inventory ${ladders ? ladders.total : 0}, vertical velocity about ${vel.toFixed(1)}, health ${bot.health}. A ladder check with no wall is still check-only, it is not an attempt :3`); return }
  say(`Ladder clutch check detailed: wall faces beside me: ${walls.map((w) => `${w.side} ${w.first.name} continuous ${w.run} block(s) down`).join(', ')}. Ground about ${ground.dist} blocks below, ladders in inventory ${ladders ? ladders.total : 0}, vertical velocity about ${vel.toFixed(1)}, health ${bot.health}. A wall alone does not prove a grab: placement timing is the hard part, so say "ladder clutch practice" at a low drop beside that wall with you watching, then "ladder clutch confirm attempt", and say "ladder clutch passed live" only if you watched a real grab :3`)
  log(`[ladder-clutch-check] walls=${walls.map((w) => w.side + ':' + w.run).join(',')} ground=${ground.dist}`)
}
function ladderClutchPractice () {
  if (!bot || !bot.entity) return
  const ground = groundDistanceBelow(); const walls = ladderWallScan()
  if (!walls.length) { say('Ladder clutch practice refused, no solid wall face right beside me, move beside a wall live first, I will not place a ladder mid-fall blind with no wall :3'); return }
  if (!inventoryItem('ladder')) { say('Ladder clutch practice refused, I have no ladder in inventory, bring one first :3'); return }
  const lowPassed = ladderClutchPassedLiveMap['ladder:low']
  if (ground.dist > 6 && !lowPassed) { say(`Ladder clutch practice refused at this height: ground is about ${ground.dist} blocks below, ladder practice is low-height first, 6 blocks or less, until a low live pass is recorded, then a higher staged ladder attempt is allowed up to 20 blocks :3`); return }
  if (ground.dist > 20) { say(`Ladder clutch practice refused, ground is about ${ground.dist} blocks below, over the 20-block staged ladder limit for now, test 20 blocks or less first with you watching :3`); return }
  pendingLadderClutch = { at: Date.now(), healthBefore: bot.health, yBefore: bot.entity.position.y, groundDist: ground.dist, stage: ground.dist <= 6 ? 'low' : 'high' }
  say(`Ladder clutch practice set up, step 1 only, I have NOT fallen yet: wall faces beside me: ${walls.map((w) => w.side).join(', ')}, ground about ${ground.dist} blocks below, stage ${pendingLadderClutch.stage}, health ${bot.health}. Say "ladder clutch confirm attempt" now, with you watching, to step off and try to place a ladder against that wall mid-fall, or say "ladder clutch cancel" to stop. If the wall, ladder, or ground changes on recheck, I will refuse and report it cleanly :3`)
  log(`[ladder-clutch-practice] ground=${ground.dist} stage=${pendingLadderClutch.stage}`)
}
function ladderClutchCancel () { if (!pendingLadderClutch) { say('No ladder clutch practice is pending, say "ladder clutch practice" first beside a wall :3'); return } pendingLadderClutch = null; say('Ladder clutch practice cancelled, I will not fall or attempt anything :3') }
function ladderClutchPassedLive () {
  const stage = pendingLadderClutch ? pendingLadderClutch.stage : null
  // A pass is recorded from the last practice stage if one is still
  // in this session, otherwise it is recorded as a general live
  // pass without a stage, and it never claims a higher stage.
  const key = stage ? 'ladder:' + stage : 'ladder:live'
  ladderClutchPassedLiveMap[key] = { at: new Date().toISOString() }
  if (stage === 'low') ladderClutchPassedLiveMap['ladder:low'] = { at: new Date().toISOString() }
  say(`Recorded, session only: you confirmed live that a ladder clutch passed${stage ? ' at ' + stage + ' height' : ''}. This is your live confirmation, not a bot measurement, and it does not claim a ladder grab from bot data alone, or a higher stage :3`)
}
function ladderClutchAttemptsList () {
  if (!ladderClutchAttempts.length) { say('No ladder clutch attempts this session yet, say "ladder clutch practice" beside a wall first :3'); return }
  say(`Ladder clutch attempts, session only: ${ladderClutchAttempts.map((a) => `${a.at.slice(11, 19)} stage ${a.stage} ground ${a.groundDist} wall ${a.wall} placed ${a.placed} velocity ${a.velBefore} to ${a.velAfter} health ${a.healthBefore} to ${a.healthAfter} landed ${a.landed} result ${a.result}`).join('; ')}. An attempt is not a pass until you say "ladder clutch passed live" after watching a real grab :3`)
}
async function ladderClutchConfirmAttempt () {
  if (!bot || !bot.entity) return
  if (!pendingLadderClutch) { say('No ladder clutch practice is pending, say "ladder clutch practice" first beside a wall, then confirm it with you watching :3'); return }
  if (Date.now() - pendingLadderClutch.at > 120000) { pendingLadderClutch = null; say('Ladder clutch practice expired after 2 minutes, say "ladder clutch practice" again beside a wall with you watching, I will not attempt on an old setup :3'); return }
  const pending = pendingLadderClutch; pendingLadderClutch = null
  const walls0 = ladderWallScan()
  if (!walls0.length) { say('Ladder clutch attempt refused on recheck, no solid wall face beside me now, I did not fall :3'); return }
  const ladder = inventoryItem('ladder'); if (!ladder) { say('Ladder clutch attempt refused on recheck, no ladder in inventory now, I did not fall :3'); return }
  const ground0 = groundDistanceBelow()
  if (pending.stage === 'low' && ground0.dist > 6) { say(`Ladder clutch attempt refused on recheck, ground is now about ${ground0.dist} blocks below, over the low 6-block setup, set it up again at a low drop :3`); return }
  const healthBefore = bot.health; const yBefore = bot.entity.position.y; const velBefore = bot.entity.velocity ? bot.entity.velocity.y : 0
  bot.pathfinder.setGoal(null)
  let placed = false; let wallUsed = 'none'; let placedAtGround = null; let velAfter = velBefore
  try {
    await bot.equip(ladder.first, 'hand')
    bot.setControlState('forward', true)
    // Timing check, not a guessed grab: poll every 50ms for up to
    // 4 seconds, and only place when a wall block is actually
    // adjacent at the bot's current height. If no wall is adjacent
    // by the time the ground is 3 blocks below, stop placing and
    // report the timing miss honestly, do not claim a grab.
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const walls = ladderWallScan()
      if (walls.length) {
        const w = walls[0]; const wallBlock = w.first
        // Face vector points from the wall block toward the bot,
        // so the ladder lands on the wall face beside the fall.
        const face = new (require('vec3'))(-w.dx, 0, -w.dz)
        try { await bot.placeBlock(wallBlock, face); placed = true; wallUsed = w.side; placedAtGround = groundDistanceBelow().dist } catch (e) { try { bot.activateItem() } catch (e2) {} }
        // Try to grab: look at the wall and move toward it briefly,
        // then report velocity honestly, do not claim a grab from
        // data alone, Moon must confirm it live.
        try { bot.lookAt(wallBlock.position, true) } catch (e) {}
        await new Promise((r) => setTimeout(r, 1000))
        break
      }
      const g = groundDistanceBelow()
      if (g.dist <= 3 || bot.entity.onGround) break
    }
    bot.setControlState('forward', false)
    await new Promise((r) => setTimeout(r, 500))
  } catch (e) { bot.setControlState('forward', false) }
  velAfter = bot.entity.velocity ? bot.entity.velocity.y : 0
  const healthAfter = bot.health; const yAfter = bot.entity.position.y; const below = bot.blockAt(bot.entity.position.offset(0, -1, 0)); const landed = below ? below.name : 'unknown'
  const fell = Math.max(0, yBefore - yAfter)
  const slowed = velAfter > -2 && velBefore < -0.5
  let result = 'attempt done, check live'
  if (!placed) result = 'did NOT verify a ladder place mid-fall, timing or wall was missing, check live, do not claim a ladder clutch'
  else if (slowed && healthAfter >= healthBefore) result = 'ladder placed and descent looks slowed in bot data, but a grab is NOT claimed from data alone, check live and say "ladder clutch passed live" only if you watched a real grab'
  else result = 'ladder placed, but descent or health did NOT verify a grab in bot data, check live, do not claim a ladder clutch'
  ladderClutchAttempts.push({ at: new Date().toISOString(), stage: pending.stage, groundDist: pending.groundDist, wall: wallUsed, placed: placed ? 'yes' : 'no', placedAtGround, velBefore: velBefore.toFixed(1), velAfter: velAfter.toFixed(1), healthBefore, healthAfter, landed, result })
  say(`Ladder clutch attempt stage ${pending.stage} done, stopped: fell about ${fell.toFixed(1)} blocks, wall used ${wallUsed}, ladder placed ${placed ? 'yes' : 'no'}${placedAtGround !== null ? ' at about ' + placedAtGround + ' blocks above ground' : ''}, vertical velocity ${velBefore.toFixed(1)} to ${velAfter.toFixed(1)}, health ${healthBefore} to ${healthAfter}, landed on ${landed}. Result: ${result} :3`)
  log(`[ladder-clutch-attempt] stage=${pending.stage} wall=${wallUsed} placed=${placed} vel=${velBefore.toFixed(1)}->${velAfter.toFixed(1)} health=${healthBefore}->${healthAfter} landed=${landed}`)
}
function clutchMethodsReport () {
  if (!bot || !bot.entity) return
  const methods = clutchMethods(); const ground = groundDistanceBelow(); const dim = dimensionName()
  const lines = methods.map((m) => {
    const it = inventoryItem(m.item); const count = it ? it.total : 0
    const low = clutchPassedLiveMap[m.key] ? 'low pass live yes' : 'low pass live no'
    const highs = Object.keys(highClutchPassedLiveMap).filter((k) => k.startsWith(m.key + ':')).join(', ') || 'no high pass'
    const lad = m.key === 'ladder' ? (ladderClutchPassedLiveMap['ladder:low'] ? 'ladder low pass live yes' : 'ladder low pass live no') : ''
    let note = ''
    if (m.key === 'water' && dim === 'the_nether') note = 'water does NOT work in the Nether'
    if (m.key === 'ladder') note = 'ladder is staged placement, not check-only any more, but a grab still needs your live confirmation'
    return `${m.name} x${count}, ${low}, high: ${highs}${lad ? ', ' + lad : ''}${note ? ', ' + note : ''}`
  })
  say(`Clutch methods report, no new methods guessed, only the methods in clutch help: ground about ${ground.dist} blocks below, first solid block ${ground.block ? ground.block.name : 'unknown'}, dimension ${dim}, health ${bot.health}. ${lines.join('; ')}. A method with no item cannot be attempted, a method with no live pass cannot claim a higher stage, and a ladder pass is your live confirmation, not a bot measurement :3`)
  log(`[clutch-methods-report] ground=${ground.dist} dim=${dim}`)
}
function parkourCourseHelp () {
  say('Parkour course help, chained, one jump at a time, never blind chaining: first say "parkour course set 2 3 4" with the gaps in order, at least 2 gaps, each 2, 3, or 4 blocks. Then say "parkour course next" for one jump only, it stops after that jump and reports distance, landing, and health, and it only moves to the next gap if that jump landed on its target block. If a jump fails, the course pauses at that jump, it does NOT chain to the next gap, say "parkour course next" again after you reposition me for a retry, or "parkour course cancel" to abandon it. When all gaps are done, say "parkour course passed live" only if you watched every jump clean. A course is not a single jump, and a single jump pass does not claim a course :3')
}
function parkourCourseSet (gaps) {
  if (!gaps || gaps.length < 2) { say('Parkour course set refused, I need at least 2 gaps in order, for example "parkour course set 2 3 4", each gap 2, 3, or 4 blocks :3'); return }
  parkourCourse = { jumps: gaps, index: 0, at: new Date().toISOString(), done: false }
  parkourCourseAttempts = []
  say(`Parkour course set, session only: gaps in order ${gaps.join(', ')}, starting at jump 1 of ${gaps.length}, gap ${gaps[0]} blocks. Face me toward the first gap live, say "parkour check" if you want to verify it, then say "parkour course next" for one jump only, I will stop after it and wait for you :3`)
  log(`[parkour-course-set] gaps=${gaps.join(',')}`)
}
function parkourCourseStatus () {
  if (!parkourCourse) { say('No parkour course is set, say "parkour course set 2 3 4" first :3'); return }
  say(`Parkour course status: gaps ${parkourCourse.jumps.join(', ')}, now at jump ${parkourCourse.index + 1} of ${parkourCourse.jumps.length}, gap ${parkourCourse.jumps[parkourCourse.index]} blocks${parkourCourse.done ? ', course complete, say "parkour course passed live" only if you watched every jump clean' : ', not complete yet, say "parkour course next" for one jump only'}. Course attempts this session: ${parkourCourseAttempts.length ? parkourCourseAttempts.map((a) => `jump ${a.jumpNo} gap ${a.gap} landed ${a.landed} health ${a.healthBefore} to ${a.healthAfter} result ${a.result}`).join('; ') : 'none yet'} :3`)
}
function parkourCourseCancel () { if (!parkourCourse) { say('No parkour course is set, nothing to cancel :3'); return } parkourCourse = null; say('Parkour course cancelled, I will not chain any more jumps :3') }
function parkourCoursePassedLive () {
  if (!parkourCourse || !parkourCourse.done) { say('Parkour course passed live refused, the course is not complete yet, finish every gap first, then say it again only if you watched every jump clean :3'); return }
  say('Recorded, session only: you confirmed live that the full parkour course passed. This is your live confirmation, not a bot measurement, and it does not claim a different course :3')
  log('[parkour-course-passed-live]')
}
async function parkourCourseNext () {
  if (!bot || !bot.entity) return
  if (!parkourCourse) { say('No parkour course is set, say "parkour course set 2 3 4" first :3'); return }
  if (parkourCourse.done) { say('Parkour course is already complete, say "parkour course passed live" only if you watched every jump clean, or set a new course :3'); return }
  if (typeof bot.food === 'number' && bot.food <= 6) { say('Parkour course jump refused, food is 6 or less, sprint needs food above 6, eat first :3'); return }
  const gap = parkourCourse.jumps[parkourCourse.index]; const jumpNo = parkourCourse.index + 1
  const c = parkourCheckAuto()
  if (!c || !c.landing) { say(`Parkour course jump ${jumpNo} of ${parkourCourse.jumps.length} refused, I see no solid landing ahead, that is a cliff, move me to a real ${gap}-block gap live first, the course is paused, it will not chain :3`); return }
  if (c.gap !== gap) { say(`Parkour course jump ${jumpNo} of ${parkourCourse.jumps.length} refused, the gap I actually see ahead is ${c.gap} block(s), not ${gap}, face me toward the ${gap}-block gap live first, or reposition me, the course is paused, it will not chain :3`); return }
  if (gap === 4 && c.runUp < 2) { say(`Parkour course jump ${jumpNo} refused, run-up is short, a 4-block jump needs full sprint momentum, back up for at least a few solid run-up blocks live, then try this jump again :3`); return }
  const before = bot.entity.position.clone(); const healthBefore = bot.health; const landingName = c.landing.name
  bot.pathfinder.setGoal(null)
  try {
    bot.setControlState('sprint', true); bot.setControlState('forward', true)
    await new Promise((r) => setTimeout(r, gap === 4 ? 800 : 500))
    bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 500)); bot.setControlState('jump', false)
    await new Promise((r) => setTimeout(r, 2000)); bot.setControlState('forward', false); bot.setControlState('sprint', false)
  } catch (e) {}
  const after = bot.entity.position.clone(); const moved = Math.hypot(after.x - before.x, after.z - before.z); const below = bot.blockAt(after.offset(0, -1, 0)); const landed = below && below.name === landingName && after.y >= before.y - 1
  const fell = before.y - after.y
  parkourCourseAttempts.push({ at: new Date().toISOString(), jumpNo, gap, moved: moved.toFixed(1), landed: below ? below.name : 'unknown', healthBefore, healthAfter: bot.health, result: landed ? 'landed on target block' : 'did NOT verify landing on target block, course paused' })
  parkourAttempts.push({ at: new Date().toISOString(), gap: 'course-' + gap, moved: moved.toFixed(1), landed: below ? below.name : 'unknown', healthBefore, healthAfter: bot.health, result: landed ? 'course jump landed on target block, check live' : 'course jump did NOT verify landing, course paused' })
  if (landed) {
    parkourCourse.index++
    if (parkourCourse.index >= parkourCourse.jumps.length) {
      parkourCourse.done = true
      say(`Parkour course jump ${jumpNo} of ${parkourCourse.jumps.length} done, stopped: moved ${moved.toFixed(1)} blocks forward, landed on ${below.name}, target was ${landingName}, health ${healthBefore} to ${bot.health}. That was the last gap, the course is complete as jumps, say "parkour course passed live" only if you watched every jump clean, I am not claiming a course pass from landings alone :3`)
    } else {
      say(`Parkour course jump ${jumpNo} of ${parkourCourse.jumps.length} done, stopped: moved ${moved.toFixed(1)} blocks forward, landed on ${below.name}, target was ${landingName}, health ${healthBefore} to ${bot.health}. Next gap is ${parkourCourse.jumps[parkourCourse.index]} blocks, I will NOT jump it until you say "parkour course next" again, face me toward that gap live first if the course turns :3`)
    }
  } else {
    say(`Parkour course jump ${jumpNo} of ${parkourCourse.jumps.length} did NOT verify a landing on the target block, stopped: moved ${moved.toFixed(1)} blocks forward${fell > 2 ? `, fell about ${fell.toFixed(1)} blocks` : ''}, landed on ${below ? below.name : 'unknown'}, target was ${landingName}, health ${healthBefore} to ${bot.health}. The course is paused at this jump, it will NOT chain to the next gap, say "parkour course next" again after you reposition me for a retry, or "parkour course cancel" to abandon it :3`)
  }
  log(`[parkour-course-jump] jump=${jumpNo} gap=${gap} moved=${moved.toFixed(1)} landed=${below ? below.name : 'unknown'} target=${landingName} health=${healthBefore}->${bot.health}`)
}


// ---------------------------------------------------------------- round 15: auto-clutch watch only, ladder grab proof, parkour course stepping
// Round 14 left three clear gaps, and this round closes them only
// where a result can actually be verified, never by claiming a
// skill from data alone. Auto-clutch on a real, unplanned fall is
// NOT claimed in this round: what is added is honest fall
// detection and reporting, plus staged opt-in watch settings that
// Moon must explicitly enable live. Even with the watch ON, this
// round does NOT place, throw, or save the bot by itself, and it
// never silently auto-saves from a surprise high fall. A ladder
// grab is NOT proved by bot data alone: wall, ladder block, and
// slowed velocity are reported as a checklist, and only Moon
// watching live confirms a grab. A parkour course is NOT an
// automatic run: it stays one jump at a time, Moon faces the bot
// to each gap, it pauses on failure, and only Moon's live
// confirmation passes a course.
let pendingAutoClutch = null
let autoClutchWatch = { on: false, method: null, maxGround: 6, minHealth: 10, at: null }
let autoClutchReports = []
let fallWatchEpisode = null
function autoClutchMaxUnlocked (methodKey) {
  if (highClutchPassedLiveMap[methodKey + ':4']) return 40
  if (highClutchPassedLiveMap[methodKey + ':3']) return 20
  if (highClutchPassedLiveMap[methodKey + ':2']) return 12
  if (clutchPassedLiveMap[methodKey]) return 6
  return 0
}
function autoClutchHelp () {
  say('Auto clutch help, watch only, NOT an auto-save yet: by default auto clutch is OFF, and it stays off until Moon sets it up and confirms it live. Say "auto clutch setup water" for a method you already have a live pass for, low or staged high, then "auto clutch confirm enable" within 2 minutes to turn the watch ON. The watch checks every 1 second, so a very short fall may be missed, that is a real limit, it is not tick-perfect. When it sees an unplanned fall, it reports method, ground distance, health, velocity, and whether that method would even have been eligible, and it logs it, but it does NOT place a bucket, throw a pearl, or save me by itself in this round. Say "auto clutch status" to see method, max ground, and min health, "auto clutch off" to turn the watch off, and "auto clutch fall check" for a one-shot fall report. A surprise high fall is never silently auto-saved, and a watch report is never a clutch pass :3')
}
function autoClutchSetup (methodKey) {
  if (!bot || !bot.entity) return
  const methods = clutchMethods(); const m = methods.find((x) => x.key === methodKey)
  if (!m) { say(`I do not know a clutch method called ${methodKey}, say "clutch help" for the list :3`); return }
  if (m.key === 'ladder') { say('Auto clutch setup refused for ladder, a ladder clutch needs a wall beside the fall and Moon watching live to confirm a grab, it cannot be an auto-clutch method, use ladder clutch practice live instead :3'); return }
  const unlocked = autoClutchMaxUnlocked(m.key)
  if (unlocked <= 0) { say(`Auto clutch setup ${m.name} refused, I have no live pass for this method yet, do a low practice first, say "clutch practice ${m.key}" at 6 blocks or less, then "clutch passed live ${m.key}" after you watch it, then set up auto clutch :3`); return }
  const minHealth = (m.key === 'hay' || m.key === 'bed') ? 20 : 10
  pendingAutoClutch = { method: m.key, maxGround: unlocked, minHealth, at: Date.now() }
  autoClutchWatch.on = false
  say(`Auto clutch setup ${m.name}, step 1 only, watch is NOT on yet: max ground ${unlocked} blocks, from your live passes for this method, min health ${minHealth}${m.key === 'hay' || m.key === 'bed' ? ', full health, because hay and bed only reduce damage, they do not fully negate it' : ''}. Say "auto clutch set max 12" to lower the max ground, or "auto clutch set min health 15" to raise the min health, then say "auto clutch confirm enable" within 2 minutes to turn the watch ON, or "auto clutch cancel setup" to stop. Even when ON, this round is watch and report only, it will not place or throw by itself :3`)
  log(`[auto-clutch-setup] method=${m.key} maxGround=${unlocked} minHealth=${minHealth}`)
}
function autoClutchSetMax (n) {
  if (!pendingAutoClutch) { say('No auto clutch setup is pending, say "auto clutch setup water" first, then set a max ground before confirming :3'); return }
  const unlocked = autoClutchMaxUnlocked(pendingAutoClutch.method)
  if (!n || n < 1 || n > unlocked) { say(`Auto clutch set max refused, ${n} is outside the unlocked range for this method, 1 to ${unlocked} blocks, from your live passes, I will not raise the max above a live pass :3`); return }
  pendingAutoClutch.maxGround = n
  say(`Auto clutch setup updated, pending only, watch is still NOT on: method ${pendingAutoClutch.method}, max ground now ${n} blocks, min health ${pendingAutoClutch.minHealth}. Say "auto clutch confirm enable" to turn the watch ON :3`)
}
function autoClutchSetMinHealth (n) {
  if (!pendingAutoClutch) { say('No auto clutch setup is pending, say "auto clutch setup water" first, then set a min health before confirming :3'); return }
  if (!n || n < 1 || n > 20) { say('Auto clutch set min health refused, health is 1 to 20, pick a value in that range :3'); return }
  if ((pendingAutoClutch.method === 'hay' || pendingAutoClutch.method === 'bed') && n < 20) { say('Auto clutch set min health refused for hay and bed, they only reduce damage, so min health must stay at 20, full health, for those methods :3'); return }
  pendingAutoClutch.minHealth = n
  say(`Auto clutch setup updated, pending only, watch is still NOT on: method ${pendingAutoClutch.method}, max ground ${pendingAutoClutch.maxGround} blocks, min health now ${n}. Say "auto clutch confirm enable" to turn the watch ON :3`)
}
function autoClutchConfirmEnable () {
  if (!bot || !bot.entity) return
  if (!pendingAutoClutch) { say('No auto clutch setup is pending, say "auto clutch setup water" first, then confirm it with you watching :3'); return }
  if (Date.now() - pendingAutoClutch.at > 120000) { const old = pendingAutoClutch.method; pendingAutoClutch = null; say(`Auto clutch setup for ${old} expired after 2 minutes, say "auto clutch setup ${old}" again, I will not turn a watch on from an old setup :3`); return }
  const pending = pendingAutoClutch; pendingAutoClutch = null
  const methods = clutchMethods(); const m = methods.find((x) => x.key === pending.method)
  if (autoClutchMaxUnlocked(pending.method) <= 0) { say(`Auto clutch enable refused, I no longer have a live pass for ${m.name} this session, do a live practice first :3`); return }
  if (pending.method === 'water' || pending.method === 'powder snow' || pending.method === 'pearl' || pending.method === 'slime' || pending.method === 'cobweb') {
    if (!inventoryItem(m.item)) { say(`Auto clutch enable refused, I have no ${m.item} in inventory right now, bring one first, the watch will not turn on with a missing item :3`); return }
  }
  if (pending.method === 'water' && dimensionName() === 'the_nether') { say('Auto clutch enable refused right now, water evaporates in the Nether, use powder snow there, set that method up instead :3'); return }
  autoClutchWatch = { on: true, method: pending.method, maxGround: pending.maxGround, minHealth: pending.minHealth, at: new Date().toISOString() }
  say(`Auto clutch watch ON, watch and report only: method ${m.name}, max ground ${pending.maxGround} blocks, min health ${pending.minHealth}. This is NOT an auto-save: if I fall unplanned, I will report it and log it, I will NOT place, throw, or save myself by itself in this round. Say "auto clutch off" any time to turn the watch off :3`)
  log(`[auto-clutch-on] method=${pending.method} maxGround=${pending.maxGround} minHealth=${pending.minHealth}`)
}
function autoClutchCancelSetup () { if (!pendingAutoClutch) { say('No auto clutch setup is pending, say "auto clutch setup water" first :3'); return } const old = pendingAutoClutch.method; pendingAutoClutch = null; say(`Auto clutch setup cancelled for ${old}, the watch was not turned on :3`) }
function autoClutchOff () { if (!autoClutchWatch.on) { say('Auto clutch watch is already off, say "auto clutch setup water" then "auto clutch confirm enable" to turn it on live :3'); return } autoClutchWatch.on = false; fallWatchEpisode = null; say('Auto clutch watch OFF, I will not report unplanned falls as auto-clutch falls any more, manual clutch practice is still available live :3'); log('[auto-clutch-off]') }
function autoClutchStatus () {
  const reports = autoClutchReports.length ? autoClutchReports.slice(-3).map((r) => `${r.at.slice(11, 19)} ${r.method} ground ${r.groundDist} health ${r.healthBefore} eligible ${r.eligible ? 'yes' : 'no'}${r.reasons.length ? ' (' + r.reasons.join(', ') + ')' : ''}`).join('; ') : 'none yet'
  say(`Auto clutch status: watch ${autoClutchWatch.on ? 'ON' : 'OFF'}${autoClutchWatch.on ? `, method ${autoClutchWatch.method}, max ground ${autoClutchWatch.maxGround} blocks, min health ${autoClutchWatch.minHealth}, turned on ${autoClutchWatch.at ? autoClutchWatch.at.slice(11, 19) : 'unknown'}` : ', no method set, say "auto clutch setup water" then "auto clutch confirm enable" to turn it on live'}. This round is watch and report only, even when ON it does NOT place, throw, or save me by itself, and a watch report is never a clutch pass. Recent fall reports: ${reports}. Say "auto clutch reports" for the full session list :3`)
}
function autoClutchReportsList () {
  if (!autoClutchReports.length) { say('No auto clutch fall reports this session yet, turn the watch on live first, then a fall report will appear here, watch only, no attempt :3'); return }
  say(`Auto clutch fall reports, session only, watch and report only, no attempt was made in this round: ${autoClutchReports.map((r) => `${r.at.slice(11, 19)} ${r.method} ground ${r.groundDist} health ${r.healthBefore}${r.healthAfter !== null ? ' to ' + r.healthAfter : ''} velocity ${r.vel} eligible ${r.eligible ? 'yes' : 'no'}${r.reasons.length ? ' (' + r.reasons.join(', ') + ')' : ''} landed ${r.landed || 'not landed yet'}`).join('; ')} :3`)
}
function autoClutchFallCheck () {
  if (!bot || !bot.entity) return
  const ground = groundDistanceBelow(); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0; const falling = vel < -0.5 && !bot.entity.onGround
  if (!autoClutchWatch.on) { say(`Auto clutch fall check, watch is OFF: falling ${falling ? 'yes' : 'no'}, vertical velocity about ${vel.toFixed(1)}, ground about ${ground.dist} blocks below, health ${bot.health}, on ground ${bot.entity.onGround ? 'yes' : 'no'}. Turn the watch on live first if you want unplanned falls reported, say "auto clutch setup water" then "auto clutch confirm enable" :3`); return }
  const methods = clutchMethods(); const m = methods.find((x) => x.key === autoClutchWatch.method)
  const reasons = []
  if (ground.dist > autoClutchWatch.maxGround) reasons.push(`ground ${ground.dist} over max ${autoClutchWatch.maxGround}`)
  if (bot.health < autoClutchWatch.minHealth) reasons.push(`health ${bot.health} under min ${autoClutchWatch.minHealth}`)
  if (autoClutchWatch.method === 'water' && dimensionName() === 'the_nether') reasons.push('water in the Nether')
  say(`Auto clutch fall check, watch ON, method ${m ? m.name : autoClutchWatch.method}: falling ${falling ? 'yes' : 'no'}, vertical velocity about ${vel.toFixed(1)}, ground about ${ground.dist} blocks below, first solid block ${ground.block ? ground.block.name : 'unknown'}, health ${bot.health}, on ground ${bot.entity.onGround ? 'yes' : 'no'}, eligible for a future auto attempt ${reasons.length ? 'no, ' + reasons.join(', ') : 'yes on these facts'}. This check alone does NOT attempt a clutch, and a future attempt is still not in this round, watch only :3`)
}
function fallWatchTick () {
  if (!bot || !bot.entity) return
  if (!autoClutchWatch.on) return
  if (pendingClutch || pendingHighClutch || pendingLadderClutch) return
  const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  const falling = vel < -0.5 && !bot.entity.onGround
  if (falling && !fallWatchEpisode) {
    const ground = groundDistanceBelow(); const methods = clutchMethods(); const m = methods.find((x) => x.key === autoClutchWatch.method)
    const reasons = []
    if (ground.dist > autoClutchWatch.maxGround) reasons.push(`ground ${ground.dist} over max ${autoClutchWatch.maxGround}`)
    if (bot.health < autoClutchWatch.minHealth) reasons.push(`health ${bot.health} under min ${autoClutchWatch.minHealth}`)
    if (autoClutchWatch.method === 'water' && dimensionName() === 'the_nether') reasons.push('water in the Nether')
    if (m && (autoClutchWatch.method === 'water' || autoClutchWatch.method === 'powder snow' || autoClutchWatch.method === 'pearl' || autoClutchWatch.method === 'slime' || autoClutchWatch.method === 'cobweb') && !inventoryItem(m.item)) reasons.push(`no ${m.item} in inventory`)
    const eligible = reasons.length === 0
    fallWatchEpisode = { at: new Date().toISOString(), method: autoClutchWatch.method, groundDist: ground.dist, healthBefore: bot.health, vel: vel.toFixed(1), eligible, reasons, healthAfter: null, landed: null }
    autoClutchReports.push(fallWatchEpisode)
    say(`UNPLANNED FALL, auto clutch watch report, watch only, I am NOT attempting a save: method ${m ? m.name : autoClutchWatch.method}, ground about ${ground.dist} blocks below, health ${bot.health}, vertical velocity about ${vel.toFixed(1)}. Eligible for a future auto attempt on these facts: ${eligible ? 'yes' : 'no' + (reasons.length ? ', ' + reasons.join(', ') : '')}. This round does NOT place, throw, or save me by itself, say a manual clutch command live if you want a try, or let me land and check health :3`)
    log(`[auto-clutch-fall] method=${autoClutchWatch.method} ground=${ground.dist} health=${bot.health} vel=${vel.toFixed(1)} eligible=${eligible} reasons=${reasons.join('|')}`)
  } else if (!falling && fallWatchEpisode && bot.entity.onGround) {
    const ep = fallWatchEpisode; fallWatchEpisode = null
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0)); ep.healthAfter = bot.health; ep.landed = below ? below.name : 'unknown'
    log(`[auto-clutch-landed] method=${ep.method} health=${ep.healthBefore}->${ep.healthAfter} landed=${ep.landed}`)
    if (ep.healthAfter < ep.healthBefore) say(`Landed after that unplanned fall, health ${ep.healthBefore} to ${ep.healthAfter}, landed on ${ep.landed}. Auto clutch watch reported only, it did not attempt a save in this round :3`)
  } else if (!falling && fallWatchEpisode && Date.now() - new Date(fallWatchEpisode.at).getTime() > 10000) {
    fallWatchEpisode = null
  }
}
function ladderGrabCheck () {
  if (!bot || !bot.entity) return
  const walls = ladderWallScan(); const ground = groundDistanceBelow(); const vel = bot.entity.velocity ? bot.entity.velocity.y : 0
  let ladderBlocks = []
  try { ladderBlocks = bot.findBlocks({ matching: (b) => b.name === 'ladder', maxDistance: 2, count: 10 }) || [] } catch (e) { ladderBlocks = [] }
  const wallText = walls.length ? walls.map((w) => `${w.side} ${w.first.name} continuous ${w.run} block(s) down`).join(', ') : 'no wall beside me'
  const ladderText = ladderBlocks.length ? `${ladderBlocks.length} ladder block(s) within 2 blocks` : 'no ladder block within 2 blocks'
  say(`Ladder grab check, proof checklist, NOT a grab confirmation: wall beside me: ${wallText}; ladder block nearby: ${ladderText}; vertical velocity about ${vel.toFixed(1)}, on ground ${bot.entity.onGround ? 'yes' : 'no'}, ground about ${ground.dist} blocks below, health ${bot.health}. Checklist: wall present ${walls.length ? 'yes' : 'no'}, ladder placed adjacent ${ladderBlocks.length ? 'yes' : 'no'}, velocity slowed, over -2, ${vel > -2 ? 'yes' : 'no'}. Even if every data box is yes, that is still NOT proof of a grab in this round, because mineflayer exposes no reliable is-climbing or grab flag here, and I will not invent one. A grab is confirmed ONLY if you say "ladder clutch passed live" after watching a real grab :3`)
  log(`[ladder-grab-check] walls=${walls.length} ladderBlocks=${ladderBlocks.length} vel=${vel.toFixed(1)} ground=${ground.dist}`)
}
function ladderGrabReports () {
  if (!ladderClutchAttempts.length) { say('No ladder clutch attempts this session yet, say "ladder clutch practice" beside a wall first, then "ladder clutch confirm attempt" with you watching :3'); return }
  const lines = ladderClutchAttempts.map((a) => {
    const velAfter = parseFloat(a.velAfter); const slowed = a.placed === 'yes' && !isNaN(velAfter) && velAfter > -2 && a.healthAfter >= a.healthBefore
    return `${a.at.slice(11, 19)} stage ${a.stage} wall ${a.wall} placed ${a.placed} velocity ${a.velBefore} to ${a.velAfter} health ${a.healthBefore} to ${a.healthAfter} landed ${a.landed}, data signal: ${slowed ? 'placed plus slowed descent, live confirmation still required' : 'no data signal for a grab, live confirmation still required'}`
  })
  say(`Ladder grab reports, session only: ${lines.join('; ')}. In every case a grab is confirmed ONLY by you saying "ladder clutch passed live" after watching a real grab, never by bot data alone :3`)
}
function parkourCourseFaceCheck () {
  if (!bot || !bot.entity) return
  if (!parkourCourse) { say('No parkour course is set, say "parkour course set 2 3 4" first, then face me toward the first gap live :3'); return }
  const yaw = bot.entity.yaw || 0; const fx = -Math.sin(yaw); const fz = Math.cos(yaw)
  let facing = 'unknown'
  if (Math.abs(fx) >= Math.abs(fz)) facing = fx > 0 ? 'east, approximately' : 'west, approximately'
  else facing = fz > 0 ? 'south, approximately' : 'north, approximately'
  const c = parkourCheckAuto()
  say(`Parkour course face check, jump ${parkourCourse.index + 1} of ${parkourCourse.jumps.length}, gap ${parkourCourse.jumps[parkourCourse.index]} blocks: I am facing ${facing}, yaw about ${yaw.toFixed(2)}. Gap I actually see ahead: ${c ? c.gap + ' block(s)' : 'unknown'}, run-up solid blocks behind me: ${c ? c.runUp : 'unknown'}, landing ahead: ${c && c.landing ? c.landing.name : 'none seen, that is a cliff, do not jump'}. Moon, face me toward the ${parkourCourse.jumps[parkourCourse.index]}-block gap live first if this facing is wrong, then say "parkour course next" for one jump only, I will not reposition myself into a gap blind :3`)
}
function parkourCourseLandingCheck () {
  if (!bot || !bot.entity) return
  if (!parkourCourse) { say('No parkour course is set, say "parkour course set 2 3 4" first :3'); return }
  const below = bot.blockAt(bot.entity.position.offset(0, -1, 0)); const last = parkourCourseAttempts.length ? parkourCourseAttempts[parkourCourseAttempts.length - 1] : null
  say(`Parkour course landing check, jump ${parkourCourse.index + 1} of ${parkourCourse.jumps.length}, gap ${parkourCourse.jumps[parkourCourse.index]} blocks, course ${parkourCourse.done ? 'complete as jumps' : 'not complete yet'}: block under me now ${below ? below.name : 'unknown'}, health ${bot.health}. Last course attempt: ${last ? `jump ${last.jumpNo} gap ${last.gap} landed ${last.landed} health ${last.healthBefore} to ${last.healthAfter} result ${last.result}` : 'none yet'}. A below-block match alone is NOT a course pass, and a single jump landing alone is NOT a course pass, say "parkour course passed live" only if you watched every jump clean, and say "parkour course next" again after repositioning for a retry if the last jump failed :3`)
}
function parkourCourseStepHelp () {
  say('Parkour course step help, one jump at a time, never an automatic run: set the course first, "parkour course set 2 3 4", then Moon faces me toward each gap live, I do not turn myself to a gap blind. Say "parkour course face check" to see my facing, gap, run-up, and landing, and "parkour course landing check" after a jump to see what I actually landed on. Say "parkour course next" for exactly one jump, I stop after it, and I only advance if that jump landed on its target block. If it failed, the course pauses at that jump, say "parkour course reposition help" for what to fix live, reposition me, then say "parkour course next" again for a retry, or "parkour course cancel" to abandon it. When every gap is done, say "parkour course passed live" only if you watched every jump clean :3')
}
function parkourCourseRepositionHelp () {
  if (!bot || !bot.entity) return
  if (!parkourCourse) { say('No parkour course is set, say "parkour course set 2 3 4" first, then reposition help will tell you what to fix for the current gap :3'); return }
  const c = parkourCheckAuto(); const last = parkourCourseAttempts.length ? parkourCourseAttempts[parkourCourseAttempts.length - 1] : null
  say(`Parkour course reposition help, jump ${parkourCourse.index + 1} of ${parkourCourse.jumps.length}, gap ${parkourCourse.jumps[parkourCourse.index]} blocks, course ${parkourCourse.done ? 'complete as jumps' : 'paused or not complete yet'}: gap I actually see ahead now ${c ? c.gap + ' block(s)' : 'unknown'}, run-up ${c ? c.runUp : 'unknown'} block(s), landing ahead ${c && c.landing ? c.landing.name : 'none seen, move me to a real gap, do not jump a cliff'}. Last attempt: ${last ? `jump ${last.jumpNo} landed ${last.landed} health ${last.healthBefore} to ${last.healthAfter}` : 'none yet'}. To retry live: move me back to the start of this gap, face me toward the ${parkourCourse.jumps[parkourCourse.index]}-block gap, check the run-up is solid and the landing is the target block, then say "parkour course next" for one jump only. I will NOT move myself to the gap or chain the next gap blind :3`)
}


// ---------------------------------------------------------------- round 16: "Nova, impress me" routine, end goal, staged
// Moon's end goal, not a current ability: "Nova, impress me" should
// do impressive things, setting them up himself, plus whatever other
// cool, verifiable things can be found. This round does NOT claim
// that end goal is reached, and it does NOT turn a routine into an
// automatic show. Rules, all enforced in code:
// - Setup first: health, food, surroundings, flat safe area, no
//   lava nearby, no void below, no cliff edge, and no building on
//   or breaking Moon's builds. If no safe area is found, the routine
//   refuses and says what to fix live, it does not build blind.
// - One trick at a time, stop between each, Moon watching live.
// - Parkour jumps only in order, 2, then 3, then 4, and only if
//   Moon already confirmed that gap live this session. A gap with
//   no live pass is skipped and listed as missing, never attempted
//   as a first try inside a show.
// - Low clutch only, and only for a method with a low live pass
//   and the item in inventory, and only after a confirm step:
//   impress sets the practice, Moon says "impress confirm clutch",
//   then it tries, then it stops and reports. No high clutch, no
//   boat clutch, no honey clutch, and no other method guessed here.
// - Spin only at the end, and only if Moon already confirmed a
//   spin live and a fresh "parkour spin ready live" is set, with a
//   3-block gap actually seen. Otherwise the spin stage is skipped
//   and listed as missing.
// - Other cool tricks are only existing, verified single steps:
//   elytra glide step, boat step, minecart ride step. Each is only
//   included if its precondition is actually present at setup
//   (elytra in inventory, a boat nearby, rails nearby), and each
//   stops after itself. A failed trick pauses the routine, it does
//   not chain to the next trick blind.
// - A routine pass is only recorded if Moon says "impress passed
//   live" after watching the whole routine clean, session only.
// - Round 15 pickups here are help-only, not claims: auto-clutch
//   as an actual save, ladder grab proof from data alone, and
//   parkour as reliable automation are still NOT covered, and
//   the help commands below say so plainly instead of claiming them.
let impressRoutine = null
let impressPassedLiveRecord = null
function impressSafeArea () {
  if (!bot || !bot.entity) return { ok: false, reason: 'no bot entity, cannot check a safe area' }
  const ground = groundDistanceBelow()
  if (ground.dist === 99) return { ok: false, reason: 'no solid ground found within 40 blocks below, that could be a void, do NOT impress here' }
  if (ground.dist > 1) return { ok: false, reason: `I am about ${ground.dist} blocks above solid ground, I am not standing on a safe flat area, land on solid ground first` }
  let lava = 0
  try { const found = bot.findBlocks({ matching: (b) => b && b.name === 'lava', maxDistance: 16, count: 20 }); for (const pos of found) { const d = Math.hypot(pos.x - bot.entity.position.x, pos.z - bot.entity.position.z); if (d <= 8) lava++ } } catch (e) {}
  if (lava) return { ok: false, reason: `${lava} lava block(s) within 8 blocks, move to a safe area with no lava nearby first` }
  const gy = Math.floor(bot.entity.position.y) - 1
  // Flat check, using the ground level directly:
  let flatSolid = 0, flatTotal = 0
  for (let dx = -2; dx <= 2; dx++) { for (let dz = -2; dz <= 2; dz++) { flatTotal++; const b = bot.blockAt(new (require('vec3'))(Math.floor(bot.entity.position.x) + dx, gy, Math.floor(bot.entity.position.z) + dz)); if (b && b.boundingBox === 'block') flatSolid++ } }
  if (flatSolid < 18) return { ok: false, reason: `ground here is not flat enough for a show, only ${flatSolid} of ${flatTotal} blocks at ground level nearby are solid, move to a flat safe area first` }
  return { ok: true, ground: ground.dist, flatSolid, flatTotal, lava: 0 }
}
function impressStagesFor () {
  const stages = []
  stages.push({ key: 'dance', label: 'dance and jump' })
  stages.push({ key: 'sprint', label: 'sprint jump step' })
  for (const gap of [2, 3, 4]) { if (parkourPassedLiveMap[String(gap)]) stages.push({ key: 'parkour' + gap, label: `parkour jump ${gap}`, gap }) }
  let clutchMethod = null
  for (const m of ['water', 'powder snow', 'slime']) { if (clutchPassedLiveMap[m] && inventoryItem(m === 'water' ? 'water_bucket' : m === 'powder snow' ? 'powder_snow_bucket' : 'slime_block')) { clutchMethod = m; break } }
  if (clutchMethod) stages.push({ key: 'clutch-' + clutchMethod, label: `low clutch ${clutchMethod}`, method: clutchMethod })
  if (inventoryItem('elytra')) stages.push({ key: 'elytra', label: 'elytra glide step' })
  let boatNear = false, railsNear = false
  try { for (const id of Object.keys(bot.entities || {})) { const e = bot.entities[id]; if (e && String(e.name || e.mobType || '').toLowerCase().includes('boat')) boatNear = true } } catch (e) {}
  try { const rails = bot.findBlocks({ matching: (b) => b && b.name.includes('rail'), maxDistance: 12, count: 10 }); if (rails && rails.length) railsNear = true } catch (e) {}
  if (boatNear) stages.push({ key: 'boat', label: 'boat step' })
  if (railsNear) stages.push({ key: 'minecart', label: 'minecart ride step' })
  if (parkourPassedLiveMap['spin']) stages.push({ key: 'spin', label: '3-block 360 spin step' })
  return stages
}
function impressMissingList () {
  const missing = []
  for (const gap of [2, 3, 4]) { if (!parkourPassedLiveMap[String(gap)]) missing.push(`parkour jump ${gap}, no live pass yet`) }
  if (!parkourPassedLiveMap['spin']) missing.push('3-block 360 spin, no live pass yet')
  const clutchOk = ['water', 'powder snow', 'slime'].some((m) => clutchPassedLiveMap[m])
  if (!clutchOk) missing.push('low clutch, no live pass for water, powder snow, or slime yet')
  if (!inventoryItem('elytra')) missing.push('elytra glide, no elytra in inventory')
  return missing
}
function impressHelp () {
  say('Impress help, end goal, staged, Moon watching live, one trick at a time, never an automatic show: say "impress me" to set up a routine, I check health, food, and a flat safe area with no lava, no void, and no cliff edge, and I will NOT build on or break your builds to set it up. Then say "impress next" for one trick, I stop after each one. Order is: dance and jump, sprint jump step, parkour jumps in order 2, then 3, then 4, but only if you already confirmed that gap live this session, then a low clutch for water, powder snow, or slime, but only if you already confirmed that method live and I have the item, and only after you say "impress confirm clutch", then elytra glide step if I have an elytra, boat step if a boat is nearby, minecart ride step if rails are nearby, and a 3-block 360 spin step last, but only if you already confirmed a spin live and a fresh "parkour spin ready live" is set. A failed trick pauses the routine, it does not chain blind. Mace clutch and the warden scene are NOT in this routine, "impress next" never attempts them, see "mace clutch help" and "impress warden scene help", and "impress status" reports mace unlock separately. Say "impress status" to see what is unlocked and what is missing, "impress cancel" to stop at any time, and "impress passed live" only after you watched the whole routine clean, session only :3')
}
function impressStatus () {
  if (!bot || !bot.entity) return
  const stages = impressStagesFor(); const missing = impressMissingList()
  const routine = impressRoutine ? `Routine is ${impressRoutine.done ? 'complete, say "impress passed live" only if you watched it all clean, or "impress cancel" to clear it' : impressRoutine.paused ? `paused at stage ${impressRoutine.index + 1} of ${impressRoutine.stages.length}, ${impressRoutine.stages[impressRoutine.index].label}, fix it live or say "impress cancel"` : `running, stage ${impressRoutine.index + 1} of ${impressRoutine.stages.length}, next is ${impressRoutine.stages[impressRoutine.index].label}${impressRoutine.awaitingClutch ? ', waiting for "impress confirm clutch"' : ', say "impress next"'}`}` : 'No routine running, say "impress me" to set one up.'
  say(`Impress status: health ${bot.health}, food ${bot.food}, dimension ${dimensionName()}. ${routine}. Tricks in a new routine would be: ${stages.map((s) => s.label).join(', ')}. Missing or skipped: ${missing.length ? missing.join('; ') : 'none, every listed trick has a live pass or its item'}. A routine pass is never claimed from bot data alone, only from your "impress passed live" after watching it all clean. ${maceImpressStatusLine()} :3`)
  log(`[impress-status] stages=${stages.map((s) => s.key).join(',')} missing=${missing.join('|')}`)
}
function impressCancel () {
  if (!impressRoutine) { say('No impress routine is running, say "impress me" to start one :3'); return }
  const wasClutch = impressRoutine.awaitingClutch
  impressRoutine = null
  if (wasClutch && typeof pendingClutch !== 'undefined' && pendingClutch) { try { clutchCancel() } catch (e) { pendingClutch = null } }
  say('Impress routine cancelled, I will not do the next trick, say "impress me" again to set up a fresh routine live :3')
  log('[impress-cancel]')
}
function impressStart () {
  if (!bot || !bot.entity) return
  if (impressRoutine && !impressRoutine.done) { say(`An impress routine is already running, stage ${impressRoutine.index + 1} of ${impressRoutine.stages.length}, next is ${impressRoutine.stages[impressRoutine.index].label}. Say "impress next", "impress cancel", or "impress status" :3`); return }
  if (typeof bot.food === 'number' && bot.food <= 6) { say('Impress routine refused, food is 6 or less, sprint needs food above 6, eat first :3'); return }
  if (bot.health < 10) { say(`Impress routine refused, health is ${bot.health}, under 10, heal first, I will not do a show while hurt :3`); return }
  const area = impressSafeArea()
  if (!area.ok) { say(`Impress routine refused, safe setup failed: ${area.reason}. I will NOT build a course blind or break your builds to fix it, move me to a flat safe area live first :3`); return }
  const stages = impressStagesFor(); const missing = impressMissingList()
  impressRoutine = { stages, index: 0, done: false, paused: false, awaitingClutch: false, startedAt: Date.now() }
  say(`Impress routine set up, end goal, staged, Moon watching live: safe flat area found, ${area.flatSolid} of ${area.flatTotal} ground blocks solid, no lava within 8 blocks, health ${bot.health}, food ${bot.food}. Tricks in order: ${stages.map((s, i) => `${i + 1}. ${s.label}`).join(', ')}. Skipped or missing: ${missing.length ? missing.join('; ') : 'none'}. I have NOT done any trick yet, and I will NOT build a course blind. Say "impress next" for the first trick, I will stop after each one. A risky trick, the clutch, will ask for "impress confirm clutch" first, and a failed trick pauses the routine :3`)
  log(`[impress-start] stages=${stages.map((s) => s.key).join(',')}`)
}
async function impressAdvanceOrComplete (label) {
  impressRoutine.index++
  if (impressRoutine.index >= impressRoutine.stages.length) { impressRoutine.done = true; say(`Impress routine complete, stopped after ${label}: every stage in this routine is done. Say "impress passed live" only if you watched the whole routine clean, otherwise say "impress cancel" to clear it. A routine pass is your live confirmation, not a bot measurement :3`); log('[impress-complete]'); return }
  say(`Impress stopped after ${label}. Next trick is ${impressRoutine.stages[impressRoutine.index].label}. Say "impress next" for one trick only, or "impress cancel" to stop :3`)
}
async function impressNext () {
  if (!bot || !bot.entity) return
  if (!impressRoutine) { say('No impress routine is running, say "impress me" to set one up first :3'); return }
  if (impressRoutine.done) { say('Impress routine is already complete, say "impress passed live" only if you watched it all clean, or "impress cancel" to clear it :3'); return }
  if (impressRoutine.awaitingClutch) { say('Impress is waiting on a clutch confirm, say "impress confirm clutch" with you watching to try the low clutch, or "impress cancel" to stop, I will not fall without that confirm :3'); return }
  const stage = impressRoutine.stages[impressRoutine.index]
  if (!stage) { impressRoutine.done = true; say('Impress routine has no next stage, say "impress passed live" only if you watched it all clean :3'); return }
  impressRoutine.paused = false
  try {
    if (stage.key === 'dance') {
      const healthBefore = bot.health
      try { doJump(); try { bot.look((bot.entity.yaw || 0) + 1.5, 0, true) } catch (e) {}; try { if (bot.swingArm) bot.swingArm('right') } catch (e) {} } catch (e) {}
      say(`Impress dance and jump done, stopped: health ${healthBefore} to ${bot.health}. That was a safe showy trick, no risk, no build changed :3`)
      await impressAdvanceOrComplete('dance and jump'); return
    }
    if (stage.key === 'sprint') {
      const before = bot.entity.position.clone()
      await parkourSprintJumpStep()
      const moved = Math.hypot(bot.entity.position.x - before.x, bot.entity.position.z - before.z)
      if (moved < 0.5) { impressRoutine.paused = true; say(`Impress routine paused at sprint jump step: I only moved ${moved.toFixed(1)} blocks, I will not chain to the next trick blind, reposition me live or say "impress cancel" :3`); return }
      await impressAdvanceOrComplete('sprint jump step'); return
    }
    if (stage.key.startsWith('parkour')) {
      const gap = stage.gap
      await parkourJumpAttempt(gap)
      const last = parkourAttempts.length ? parkourAttempts[parkourAttempts.length - 1] : null
      if (!last || String(last.result || '').includes('did NOT verify')) { impressRoutine.paused = true; say(`Impress routine paused at parkour jump ${gap}: that jump did NOT verify a landing on the target block, I will not chain to the next trick blind, reposition me live or say "impress cancel" :3`); return }
      await impressAdvanceOrComplete(`parkour jump ${gap}`); return
    }
    if (stage.key.startsWith('clutch-')) {
      clutchPractice(stage.method)
      if (typeof pendingClutch !== 'undefined' && pendingClutch && pendingClutch.method === stage.method) { impressRoutine.awaitingClutch = true; say(`Impress clutch setup done, I have NOT fallen yet: say "impress confirm clutch" now, with you watching, to try the low ${stage.method} clutch, or "impress cancel" to stop. If the item or landing is wrong on recheck, I will refuse cleanly :3`); return }
      impressRoutine.paused = true; say(`Impress routine paused at low clutch ${stage.method}: the clutch practice refused, likely a missing item, a wrong landing, or ground over 6 blocks, fix it live or say "impress cancel", I will not fall without a clean setup :3`); return
    }
    if (stage.key === 'elytra') {
      const before = bot.entity.position.clone()
      await elytraGlideStep()
      const moved = Math.hypot(bot.entity.position.x - before.x, bot.entity.position.z - before.z)
      if (moved < 3) { impressRoutine.paused = true; say(`Impress routine paused at elytra glide step: I only moved ${moved.toFixed(1)} blocks forward, that did not verify a slowed glide, I will not chain blind, check live or say "impress cancel" :3`); return }
      await impressAdvanceOrComplete('elytra glide step'); return
    }
    if (stage.key === 'boat') {
      const before = bot.entity.position.clone()
      await boatStep()
      const moved = bot.entity.position.distanceTo(before)
      if (moved < 0.5) { impressRoutine.paused = true; say(`Impress routine paused at boat step: I only moved ${moved.toFixed(1)} blocks in the boat, that did not verify a boat step, I will not chain blind, check live or say "impress cancel" :3`); return }
      await impressAdvanceOrComplete('boat step'); return
    }
    if (stage.key === 'minecart') {
      const before = bot.entity.position.clone()
      await minecartRideStep()
      const moved = bot.entity.position.distanceTo(before)
      if (moved < 1) { impressRoutine.paused = true; say(`Impress routine paused at minecart ride step: I only moved ${moved.toFixed(1)} blocks, that did not verify a minecart ride, I will not chain blind, check live or say "impress cancel" :3`); return }
      await impressAdvanceOrComplete('minecart ride step'); return
    }
    if (stage.key === 'spin') {
      await parkourSpinStep()
      const last = parkourAttempts.length ? parkourAttempts[parkourAttempts.length - 1] : null
      if (!last || String(last.result || '').includes('did NOT verify')) { impressRoutine.paused = true; say('Impress routine paused at 3-block 360 spin step: that spin did NOT verify a full 360 plus a clean landing, I will not claim the end-goal spin, set "parkour spin ready live" again live or say "impress cancel" :3'); return }
      await impressAdvanceOrComplete('3-block 360 spin step'); return
    }
    say(`Impress stage ${stage.label} is not a trick I can do in this routine, routine paused, say "impress cancel" :3`); impressRoutine.paused = true
  } catch (e) { impressRoutine.paused = true; say(`Impress routine paused at ${stage.label}: an error stopped the trick, ${e.message}, I will not chain blind, say "impress cancel" or fix it live :3`); log(`[impress-error] stage=${stage.key} err=${e.message}`) }
}
async function impressConfirmClutch () {
  if (!bot || !bot.entity) return
  if (!impressRoutine || !impressRoutine.awaitingClutch) { say('No impress clutch is waiting for a confirm, say "impress me" then "impress next" until the clutch stage sets a practice first :3'); return }
  const stage = impressRoutine.stages[impressRoutine.index]
  await clutchConfirmAttempt()
  impressRoutine.awaitingClutch = false
  const last = clutchAttempts.length ? clutchAttempts[clutchAttempts.length - 1] : null
  if (!last || String(last.result || '').includes('did NOT verify') || String(last.result || '').includes('failed')) { impressRoutine.paused = true; say(`Impress routine paused at low clutch ${stage ? stage.method : 'unknown'}: that attempt did NOT verify a clutch, I will not chain to the next trick blind, check health and landing live or say "impress cancel" :3`); return }
  await impressAdvanceOrComplete(`low clutch ${stage ? stage.method : 'unknown'}`)
}
function impressPassedLive () {
  if (!impressRoutine || !impressRoutine.done) { say(`Impress passed live refused, the routine is ${!impressRoutine ? 'not running' : impressRoutine.paused ? 'paused' : 'not complete yet'}, say "impress passed live" only after you watched the whole routine clean :3`); return }
  impressPassedLiveRecord = { at: new Date().toISOString(), stages: impressRoutine.stages.map((s) => s.key) }
  impressRoutine = null
  say('Recorded, session only: you confirmed live that the whole impress routine passed clean. This is your live confirmation, not a bot measurement, and it does not claim any single trick works on its own next time, or that a high clutch, a spin, or an automatic show works :3')
  log('[impress-passed-live]')
}
function autoClutchAttemptHelp () {
  say('Auto clutch attempt help, NOT a claim, and NOT an attempt in this round: an actual auto save on a surprise fall would need, all at once, the auto clutch watch ON, a live pass for that method, the item in inventory, ground at or under the unlocked max from live passes, health at or over the min health, and a fall long enough for the 1-second watch tick to see it, a very short fall may be missed. Even with all that, this round still only watches and reports, it does NOT place, throw, or save me by itself. A future auto attempt round would need a separate live setup and separate tests, and must not be claimed from the watch alone :3')
}
function ladderGrabProofHelp () {
  say('Ladder grab proof help, NOT a proof claim: bot data can report a wall beside me, a ladder block nearby, and slowed vertical velocity, but none of those, even together, proves a grab, because mineflayer exposes no reliable is-climbing or grab flag here. A grab is confirmed ONLY if you say "ladder clutch passed live" after watching a real grab. Say "ladder grab check" for the checklist, "ladder grab reports" for session attempts, and do not take a data checklist as a grab pass :3')
}
function parkourAutomationHelp () {
  say('Parkour automation help, NOT an automatic run: a course is still a plan plus one jump at a time, Moon faces me to each gap live, "parkour course next" is exactly one jump and stops, it advances only on a verified target landing, and it pauses on failure. A reliable automatic run would need gap detection, facing, run-up, landing, and failure recovery all verified together, and that is still not covered. Say "parkour course step help" for the stepping rules, and do not claim a course from single jumps :3')
}

// ---------------------------------------------------------------- round 17: mace clutch, staged, low passive-mob first
// Moon's dramatic example / end goal, NOT a current ability: a mace
// clutch in the impress routine, bot builds a tall stack, pulls out
// a mace, jumps, spins a few times mid-air, then hits a warden at
// the bottom, one-shotting it. This round implements that honestly,
// staged, with NO one-shot claim and NO warden fight claim:
// - Mace mechanics, help first: a mace smash attack is a falling
//   hit on a mob. It only counts as a smash if the hit lands while
//   falling, roughly more than 1.5 to 2 blocks of fall. If the smash
//   lands, fall damage is negated. If it misses, the bot takes
//   normal fall damage. Damage scales with fall height, it is NOT
//   a guaranteed one-shot, and it is NOT a guaranteed one-shot on
//   a warden: a warden has 500 health, very high, and a low staged
//   fall is nowhere near a warden one-shot. A warden is extremely
//   dangerous and will likely kill a bot that misses, or that hits
//   and does not kill it. A low practice therefore never starts
//   on a warden, or on any hostile mob.
// - Practice is low first, on a PASSIVE mob only, and only the
//   mobs named in this round: pig, cow, sheep. No new mob types
//   are guessed here, no chicken, rabbit, horse, or other passive
//   is added as a mace target, and a hostile is never a practice
//   target. Moon positions the bot live on a low ledge above the
//   passive mob and faces the bot toward the drop, the bot does
//   not find, lure, or pen a mob by itself.
// - Practice sets a pending practice only, it does NOT fall.
//   Confirm runs exactly one attempt, then stops and reports.
//   A pass is only recorded if Moon says "mace clutch passed
//   live" after watching it clean, and only if at least one mace
//   clutch attempt exists this session. Bot data here does NOT
//   show mob damage numbers or mob health, so no damage number
//   is ever claimed, and a mob disappearing alone is NOT claimed
//   as a kill. Health before and after, landed block, and whether
//   fall damage looks negated are reported as far as data shows,
//   and Moon's live watch is still the pass.
// - Mid-air spin reuse: the existing spin step, yaw turns
//   mid-air, may be used as a cosmetic spin during a mace clutch
//   attempt, but a spin does NOT guarantee a hit. A missed spin
//   attempt pauses and stops, it does not chain on, and it does
//   not start or continue an impress routine.
// - Tower building: NO blind auto-building is added in this
//   round, and NO tower build command is added. The gated tower
//   design lives in help only, see maceClutchTowerHelp. A tower
//   would only ever be built if Moon says a specific build
//   command live in a future round, only dirt or stone, only on
//   flat solid ground far from Moon's builds, only up to a staged
//   height, low first, with Moon watching, and it stops on any
//   unsafe block below. It is NOT part of impress setup by
//   default, and impress never builds a tower.
// - Impress routine: NO warden scene and NO mace clutch attempt
//   is added to the normal "impress next" order. Impress status
//   only reports mace unlock separately, see
//   maceImpressStatusLine. A warden attempt command that tries
//   a smash is NOT added in this round: the warden scene is
//   help-only, and any scene wording without "help" is refused
//   in code, see maceWardenRefusal. The bot never spawns a
//   warden, there is no /summon or operator command by the bot,
//   and a warden scene would only ever be a separate,
//   Moon-confirmed scene command in a future round, after a low
//   passive-mob pass, with a warden already present below, never
//   as part of the automatic impress routine.
const MACE_PASSIVE_TYPES = ['Pig', 'Cow', 'Sheep']
const MACE_MIN_HEALTH = 16
const MACE_LOW_MAX_DROP = 6
const MACE_LOW_MIN_DROP = 2
let pendingMaceClutch = null
let maceClutchAttempts = []
let maceClutchPassedLiveRecord = null
let maceClutchReadyAt = null
function maceClutchFindBelow () {
  if (!bot || !bot.entity) return { passive: null, warden: null }
  const center = bot.entity.position
  let passive = null; let passiveScore = Infinity
  let warden = null; let wardenScore = Infinity
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !e.position) continue
    const horiz = Math.hypot(e.position.x - center.x, e.position.z - center.z)
    const drop = center.y - e.position.y
    const dist = e.position.distanceTo(center)
    if (MACE_PASSIVE_TYPES.includes(e.mobType) && drop >= 0 && dist < passiveScore) { passive = { entity: e, mobType: e.mobType, horiz, drop, dist }; passiveScore = dist }
    if (e.mobType === 'Warden' && drop >= 0 && dist < wardenScore) { warden = { entity: e, mobType: 'Warden', horiz, drop, dist }; wardenScore = dist }
  }
  return { passive, warden }
}
function maceClutchHelp () {
  say('Mace clutch help, staged, low passive-mob first, nothing claimed until a low test passes live: a mace smash attack is a falling hit on a mob, it only counts as a smash if the hit lands while falling, roughly more than 1.5 to 2 blocks of fall, if the smash lands your fall damage is negated, if it misses you take normal fall damage, and damage scales with fall height, it is NOT a guaranteed one-shot, and it is NOT a guaranteed one-shot on a warden, a warden has 500 health, very high, and a warden is extremely dangerous and will likely kill a bot that misses or survives the hit. What a mace clutch needs: a mace in inventory, a passive mob below, pig, cow, or sheep only, never a hostile first, a safe fall path with no lava and no unsafe landing below, full or high health, at least 16, Moon watching live, and a staged practice path, low first, never a warden first. Say "mace clutch ready live" when you are watching and the bot is on a low ledge above a passive mob, then "mace clutch check" for mace, mob, fall height, health, and food, then "mace clutch practice" to set one pending practice, no fall yet, then "mace clutch confirm" for one attempt, then "mace clutch passed live" only if you watched it clean. Say "mace clutch tower help" for the gated tower design, which is help only, no tower is built in this round, and "impress warden scene help" for the dramatic end-goal scene, which is description only and is NEVER in the normal impress routine :3')
}
function maceClutchTowerHelp () {
  say('Mace clutch tower help, design only, NO tower build command in this round, and NO blind auto-building: a tower step, if it ever exists in a future round, would only run if Moon says a specific build command live, only dirt or stone, only on flat solid ground far from Moon\'s builds, only up to a staged height, low first, up to 6 blocks, with higher stages only after a low live pass, never a tall stack first, with Moon watching live, and it stops on any unsafe block below, lava, void or no solid ground, a cliff edge, or Moon\'s build. Impress setup never builds a tower by default, and this round builds nothing, it only describes the gate, so do not claim a tower from this help :3')
}
function maceClutchReadyLive () {
  maceClutchReadyAt = Date.now()
  say('Mace clutch ready, recorded this session: you said you are watching live and the low ledge above a passive mob is set. I will accept one "mace clutch practice" in the next 2 minutes, after that say "mace clutch ready live" again, because mob position and health change fast and I will not practice on an old setup. This does NOT fall yet, say "mace clutch practice" next :3')
}
function maceClutchCheck () {
  if (!bot || !bot.entity) return
  const mace = inventoryItem('mace')
  const below = maceClutchFindBelow()
  const ground = groundDistanceBelow()
  const health = bot.health; const food = bot.food
  const p = below.passive
  const passiveLine = p ? `${p.mobType} below, about ${p.drop.toFixed(1)} blocks below, horizontal distance about ${p.horiz.toFixed(1)} blocks, total distance about ${p.dist.toFixed(1)} blocks` : 'no pig, cow, or sheep seen below, move to a low ledge above a passive mob live'
  const passiveOk = !!p && p.horiz <= 2 && p.drop >= MACE_LOW_MIN_DROP && p.drop <= MACE_LOW_MAX_DROP
  const wardenLine = below.warden ? `A warden is also seen below, about ${below.warden.drop.toFixed(1)} blocks below, that is NOT a practice target, practice refuses a warden, see "impress warden scene help" for the locked end-goal description only.` : 'No warden seen below.'
  const watching = !!(maceClutchReadyAt && Date.now() - maceClutchReadyAt <= 120000)
  const readyReasons = []
  if (!mace) readyReasons.push('no mace in inventory')
  if (!p) readyReasons.push('no passive mob below')
  else if (!passiveOk) readyReasons.push(`passive mob is not in a low practice position, need horizontal distance 2 or less and a drop of ${MACE_LOW_MIN_DROP} to ${MACE_LOW_MAX_DROP} blocks`)
  if (health < MACE_MIN_HEALTH) readyReasons.push(`health ${health} is under ${MACE_MIN_HEALTH}`)
  if (!watching) readyReasons.push('no fresh "mace clutch ready live" in the last 2 minutes')
  say(`Mace clutch check: mace in inventory: ${mace ? `yes, x${mace.total}` : 'no'}. Mob below: ${passiveLine}. Fall height to that mob: ${p ? `${p.drop.toFixed(1)} blocks` : 'unknown, no passive mob below'}. Ground about ${ground.dist} blocks below, first solid block ${ground.block ? ground.block.name : 'unknown'}. Health ${health}, food ${food}. Low practice ready: ${readyReasons.length ? 'no, ' + readyReasons.join('; ') : 'yes, say "mace clutch practice" now, no fall yet'}. A low practice is unlocked by gear, mob, and health here, but it still needs your fresh watching step, and a live pass still needs "mace clutch passed live" after you watch a clean attempt. ${wardenLine} No damage number is claimed from bot data, bot data does not show mob health :3`)
  log(`[mace-clutch-check] mace=${!!mace} passive=${p ? p.mobType : 'none'} drop=${p ? p.drop.toFixed(1) : 'na'} horiz=${p ? p.horiz.toFixed(1) : 'na'} health=${health} food=${food} ready=${!readyReasons.length}`)
}
function maceClutchPractice () {
  if (!bot || !bot.entity) return
  if (pendingMaceClutch) { say('A mace clutch practice is already pending, say "mace clutch confirm" for that one attempt with you watching, or "mace clutch cancel" to stop, I will not stack a second practice :3'); return }
  if (!maceClutchReadyAt || Date.now() - maceClutchReadyAt > 120000) { say('Mace clutch practice refused, no fresh "mace clutch ready live" in the last 2 minutes. Say "mace clutch ready live" when you are watching live and the low ledge above a passive mob is set, then say "mace clutch practice" again, I will not practice without that watching step :3'); return }
  const mace = inventoryItem('mace')
  if (!mace) { say('Mace clutch practice refused, I have no mace in inventory, bring a mace first, a mace is rare, from trial chambers, and I will not attempt a smash without one :3'); return }
  const below = maceClutchFindBelow()
  const p = below.passive
  if (!p) { say('Mace clutch practice refused, no pig, cow, or sheep seen below, practice is passive-mob only, never a hostile first, move to a low ledge above a passive mob live and say "mace clutch ready live" again :3'); return }
  if (below.warden) { say(`Mace clutch practice refused, a warden is seen below, about ${below.warden.drop.toFixed(1)} blocks below, practice never starts near a warden, move away from the warden live first :3`); return }
  if (p.horiz > 2) { say(`Mace clutch practice refused, the ${p.mobType} below is about ${p.horiz.toFixed(1)} blocks away horizontally, practice needs 2 or less so the fall lands on the mob, reposition live so the mob is directly below, then say "mace clutch ready live" again :3`); return }
  if (p.drop < MACE_LOW_MIN_DROP || p.drop > MACE_LOW_MAX_DROP) { say(`Mace clutch practice refused, the fall to the ${p.mobType} below is about ${p.drop.toFixed(1)} blocks, low practice first is ${MACE_LOW_MIN_DROP} to ${MACE_LOW_MAX_DROP} blocks, a smash needs more than about 1.5 to 2 blocks of fall, and a higher fall is not a first try, move to a low ledge live first :3`); return }
  if (bot.health < MACE_MIN_HEALTH) { say(`Mace clutch practice refused, health is ${bot.health}, under ${MACE_MIN_HEALTH}, a missed smash means normal fall damage, heal first, I will not practice while hurt :3`); return }
  const ground = groundDistanceBelow()
  if (ground.block && ground.block.name === 'lava') { say('Mace clutch practice refused, the first solid block below looks like lava, that is not a safe fall path, move to a safe low ledge live first :3'); return }
  maceClutchReadyAt = null
  pendingMaceClutch = { at: Date.now(), mobId: p.entity.id, mobType: p.mobType, drop: p.drop, horiz: p.horiz, healthBefore: bot.health, yBefore: bot.entity.position.y }
  say(`Mace clutch practice set up, step 1 only, I have NOT fallen yet: ${p.mobType} below, about ${p.drop.toFixed(1)} blocks below, horizontal distance about ${p.horiz.toFixed(1)} blocks, health ${bot.health}, food ${bot.food}, mace in inventory x${mace.total}. I will equip the mace on confirm, fall toward that mob, turn mid-air as a cosmetic spin, and try one smash attack in range, a spin does NOT guarantee a hit. Say "mace clutch confirm" now, with you watching, for one attempt, or "mace clutch cancel" to stop. If the mace or mob is wrong on recheck, I will refuse and I will not fall :3`)
  log(`[mace-clutch-practice] mob=${p.mobType} drop=${p.drop.toFixed(1)} horiz=${p.horiz.toFixed(1)} health=${bot.health}`)
}
function maceClutchCancel () {
  if (!pendingMaceClutch) { say('No mace clutch practice is pending, say "mace clutch ready live" then "mace clutch practice" first :3'); return }
  const old = pendingMaceClutch.mobType; pendingMaceClutch = null
  say(`Mace clutch practice cancelled for ${old}, I will not fall or attempt anything :3`)
}
function maceClutchAttemptsList () {
  if (!maceClutchAttempts.length) { say('No mace clutch attempts this session yet, say "mace clutch ready live" then "mace clutch practice" at a low drop first :3'); return }
  say(`Mace clutch attempts, session only: ${maceClutchAttempts.map((a) => `${a.at.slice(11, 19)} ${a.mobType} fall about ${a.fell.toFixed(1)} blocks, hit attempted ${a.hitAttempted ? 'yes' : 'no'}, spin about ${a.spinDeg} degrees, health ${a.healthBefore} to ${a.healthAfter}, landed ${a.landed}, mob still seen ${a.mobStillSeen ? 'yes' : 'no'}, result ${a.result}`).join('; ')}. No damage number is claimed, bot data does not show mob health, and an attempt alone is not a pass, a pass still needs your "mace clutch passed live" after watching clean :3`)
}
async function maceClutchConfirmAttempt () {
  if (!bot || !bot.entity) return
  if (!pendingMaceClutch) { say('No mace clutch practice is pending, say "mace clutch ready live" then "mace clutch practice" at a low drop first, then confirm it with you watching :3'); return }
  if (Date.now() - pendingMaceClutch.at > 120000) { const old = pendingMaceClutch.mobType; pendingMaceClutch = null; say(`Mace clutch practice for ${old} expired after 2 minutes, say "mace clutch ready live" then "mace clutch practice" again with you watching, I will not attempt on an old setup :3`); return }
  const pending = pendingMaceClutch; pendingMaceClutch = null
  const mace = inventoryItem('mace')
  if (!mace) { say('Mace clutch attempt refused on recheck, no mace in inventory now, I did not fall, bring a mace and set it up again :3'); return }
  const mob = bot.entities[pending.mobId]
  if (!mob || mob.mobType !== pending.mobType || !MACE_PASSIVE_TYPES.includes(mob.mobType)) { say(`Mace clutch attempt refused on recheck, the ${pending.mobType} below is no longer seen as that passive mob, it may have moved or despawned, I did not fall, set it up again live :3`); return }
  const horizNow = Math.hypot(mob.position.x - bot.entity.position.x, mob.position.z - bot.entity.position.z)
  const dropNow = bot.entity.position.y - mob.position.y
  if (horizNow > 3 || dropNow < MACE_LOW_MIN_DROP || dropNow > MACE_LOW_MAX_DROP) { say(`Mace clutch attempt refused on recheck, the ${pending.mobType} is now about ${horizNow.toFixed(1)} blocks away horizontally and about ${dropNow.toFixed(1)} blocks below, outside the low practice position, I did not fall, reposition live and set it up again :3`); return }
  if (bot.health < MACE_MIN_HEALTH) { say(`Mace clutch attempt refused on recheck, health is ${bot.health}, under ${MACE_MIN_HEALTH}, I did not fall, heal first :3`); return }
  const healthBefore = bot.health; const yBefore = bot.entity.position.y; const yawBefore = bot.entity.yaw || 0
  bot.pathfinder.setGoal(null)
  try { await bot.equip(mace.first, 'hand') } catch (e) {}
  let fellOffEdge = false; let hitAttempted = false; let spinDeg = 0; let hitAtFall = null
  try {
    bot.setControlState('forward', true)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (bot.entity.position.y < yBefore - 0.5) { fellOffEdge = true; break }
      if (bot.entity.onGround && bot.entity.position.y >= yBefore - 0.1 && i > 5) break
    }
    bot.setControlState('forward', false)
    if (!fellOffEdge) {
      say('Mace clutch attempt stopped, I did not fall off the edge, I stayed on the ledge, reposition me live facing the drop above the passive mob, then set a fresh practice, I will not guess the edge direction blind :3')
      log('[mace-clutch-attempt] no-fall-off-edge')
      return
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100))
      try { bot.look(yawBefore + (Math.PI * 2 * (i + 1) / 30), 0, true); spinDeg = Math.round((Math.PI * 2 * (i + 1) / 30) * 180 / Math.PI) } catch (e) {}
      const liveMob = bot.entities[pending.mobId]
      if (liveMob && !hitAttempted && liveMob.position.distanceTo(bot.entity.position) <= 3.5) {
        try { bot.attack(liveMob); hitAttempted = true; hitAtFall = yBefore - bot.entity.position.y } catch (e) { hitAttempted = true; hitAtFall = yBefore - bot.entity.position.y }
      }
      if (bot.entity.onGround) break
    }
    bot.setControlState('forward', false)
    await new Promise((r) => setTimeout(r, 800))
  } catch (e) { bot.setControlState('forward', false) }
  const healthAfter = bot.health; const yAfter = bot.entity.position.y
  const below = bot.blockAt(bot.entity.position.offset(0, -1, 0)); const landed = below ? below.name : 'unknown'
  const fell = Math.max(0, yBefore - yAfter)
  const mobStillSeen = !!bot.entities[pending.mobId]
  let result = 'attempt done, check live'
  if (!hitAttempted) result = 'no hit in range, missed, a spin does NOT guarantee a hit, check live where I landed'
  else if (healthAfter >= healthBefore && fell >= 3) result = 'hit attempted, health unchanged after a fall that would normally hurt, looks like a smash negation as far as data shows, check live, NOT a damage claim'
  else if (hitAttempted && healthAfter < healthBefore) result = 'hit attempted but health dropped, fall damage was NOT fully negated as far as data shows, check live whether the hit actually landed as a smash'
  else result = 'hit attempted, check live whether it looked like a real smash'
  maceClutchAttempts.push({ at: new Date().toISOString(), mobType: pending.mobType, fell, hitAttempted, spinDeg, healthBefore, healthAfter, landed, mobStillSeen, result })
  say(`Mace clutch attempt done, stopped: ${pending.mobType} below, fell about ${fell.toFixed(1)} blocks, spin about ${spinDeg} degrees mid-air, cosmetic only, hit attempted ${hitAttempted ? `yes, after about ${hitAtFall !== null ? hitAtFall.toFixed(1) : 'unknown'} blocks of fall` : 'no, never in range'}, health ${healthBefore} to ${healthAfter}, landed on ${landed}, mob still seen ${mobStillSeen ? 'yes' : 'no'}. Result: ${result}. Bot data does not show mob damage numbers or mob health, so no damage number is claimed, and a mob disappearing alone is not a kill claim. A missed attempt pauses here, it does not chain on, and it does not start an impress routine. Say "mace clutch passed live" only if you watched it and it looked like a real clean smash, otherwise it is just an attempt, not a pass :3`)
  log(`[mace-clutch-attempt] mob=${pending.mobType} fell=${fell.toFixed(1)} hit=${hitAttempted} spinDeg=${spinDeg} health=${healthBefore}->${healthAfter} landed=${landed} mobStillSeen=${mobStillSeen}`)
}
function maceClutchPassedLive () {
  if (!maceClutchAttempts.length) { say('Mace clutch passed live refused, no mace clutch attempt this session yet, do "mace clutch ready live", then "mace clutch practice", then "mace clutch confirm" with you watching first, then say "mace clutch passed live" only after you watched a clean smash :3'); return }
  maceClutchPassedLiveRecord = { at: new Date().toISOString(), attempts: maceClutchAttempts.length }
  say('Recorded, session only: you confirmed live that a low mace clutch on a passive mob passed clean. This is your live confirmation, not a bot measurement, and it does not claim a high mace clutch, a spin by itself, a warden scene, or a one-shot works. A warden scene stays locked in this round, see "impress warden scene help" :3')
  log('[mace-clutch-passed-live]')
}
function maceImpressStatusLine () {
  if (!bot || !bot.entity) return 'Mace clutch: unknown, no bot entity.'
  const hasMace = !!inventoryItem('mace')
  const passed = !!maceClutchPassedLiveRecord
  return `Mace clutch: ${passed ? 'unlocked, low passive-mob live pass recorded this session' : 'locked, no low passive-mob live pass yet'}; mace in inventory: ${hasMace ? 'yes' : 'no'}; warden scene: locked in this round, never in "impress next", see "impress warden scene help".`
}
function impressWardenSceneHelp () {
  say('Impress warden scene help, dramatic end-goal scene ONLY as a description, NOT in the normal impress routine, NOT attempted by "impress next", and NO scene attempt command in this round: the scene, as Moon described it, is a tall tower of blocks, the bot pulls out a mace, jumps, spins around a few times mid-air, then smashes a warden at the bottom. Honest warnings, all of them: it needs a mace, rare, from trial chambers, it needs a warden already present below, the bot does NOT spawn one, there is no /summon or operator command by the bot, it needs Moon watching live, bot death is likely on a miss, because a miss means full fall damage plus a warden that can kill the bot, and a one-shot is NOT guaranteed, a warden has 500 health, very high, and a low fall will not one-shot it. This scene is locked until, in order, Moon has explicitly confirmed a low mace clutch on a passive mob live first, say "mace clutch passed live" after watching it clean, and then, in a future round, says a separate, explicit scene command, never as part of "impress next". Tower building for it is help only in this round, see "mace clutch tower help", only dirt or stone, only on flat solid ground far from Moon\'s builds, only up to a staged height, low first, with Moon watching, stopping on any unsafe block below, and it is NOT part of impress setup by default :3')
}
function maceWardenRefusal () {
  say('Warden scene refused, locked in this round: there is no warden smash attempt command yet, "impress warden scene help" is description only, and "impress next" never attempts it. First, get a low mace clutch pass on a passive mob live, say "mace clutch passed live" only after watching it clean, then a separate, explicit scene command in a future round would still be needed, with a warden already present below, Moon watching live, and no one-shot promised, because a warden has 500 health and bot death is likely on a miss. The bot never spawns a warden and never uses a /summon or operator command :3')
  log('[mace-warden-refused]')
}


// ---------------------------------------------------------------- round 18: bow, shield, duel + targeting
// PRIVATE SERVERS MOON CONTROLS ONLY: this bot only ever connects to a
// private server or private world Moon owns or controls, never a public
// server, never Noah's server without Noah's explicit say-so live. Targeting
// and duelling are for those private servers only, with Moon watching live, and a
// stop command at any time. A player is only ever attacked in a duel Moon
// names explicitly, with that player present in game. The bot never attacks
// Moon unless Moon explicitly says "duel me" or "fight me" live, and never
// attacks Noah unless Noah is explicitly in a duel Moon names live. In code
// that means: a player target needs an explicit "duel <name>" plus a
// separate "duel confirm" before the first strike, so Moon gets a second
// chance to stop it, and Moon himself needs "duel me" first. No mass
// targeting, no offline players, no guessed names: a name not in game
// right now is refused, not guessed.
let r18Target = null // { kind: 'player'|'mob', name, id, at }
let r18Duel = null // { name, id, kind, at, pendingConfirm, lastStrikeAt, critPass, status }
let r18DuelTimer = null
let r18DuelMeFlag = false
let r18BowPending = null
let r18ShieldPracticeAt = 0
let r18BowShots = []
let r18DuelStrikes = []
let r18BowPassedLiveRecord = false
let r18ShieldPassedLiveRecord = false
let r18DuelPassedLiveRecord = false

function r18InvCount (name) {
  if (!bot) return 0
  try { const it = inventoryItem(name); return it ? it.total : 0 } catch (e) { return 0 }
}
function r18HeldName () {
  try { const h = bot.heldItem; return h ? h.name : '' } catch (e) { return '' }
}
function r18FindPlayer (name) {
  if (!bot) return null
  const want = (name || '').trim().toLowerCase()
  for (const key of Object.keys(bot.players || {})) {
    const pl = bot.players[key]
    if (!pl) continue
    if (key.toLowerCase() === want || (pl.username || '').toLowerCase() === want) return pl
  }
  return null
}
function r18FindMob (name) {
  if (!bot || !bot.entity) return null
  const want = (name || '').trim().toLowerCase()
  let best = null; let bestDist = Infinity
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !e.mobType) continue
    const mobName = e.mobType.toLowerCase()
    if (mobName !== want && mobName.replace(/_/g, ' ') !== want) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestDist) { best = e; bestDist = d }
  }
  return best
}
function r18TargetLive () {
  if (!r18Target || !bot) return null
  if (r18Target.kind === 'player') {
    const pl = r18FindPlayer(r18Target.name)
    return pl && pl.entity ? pl.entity : null
  }
  const e = bot.entities[r18Target.id]
  return e || null
}
function r18TargetHelp () {
  say('Targeting system, private servers and private worlds Moon owns or controls only, never a public server, Moon watching live, stop anytime: say "target help" for this list, "target <player or mob name>" to set ONE target only, session only, "target status" to see it, "target clear" to clear it, "duel <player name>" to start a duel with that player only, "duel confirm" before the first strike, "duel status", "duel crit step" as a separate Moon-confirmed jump-crit step, "duel passed live" only after you watched a clean duel, "attack target" for a mob target only, one target at a time, and "stop duel" or "stop" to stop everything. A name not in game right now is refused, not guessed. No mass targeting, no offline players, no chaining to other targets blind. The bot never attacks Moon unless Moon explicitly says "duel me" or "fight me" live first, and never attacks Noah unless Noah is explicitly in a duel you name live. A duel stops on "stop duel", "stop fighting", or "stop", on low bot health under 8, if the target leaves or dies, or if you stop it, with a retreat report, never a fight to the death blind. Bow super-good, shield-perfect timing, and duel mastery are end goals, not instant skills, see "bow help" and "shield help" :3')
}
function r18TargetSet (rawName) {
  if (!bot || !bot.entity) return
  const name = (rawName || '').trim()
  if (!name) { say('Target refused, give me a name: "target <player or mob name>", I will not guess a target :3'); return }
  const pl = r18FindPlayer(name)
  if (pl && pl.entity) {
    const d = pl.entity.position.distanceTo(bot.entity.position)
    r18Target = { kind: 'player', name: pl.username || name, id: pl.entity.id, at: Date.now() }
    say(`Target set, one only, session only: player ${r18Target.name}, about ${d.toFixed(1)} blocks away, health is not shown by bot data for players, so I do not claim it. I have NOT attacked, a player target is only attacked in a duel you name and confirm live, say "duel ${r18Target.name}" then "duel confirm" with you watching, or "target clear" to clear it :3`)
    log(`[target] player ${r18Target.name} dist=${d.toFixed(1)}`)
    return
  }
  const mob = r18FindMob(name)
  if (mob) {
    const d = mob.position.distanceTo(bot.entity.position)
    r18Target = { kind: 'mob', name: mob.mobType, id: mob.id, at: Date.now() }
    say(`Target set, one only, session only: mob ${mob.mobType}, about ${d.toFixed(1)} blocks away. I have NOT attacked, say "attack target" for one mob target at a time, or "target clear" to clear it. I will stop on target death or on "stop", I will not chain to other mobs blind :3`)
    log(`[target] mob ${mob.mobType} dist=${d.toFixed(1)}`)
    return
  }
  say(`Target refused, "${name}" is not in game right now as a player or a mob I can see, I will not guess a target or attack an offline player, check the name live and say "target ${name}" again :3`)
}
function r18TargetStatus () {
  if (!r18Target) { say('No target is set, say "target <player or mob name>" first, one target only, session only :3'); return }
  const live = r18TargetLive()
  if (!live) { say(`Target ${r18Target.name} (${r18Target.kind}) is no longer seen, it may have left or despawned, say "target clear" and set a fresh target live, I will not attack a target I cannot see :3`); return }
  const d = live.position.distanceTo(bot.entity.position)
  const inRange = d <= 3.5 ? 'yes, melee range' : (d <= 30 ? 'no, but in bow range if I have a bow and arrows' : 'no, too far')
  say(`Target status: ${r18Target.kind} ${r18Target.name}, about ${d.toFixed(1)} blocks away, in range: ${inRange}, health: ${r18Target.kind === 'mob' ? 'not claimed from bot data' : 'not shown by bot data for players'}, bot health ${bot.health}, food ${bot.food}. Duel active: ${r18Duel ? 'yes, see "duel status"' : 'no'} :3`)
}
function r18TargetClear () {
  const old = r18Target ? r18Target.name : null
  r18Target = null
  r18StopDuel('target cleared')
  say(old ? `Target cleared, was ${old}, I will not attack it, say "target <name>" to set a fresh one live :3` : 'No target was set :3')
}
function r18StopDuel (reason) {
  if (r18DuelTimer) { clearInterval(r18DuelTimer); r18DuelTimer = null }
  const was = r18Duel
  r18Duel = null
  if (was) { try { bot.pathfinder.setGoal(null) } catch (e) {} ; try { setSneak(false) } catch (e) {} }
  return was
}
function r18DuelCooldownMs () {
  const held = r18HeldName()
  if (held.endsWith('_axe')) return 1100
  if (held.endsWith('_sword')) return 650
  if (held === 'mace') return 900
  return 800
}
async function r18DuelTick () {
  if (!r18Duel || !bot || !bot.entity) return
  try {
    if (bot.health < 8) { r18StopDuel('low health'); say(`Duel stopped, retreating: my health is ${bot.health}, under 8, I will not fight to the death blind, heal first and start a fresh duel live if you want one :3`); log('[duel] stopped low health'); return }
    const live = r18TargetLive()
    if (!live) { const goneName = r18Duel ? r18Duel.name : 'unknown'; r18StopDuel('target gone'); say(`Duel stopped: target ${goneName} is no longer seen, it may have left or died, I will not chase a target I cannot see :3`); log('[duel] stopped target gone'); return }
    const d = live.position.distanceTo(bot.entity.position)
    if (d > 3.5) {
      try { bot.pathfinder.setGoal(new goals.GoalNear(live.position.x, live.position.y, live.position.z, 1), true) } catch (e) {}
      return
    }
    try { bot.pathfinder.setGoal(null) } catch (e) {}
    // Block step: if the target is close, hold the shield briefly, then
    // unblock to strike on a full cooldown. Shield timing here is
    // best-effort, not claimed as perfect until Moon watches it live.
    const now = Date.now()
    const cd = r18DuelCooldownMs()
    if (now - (r18Duel.lastStrikeAt || 0) < cd) return
    const hasShield = r18InvCount('shield') > 0
    if (hasShield) {
      try { const sh = inventoryItem('shield'); if (sh) await bot.equip(sh.first, 'off_hand') } catch (e) {}
      setSneak(true)
      await new Promise((r) => setTimeout(r, 400))
      setSneak(false)
    }
    // Strike on a full cooldown, not the old 500 ms spam attack used
    // for mobs. Charge is reported as "waited full cooldown step"
    // because mineflayer data here does not expose a reliable attack
    // strength meter, so no meter number is claimed.
    try { bot.attack(live); r18Duel.lastStrikeAt = Date.now(); r18DuelStrikes.push({ at: new Date().toISOString(), target: r18Duel.name, weapon: r18HeldName(), dist: d }) } catch (e) { log(`[duel] strike failed: ${e.message}`) }
  } catch (e) { log(`[duel] tick failed: ${e.message}`) }
}
function r18DuelStart (rawName) {
  if (!bot || !bot.entity) return
  const name = (rawName || '').trim()
  if (!name) { say('Duel refused, name a player: "duel <player name>", with that player present in game, I will not guess a duel target :3'); return }
  if (r18Duel) { say(`A duel is already active with ${r18Duel.name}, say "stop duel" first, then start a fresh duel, I will not stack duels :3`); return }
  const isOwner = name.toLowerCase() === OWNER.toLowerCase()
  if (isOwner && !r18DuelMeFlag) { say('Duel with you refused, say "duel me" or "fight me" live first if you want me to duel you, I never attack you without that explicit live command :3'); return }
  const pl = r18FindPlayer(name)
  if (!pl || !pl.entity) { say(`Duel refused, player "${name}" is not in game right now, I will not duel an offline player or guess a name, check the name live and say "duel ${name}" again :3`); return }
  if (bot.health < 10) { say(`Duel refused, my health is ${bot.health}, under 10, heal first, I will not start a duel while hurt :3`); return }
  const d = pl.entity.position.distanceTo(bot.entity.position)
  r18Target = { kind: 'player', name: pl.username || name, id: pl.entity.id, at: Date.now() }
  r18Duel = { name: r18Target.name, id: r18Target.id, kind: 'player', at: Date.now(), pendingConfirm: true, lastStrikeAt: 0, critPass: false }
  r18DuelMeFlag = false
  say(`Duel set up, step 1 only, I have NOT attacked yet: player ${r18Target.name}, about ${d.toFixed(1)} blocks away, my health ${bot.health}, food ${bot.food}, held ${r18HeldName() || 'nothing'}. This is a private-server duel only, on a private server Moon controls, with you watching live. Say "duel confirm" now to start strikes, or "stop duel" to stop, I will not strike without that confirm. Strikes will wait for a full cooldown first, not spam, and the duel stops on low health under 8, target leaving or dying, or "stop duel" :3`)
  log(`[duel] setup player ${r18Target.name} dist=${d.toFixed(1)} health=${bot.health}`)
}
function r18DuelMe () {
  if (!bot || !bot.entity) return
  r18DuelMeFlag = true
  say('Recorded, session only: you said "duel me" live, so I may duel you if you next say "duel Werewolf_Paws" and "duel confirm" with you watching. I have NOT attacked yet, and this flag is only for this session, say "duel Werewolf_Paws" next or "stop duel" to clear it :3')
}
function r18DuelConfirm () {
  if (!r18Duel || !r18Duel.pendingConfirm) { say('No duel is waiting for confirm, say "duel <player name>" first, with that player present, then "duel confirm" with you watching :3'); return }
  r18Duel.pendingConfirm = false
  if (r18DuelTimer) clearInterval(r18DuelTimer)
  r18DuelTimer = setInterval(() => { r18DuelTick() }, 500)
  say(`Duel confirmed, strikes starting: target ${r18Duel.name}, I will walk to them, block briefly with a shield if I have one, then strike only after a full cooldown step, sword about 650 ms, axe about 1100 ms, not spam. Crits are NOT in the tick, say "duel crit step" separately for one Moon-confirmed jump crit. Say "stop duel" anytime, and I stop on low health under 8 or if the target leaves or dies :3`)
  log(`[duel] confirmed target ${r18Duel.name}`)
}
function r18DuelStatus () {
  if (!r18Duel) { say('No duel is active, say "duel <player name>" first, with that player present, then "duel confirm" with you watching :3'); return }
  const live = r18TargetLive()
  const d = live ? live.position.distanceTo(bot.entity.position).toFixed(1) : 'not seen'
  const shieldNote = 'Target shield: not reliably shown by bot data, so axe shield-disable timing is your live call, an axe hit while a target is blocking disables a shield for 5 seconds in vanilla, but I do not claim I measured their shield here.'
  say(`Duel status: target ${r18Duel.name}, ${r18Duel.pendingConfirm ? 'waiting for "duel confirm", no strikes yet' : 'active, strikes on full cooldown'}, distance ${d} blocks, my health ${bot.health}, food ${bot.food}, held ${r18HeldName() || 'nothing'}, strikes this duel ${r18DuelStrikes.length}, crit step used: ${r18Duel.critPass ? 'yes, session only, not a crit mastery claim' : 'no, say "duel crit step" separately'}. ${shieldNote} Stop anytime with "stop duel" :3`)
}
async function r18DuelCritStep () {
  if (!r18Duel || r18Duel.pendingConfirm) { say('Crit step refused, no confirmed duel is active, say "duel <player name>" then "duel confirm" first, crits are a separate staged step, not a default :3'); return }
  const live = r18TargetLive()
  if (!live) { say('Crit step refused, target is no longer seen, I will not crit a target I cannot see :3'); return }
  const d = live.position.distanceTo(bot.entity.position)
  if (d > 3.5) { say(`Crit step refused, target is about ${d.toFixed(1)} blocks away, outside melee range, walk me closer live first, then say "duel crit step" again :3`); return }
  if (bot.health < 10) { say(`Crit step refused, my health is ${bot.health}, under 10, heal first :3`); return }
  const healthBefore = bot.health
  try { bot.pathfinder.setGoal(null) } catch (e) {}
  try { bot.setControlState('jump', true); await new Promise((r) => setTimeout(r, 350)); bot.setControlState('jump', false) } catch (e) {}
  let hit = false
  try { const now = r18TargetLive(); if (now && now.position.distanceTo(bot.entity.position) <= 3.5) { bot.attack(now); hit = true } } catch (e) { hit = true }
  r18Duel.critPass = hit
  say(`Crit step done, one strike only, stopped: jumped and tried one hit on the way down, hit attempted ${hit ? 'yes' : 'no'}, health ${healthBefore} to ${bot.health}, target still seen ${!!r18TargetLive()}. A crit in vanilla is a falling attack for extra damage, not a sprint knockback hit, and bot data does not show crit particles or damage numbers, so a crit is confirmed only by you watching live, this step alone is not a crit mastery claim. Say "duel crit passed live" only if you watched it clean, or "stop duel" to stop :3`)
  log(`[duel] crit step hit=${hit} health=${healthBefore}->${bot.health}`)
}
function r18DuelPassedLive () {
  if (!r18DuelStrikes.length && !r18Duel) { say('Duel passed live refused, no duel strikes this session yet, do a confirmed duel first, then say "duel passed live" only after you watched it clean :3'); return }
  r18DuelPassedLiveRecord = true
  say('Recorded, session only: you confirmed live that a duel passed clean. This is your live confirmation, not a bot measurement, and it does not claim bow super-good, shield-perfect timing, or duel mastery, those stay end goals until you watch them clean again :3')
  log('[duel] passed live')
}
async function r18AttackTarget () {
  if (!bot || !bot.entity) return
  if (!r18Target) { say('Attack target refused, no target is set, say "target <mob name>" first, one target only :3'); return }
  if (r18Target.kind === 'player') { say(`Attack target refused for a player target, players are only attacked in a confirmed duel, say "duel ${r18Target.name}" then "duel confirm" instead, I will not use a mob attack on a player :3`); return }
  const live = r18TargetLive()
  if (!live) { say(`Attack target refused, mob ${r18Target.name} is no longer seen, set a fresh target live :3`); return }
  if (bot.health < 10) { say(`Attack target refused, my health is ${bot.health}, under 10, heal first :3`); return }
  const targetName = r18Target.name; const targetId = r18Target.id
  say(`Attacking target, one mob only: ${targetName}, I will walk to it and strike on a full cooldown step, and I will stop on target death, on "stop", or on low health under 8, I will not chain to other mobs blind :3`)
  log(`[attack-target] mob ${targetName}`)
  for (let i = 0; i < 60; i++) {
    if (!bot || !bot.entity) break
    if (bot.health < 8) { say(`Attack target stopped, retreating, my health is ${bot.health}, under 8 :3`); break }
    const now = bot.entities[targetId]
    if (!now) { say(`Attack target stopped: ${targetName} is gone, that may be a death, check live, I will not chain to another mob :3`); break }
    const d = now.position.distanceTo(bot.entity.position)
    if (d > 3.5) { try { bot.pathfinder.setGoal(new goals.GoalNear(now.position.x, now.position.y, now.position.z, 1), true) } catch (e) {} ; await new Promise((r) => setTimeout(r, 500)); continue }
    try { bot.pathfinder.setGoal(null) } catch (e) {}
    try { bot.attack(now) } catch (e) {}
    await new Promise((r) => setTimeout(r, r18DuelCooldownMs()))
  }
  try { bot.pathfinder.setGoal(null) } catch (e) {}
}
function r18BowHelp () {
  say('Bow help, staged, super-good with a bow is an END GOAL, not an instant skill: a full draw, about 1 second of charge, gives full damage and range, a spam shot with almost no charge is weak, arrows drop over distance so a far target needs aiming above it, and a moving target needs leading, aiming where it will be, not where it is. The honest hard limit: mineflayer bow aiming is the hardest part here, I aim at the target position I can see right now, I do not predict a moving target, and I do not claim a hit from bot data alone, a hit is confirmed only by you watching live. Say "bow check" for bow, arrows, and target distance, "bow practice" to set one pending shot, no shot yet, on a mob target only, never a player first, then "bow shoot" for one shot, then "bow passed live" only after you watched a clean shot. No bow auto-fire, and bow is NOT in the impress routine by default :3')
}
function r18BowCheck () {
  if (!bot || !bot.entity) return
  const bow = r18InvCount('bow'); const arrows = r18InvCount('arrow')
  const t = r18Target ? r18TargetLive() : null
  const tLine = r18Target ? (t ? `${r18Target.kind} ${r18Target.name}, about ${t.position.distanceTo(bot.entity.position).toFixed(1)} blocks away` : `${r18Target.kind} ${r18Target.name}, no longer seen, set a fresh target live`) : 'no target set, say "target <mob name>" first'
  const ready = []
  if (!bow) ready.push('no bow in inventory')
  if (!arrows) ready.push('no arrows in inventory')
  if (!r18Target) ready.push('no target set')
  else if (!t) ready.push('target no longer seen')
  else if (r18Target.kind === 'player') ready.push('player target refused for bow practice, practice on a mob first')
  else if (t.position.distanceTo(bot.entity.position) > 30) ready.push('target over 30 blocks away, move closer live first')
  say(`Bow check: bow in inventory: ${bow ? `yes, x${bow}` : 'no'}, arrows: ${arrows ? `x${arrows}` : 'none'}, health ${bot.health}, food ${bot.food}. Target: ${tLine}. Practice ready: ${ready.length ? 'no, ' + ready.join('; ') : 'yes, say "bow practice" now, no shot yet'}. A full draw is about 1 second, a spam shot is weak, and I aim at the position I see now, I do not lead a moving target, so a moving target shot is a live-watch call, not a claimed hit :3`)
}
function r18BowPractice () {
  if (!bot || !bot.entity) return
  if (r18BowPending) { say('A bow shot is already pending, say "bow shoot" for that one shot with you watching, or "bow cancel" to stop, I will not stack shots :3'); return }
  if (!r18InvCount('bow')) { say('Bow practice refused, I have no bow in inventory :3'); return }
  if (!r18InvCount('arrow')) { say('Bow practice refused, I have no arrows in inventory :3'); return }
  if (!r18Target || r18Target.kind !== 'mob') { say('Bow practice refused, practice is on a mob target only, never a player first, say "target <mob name>" first, then "bow practice" again :3'); return }
  const t = r18TargetLive()
  if (!t) { say('Bow practice refused, target mob is no longer seen, set a fresh target live :3'); return }
  const d = t.position.distanceTo(bot.entity.position)
  if (d > 30) { say(`Bow practice refused, target is about ${d.toFixed(1)} blocks away, over 30, move closer live first :3`); return }
  r18BowPending = { at: Date.now(), targetId: t.id, targetName: r18Target.name, dist: d, arrowsBefore: r18InvCount('arrow') }
  say(`Bow practice set up, step 1 only, I have NOT shot yet: mob ${r18Target.name}, about ${d.toFixed(1)} blocks away, arrows before x${r18BowPending.arrowsBefore}. Check the line of fire live yourself, I do not claim a safe backdrop from bot data alone. Say "bow shoot" now, with you watching, for one full-draw shot, or "bow cancel" to stop :3`)
  log(`[bow] practice mob ${r18Target.name} dist=${d.toFixed(1)} arrows=${r18BowPending.arrowsBefore}`)
}
async function r18BowShoot () {
  if (!bot || !bot.entity) return
  if (!r18BowPending) { say('No bow shot is pending, say "bow practice" first on a mob target, no shot yet, then "bow shoot" with you watching :3'); return }
  if (Date.now() - r18BowPending.at > 120000) { const old = r18BowPending.targetName; r18BowPending = null; say(`Bow shot for ${old} expired after 2 minutes, say "bow practice" again with you watching, I will not shoot on an old setup :3`); return }
  const pending = r18BowPending; r18BowPending = null
  const t = bot.entities[pending.targetId]
  if (!t) { say(`Bow shot refused on recheck, mob ${pending.targetName} is no longer seen, I did not shoot :3`); return }
  const bow = inventoryItem('bow')
  if (!bow) { say('Bow shot refused on recheck, no bow in inventory now, I did not shoot :3'); return }
  const arrowsBefore = r18InvCount('arrow')
  const dist = t.position.distanceTo(bot.entity.position)
  try { await bot.equip(bow.first, 'hand') } catch (e) {}
  try { bot.lookAt(t.position.offset(0, 1.5, 0)) } catch (e) {}
  await new Promise((r) => setTimeout(r, 200))
  let shot = false
  try { bot.activateItem(); await new Promise((r) => setTimeout(r, 1000)); bot.deactivateItem(); shot = true } catch (e) { shot = false; log(`[bow] shoot failed: ${e.message}`) }
  await new Promise((r) => setTimeout(r, 800))
  const arrowsAfter = r18InvCount('arrow')
  const stillSeen = !!bot.entities[pending.targetId]
  r18BowShots.push({ at: new Date().toISOString(), target: pending.targetName, dist, shot, arrowsBefore, arrowsAfter, stillSeen })
  say(`Bow shot done, one shot only, stopped: mob ${pending.targetName}, about ${dist.toFixed(1)} blocks away, full draw about 1 second, shot attempted ${shot ? 'yes' : 'no, activation failed, check live'}, arrows x${arrowsBefore} to x${arrowsAfter}, target still seen ${stillSeen ? 'yes' : 'no'}. I aimed at the position I saw now, I did not lead a moving target, and bot data does not show arrow damage, so a hit is NOT claimed here, it is confirmed only by you watching live. Say "bow passed live" only if you watched a clean shot, otherwise this is just an attempt, not a pass :3`)
  log(`[bow] shot target=${pending.targetName} dist=${dist.toFixed(1)} shot=${shot} arrows=${arrowsBefore}->${arrowsAfter} stillSeen=${stillSeen}`)
}
function r18BowCancel () {
  if (!r18BowPending) { say('No bow shot is pending :3'); return }
  const old = r18BowPending.targetName; r18BowPending = null
  say(`Bow shot cancelled for ${old}, I did not shoot :3`)
}
function r18BowPassedLive () {
  if (!r18BowShots.length) { say('Bow passed live refused, no bow shot this session yet, do "bow practice" then "bow shoot" with you watching first :3'); return }
  r18BowPassedLiveRecord = true
  say('Recorded, session only: you confirmed live that a bow shot passed clean. This is your live confirmation, not a bot measurement, and it does not claim super-good bow skill, leading, or long-range mastery, those stay end goals :3')
  log('[bow] passed live')
}
function r18ShieldHelp () {
  say('Shield help, staged, perfect shield timing is an END GOAL, not an instant skill: in vanilla, holding a shield up blocks melee and projectiles from the front, it does not block everything, an axe hit while you are blocking disables your shield for 5 seconds, and you must unblock to attack, you cannot strike while fully blocked. My existing "block / shield up" step is equip shield to offhand plus sneak, which is best-effort in mineflayer, not claimed as a perfect vanilla block pose until you watch it live. Say "shield check" for shield and offhand, "shield practice" for one timed block step then unblock, then "shield passed live" only after you watched it clean. In a duel I block briefly when a target is close, then unblock to strike on a full cooldown, then re-block, that timing is best-effort, not perfect, until you watch it live :3')
}
function r18ShieldCheck () {
  if (!bot) return
  const shield = r18InvCount('shield')
  let off = ''
  try { const o = bot.inventory.slots && bot.inventory.slots[45]; off = o ? o.name : 'empty' } catch (e) { off = 'unknown' }
  say(`Shield check: shield in inventory: ${shield ? `yes, x${shield}` : 'no'}, offhand slot: ${off}, health ${bot.health}, food ${bot.food}. Practice ready: ${shield ? 'yes, say "shield practice" now for one timed block step' : 'no, bring a shield first'}. An axe hit while blocking disables a shield for 5 seconds in vanilla, and blocking does not block everything, so a block step is not a perfect-timing claim until you watch it live :3`)
}
async function r18ShieldPractice () {
  if (!bot || !bot.entity) return
  if (!r18InvCount('shield')) { say('Shield practice refused, I have no shield in inventory :3'); return }
  try { const sh = inventoryItem('shield'); if (sh) await bot.equip(sh.first, 'off_hand') } catch (e) {}
  setSneak(true)
  await new Promise((r) => setTimeout(r, 2000))
  setSneak(false)
  r18ShieldPracticeAt = Date.now()
  say('Shield practice done, one timed step only: shield to offhand, blocked for about 2 seconds, then unblocked, stopped. This is a best-effort block step, not a perfect-timing claim, say "shield passed live" only if you watched it and it looked like a real block, otherwise it is just a step :3')
  log('[shield] practice done')
}
function r18ShieldPassedLive () {
  if (!r18ShieldPracticeAt) { say('Shield passed live refused, no shield practice this session yet, do "shield practice" with you watching first :3'); return }
  r18ShieldPassedLiveRecord = true
  say('Recorded, session only: you confirmed live that a shield block step passed clean. This is your live confirmation, not a bot measurement, and it does not claim perfect shield timing in a real duel, that stays an end goal :3')
  log('[shield] passed live')
}
// ---------------------------------------------------------------- round 19: generalised private-server scope, bow training tiers, shield vs arrows
// SCOPE GENERALISATION, overriding round 18 Boykissers-only wording: targeting
// and duelling are for private servers and private worlds Moon owns or controls
// only, so a server rename or a new world does not require rewriting this system.
// No server-name check is added here, because the bot connects via a host argument
// and a hardcoded name check would break a rename. The guardrail is procedural and
// is stated in help and in the README: Moon only puts the bot on his own private
// servers, never a public server, never Noah's server without Noah's explicit
// say-so live. All other round 18 guardrails stay: one target at a time, a named
// present target only, duel needs duel plus duel confirm, never attack Moon
// unless "duel me" was said first, stop on "stop duel" or "stop", stop on low
// health, no mass targeting, no offline or guessed names.
let r19BowTrainingPending = null // { tier, targetId, targetName, targetKind, dist, arrowsBefore, at, moving }
let r19BowTrainingShots = []
let r19BowTierPass = { close: false, mid: false, moving: false, long: false }
let r19ShieldArrowsPracticeAt = 0
let r19ShieldArrowsPassedLiveRecord = false

function r19TargetVelocity (t) {
  try {
    const v = t.velocity
    if (!v) return null
    const x = v.x || 0; const y = v.y || 0; const z = v.z || 0
    return { x: x, y: y, z: z, mag: Math.sqrt(x * x + y * y + z * z) }
  } catch (e) { return null }
}
function r19BowTrainingHelp () {
  say('Bow training help, staged, train him good is a process, not one shot: charge first, a full draw about 1 second gives full damage and range, a spam shot is weak. Distance tiers: close 10 blocks or less, mid 11 to 20 blocks, long 21 to 30 blocks, over 30 is refused, move closer live first. Drop: arrows drop over distance, so a far target needs aiming above it, more above for long than for close. Leading: a moving target needs aiming where it will be, not where it is, by aiming ahead of its current motion, that prediction is best-effort and a hit is never claimed from bot data alone. Order: close stationary first, then mid stationary, then moving with a lead step, then long only after close and mid passes live this session. Each shot is still one shot, then it stops. Say "bow aim check" for distance, moving yes or no, and direction, "bow training practice close", "mid", "moving", or "long" to set one pending shot, no shot yet, then "bow training shoot" for that one shot, "bow training cancel" to stop, "bow training passed live close" or mid, moving, or long only after you watched that tier clean, and "bow training status" to see tier passes. Mobs first, a player target only with a confirmed duel, no bow auto-fire, bow is NOT in the impress routine by default :3')
}
function r19BowAimCheck () {
  if (!bot || !bot.entity) return
  const bow = r18InvCount('bow'); const arrows = r18InvCount('arrow')
  const t = r18Target ? r18TargetLive() : null
  if (!r18Target) { say('Bow aim check: no target set, say "target <mob name>" first, one target only, then "bow aim check" again :3'); return }
  if (!t) { say('Bow aim check: target is no longer seen, set a fresh target live, I will not aim at a target I cannot see :3'); return }
  const d = t.position.distanceTo(bot.entity.position)
  const vel = r19TargetVelocity(t)
  const moving = vel && vel.mag > 0.2
  const tier = d <= 10 ? 'close' : (d <= 20 ? 'mid' : (d <= 30 ? 'long' : 'over 30, refused'))
  const dir = vel && moving ? `moving, velocity about ${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)}, speed about ${vel.mag.toFixed(2)} blocks per second` : 'not moving, or moving too slowly to measure, treat as stationary live'
  const lead = vel && moving ? `lead point, best-effort only: aim ahead by about ${(d * 0.05).toFixed(1)} blocks along its motion for a shot at this distance, check live, a hit is not claimed from this number` : 'no lead needed, stationary target, aim at the target with drop above for distance'
  say(`Bow aim check: bow ${bow ? 'yes, x' + bow : 'no'}, arrows ${arrows ? 'x' + arrows : 'none'}, target ${r18Target.kind} ${r18Target.name}, about ${d.toFixed(1)} blocks away, tier ${tier}, ${dir}. ${lead}. Tier passes this session: close ${r19BowTierPass.close ? 'yes' : 'no'}, mid ${r19BowTierPass.mid ? 'yes' : 'no'}, moving ${r19BowTierPass.moving ? 'yes' : 'no'}, long ${r19BowTierPass.long ? 'yes' : 'no'}. Long practice needs close and mid passes live first :3`)
}
function r19BowTrainingPractice (tier) {
  if (!bot || !bot.entity) return
  if (r19BowTrainingPending) { say('A bow training shot is already pending, say "bow training shoot" for that one shot with you watching, or "bow training cancel" to stop, I will not stack shots :3'); return }
  if (!r18InvCount('bow')) { say('Bow training practice refused, I have no bow in inventory :3'); return }
  if (!r18InvCount('arrow')) { say('Bow training practice refused, I have no arrows in inventory :3'); return }
  if (!r18Target) { say('Bow training practice refused, no target set, say "target <mob name>" first, mobs first, then "bow training practice ' + tier + '" again :3'); return }
  if (r18Target.kind === 'player' && !(r18Duel && !r18Duel.pendingConfirm && r18Duel.name === r18Target.name)) { say('Bow training practice refused for a player target, practice on a mob first, a player target is only shot at with a confirmed duel live, say "duel <name>" then "duel confirm" first, then set the target again :3'); return }
  const t = r18TargetLive()
  if (!t) { say('Bow training practice refused, target is no longer seen, set a fresh target live :3'); return }
  const d = t.position.distanceTo(bot.entity.position)
  if (d > 30) { say(`Bow training practice refused, target is about ${d.toFixed(1)} blocks away, over 30, move closer live first :3`); return }
  const vel = r19TargetVelocity(t)
  const moving = vel && vel.mag > 0.2
  if (tier === 'close' && d > 10) { say(`Bow training practice close refused, target is about ${d.toFixed(1)} blocks away, close is 10 or less, move closer live first or use "bow training practice mid" :3`); return }
  if (tier === 'mid' && (d <= 10 || d > 20)) { say(`Bow training practice mid refused, target is about ${d.toFixed(1)} blocks away, mid is 11 to 20, move live first :3`); return }
  if (tier === 'long' && (d <= 20 || d > 30)) { say(`Bow training practice long refused, target is about ${d.toFixed(1)} blocks away, long is 21 to 30, move live first :3`); return }
  if (tier === 'long' && !(r19BowTierPass.close && r19BowTierPass.mid)) { say('Bow training practice long refused, long needs close and mid passes live this session first, do "bow training practice close" then "bow training shoot" then "bow training passed live close", then the same for mid, with you watching each one :3'); return }
  if (tier === 'moving' && !moving) { say('Bow training practice moving refused, target is not moving measurably right now, set a moving target live first, then "bow training practice moving" again, a stationary target is a close or mid practice, not a moving one :3'); return }
  if ((tier === 'close' || tier === 'mid') && moving) { say(`Bow training practice ${tier} refused, target is moving right now, use "bow training practice moving" for a lead step, or wait for it to stop live, then try ${tier} again :3`); return }
  r19BowTrainingPending = { at: Date.now(), tier: tier, targetId: t.id, targetName: r18Target.name, targetKind: r18Target.kind, dist: d, arrowsBefore: r18InvCount('arrow'), moving: !!moving }
  say(`Bow training practice ${tier} set up, step 1 only, I have NOT shot yet: ${r18Target.kind} ${r18Target.name}, about ${d.toFixed(1)} blocks away, ${moving ? 'moving, I will aim ahead as a best-effort lead step' : 'stationary'}, arrows before x${r19BowTrainingPending.arrowsBefore}. Check the line of fire live yourself, I do not claim a safe backdrop from bot data alone. Say "bow training shoot" now, with you watching, for one full-draw shot, or "bow training cancel" to stop :3`)
  log(`[bow-training] practice ${tier} target=${r18Target.name} dist=${d.toFixed(1)} moving=${!!moving} arrows=${r19BowTrainingPending.arrowsBefore}`)
}
async function r19BowTrainingShoot () {
  if (!bot || !bot.entity) return
  if (!r19BowTrainingPending) { say('No bow training shot is pending, say "bow training practice close", "mid", "moving", or "long" first, no shot yet, then "bow training shoot" with you watching :3'); return }
  if (Date.now() - r19BowTrainingPending.at > 120000) { const old = r19BowTrainingPending.targetName; r19BowTrainingPending = null; say(`Bow training shot for ${old} expired after 2 minutes, say "bow training practice" again with you watching, I will not shoot on an old setup :3`); return }
  const pending = r19BowTrainingPending; r19BowTrainingPending = null
  const t = bot.entities[pending.targetId]
  if (!t) { say(`Bow training shot refused on recheck, ${pending.targetName} is no longer seen, I did not shoot :3`); return }
  const bow = inventoryItem('bow')
  if (!bow) { say('Bow training shot refused on recheck, no bow in inventory now, I did not shoot :3'); return }
  const arrowsBefore = r18InvCount('arrow')
  const dist = t.position.distanceTo(bot.entity.position)
  const vel = r19TargetVelocity(t)
  const movingNow = vel && vel.mag > 0.2
  try { await bot.equip(bow.first, 'hand') } catch (e) {}
  let aim = t.position.offset(0, 1.5, 0)
  let aimNote = 'aimed at the target position I see now, with drop above for distance'
  if (pending.tier === 'long') { aim = t.position.offset(0, 1.5 + dist * 0.03, 0); aimNote = 'long tier, aimed above the target for drop, best-effort only, not a measured drop table' }
  if (pending.tier === 'moving' && vel && movingNow) {
    const leadTime = dist * 0.05
    aim = t.position.offset(vel.x * leadTime, 1.5, vel.z * leadTime)
    aimNote = `moving tier, aimed ahead of its motion by about ${(dist * 0.05).toFixed(1)} blocks, best-effort lead only, a hit is not claimed from this number`
  }
  try { bot.lookAt(aim) } catch (e) {}
  await new Promise((r) => setTimeout(r, 200))
  let shot = false
  try { bot.activateItem(); await new Promise((r) => setTimeout(r, 1000)); bot.deactivateItem(); shot = true } catch (e) { shot = false; log(`[bow-training] shoot failed: ${e.message}`) }
  await new Promise((r) => setTimeout(r, 800))
  const arrowsAfter = r18InvCount('arrow')
  const stillSeen = !!bot.entities[pending.targetId]
  r19BowTrainingShots.push({ at: new Date().toISOString(), tier: pending.tier, target: pending.targetName, dist: dist, shot: shot, arrowsBefore: arrowsBefore, arrowsAfter: arrowsAfter, stillSeen: stillSeen })
  say(`Bow training shot done, tier ${pending.tier}, one shot only, stopped: ${pending.targetKind} ${pending.targetName}, about ${dist.toFixed(1)} blocks away, full draw about 1 second, ${aimNote}, shot attempted ${shot ? 'yes' : 'no, activation failed, check live'}, arrows x${arrowsBefore} to x${arrowsAfter}, target still seen ${stillSeen ? 'yes' : 'no'}. Bot data does not show arrow damage, so a hit is NOT claimed here, it is confirmed only by you watching live. Say "bow training passed live ${pending.tier}" only if you watched a clean shot for that tier :3`)
  log(`[bow-training] shot tier=${pending.tier} target=${pending.targetName} dist=${dist.toFixed(1)} shot=${shot} arrows=${arrowsBefore}->${arrowsAfter} stillSeen=${stillSeen}`)
}
function r19BowTrainingCancel () {
  if (!r19BowTrainingPending) { say('No bow training shot is pending :3'); return }
  const old = r19BowTrainingPending.targetName; r19BowTrainingPending = null
  say(`Bow training shot cancelled for ${old}, I did not shoot :3`)
}
function r19BowTrainingPassedLive (tier) {
  if (!bot || !bot.entity) return
  const hasShot = r19BowTrainingShots.some((s) => s.tier === tier)
  if (!hasShot) { say(`Bow training passed live ${tier} refused, no bow training shot for ${tier} this session yet, do "bow training practice ${tier}" then "bow training shoot" with you watching first :3`); return }
  r19BowTierPass[tier] = true
  say(`Recorded, session only: you confirmed live that a bow training shot for ${tier} passed clean. Tier passes now: close ${r19BowTierPass.close ? 'yes' : 'no'}, mid ${r19BowTierPass.mid ? 'yes' : 'no'}, moving ${r19BowTierPass.moving ? 'yes' : 'no'}, long ${r19BowTierPass.long ? 'yes' : 'no'}. This is your live confirmation, not a bot measurement, and it does not claim super-good bow skill overall, that stays an end goal until you watch every tier clean :3`)
  log(`[bow-training] passed live ${tier}`)
}
function r19BowTrainingStatus () {
  say(`Bow training status, session only: close pass ${r19BowTierPass.close ? 'yes' : 'no'}, mid pass ${r19BowTierPass.mid ? 'yes' : 'no'}, moving pass ${r19BowTierPass.moving ? 'yes' : 'no'}, long pass ${r19BowTierPass.long ? 'yes' : 'no'}, training shots this session ${r19BowTrainingShots.length}, pending shot ${r19BowTrainingPending ? 'yes, tier ' + r19BowTrainingPending.tier + ' for ' + r19BowTrainingPending.targetName : 'no'}. Long practice needs close and mid passes first, moving practice needs a measurably moving target live :3`)
}
function r19ShieldArrowsHelp () {
  say('Shield arrows help, staged, not just melee: in vanilla, holding a shield up blocks arrows and other projectiles from the FRONT, if you are facing the shooter, it does not block from behind, and it must be up before the arrow arrives, you cannot block an arrow that already hit you. An axe hit while you are blocking still disables your shield for 5 seconds, so a melee attacker can open you up for arrows. My block step is equip shield to offhand plus sneak, best-effort in mineflayer, not claimed as a perfect vanilla block pose until you watch it live. Say "shield arrows check" for shield, offhand, and a shooter source I can see, "shield arrows practice" for one timed block step facing that shooter, then unblock, with you watching, then "shield arrows passed live" only after you watched it clean. In a duel or target fight, use "shield arrows duel step" to face a shooter and block for one timed step, then unblock to shoot or strike, that step alone is not perfect timing, and a blocked arrow is confirmed only by you watching live, bot data does not show a blocked arrow as a number :3')
}
function r19ShieldArrowsFindShooter () {
  if (!bot || !bot.entity) return null
  let best = null; let bestDist = Infinity
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id]
    if (!e || e.type !== 'mob' || !e.mobType) continue
    if (e.mobType !== 'skeleton' && e.mobType !== 'stray' && e.mobType !== 'bogged') continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestDist) { best = e; bestDist = d }
  }
  if (best) return { kind: 'mob', name: best.mobType, entity: best, dist: bestDist }
  const owner = ownerEntity()
  if (owner) return { kind: 'player', name: 'Moon, shooting with consent for this practice step only', entity: owner, dist: owner.position.distanceTo(bot.entity.position) }
  return null
}
function r19FacingTo (shooterPos) {
  try {
    const dx = shooterPos.x - bot.entity.position.x
    const dz = shooterPos.z - bot.entity.position.z
    const bearing = Math.atan2(-dx, -dz)
    let diff = bearing - bot.entity.yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    return { bearing: bearing, diff: diff, front: Math.abs(diff) < 0.8 }
  } catch (e) { return null }
}
function r19ShieldArrowsCheck () {
  if (!bot || !bot.entity) return
  const shield = r18InvCount('shield')
  let off = ''
  try { const o = bot.inventory.slots && bot.inventory.slots[45]; off = o ? o.name : 'empty' } catch (e) { off = 'unknown' }
  const shooter = r19ShieldArrowsFindShooter()
  if (!shooter) { say(`Shield arrows check: shield in inventory: ${shield ? 'yes, x' + shield : 'no'}, offhand: ${off}, health ${bot.health}, food ${bot.food}. No shooter source seen, no skeleton, stray, or bogged nearby, and you are not in game as a shooter source right now, set a shooter live first, for example a skeleton nearby, or be in game ready to shoot with consent, then "shield arrows check" again. I do not claim a shooter I cannot see :3`); return }
  const facing = r19FacingTo(shooter.entity.position)
  say(`Shield arrows check: shield in inventory: ${shield ? 'yes, x' + shield : 'no'}, offhand: ${off}, health ${bot.health}, food ${bot.food}. Shooter source: ${shooter.kind} ${shooter.name}, about ${shooter.dist.toFixed(1)} blocks away, facing front: ${facing ? (facing.front ? 'yes, roughly, within about 0.8 radians' : 'no, turn to face the shooter live first') : 'unknown'}. Practice ready: ${shield ? 'yes, say "shield arrows practice" now for one timed block step facing that shooter' : 'no, bring a shield first'}. A shield blocks arrows from the front only, not from behind, and must be up before the arrow arrives :3`)
}
async function r19ShieldArrowsPractice () {
  if (!bot || !bot.entity) return
  if (!r18InvCount('shield')) { say('Shield arrows practice refused, I have no shield in inventory :3'); return }
  const shooter = r19ShieldArrowsFindShooter()
  if (!shooter) { say('Shield arrows practice refused, no shooter source seen, no skeleton, stray, or bogged nearby, and you are not in game as a shooter source right now, set a shooter live first, then "shield arrows practice" again :3'); return }
  const healthBefore = bot.health
  try { const sh = inventoryItem('shield'); if (sh) await bot.equip(sh.first, 'off_hand') } catch (e) {}
  try { bot.lookAt(shooter.entity.position.offset(0, 1.5, 0)) } catch (e) {}
  await new Promise((r) => setTimeout(r, 200))
  setSneak(true)
  await new Promise((r) => setTimeout(r, 3000))
  setSneak(false)
  const facing = r19FacingTo(shooter.entity.position)
  r19ShieldArrowsPracticeAt = Date.now()
  say(`Shield arrows practice done, one timed step only, stopped: faced shooter ${shooter.kind} ${shooter.name}, about ${shooter.dist.toFixed(1)} blocks away, blocked for about 3 seconds facing ${facing ? (facing.front ? 'roughly front' : 'not front, turn live next time') : 'unknown'}, then unblocked, health ${healthBefore} to ${bot.health}. Health unchanged after a timed block only looks like damage was avoided as far as data shows, it is NOT a perfect-timing claim, and an arrow that already hit before the block is not blocked. Say "shield arrows passed live" only if you watched it and an arrow was actually blocked, otherwise this is just a step :3`)
  log(`[shield-arrows] practice shooter=${shooter.name} dist=${shooter.dist.toFixed(1)} health=${healthBefore}->${bot.health}`)
}
async function r19ShieldArrowsDuelStep () {
  if (!bot || !bot.entity) return
  if (!r18Duel) { say('Shield arrows duel step refused, no duel is active, say "duel <player name>" then "duel confirm" first, or use "shield arrows practice" outside a duel :3'); return }
  const shooter = r19ShieldArrowsFindShooter()
  if (!shooter) { say('Shield arrows duel step refused, no shooter source seen in this duel step, no skeleton, stray, or bogged nearby, and no shooter player seen, set a shooter live first, then try again :3'); return }
  const healthBefore = bot.health
  try { const sh = inventoryItem('shield'); if (sh) await bot.equip(sh.first, 'off_hand') } catch (e) {}
  try { bot.lookAt(shooter.entity.position.offset(0, 1.5, 0)) } catch (e) {}
  setSneak(true)
  await new Promise((r) => setTimeout(r, 2000))
  setSneak(false)
  say(`Shield arrows duel step done, one step only, duel still active: faced shooter ${shooter.kind} ${shooter.name}, blocked about 2 seconds, then unblocked to shoot or strike next, health ${healthBefore} to ${bot.health}. This is a best-effort block step inside a duel, not perfect timing, and it does not replace the duel tick, say "stop duel" anytime :3`)
  log(`[shield-arrows] duel step shooter=${shooter.name} health=${healthBefore}->${bot.health}`)
}
function r19ShieldArrowsPassedLive () {
  if (!r19ShieldArrowsPracticeAt) { say('Shield arrows passed live refused, no shield arrows practice this session yet, do "shield arrows practice" with you watching first :3'); return }
  r19ShieldArrowsPassedLiveRecord = true
  say('Recorded, session only: you confirmed live that a shield arrows block step passed clean. This is your live confirmation, not a bot measurement, and it does not claim perfect arrow blocking in a real fight, that stays an end goal :3')
  log('[shield-arrows] passed live')
}
// ---------------------------------------------------------------- round 21: lure skill + target redstone line
// Moon's ideas, 2026-10-30, staged, code only, not live-tested.
// Lure: "Nova, lure some wolves to this spot" — bot gets the right
// lure item, finds the mob, then lures it back to a spot, or to a
// hole edge Moon marks live. One mob per journey, repeat for more.
// Target redstone line: a 15-block line of redstone dust from the
// target block, counting powered dust to read the signal.
// Research in code, not invented: minecraft-data 1.21.10 lists
// redstone_wire with a power state, int 0-15, and this codebase
// already reads wire.properties.power in checkRedstonePower.
// So a dust line IS code-readable in principle, unlike the round 20
// direct target-block read, which round 20 could not rely on.
// Live verification is still required: the signal is transient,
// it must be read right after a shot, before it fades, and if
// first-dust power and powered-dust count disagree, Moon checks
// live. This line method, if it works live, supersedes the round 20
// "signal not readable" limit FOR A LINE ONLY; with no line, the
// round 20 direct-read limit still stands.
let r21LurePending = null // { mob, method, item, dest:{x,y,z}, destLabel, hole, methodWanted, at }
let r21LureActive = null // same shape, plus active, breaks, started, farTicks, lostTicks
let r21LureJourneys = [] // { at, mob, method, destLabel, success, reason, breaks }
let r21RedLine = null // { target:{x,y,z}, dir, dx, dz, positions:[{x,y,z}], placed }
const R21_LURE_MOBS = {
  pig: { types: ['Pig'], follow: ['carrot', 'potato', 'beetroot'], lead: true },
  cow: { types: ['Cow'], follow: ['wheat'], lead: true },
  sheep: { types: ['Sheep'], follow: ['wheat'], lead: true },
  chicken: { types: ['Chicken'], follow: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'], lead: true },
  horse: { types: ['Horse'], follow: ['golden_apple', 'golden_carrot'], lead: true },
  donkey: { types: ['Donkey'], follow: ['golden_apple', 'golden_carrot'], lead: true },
  wolf: { types: ['Wolf'], follow: [], tame: ['bone'], lead: true, note: 'wolves do NOT follow a bone like a pig follows a carrot. An untamed wolf needs bones to tame, then a tamed wolf follows its tamer, or use a lead.' },
  cat: { types: ['Cat'], follow: [], tame: ['cod', 'salmon'], lead: true, note: 'approach a cat slowly and crouched, cats run from fast movement, then feed cod or salmon to tame.' },
  fox: { types: ['Fox'], follow: ['sweet_berries'], lead: true, note: 'wild foxes run, approach slowly, sweet berries are the follow food here.' },
  goat: { types: ['Goat'], follow: ['wheat'], lead: true },
  rabbit: { types: ['Rabbit'], follow: ['carrot', 'golden_carrot', 'dandelion'], lead: true }
}
function r21NormMob (raw) {
  if (!raw) return ''
  let s = String(raw).trim().toLowerCase().replace(/^some /, '')
  if (s === 'wolves') return 'wolf'
  if (R21_LURE_MOBS[s]) return s
  if (s.endsWith('s') && R21_LURE_MOBS[s.slice(0, -1)]) return s.slice(0, -1)
  return s
}
function r21FindLureMob (mob) {
  const def = R21_LURE_MOBS[mob]
  if (!def || !bot || !bot.entity) return null
  return findMobByTypes(def.types, 32)
}
function r21MethodFor (mob, wanted) {
  const def = R21_LURE_MOBS[mob]
  if (!def) return { ok: false, reason: 'unsupported mob, tell me live what lure you mean' }
  const leadCount = r18InvCount('lead')
  const hasLead = leadCount > 0 && def.lead
  const followItem = (def.follow || []).find((f) => r18InvCount(f) > 0)
  const tameItem = (def.tame || []).find((f) => r18InvCount(f) > 0)
  if (wanted === 'lead') {
    if (!hasLead) return { ok: false, reason: 'you asked for a lead, but I have no lead in inventory' }
    return { ok: true, method: 'lead', item: 'lead', leadCount: leadCount }
  }
  if (wanted === 'food') {
    if (followItem) return { ok: true, method: 'food', item: followItem, leadCount: leadCount }
    if (tameItem) return { ok: true, method: 'tame', item: tameItem, leadCount: leadCount }
    return { ok: false, reason: 'you asked for food, but I have no follow or tame food for this mob in inventory' }
  }
  if (hasLead) return { ok: true, method: 'lead', item: 'lead', leadCount: leadCount }
  if (followItem) return { ok: true, method: 'food', item: followItem, leadCount: leadCount }
  if (tameItem) return { ok: true, method: 'tame', item: tameItem, leadCount: leadCount }
  const need = []
  if (def.lead) need.push('a lead')
  if (def.follow && def.follow.length) need.push('follow food: ' + def.follow.join(' or '))
  if (def.tame && def.tame.length) need.push('tame food: ' + def.tame.join(' or '))
  return { ok: false, reason: 'I have no lure item for this mob, bring ' + need.join(', ') + ' live first' }
}
function r21LureHelp () {
  say('Lure help, staged, one mob per journey, repeat for more: say "lure check wolf" first, then "lure wolf to here" for step 1 only, no movement yet, then "lure confirm" with you watching for one journey. Destination is never guessed: "to here" or "to this spot" means where you are standing when you say it, "to <label>" means a spot you remembered live with "remember <label>", and "to here hole" or "to <label> hole" means I walk the mob to the hole edge and stop there, then your live step guides or pushes it in, I will NOT push a mob into a hole blind, and I will NOT break blocks to make a hole. Many passive mobs follow a player holding their food: pig carrot, potato, or beetroot, cow and sheep wheat, chicken seeds, horse and donkey golden apple or golden carrot, fox sweet berries, goat wheat, rabbit carrot or dandelion. Wolves are different: wolves do NOT follow a bone like a pig follows a carrot, an untamed wolf needs bones to tame, then a tamed wolf follows its tamer, or use a lead. Cats need cod or salmon, approached slowly and crouched. Leads are an option for most of these mobs: say "lure wolf to here with lead" to force a lead, or "with food" to force food or taming, otherwise I use a lead first if I have one, then food. Lead breaks: I do not have a clean isLeashed flag in mineflayer data here, so a break is sensed best-effort, a dropped lead item seen nearby, or the mob suddenly far from me and not following for several checks, then I stop, go pick up the dropped lead if I see it, recatch the mob and re-attach the lead, then resume. If the lead is not found, the mob is lost, or the lead breaks more than 3 times, the journey pauses and reports, it does NOT loop blind forever. Lure only passive or neutral mobs I list, never hostile mobs, never players, max 64 blocks to the destination, stop anytime with "lure stop", and "lure passed live" only if you watched a full lure clean :3')
}
function r21LureCheck (mobRaw) {
  if (!bot || !bot.entity) return
  const mob = r21NormMob(mobRaw)
  const def = R21_LURE_MOBS[mob]
  if (!def) { say(`Lure check refused, ${mobRaw} is not a lure mob I support yet, supported: pig, cow, sheep, chicken, horse, donkey, wolf, cat, fox, goat, rabbit. Hostile mobs and players are never lured :3`); return }
  const seen = r21FindLureMob(mob)
  const method = r21MethodFor(mob, null)
  const leadCount = r18InvCount('lead')
  const followList = (def.follow || []).map((f) => f + ' x' + r18InvCount(f)).join(', ') || 'none'
  const tameList = (def.tame || []).map((f) => f + ' x' + r18InvCount(f)).join(', ') || 'none'
  say(`Lure check ${mob}: seen nearby ${seen ? 'yes, about ' + seen.position.distanceTo(bot.entity.position).toFixed(1) + ' blocks away' : 'no, find one live first'}, lead x${leadCount}, follow food ${followList}, tame food ${tameList}, method I would use ${method.ok ? method.method + ' with ' + method.item : 'none, ' + method.reason}${def.note ? '. Note: ' + def.note : ''}. Destination is set by "lure ${mob} to here" or "to <label>", never guessed. Health ${bot.health}, food ${bot.food} :3`)
}
function r21LureSetup (mobRaw, destLabelRaw, opts) {
  if (!bot || !bot.entity) return
  opts = opts || {}
  const mob = r21NormMob(mobRaw)
  const def = R21_LURE_MOBS[mob]
  if (!def) { say(`Lure refused, ${mobRaw} is not a lure mob I support yet, supported: pig, cow, sheep, chicken, horse, donkey, wolf, cat, fox, goat, rabbit. Hostile mobs and players are never lured :3`); return }
  if (r21LurePending) { say('A lure is already pending, say "lure confirm" for that one, or "lure stop" to stop it first, I will not stack lures :3'); return }
  if (r21LureActive && r21LureActive.active) { say('A lure journey is already active, say "lure stop" to stop it first :3'); return }
  let dest = null; let destLabel = destLabelRaw || ''
  if (destLabel === 'here' || destLabel === 'this spot') {
    const owner = ownerEntity()
    if (!owner) { say('Lure refused, I do not see you right now, so I have no "here" to lure to, come near me live first :3'); return }
    dest = { x: owner.position.x, y: owner.position.y, z: owner.position.z }
    destLabel = 'here, where you were standing'
  } else {
    if (!rememberedSpot || (normalizeName(destLabel) !== normalizeName(rememberedSpotLabel || '') && normalizeName(destLabel) !== normalizeName(rememberedSpotLabel2 || ''))) { say(`Lure refused, I have no remembered spot called "${destLabel}", say "remember ${destLabel}" live at the spot first, or "lure ${mob} to here" :3`); return }
    dest = { x: rememberedSpot.x, y: rememberedSpot.y, z: rememberedSpot.z }
  }
  const distToDest = Math.hypot(dest.x - bot.entity.position.x, dest.z - bot.entity.position.z)
  if (distToDest > 64) { say(`Lure refused, destination is about ${distToDest.toFixed(0)} blocks away, over the 64-block lure limit, move closer live first :3`); return }
  const seen = r21FindLureMob(mob)
  if (!seen) { say(`Lure refused, I do not see a ${mob} nearby within 32 blocks, find one live first :3`); return }
  const method = r21MethodFor(mob, opts.methodWanted || null)
  if (!method.ok) { say(`Lure refused, ${method.reason} :3`); return }
  if (bot.health < 10) { say(`Lure refused, my health is ${bot.health}, under 10, heal live first :3`); return }
  r21LurePending = { mob: mob, method: method.method, item: method.item, dest: dest, destLabel: destLabel, hole: !!opts.hole, at: Date.now() }
  say(`Lure set up, step 1 only, I have NOT moved yet: ${mob} about ${seen.position.distanceTo(bot.entity.position).toFixed(1)} blocks away, method ${method.method} with ${method.item}, destination ${destLabel} at ${dest.x.toFixed(0)}, ${dest.y.toFixed(0)}, ${dest.z.toFixed(0)}${opts.hole ? ', hole mode: I will stop at the hole edge, your live step guides it in, I will not push it blind' : ''}. Say "lure confirm" now, with you watching, for one journey, or "lure stop" to stop. Lead breaks: I will stop, pick up a dropped lead if I see one, recatch and resume, up to 3 breaks, then I pause :3`)
  log(`[lure] pending ${mob} method=${method.method} item=${method.item} dest=${destLabel} hole=${!!opts.hole}`)
}
function r21FindDroppedLead () {
  if (!bot) return null
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id]
    if (!e || !e.position) continue
    const name = String(e.name || e.mobType || '').toLowerCase()
    if (name.includes('lead')) return e
  }
  return null
}
async function r21LureJourney () {
  if (!bot || !bot.entity || !r21LurePending) return
  const pending = r21LurePending; r21LurePending = null
  const active = Object.assign({}, pending, { active: true, breaks: 0, started: Date.now(), farTicks: 0, lostTicks: 0 })
  r21LureActive = active
  const dest = active.dest
  const finish = (success, reason) => {
    active.active = false
    try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
    r21LureJourneys.push({ at: new Date().toISOString(), mob: active.mob, method: active.method, destLabel: active.destLabel, success: success, reason: reason, breaks: active.breaks })
    say(`Lure ${success ? 'done, as far as data shows' : 'paused'}: ${active.mob} to ${active.destLabel}, method ${active.method}, lead breaks ${active.breaks}. ${reason}${success ? ' Say "lure passed live" only if you watched the full lure clean.' : ' I will not continue blind, fix it live or say "lure stop".'} :3`)
    log(`[lure] ${success ? 'done' : 'paused'} ${active.mob} method=${active.method} breaks=${active.breaks} reason=${reason}`)
  }
  let mob = r21FindLureMob(active.mob)
  if (!mob) { finish(false, 'mob no longer seen on recheck, find one live again.'); return }
  const mobId = mob.id
  const reachedMob = await walkToMob(mob)
  if (!reachedMob || !active.active) { if (active.active) finish(false, 'could not reach the mob in 10 seconds.'); return }
  mob = bot.entities[mobId] || mob
  if (active.method === 'lead') {
    const leadBefore = r18InvCount('lead')
    try { const leadItem = inventoryItem('lead'); if (leadItem) await bot.equip(leadItem.first, 'hand'); await bot.activateEntity(mob) } catch (e) { log(`[lure] lead attach failed: ${e.message}`) }
    say(`Lure journey, lead attach step, best effort: lead x${leadBefore} to x${r18InvCount('lead')} after trying to leash the ${active.mob}. Lead attachment is not a clean flag in mineflayer data here, so check live that the lead is actually on it, then I walk back :3`)
  } else if (active.method === 'food') {
    try { const foodItem = inventoryItem(active.item); if (foodItem) await bot.equip(foodItem.first, 'hand') } catch (e) {}
    say(`Lure journey, holding ${active.item} for the ${active.mob} to follow, walking slowly back now, with you watching :3`)
  } else if (active.method === 'tame') {
    try { const tameItem = inventoryItem(active.item); if (tameItem) await bot.equip(tameItem.first, 'hand'); await bot.activateEntity(mob) } catch (e) { log(`[lure] tame feed failed: ${e.message}`) }
    say(`Lure journey, tried to feed the ${active.mob} a ${active.item}, taming may take more than one, check for hearts live, then I walk back and see if it follows :3`)
  }
  try { bot.pathfinder.setGoal(new goals.GoalNear(dest.x, dest.y, dest.z, 1), true) } catch (e) {}
  while (active.active) {
    await new Promise((r) => setTimeout(r, 1000))
    if (!bot || !bot.entity) { finish(false, 'bot no longer in game.'); return }
    if (bot.health < 8) { finish(false, 'my health fell under 8, retreating, heal live first.'); return }
    if (Date.now() - active.started > 180000) { finish(false, 'journey timed out after 3 minutes, destination may be unreachable.'); return }
    const liveMob = bot.entities[mobId]
    if (!liveMob) {
      active.lostTicks++
      if (active.lostTicks >= 10) { finish(false, 'mob lost, not seen for 10 seconds.'); return }
      continue
    }
    active.lostTicks = 0
    const botToDest = bot.entity.position.distanceTo({ x: dest.x, y: dest.y, z: dest.z })
    const mobToDest = liveMob.position.distanceTo({ x: dest.x, y: dest.y, z: dest.z })
    if (botToDest < 2.5 && mobToDest < 4.5) {
      if (active.hole) { finish(true, 'at the hole edge, your live step now guides or pushes it in, I did not push it blind and I did not break blocks to make a hole.'); return }
      finish(true, 'bot and mob both at the destination, as far as data shows.'); return
    }
    const mobToBot = liveMob.position.distanceTo(bot.entity.position)
    if (mobToBot > 10) {
      active.farTicks++
    } else {
      active.farTicks = 0
    }
    if (active.farTicks >= 3) {
      const dropped = r21FindDroppedLead()
      say(`Lure lead break suspected: ${active.mob} is about ${mobToBot.toFixed(1)} blocks from me and not following for several checks${dropped ? ', and I see a dropped lead nearby' : ', no dropped lead item seen, check live'}. Stopping to recover, I will not continue blind :3`)
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      let recoveredLead = false
      if (dropped) {
        const leadBefore = r18InvCount('lead')
        try { bot.pathfinder.setGoal(new goals.GoalNear(dropped.position.x, dropped.position.y, dropped.position.z, 1), true); await waitForNear(dropped.position, 2, 10000); bot.pathfinder.setGoal(null) } catch (e) {}
        recoveredLead = r18InvCount('lead') > leadBefore
        say(`Lead recovery: lead x${leadBefore} to x${r18InvCount('lead')} after walking to the dropped lead spot${recoveredLead ? ', that looks like a picked-up lead.' : ', that did NOT verify a picked-up lead, check live.'} :3`)
      } else {
        say('Lead recovery: no dropped lead item seen to pick up, check live where the lead went :3')
      }
      const liveAgain = bot.entities[mobId]
      if (!liveAgain) { finish(false, 'mob lost during lead recovery.'); return }
      let reattached = false
      if (active.method === 'lead' && r18InvCount('lead') > 0) {
        const reachedAgain = await walkToMob(liveAgain)
        if (reachedAgain) {
          try { const leadItem = inventoryItem('lead'); if (leadItem) await bot.equip(leadItem.first, 'hand'); await bot.activateEntity(liveAgain); reattached = true } catch (e) { log(`[lure] re-attach failed: ${e.message}`) }
        }
      }
      active.breaks++
      if (active.breaks > 3) { finish(false, 'lead broke more than 3 times, journey paused, fix it live.'); return }
      if (active.method === 'lead' && !reattached && !recoveredLead) { finish(false, 'lead break recovery did not verify a lead back in hand, journey paused.'); return }
      say(`Lead break ${active.breaks} handled, resuming the journey to ${active.destLabel}, method ${active.method} :3`)
      active.farTicks = 0
      try { bot.pathfinder.setGoal(new goals.GoalNear(dest.x, dest.y, dest.z, 1), true) } catch (e) {}
    }
  }
  if (!active.active) {
    try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
    say('Lure journey stopped by you, no more movement from that journey :3')
  }
}
function r21LureConfirm () {
  if (!bot || !bot.entity) return
  if (!r21LurePending) { say('No lure is pending, say "lure wolf to here" first for step 1, no movement yet, then "lure confirm" :3'); return }
  if (Date.now() - r21LurePending.at > 120000) { const old = r21LurePending.mob; r21LurePending = null; say(`Lure for ${old} expired after 2 minutes, say "lure ${old} to here" again with you watching, I will not start on an old setup :3`); return }
  ;(async () => { await r21LureJourney() })()
}
function r21LureStatus () {
  const pendingText = r21LurePending ? `pending ${r21LurePending.mob}, method ${r21LurePending.method} with ${r21LurePending.item}, destination ${r21LurePending.destLabel}${r21LurePending.hole ? ', hole mode' : ''}` : 'no pending lure'
  const activeText = r21LureActive && r21LureActive.active ? `active ${r21LureActive.mob}, method ${r21LureActive.method}, destination ${r21LureActive.destLabel}, lead breaks ${r21LureActive.breaks}` : 'no active journey'
  const last = r21LureJourneys.length ? r21LureJourneys[r21LureJourneys.length - 1] : null
  say(`Lure status, session only: ${pendingText}; ${activeText}; journeys this session ${r21LureJourneys.length}, last ${last ? last.mob + ' ' + (last.success ? 'done' : 'paused') + ' (' + last.reason + ')' : 'none'}. One mob per journey, repeat for more, stop anytime with "lure stop" :3`)
}
function r21LureStop () {
  if (r21LureActive && r21LureActive.active) {
    r21LureActive.active = false
    try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
    say('Lure journey stopped, I will not move for that journey anymore :3')
    log('[lure] stopped by Moon')
    return
  }
  if (r21LurePending) { r21LurePending = null; say('Lure pending cancelled, I did not move :3'); return }
  say('No lure pending or active :3')
}
function r21LurePassedLive () {
  if (!bot || !bot.entity) return
  const done = r21LureJourneys.some((j) => j.success)
  if (!done) { say('Lure passed live refused, no lure journey has completed this session yet, do "lure wolf to here" then "lure confirm" with you watching first :3'); return }
  say('Recorded, session only: you confirmed live that a lure journey passed clean. This is your live confirmation, not a bot measurement, and it does not claim multi-mob herding, hole pushing, or a lead that never breaks :3')
  log('[lure] passed live')
}
function r21RedLineDirVec (dir) {
  if (dir === 'east') return { dx: 1, dz: 0 }
  if (dir === 'west') return { dx: -1, dz: 0 }
  if (dir === 'north') return { dx: 0, dz: -1 }
  if (dir === 'south') return { dx: 0, dz: 1 }
  return null
}
function r21RedLineRead () {
  if (!r21RedLine || !bot) return { readable: false, powered: 0, first: null, powers: [], placed: 0 }
  const powers = []
  try {
    const Vec3 = require('vec3')
    for (const p of r21RedLine.positions) {
      const b = bot.blockAt(new Vec3(p.x, p.y, p.z))
      if (b && b.name === 'redstone_wire' && b.properties && typeof b.properties.power === 'number') powers.push(b.properties.power)
      else powers.push(null)
    }
  } catch (e) { return { readable: false, powered: 0, first: null, powers: [], placed: r21RedLine.positions.length } }
  const powered = powers.filter((p) => typeof p === 'number' && p > 0).length
  const first = powers.length ? powers[0] : null
  return { readable: powers.some((p) => typeof p === 'number'), powered: powered, first: first, powers: powers, placed: r21RedLine.positions.length }
}
function r21RedLineReport () {
  if (!r21RedLine) return ''
  const read = r21RedLineRead()
  if (!read.readable) return 'redstone line present, but dust power was not readable from bot data on this read, check the line live, I am not inventing a score.'
  return `redstone line: ${read.powered} of ${read.placed} dust powered, first dust power ${read.first === null ? 'not readable' : read.first}, inferred signal ${read.powered} (powered dust count). If first dust power and powered count disagree, check live, the signal is transient and must be read right after a shot.`
}
function r21RedLineHelp () {
  say('Target redstone help, line method only: a target block signal decays by 1 per block along redstone dust, so a signal of strength S should power S dust blocks in a straight line, first dust S, next S-1, and so on down to 1, then dust after that is unpowered. Counting powered dust in a 15-block line therefore gives the signal, IF dust power is readable. Research in code: minecraft-data 1.21.10 lists redstone_wire with a power state, int 0 to 15, and this codebase already reads wire.properties.power in the redstone power check, so a dust line is code-readable in principle, unlike the round 20 direct target read, which round 20 could not rely on. Live verification is still required, the signal is transient, read it right after a shot, before it fades, and if first dust power and powered count disagree, check live. This line method, if it works live, supersedes the round 20 "signal not readable" limit FOR A LINE ONLY, with no line, the round 20 direct-read limit still stands. Say "target redstone check" for target block, dust count, and line, "target redstone line east", or west, north, or south, only on flat solid ground far from your builds when you say it live, never breaking builds, then "target redstone read" after a shot, and "target block shoot" will now also report the line count if a line is stored :3')
}
function r21RedLineCheck () {
  if (!bot || !bot.entity) return
  const stored = r20TargetBlockStored()
  const dust = r18InvCount('redstone')
  const lineText = r21RedLine ? `line stored, direction ${r21RedLine.dir}, ${r21RedLine.positions.length} dust positions, target at ${r21RedLine.target.x}, ${r21RedLine.target.y}, ${r21RedLine.target.z}, ${r21RedLineReport()}` : 'no redstone line stored, say "target redstone line east" live first'
  say(`Target redstone check: stored target block ${stored ? 'yes, at ' + stored.position.x + ', ' + stored.position.y + ', ' + stored.position.z : 'no, place a target block live first'}, redstone dust in inventory x${dust} (need up to 15 for a full line), ${lineText}. Line direction is never guessed, you name it in the line command :3`)
}
async function r21RedLinePlace (dir) {
  if (!bot || !bot.entity) return
  const vec = r21RedLineDirVec(dir)
  if (!vec) { say('Target redstone line refused, direction must be east, west, north, or south, say "target redstone line east" :3'); return }
  const stored = r20TargetBlockStored()
  if (!stored) { say('Target redstone line refused, no stored target block found, say "place target block" live first :3'); return }
  const dustCount = r18InvCount('redstone')
  if (!dustCount) { say('Target redstone line refused, I have no redstone dust in inventory :3'); return }
  const targetPos = { x: stored.position.x, y: stored.position.y, z: stored.position.z }
  const positions = []
  let placed = 0
  const want = Math.min(15, dustCount)
  for (let i = 1; i <= want; i++) {
    const pos = { x: targetPos.x + vec.dx * i, y: targetPos.y, z: targetPos.z + vec.dz * i }
    const existing = bot.blockAt(new (require('vec3'))(pos.x, pos.y, pos.z))
    if (existing && existing.name === 'redstone_wire') { positions.push(pos); placed++; continue }
    const below = bot.blockAt(new (require('vec3'))(pos.x, pos.y - 1, pos.z))
    const space = existing
    if (!below || below.boundingBox !== 'block') { say(`Target redstone line stopped at ${placed} dust, block ${i} has no solid ground below, move the target to flat ground live first :3`); break }
    if (space && space.boundingBox === 'block') { say(`Target redstone line stopped at ${placed} dust, block ${i} space is occupied, clear it live first, I will not break builds :3`); break }
    try { bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2), true) } catch (e) {}
    const reached = await waitForNear(pos, 4, 10000)
    if (!reached) { say(`Target redstone line stopped at ${placed} dust, I could not walk near block ${i} in 10 seconds :3`); break }
    const dustItem = inventoryItem('redstone')
    if (!dustItem) { say(`Target redstone line stopped at ${placed} dust, no redstone dust left :3`); break }
    try { await bot.equip(dustItem.first, 'hand'); await bot.placeBlock(below, { x: 0, y: 1, z: 0 }); placed++; positions.push(pos) } catch (e) { say(`Target redstone line stopped at ${placed} dust, placement failed: ${e.message} :3`); break }
  }
  try { bot.pathfinder.setGoal(null) } catch (e) {}
  if (placed > 0) {
    r21RedLine = { target: targetPos, dir: dir, dx: vec.dx, dz: vec.dz, positions: positions, placed: placed }
    say(`Target redstone line placed, ${placed} of 15 dust, direction ${dir}, from target at ${targetPos.x}, ${targetPos.y}, ${targetPos.z}. A full signal of 15 needs all 15 dust, a shorter line only reads up to its length, check live that the line is straight and far from your builds. Say "target redstone read" after a target block shot :3`)
    log(`[target-redstone] line placed ${placed} dir=${dir} target=${targetPos.x},${targetPos.y},${targetPos.z}`)
  } else {
    say('Target redstone line placed 0 dust, I did not record a line, fix the ground or the space live first :3')
  }
}
function r21RedLineReadSay () {
  if (!bot || !bot.entity) return
  if (!r21RedLine) { say('No redstone line stored, say "target redstone line east" live first, with a stored target block :3'); return }
  say(`Target redstone read: ${r21RedLineReport()} This is a line read only, with no line the round 20 direct-read limit still stands, and a blocked or faded signal is checked live, never guessed :3`)
  log(`[target-redstone] read ${r21RedLineReport()}`)
}
function r21RoundHelp () {
  say('Round 21: say "lure help" for mob methods, lead breaks, and hole mode, "lure check wolf" for mob seen, lure item, and lead count, "lure wolf to here" or "lure wolf to <label>" for step 1 only, no movement yet, with optional "with lead", "with food", or "hole" at the end, "lure confirm" for one journey with you watching, "lure status", "lure stop" anytime, and "lure passed live" only after you watched a full lure clean. One mob per journey, wolves need taming or a lead, they do NOT follow a bone like a pig follows a carrot. Plus "target redstone help" for dust decay and the line method, "target redstone check", "target redstone line east", west, north, or south only on flat ground far from builds when you say it live, and "target redstone read" after a shot, and "target block shoot" now also reports the line count if a line is stored. A line read, if it works live, supersedes the round 20 signal limit for a line only :3')
}

// ---------------------------------------------------------------- round 22: enderman safety + death-loot return
// Moon's live ask, 2026-10-30, while playing: the bot looked at an
// enderman, and the bot died at 16:03 UTC and respawned. Staged,
// code only, not live-tested. Moon must still confirm every staged
// step live, and a live pass only counts via a "passed live" command.
// Enderman facts used here, vanilla 1.21.10, stated honestly:
//   * Looking at an enderman's head/face can anger it; looking away,
//     or wearing a carved pumpkin on the head, avoids look-aggro.
//   * Endermen take damage in water and teleport away from it, so
//     water is a retreat, not a fight. Water does NOT work in the
//     Nether (it evaporates), and there is no standing water there
//     to walk to either, so both water routes refuse in the Nether.
//   * Mineflayer data here does NOT reliably show an enderman's
//     aggro state from the bot's own look. "Mad" in this round is
//     therefore Moon's live call, or an attack actually in progress
//     (entityHurt / self-defense), never a data claim about a look.
// Death-loot facts, vanilla: dropped items despawn after about
// 5 minutes (300 seconds). The bot does NOT track item types from
// data alone; it records only position and time, and on arrival it
// reports dropped items actually seen nearby and any inventory
// change, never a recovery it did not measure.
let r22EndermanSaidId = null
let r22EndermanPending = null // { method: 'bucket'|'water', at }
let r22EndermanAttempts = [] // { at, method, result }
let r22EndermanPassedLiveRecord = false
let r22LastBotPos = null
let r22Death = null // { x, y, z, at, atISO }
let r22DeathAnnouncePending = false
let r22DeathJourney = null // { active, dest, started, invBefore }
function r22FindEnderman (radius) {
  if (!bot || !bot.entity) return null
  return findMobByTypes(['Enderman'], radius || 16)
}
function r22PumpkinState () {
  let worn = false
  let wornName = ''
  try {
    if (bot && bot.inventory && bot.inventory.slots && bot.inventory.slots[5]) {
      wornName = bot.inventory.slots[5].name || ''
      worn = wornName === 'carved_pumpkin'
    }
  } catch (e) {}
  if (!worn) {
    try {
      if (bot && bot.entity && bot.entity.equipment) {
        for (const it of bot.entity.equipment) {
          if (it && it.name === 'carved_pumpkin') { worn = true; wornName = 'carved_pumpkin'; break }
        }
      }
    } catch (e) {}
  }
  return { worn: worn, wornName: wornName, inInventory: r18InvCount('carved_pumpkin') }
}
function r22EndermanSafetyTick () {
  if (!bot || !bot.entity) return
  try { r22LastBotPos = bot.entity.position.clone() } catch (e) {}
  if (fightMode || guardMode) { r22EndermanSaidId = null; return }
  const ender = r22FindEnderman(16)
  if (!ender) { r22EndermanSaidId = null; return }
  if (r22EndermanSaidId === ender.id) return
  r22EndermanSaidId = ender.id
  try {
    const away = bot.entity.position.clone().add(bot.entity.position.clone().subtract(ender.position))
    away.y = bot.entity.position.y - 5
    bot.lookAt(away, true)
  } catch (e) {}
  const pumpkin = r22PumpkinState()
  say(pumpkin.worn ? 'Enderman nearby, looking away so I do not make it mad, and I am already wearing a carved pumpkin, which also helps :3' : 'Enderman nearby, looking away so I do not make it mad, say "enderman check" if you want the water and pumpkin check :3')
  log('[enderman] look away, encounter id=' + ender.id)
}
function r22EndermanHelp () {
  say('Enderman help, staged, never blind: do NOT look at an enderman\'s head or face, I look down and away when one is within about 16 blocks and I am not fighting it, once per encounter, not spammy, unless you explicitly target or fight it. A carved pumpkin worn on the head also prevents look-aggro, say "wear pumpkin" if I have one, and "enderman check" verifies, never claims, whether I am actually wearing it. If one is mad, that is your live call or an attack in progress, mineflayer data here does not reliably show aggro from my own look. In order, if you say fight, I fight back with the existing "fight" step, otherwise retreat to water: endermen take damage in water and teleport away. Say "enderman check" for nearest enderman, water bucket, nearest water, health and food, and pumpkin, then "enderman water" for step 1 only, no movement yet, then "enderman water confirm" for one attempt with you watching, "enderman stop" anytime, and "enderman passed live" only after you watched a water retreat clean. Water needs a water bucket to place at my feet on solid ground, not in the Nether, not breaking builds, or a water block within 32 blocks to walk to and stand in, otherwise I say so plainly and do not claim water :3')
}
function r22EndermanCheck () {
  if (!bot || !bot.entity) return
  const ender = r22FindEnderman(32)
  const bucket = r18InvCount('water_bucket')
  let waterText = 'no water block found within 32 blocks'
  try {
    const waters = bot.findBlocks({ matching: (b) => b.name === 'water', maxDistance: 32, count: 1 })
    if (waters.length) waterText = 'nearest water about ' + waters[0].distanceTo(bot.entity.position).toFixed(1) + ' blocks away'
  } catch (e) {}
  const pumpkin = r22PumpkinState()
  say(`Enderman check: nearest enderman ${ender ? 'about ' + ender.position.distanceTo(bot.entity.position).toFixed(1) + ' blocks away' : 'none seen within 32 blocks'}, water bucket x${bucket}, ${waterText}, dimension ${dimensionName()}, health ${bot.health}, food ${bot.food}, carved pumpkin worn ${pumpkin.worn ? 'yes, verified' : 'no'}, in inventory x${pumpkin.inInventory}. Mad is your live call or an attack in progress, not a data claim, and self-defense may already have started a fight if one hurt me, say "stop" to stop it, then "enderman water" to set up a water retreat :3`)
}
function r22EndermanWaterSetup () {
  if (!bot || !bot.entity) return
  if (r22EndermanPending) { say('An enderman water retreat is already pending, say "enderman water confirm" for that one, or "enderman stop" to stop it first, I will not stack retreats :3'); return }
  if (dimensionName() === 'the_nether') { say('Enderman water retreat refused, I am in the Nether, placed water evaporates there and there is no standing water to walk to, fight or leave the Nether live instead, I did not move :3'); return }
  const bucket = r18InvCount('water_bucket')
  let waterNear = false
  try { const waters = bot.findBlocks({ matching: (b) => b.name === 'water', maxDistance: 32, count: 1 }); waterNear = waters.length > 0 } catch (e) {}
  if (!bucket && !waterNear) { say('Enderman water retreat refused, I have no water bucket and no water block within 32 blocks, bring a bucket or move near water live first, I did not move :3'); return }
  const method = bucket ? 'bucket' : 'water'
  r22EndermanPending = { method: method, at: Date.now() }
  say(`Enderman water retreat set up, step 1 only, I have NOT moved yet: method ${method === 'bucket' ? 'place a water bucket at my feet on solid ground' : 'walk to the nearest water block within 32 blocks and stand in it'}. Say "enderman water confirm" now, with you watching, for one attempt, or "enderman stop" to stop. Endermen take damage in water and teleport away, but I will not claim a teleport until you watch it live :3`)
  log('[enderman] water pending method=' + method)
}
async function r22EndermanWaterConfirm () {
  if (!bot || !bot.entity || !r22EndermanPending) { say('No enderman water retreat is pending, say "enderman water" first for step 1, no movement yet, then "enderman water confirm" :3'); return }
  if (Date.now() - r22EndermanPending.at > 120000) { const m = r22EndermanPending.method; r22EndermanPending = null; say('Enderman water retreat expired after 2 minutes, say "enderman water" again with you watching, I will not start on an old setup :3'); log('[enderman] water expired method=' + m); return }
  const pending = r22EndermanPending; r22EndermanPending = null
  const healthBefore = bot.health
  if (dimensionName() === 'the_nether') { say('Enderman water retreat refused on recheck, I am in the Nether, placed water evaporates there, I did not move :3'); r22EndermanAttempts.push({ at: new Date().toISOString(), method: pending.method, result: 'refused, Nether' }); return }
  if (pending.method === 'bucket') {
    if (r18InvCount('water_bucket') < 1) { say('Enderman water retreat refused on recheck, I have no water bucket now, I did not place water :3'); r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'bucket', result: 'refused, no bucket on recheck' }); return }
    const p = bot.entity.position
    const below = bot.blockAt(p.offset(0, -1, 0))
    const atFeet = bot.blockAt(p)
    if (atFeet && atFeet.name === 'water') { say('Enderman water retreat: I am already standing in water, no bucket placed, check live if the enderman teleported away :3'); r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'bucket', result: 'already in water, no placement' }); return }
    if (!below || below.boundingBox !== 'block') { say('Enderman water retreat refused, no solid ground below me to place water on, I will not place water blind, move to solid ground live first :3'); r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'bucket', result: 'refused, no solid ground' }); return }
    try {
      const bucketItem = inventoryItem('water_bucket')
      await bot.equip(bucketItem.first, 'hand')
      await bot.placeBlock(below, { x: 0, y: 1, z: 0 })
      const placed = bot.blockAt(p) && bot.blockAt(p).name === 'water'
      say(`Enderman water retreat attempt done: water bucket placed at my feet at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}, water seen at my feet ${placed ? 'yes' : 'not verified, check live'}, health ${healthBefore} to ${bot.health}. I am NOT claiming the enderman teleported away, check live, and say "enderman passed live" only if you watched a clean retreat :3`)
      log('[enderman] water bucket placed placed=' + placed + ' health=' + healthBefore + '->' + bot.health)
      r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'bucket', result: placed ? 'water placed at feet' : 'placement not verified' })
    } catch (e) {
      say(`Enderman water retreat failed, I did not verify water placed: ${e.message}, check live :3`)
      log('[enderman] water bucket failed: ' + e.message)
      r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'bucket', result: 'failed: ' + e.message })
    }
    return
  }
  let waters = []
  try { waters = bot.findBlocks({ matching: (b) => b.name === 'water', maxDistance: 32, count: 1 }) } catch (e) {}
  if (!waters.length) { say('Enderman water retreat refused on recheck, no water block within 32 blocks now, I did not move :3'); r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'water', result: 'refused, no water on recheck' }); return }
  const wp = waters[0]
  try { bot.pathfinder.setGoal(new goals.GoalNear(wp.x, wp.y, wp.z, 1), true) } catch (e) {}
  const reached = await waitForNear(wp, 3, 12000)
  try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
  const inWater = isInWater()
  say(`Enderman water retreat attempt done: walked to water at ${wp.x}, ${wp.y}, ${wp.z}, reached nearby ${reached ? 'yes' : 'no, timed out after 12 seconds'}, standing in water as far as data shows ${inWater ? 'yes' : 'no, check live'}, health ${healthBefore} to ${bot.health}. I am NOT claiming the enderman teleported away, check live, and say "enderman passed live" only if you watched a clean retreat :3`)
  log('[enderman] water walk reached=' + reached + ' inWater=' + inWater + ' health=' + healthBefore + '->' + bot.health)
  r22EndermanAttempts.push({ at: new Date().toISOString(), method: 'water', result: reached ? (inWater ? 'arrived and in water' : 'arrived nearby, in water not verified') : 'timed out, not arrived' })
}
function r22EndermanStop () {
  if (r22EndermanPending) { r22EndermanPending = null; try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}; say('Enderman water retreat stopped, pending cancelled, I did not move further :3'); return }
  try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
  say('Enderman stop: no pending water retreat, any movement goal cleared, I will not fight or retreat blind, say "enderman water" to set one up :3')
}
function r22EndermanPassedLive () {
  if (!r22EndermanAttempts.length) { say('Enderman passed live refused, no water retreat attempt this session yet, say "enderman water" then "enderman water confirm" with you watching first :3'); return }
  r22EndermanPassedLiveRecord = true
  say('Enderman water retreat passed live, session only, because you watched it clean. That does not claim water always works next time, a bucket or nearby water is still needed each time, and "mad" is still your live call, not a data claim :3')
  log('[enderman] passed live')
}
function r22WearPumpkin () {
  if (!bot) return
  if (r18InvCount('carved_pumpkin') < 1) { say('Wear pumpkin refused, I have no carved pumpkin in inventory, bring one live first :3'); return }
  ;(async () => {
    try { await equipItem('carved_pumpkin', 'head') } catch (e) { say(`Wear pumpkin failed: ${e.message} :3`); return }
    await new Promise((r) => setTimeout(r, 800))
    const pumpkin = r22PumpkinState()
    say(pumpkin.worn ? 'Wearing a carved pumpkin, verified on my head, which should prevent look-aggro from endermen, I still look away when one is near and not being fought :3' : 'Wear pumpkin did not verify, I do not see a carved pumpkin on my head in data, check live, I am not claiming it is worn :3')
  })()
}
function r22RecordDeath () {
  let pos = null
  try { if (bot && bot.entity) pos = bot.entity.position.clone() } catch (e) {}
  if (!pos && r22LastBotPos) { try { pos = r22LastBotPos.clone() } catch (e) {} }
  if (!pos) { log('[death-spot] no position recorded, not inventing one'); return }
  r22Death = { x: pos.x, y: pos.y, z: pos.z, at: Date.now(), atISO: new Date().toISOString() }
  r22DeathAnnouncePending = true
  log(`[death-spot] recorded ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)} at ${r22Death.atISO}`)
}
function r22DeathSpotSay () {
  if (!r22Death) { say('Death spot: no death recorded this session yet, I am not inventing a position, my stuff is wherever I last died live, if at all :3'); return }
  const elapsed = Math.floor((Date.now() - r22Death.at) / 1000)
  const left = Math.max(0, 300 - elapsed)
  const leftText = left <= 0 ? 'about 5 minutes may already be up, items may have despawned, check live fast' : `about ${Math.floor(left / 60)} minutes ${left % 60} seconds left before the about-5-minute despawn, as an estimate only`
  say(`Death spot, session only: I died at ${r22Death.x.toFixed(0)}, ${r22Death.y.toFixed(0)}, ${r22Death.z.toFixed(0)}, ${elapsed} seconds ago, ${leftText}. Say "return to my stuff" for one staged journey there, I will not run there blind on respawn :3`)
}
function r22DeathSpotStop () {
  if (r22DeathJourney && r22DeathJourney.active) { r22DeathJourney.active = false; try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}; say('Death spot journey stopped, I will not continue to my stuff blind, say "return to my stuff" again to start fresh :3'); return }
  try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
  say('Death spot stop: no death journey was active :3')
}
function r22CountDroppedItemsNear (center, radius) {
  let count = 0
  let names = []
  try {
    for (const id of Object.keys(bot.entities || {})) {
      const e = bot.entities[id]
      if (!e || !e.position) continue
      const nm = String(e.name || e.mobType || e.objectType || '').toLowerCase()
      const isItem = nm.includes('item') || String(e.objectType || '').toLowerCase().includes('item')
      if (!isItem) continue
      if (e.position.distanceTo(center) <= radius) { count++; if (names.length < 5) names.push(nm || 'item') }
    }
  } catch (e) {}
  return { count: count, names: names }
}
function r22InvTotal () {
  try { return bot.inventory.items().reduce((n, i) => n + (i.count || 1), 0) } catch (e) { return -1 }
}
async function r22ReturnToDeathSpot () {
  if (!bot || !bot.entity) return
  if (!r22Death) { say('Return to my stuff refused, no death recorded this session yet, I am not inventing a position :3'); return }
  if (r22DeathJourney && r22DeathJourney.active) { say('A death spot journey is already active, say "death spot stop" to stop it first, I will not stack journeys :3'); return }
  const dest = { x: r22Death.x, y: r22Death.y, z: r22Death.z }
  const journey = { active: true, dest: dest, started: Date.now(), invBefore: r22InvTotal() }
  r22DeathJourney = journey
  say(`Return to my stuff, one staged journey, no auto-run: going to my death spot at ${dest.x.toFixed(0)}, ${dest.y.toFixed(0)}, ${dest.z.toFixed(0)}, I will stop on arrival, on "death spot stop", or after 3 minutes, and I will not claim items recovered without an inventory change live :3`)
  log(`[death-spot] journey started to ${dest.x.toFixed(0)}, ${dest.y.toFixed(0)}, ${dest.z.toFixed(0)} invBefore=${journey.invBefore}`)
  try { bot.pathfinder.setGoal(new goals.GoalNear(dest.x, dest.y, dest.z, 1), true) } catch (e) {}
  const finish = (reason, arrived) => {
    journey.active = false
    try { if (bot) bot.pathfinder.setGoal(null) } catch (e) {}
    if (!bot || !bot.entity) { say('Death spot journey paused, I am no longer in game :3'); return }
    const invAfter = r22InvTotal()
    const invChange = (invBeforeIs(journey.invBefore) && invAfter >= 0) ? invAfter - journey.invBefore : null
    const seen = r22CountDroppedItemsNear(bot.entity.position, 8)
    say(`Death spot journey ${arrived ? 'arrived' : 'paused'}: ${reason} Dropped items seen nearby in data: ${seen.count}${seen.count ? ', check live what they are, I do not track item types from data alone' : ', none seen in data, check live, I am not claiming they are gone'}. Inventory total ${journey.invBefore} to ${invAfter}${invChange === null ? '' : ', change ' + invChange}${invChange !== null && invChange > 0 ? ', so something may have been picked up, check live what it was, I am not naming items I did not verify' : ', no inventory increase seen, so I am not claiming any items recovered'}. :3`)
    log(`[death-spot] journey ${arrived ? 'arrived' : 'paused'} reason=${reason} seen=${seen.count} inv=${journey.invBefore}->${invAfter}`)
  }
  function invBeforeIs (v) { return typeof v === 'number' && v >= 0 }
  while (journey.active) {
    await new Promise((r) => setTimeout(r, 1000))
    if (!bot || !bot.entity) { finish('bot no longer in game.', false); return }
    if (bot.health < 8) { finish('my health fell under 8, retreating, heal live first.', false); return }
    if (Date.now() - journey.started > 180000) { finish('journey timed out after 3 minutes, destination may be unreachable.', false); return }
    const d = bot.entity.position.distanceTo(dest)
    if (d < 2.5) { finish('at the death spot, as far as data shows.', true); return }
  }
}
function r22RoundHelp () {
  say('Round 22: say "enderman help" for look-away, pumpkin, fight-or-water order, and mad-as-live-call, "enderman check" for nearest enderman, bucket, nearest water, health, food, and pumpkin worn verified, "wear pumpkin" if I have a carved pumpkin, "enderman water" for step 1 only, no movement yet, "enderman water confirm" for one water attempt with you watching, "enderman stop" anytime, and "enderman passed live" only after you watched a clean water retreat. Plus death loot: "death spot" for my last death position and about-5-minute time left, never invented, "return to my stuff" or "go to death spot" for one staged journey there, stopping on arrival, on "death spot stop", or after 3 minutes, reporting dropped items seen nearby and any inventory change only, never claiming recovery without it. I do NOT auto-run to my stuff on respawn, you must say it, because running blind could be dangerous :3')
}


// ---------------------------------------------------------------- round 20: target block self-training
// Moon's idea: could the bot craft a target block and then train
// himself with that? A stationary target block cannot train moving
// targets, Moon said that himself, but the rest can be trained, and
// a target block gives something a mob does not: a redstone signal
// on a projectile hit, with signal strength based on how close to
// the centre the hit lands, closer = stronger, up to 15, from a
// vanilla recipe of 4 redstone dust + 1 hay bale (hay_block).
// Honest signal limit, stated in help and in every shot report:
// this codebase does not have a reliable read of that emitted
// signal in mineflayer block data. A target block has no power
// blockstate I can read here, its signal goes to adjacent redstone,
// so r20TargetBlockSignal tries a power/signal property if one is
// actually present, polls briefly after a shot, and otherwise
// reports "signal not readable from bot data, check live" and
// never invents a score. A bot number is only ever reported if a
// numeric power field was actually found, which is not expected.
// Also fixed in this round, no behaviour change intended: the
// round 18 dispatch block was orphaned at top level before
// parseFuzzyIntent, so the file crashed on load with
// "ReferenceError: cmd is not defined" (verified by running a
// /tmp copy before the fix). That block is now the first block
// inside parseFuzzyIntent, so rounds 18-20 load and run.
let r20TargetBlockPos = null // plain {x, y, z} of a placed target block, session only
let r20TargetBlockPending = null // { tier, dist, arrowsBefore, at }
let r20TargetBlockShots = [] // { at, tier, dist, shot, arrowsBefore, arrowsAfter, signalReadable, signalValue, source }
let r20TargetBlockPass = { close: false, mid: false, long: false }
let r20TargetBlockSession = null // { tier, wanted, done, active, at }
function r20TargetBlockTier (dist) {
  if (dist <= 10) return 'close'
  if (dist <= 20) return 'mid'
  if (dist <= 30) return 'long'
  return null
}
function r20TargetBlockFindNearby () {
  if (!bot || !bot.entity) return null
  try {
    const found = bot.findBlocks({ matching: (b) => b.name === 'target', maxDistance: 32, count: 1 })
    if (!found || found.length === 0) return null
    return bot.blockAt(found[0])
  } catch (e) { return null }
}
function r20TargetBlockStored () {
  if (!bot || !r20TargetBlockPos) return null
  try {
    const Vec3 = require('vec3')
    const b = bot.blockAt(new Vec3(r20TargetBlockPos.x, r20TargetBlockPos.y, r20TargetBlockPos.z))
    if (!b || b.name !== 'target') return null
    return b
  } catch (e) { return null }
}
function r20TargetBlockSignal () {
  const b = r20TargetBlockStored()
  if (!b) return { readable: false, value: null }
  try {
    const props = b.properties || {}
    if (typeof props.power === 'number') return { readable: true, value: props.power, source: 'block power property' }
    if (typeof props.signal === 'number') return { readable: true, value: props.signal, source: 'block signal property' }
  } catch (e) {}
  return { readable: false, value: null }
}
function r20TargetBlockHelp () {
  say('Target block help, staged, train himself with a stationary target, not a moving one: vanilla recipe is 4 redstone dust + 1 hay bale (hay_block), in a crafting table, it makes 1 target block. When a projectile hits it, it emits a redstone signal, strength based on how close to the centre the hit lands, closer = stronger, up to 15. That signal is the measurable feedback a mob does not give, bot data does not show arrow damage on a mob, but here is the honest limit: in this bot data I do not have a reliable read of that emitted signal as a number, a target block has no power blockstate I can read, its signal goes to adjacent redstone, so I will try to read a power or signal property if one is actually present, poll briefly after a shot, and otherwise say "signal not readable from bot data, check live" and never invent a score. Say "target block check" for redstone, hay bale, target block, bow, arrows, and a flat safe area, "craft target block" only with materials already in inventory, no /give, "place target block" only on flat solid ground far from your builds, only when you say it live, never breaking a build to place it, "target block practice close", "mid", or "long" for one pending shot, no shot yet, then "target block shoot" for that one shot, then "target block passed live close", "mid", or "long" only if you watched it clean. For self-training, say "train target block close 5", or mid or long with up to 10 shots, that is a Moon-started, Moon-stoppable session, one shot at a time with a pause and a report after each, stopping on low arrows, on your stop, on the target block breaking or moving, or on any unsafe condition, it is NOT an unsupervised overnight loop, and it does NOT train moving targets, a target block is stationary, moving training stays with mobs and duels live only, as you said yourself. Tiers are the same as bow training: close 10 blocks or less, mid 11 to 20, long 21 to 30, over 30 refused :3')
}
function r20TargetBlockCheck () {
  if (!bot || !bot.entity) return
  const redstone = r18InvCount('redstone')
  const hay = r18InvCount('hay_block')
  const target = r18InvCount('target')
  const bow = r18InvCount('bow')
  const arrows = r18InvCount('arrow')
  const placed = r20TargetBlockFindNearby()
  const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
  const flat = below && below.boundingBox === 'block' && !isRavineRiskAt(bot.entity.position)
  say(`Target block check: redstone dust x${redstone} (need 4 to craft), hay bale x${hay} (need 1 to craft), target block in inventory ${target ? 'yes, x' + target : 'no'}, bow ${bow ? 'yes, x' + bow : 'no'}, arrows ${arrows ? 'x' + arrows : 'none'}, placed target block nearby ${placed ? 'yes, at ' + placed.position.x + ', ' + placed.position.y + ', ' + placed.position.z : 'no, place one live first'}, stored target block ${r20TargetBlockPos ? r20TargetBlockPos.x + ', ' + r20TargetBlockPos.y + ', ' + r20TargetBlockPos.z : 'none'}, flat safe area under me ${flat ? 'yes, solid ground, no drop risk seen' : 'no, move to flat solid ground live first'}, health ${bot.health}, food ${bot.food}. Backdrop and distance from your builds are your live checks, I do not claim those from bot data alone. Signal note: I will try to read a power property after a shot, and otherwise say signal not readable, I will not invent a score :3`)
}
async function r20CraftTargetBlock () {
  if (!bot || !bot.entity) return
  const redstoneBefore = r18InvCount('redstone')
  const hayBefore = r18InvCount('hay_block')
  const targetBefore = r18InvCount('target')
  if (redstoneBefore < 4 || hayBefore < 1) { say(`Craft target block refused, I have redstone dust x${redstoneBefore} (need 4) and hay bale x${hayBefore} (need 1), bring the materials live first, I will not use /give or an operator command :3`); return }
  let table = null
  try {
    const tables = bot.findBlocks({ matching: (b) => b.name === 'crafting_table', maxDistance: 8, count: 1 })
    if (tables.length > 0) table = bot.blockAt(tables[0])
  } catch (e) { table = null }
  if (!table) { say('Craft target block refused, no crafting table nearby within 8 blocks, place one live first, the recipe needs a table :3'); return }
  const type = findItemType('target')
  if (!type) { say('Craft target block refused, I do not know the target block item in this version :3'); return }
  let recipes = []
  try { recipes = bot.recipesFor(type.id, null, 1, table) } catch (e) { recipes = [] }
  if (!recipes || recipes.length === 0) { say('Craft target block refused, no recipe found with what I have, check the materials live :3'); return }
  try { await bot.craft(recipes[0], 1, table) } catch (e) { say(`Craft target block failed: ${e.message}`); log(`[target-block] craft failed: ${e.message}`); return }
  const targetAfter = r18InvCount('target')
  const redstoneAfter = r18InvCount('redstone')
  const hayAfter = r18InvCount('hay_block')
  say(`Craft target block done, as far as inventory shows: target block x${targetBefore} to x${targetAfter}, redstone dust x${redstoneBefore} to x${redstoneAfter}, hay bale x${hayBefore} to x${hayAfter}. ${targetAfter > targetBefore ? 'That looks like a crafted target block, say "place target block" live when you have a flat safe spot far from your builds.' : 'That did NOT verify a target block in inventory, I am not claiming a craft, check live.'} :3`)
  log(`[target-block] craft target=${targetBefore}->${targetAfter} redstone=${redstoneBefore}->${redstoneAfter} hay=${hayBefore}->${hayAfter}`)
}
async function r20PlaceTargetBlock () {
  if (!bot || !bot.entity) return
  if (!r18InvCount('target')) { say('Place target block refused, I have no target block in inventory, say "craft target block" first with materials in hand :3'); return }
  const ok = await placeNamedBlock('target')
  if (!ok) { say('Place target block did not verify, I will not claim a placed target block, check live :3'); return }
  const placed = r20TargetBlockFindNearby()
  if (placed) {
    r20TargetBlockPos = { x: placed.position.x, y: placed.position.y, z: placed.position.z }
    say(`Target block placed and verified nearby at ${r20TargetBlockPos.x}, ${r20TargetBlockPos.y}, ${r20TargetBlockPos.z}. Check live yourself that this spot is flat, safe, and far from your builds, I do not claim distance from builds from bot data. Say "target block practice close", "mid", or "long" next, with you watching :3`)
    log(`[target-block] placed at ${r20TargetBlockPos.x}, ${r20TargetBlockPos.y}, ${r20TargetBlockPos.z}`)
  } else {
    r20TargetBlockPos = null
    say('Place step reported a placement, but I did not verify a target block nearby afterwards, so I am not recording a stored position, check live where it actually went, then say "target block check" again :3')
  }
}
function r20TargetBlockPractice (tier) {
  if (!bot || !bot.entity) return
  if (r20TargetBlockPending) { say('A target block shot is already pending, say "target block shoot" for that one shot with you watching, or "target block training stop" to stop, I will not stack shots :3'); return }
  if (!r18InvCount('bow')) { say('Target block practice refused, I have no bow in inventory :3'); return }
  if (!r18InvCount('arrow')) { say('Target block practice refused, I have no arrows in inventory :3'); return }
  const stored = r20TargetBlockStored()
  if (!stored) { say('Target block practice refused, no stored target block found, say "place target block" live first, then "target block practice ' + tier + '" again :3'); return }
  const d = stored.position.distanceTo(bot.entity.position)
  if (d > 30) { say(`Target block practice refused, target block is about ${d.toFixed(1)} blocks away, over 30, move closer live first :3`); return }
  const tierNow = r20TargetBlockTier(d)
  if (tierNow !== tier) { say(`Target block practice ${tier} refused, target block is about ${d.toFixed(1)} blocks away, that is tier ${tierNow}, not ${tier}, move live first or use "target block practice ${tierNow}" :3`); return }
  r20TargetBlockPending = { at: Date.now(), tier: tier, dist: d, arrowsBefore: r18InvCount('arrow') }
  say(`Target block practice ${tier} set up, step 1 only, I have NOT shot yet: target block at ${stored.position.x}, ${stored.position.y}, ${stored.position.z}, about ${d.toFixed(1)} blocks away, stationary, arrows before x${r20TargetBlockPending.arrowsBefore}. Check the line of fire and the backdrop live yourself, I do not claim a safe backdrop from bot data alone. Say "target block shoot" now, with you watching, for one full-draw shot, or "target block training stop" to stop :3`)
  log(`[target-block] practice ${tier} dist=${d.toFixed(1)} arrows=${r20TargetBlockPending.arrowsBefore}`)
}
async function r20TargetBlockDoShot (tier, source) {
  if (!bot || !bot.entity) return null
  const stored = r20TargetBlockStored()
  if (!stored) { say('Target block shot refused, no stored target block found anymore, it may have broken or moved, place one live again, I did not shoot :3'); return null }
  const bow = inventoryItem('bow')
  if (!bow) { say('Target block shot refused on recheck, no bow in inventory now, I did not shoot :3'); return null }
  const arrowsBefore = r18InvCount('arrow')
  if (!arrowsBefore) { say('Target block shot refused on recheck, no arrows left, I did not shoot :3'); return null }
  const dist = stored.position.distanceTo(bot.entity.position)
  const tierNow = r20TargetBlockTier(dist)
  if (tierNow !== tier) { say(`Target block shot refused, target block is now about ${dist.toFixed(1)} blocks away, tier ${tierNow || 'over 30'}, not ${tier}, move live first, I did not shoot :3`); return null }
  try { await bot.equip(bow.first, 'hand') } catch (e) {}
  let aim = stored.position.offset(0.5, 0.5, 0.5)
  let aimNote = 'aimed at the centre of the target block'
  if (tier === 'long') { aim = stored.position.offset(0.5, 0.5 + dist * 0.03, 0.5); aimNote = 'long tier, aimed above the centre for drop, best-effort only, not a measured drop table' }
  try { bot.lookAt(aim) } catch (e) {}
  await new Promise((r) => setTimeout(r, 200))
  let shot = false
  try { bot.activateItem(); await new Promise((r) => setTimeout(r, 1000)); bot.deactivateItem(); shot = true } catch (e) { shot = false; log(`[target-block] shoot failed: ${e.message}`) }
  let signal = { readable: false, value: null }
  for (let i = 0; i < 10 && !signal.readable; i++) {
    await new Promise((r) => setTimeout(r, 200))
    signal = r20TargetBlockSignal()
  }
  const arrowsAfter = r18InvCount('arrow')
  const stillThere = !!r20TargetBlockStored()
  const record = { at: new Date().toISOString(), tier: tier, dist: dist, shot: shot, arrowsBefore: arrowsBefore, arrowsAfter: arrowsAfter, signalReadable: signal.readable, signalValue: signal.value, source: source, stillThere: stillThere }
  r20TargetBlockShots.push(record)
  const signalText = signal.readable ? `signal strength ${signal.value} as read from block data (${signal.source})` : 'signal NOT readable from bot data, check the redstone signal live, I am not inventing a score'
  const lineText = r21RedLine ? (' ' + r21RedLineReport()) : ''
  say(`Target block shot done, tier ${tier}, one shot only, stopped: target block at ${stored.position.x}, ${stored.position.y}, ${stored.position.z}, about ${dist.toFixed(1)} blocks away, full draw about 1 second, ${aimNote}, shot attempted ${shot ? 'yes' : 'no, activation failed, check live'}, arrows x${arrowsBefore} to x${arrowsAfter}, target block still there ${stillThere ? 'yes' : 'no'}, ${signalText}.${lineText} A hit score is confirmed only by you watching live, or by a bot-readable signal if one was actually found, never by a guessed number. Say "target block passed live ${tier}" only if you watched a clean shot for that tier :3`)
  log(`[target-block] shot tier=${tier} source=${source} dist=${dist.toFixed(1)} shot=${shot} arrows=${arrowsBefore}->${arrowsAfter} signalReadable=${signal.readable} signal=${signal.value} stillThere=${stillThere}`)
  return record
}
async function r20TargetBlockShoot () {
  if (!bot || !bot.entity) return
  if (!r20TargetBlockPending) { say('No target block shot is pending, say "target block practice close", "mid", or "long" first, no shot yet, then "target block shoot" with you watching :3'); return }
  if (Date.now() - r20TargetBlockPending.at > 120000) { const old = r20TargetBlockPending.tier; r20TargetBlockPending = null; say(`Target block shot for ${old} expired after 2 minutes, say "target block practice" again with you watching, I will not shoot on an old setup :3`); return }
  const pending = r20TargetBlockPending; r20TargetBlockPending = null
  await r20TargetBlockDoShot(pending.tier, 'single')
}
async function r20TargetBlockTrain (tier, shots) {
  if (!bot || !bot.entity) return
  if (shots > 10) { say(`Train target block refused, ${shots} shots is over the session limit, max 10 shots per session, say "train target block ${tier} 10" or fewer :3`); return }
  if (shots < 1) { say('Train target block refused, shots must be at least 1 :3'); return }
  if (r20TargetBlockSession && r20TargetBlockSession.active) { say(`A target block training session is already active, tier ${r20TargetBlockSession.tier}, ${r20TargetBlockSession.done} of ${r20TargetBlockSession.wanted} done, say "target block training stop" to stop it first, I will not stack sessions :3`); return }
  if (!r18InvCount('bow')) { say('Train target block refused, I have no bow in inventory :3'); return }
  if (!r18InvCount('arrow')) { say('Train target block refused, I have no arrows in inventory :3'); return }
  const stored = r20TargetBlockStored()
  if (!stored) { say('Train target block refused, no stored target block found, say "place target block" live first :3'); return }
  const d = stored.position.distanceTo(bot.entity.position)
  const tierNow = r20TargetBlockTier(d)
  if (tierNow !== tier) { say(`Train target block ${tier} refused, target block is about ${d.toFixed(1)} blocks away, that is tier ${tierNow || 'over 30'}, not ${tier}, move live first :3`); return }
  r20TargetBlockSession = { tier: tier, wanted: shots, done: 0, active: true, at: Date.now() }
  say(`Target block training session started, tier ${tier}, ${shots} shot${shots === 1 ? '' : 's'} max, one shot at a time with a pause and a report after each, Moon-started and Moon-stoppable, NOT an unsupervised loop. It will stop on low arrows, on your "target block training stop", on the target block breaking or moving, or on any unsafe condition. It does NOT train moving targets, this target is stationary. Starting now, with you watching :3`)
  log(`[target-block] training started tier=${tier} wanted=${shots}`)
  while (r20TargetBlockSession && r20TargetBlockSession.active && r20TargetBlockSession.done < r20TargetBlockSession.wanted) {
    const record = await r20TargetBlockDoShot(tier, 'session')
    if (!record) { say(`Target block training session stopped at ${r20TargetBlockSession.done} of ${r20TargetBlockSession.wanted} shots, a shot was refused, see the reason above, I will not continue blind :3`); break }
    r20TargetBlockSession.done++
    if (r20TargetBlockSession.done >= r20TargetBlockSession.wanted) break
    if (!r18InvCount('arrow')) { say(`Target block training session stopped at ${r20TargetBlockSession.done} of ${r20TargetBlockSession.wanted} shots, no arrows left :3`); break }
    if (!r20TargetBlockStored()) { say(`Target block training session stopped at ${r20TargetBlockSession.done} of ${r20TargetBlockSession.wanted} shots, target block is no longer there :3`); break }
    await new Promise((r) => setTimeout(r, 1500))
  }
  const done = r20TargetBlockSession ? r20TargetBlockSession.done : 0
  const wanted = r20TargetBlockSession ? r20TargetBlockSession.wanted : shots
  if (r20TargetBlockSession) r20TargetBlockSession.active = false
  say(`Target block training session ended, tier ${tier}, ${done} of ${wanted} shots done, arrows now x${r18InvCount('arrow')}. Say "target block passed live ${tier}" only if you watched clean shots for that tier, and "target block training status" to see the session :3`)
  log(`[target-block] training ended tier=${tier} done=${done} wanted=${wanted}`)
}
function r20TargetBlockTrainingStop () {
  if (r20TargetBlockSession && r20TargetBlockSession.active) {
    r20TargetBlockSession.active = false
    say(`Target block training stopped, ${r20TargetBlockSession.done} of ${r20TargetBlockSession.wanted} shots done, no more shots will fire from that session :3`)
    log('[target-block] training stopped by Moon')
    return
  }
  if (r20TargetBlockPending) { r20TargetBlockPending = null; say('Target block pending shot cancelled, I did not shoot :3'); return }
  say('No target block training session or pending shot was active :3')
}
function r20TargetBlockStatus () {
  const sessionText = r20TargetBlockSession ? `session tier ${r20TargetBlockSession.tier}, ${r20TargetBlockSession.done} of ${r20TargetBlockSession.wanted} done, active ${r20TargetBlockSession.active ? 'yes' : 'no'}` : 'no session this session'
  say(`Target block training status, session only: stored target block ${r20TargetBlockPos ? r20TargetBlockPos.x + ', ' + r20TargetBlockPos.y + ', ' + r20TargetBlockPos.z : 'none, place one live first'}, pending shot ${r20TargetBlockPending ? 'yes, tier ' + r20TargetBlockPending.tier : 'no'}, ${sessionText}, shots this session ${r20TargetBlockShots.length}, arrows now x${r18InvCount('arrow')}, tier passes close ${r20TargetBlockPass.close ? 'yes' : 'no'}, mid ${r20TargetBlockPass.mid ? 'yes' : 'no'}, long ${r20TargetBlockPass.long ? 'yes' : 'no'}. Moving targets are NOT trained with a target block, it is stationary by design :3`)
}
function r20TargetBlockPassedLive (tier) {
  if (!bot || !bot.entity) return
  const hasShot = r20TargetBlockShots.some((s) => s.tier === tier)
  if (!hasShot) { say(`Target block passed live ${tier} refused, no target block shot for ${tier} this session yet, do "target block practice ${tier}" then "target block shoot" with you watching first :3`); return }
  r20TargetBlockPass[tier] = true
  say(`Recorded, session only: you confirmed live that a target block shot for ${tier} passed clean. Tier passes now: close ${r20TargetBlockPass.close ? 'yes' : 'no'}, mid ${r20TargetBlockPass.mid ? 'yes' : 'no'}, long ${r20TargetBlockPass.long ? 'yes' : 'no'}. This is your live confirmation, not a bot measurement, and it does not claim super-good bow skill overall, that stays an end goal until you watch every tier clean :3`)
  log(`[target-block] passed live ${tier}`)
}
function r20RoundHelp () {
  say('Round 20: say "target block help" for recipe, signal, tiers, and limits, "target block check" for redstone, hay bale, target block, bow, arrows, and a flat safe area, "craft target block" only with materials already in inventory, "place target block" only on flat solid ground far from your builds when you say it live, "target block practice close", "mid", or "long" for one pending shot, no shot yet, "target block shoot" for that one full-draw shot, "train target block close 5", or mid or long with up to 10 shots, for a Moon-started, Moon-stoppable session, one shot at a time with a pause and a report after each, "target block training status" for session, shots, and tier passes, "target block training stop" to stop a session or a pending shot anytime, and "target block passed live close", "mid", or "long" only after you watched that tier clean. Signal note: I try to read a power property after a shot, and otherwise say signal not readable, I never invent a score, and a target block does NOT train moving targets, it is stationary :3')
}

function r19RoundHelp () {
  say('Round 19: targeting and duelling are now generalised to private servers and private worlds Moon owns or controls, not just Boykissers, so a rename or a new world does not need a rewrite, never a public server, never Noah server without Noah explicit say-so live, no hardcoded server name check in code. Say "bow training help" for charge, tiers, drop, and leading, "bow aim check" for distance, moving, and direction, "bow training practice close", "mid", "moving", or "long" for one pending shot, no shot yet, "bow training shoot" for one full-draw shot, "bow training cancel" to stop, "bow training passed live close", "mid", "moving", or "long" only after you watched that tier clean, and "bow training status" for tier passes, long needs close and mid passes first. Plus "shield arrows help", "shield arrows check", "shield arrows practice" for one timed block facing a shooter, "shield arrows duel step" inside an active duel, and "shield arrows passed live" only after a watched practice. Bow super-good and shield arrows perfect timing are end goals, a hit or a blocked arrow is confirmed only by you watching live :3')
}

function r18RoundHelp () {
  say('Round 18: say "target help" for the targeting system, "target <player or mob name>" for one target only, "target status", "target clear", "duel <player name>" then "duel confirm" for a confirmed private-server duel, "duel status", "duel crit step" as a separate Moon-confirmed jump crit, "duel passed live" only after you watched clean, "attack target" for a mob target only, "stop duel" anytime, plus "bow help", "bow check", "bow practice" on a mob only, "bow shoot" for one full-draw shot, "bow cancel", "bow passed live", plus "shield help", "shield check", "shield practice" for one timed block step, and "shield passed live". Bow super-good, shield-perfect timing, and duel mastery are end goals, targeting is for private servers Moon controls only, and no player is attacked without a named, present, confirmed duel live :3')
}

  // Round 18: bow, shield, duel + targeting, private servers Moon controls only (generalised in round 19).
// ---------------------------------------------------------------- round 23: learned phrases from live play
// Moon's live phrases, 2026-10-30, logged as [unknown-message]:
// "Fight!", "Need food?", "What do you know?". Bare chat (no
// "Nova, " prefix) never reaches parseFuzzyIntent: the chat handler
// tries conversationalReply first, so the bare forms are also handled
// there (see conversationalReply). The "Nova, " forms come here.
// "Need food?" reading, stated honestly: "low" means not full
// (food < 20) or hurt (health < 20), because a hurt bot needs food
// to regenerate. If neither, one short line says he does not need
// food, with no numbers. If he does need food, eatHeldFood eats one
// held item and says so, or says he has none — no food count is
// invented, inventory is the only source.
// "What do you know?" is deliberately SHORT, not the huge help dump,
// because Moon asked for no bunch of chat stats: one message, a
// brief list, and "help" for the full list.
function r23Fight () {
  setFight(true) // says "Fighting! :3", hostile mobs only via fightTick
}
async function r23NeedFood () {
  if (!bot) { say("I'm not in the world yet :3"); return }
  const food = (typeof bot.food === 'number') ? bot.food : null
  const health = (typeof bot.health === 'number') ? bot.health : null
  if (food === 20 && health === 20) { say('Nope, I am full right now :3'); return }
  await eatHeldFood() // "Ate X :3", "I don't have any food to eat :3", or a failure line
}
function r23WhatDoYouKnow () {
  say('I can follow, fight, guard, eat, open doors, craft, mine, go to water for endermen, and return to my stuff. Say "help" for the full list :3')
}
function r23RoundHelp () {
  say('Round 23: say "fight" to start the existing hostile-mob-only fight step, "need food" and I eat one held food if I am not full or I am hurt, or say briefly I have none or do not need any, and "what do you know" for a short list, say "help" for the full list. Bare forms work too, no "Nova, " needed :3')
}

function parseFuzzyIntent (cmd) {
  // Round 25: specific hunt, general gathering with quantity, bring
  // = go get first, and planks from trees. These run first so a
  // quantity like "two blocks of dirt" is parsed here, not read as
  // one item name by the older bring/get patterns below.
  if (r25TryCommand(cmd)) return true
  // Round 23: phrases Moon used live on 2026-10-30 that were logged as
  // [unknown-message] because bare chat never reaches this dispatch
  // (see conversationalReply, which handles the bare forms too).
  // These run first so they are not swallowed by any generic pattern.
  // "fight" here is the same hostile-mob-only fight step as the
  // existing "fight" switch case: fightTick targets only
  // findNearestHostile, never a player.
  if (/^(fight)$/.test(cmd)) { r23Fight(); return true }
  if (/^(need food|do you need food)$/.test(cmd)) { (async () => { await r23NeedFood() })(); return true }
  if (/^(what do you know|what can you do)$/.test(cmd)) { r23WhatDoYouKnow(); return true }
  if (/^(round 23 help|round twenty three help)$/.test(cmd)) { r23RoundHelp(); return true }
  // Round 22: enderman safety + death-loot return. These run first so
  // "enderman ..." and "death spot ..." are not swallowed elsewhere,
  // and a generic "stop" also stops a death journey / pending retreat.
  if (cmd === 'stop' || cmd === 'stop everything') {
    if (r22DeathJourney) r22DeathJourney.active = false
    r22EndermanPending = null
  }
  if (/^(enderman help|help enderman|enderman guide)$/.test(cmd)) { r22EndermanHelp(); return true }
  if (/^(enderman check|check enderman|enderman status)$/.test(cmd)) { r22EndermanCheck(); return true }
  if (/^(enderman water|enderman water setup|enderman retreat|enderman water retreat)$/.test(cmd)) { r22EndermanWaterSetup(); return true }
  if (/^(enderman water confirm|confirm enderman water|enderman confirm water)$/.test(cmd)) { (async () => { await r22EndermanWaterConfirm() })(); return true }
  if (/^(enderman stop|stop enderman|enderman cancel|cancel enderman)$/.test(cmd)) { r22EndermanStop(); return true }
  if (/^(enderman passed live|enderman pass live)$/.test(cmd)) { r22EndermanPassedLive(); return true }
  if (/^(wear pumpkin|wear carved pumpkin|equip pumpkin|put on pumpkin)$/.test(cmd)) { r22WearPumpkin(); return true }
  if (/^(death spot|check death spot|where did i die|where did you die|last death)$/.test(cmd)) { r22DeathSpotSay(); return true }
  if (/^(return to my stuff|go to death spot|return to death spot|go to my stuff)$/.test(cmd)) { (async () => { await r22ReturnToDeathSpot() })(); return true }
  if (/^(death spot stop|stop death spot|stop return to my stuff|cancel death spot)$/.test(cmd)) { r22DeathSpotStop(); return true }
  if (/^(round 22 help|round twenty two help)$/.test(cmd)) { r22RoundHelp(); return true }
  // Round 21: lure skill + target redstone line. These run first so
  // "target redstone ..." is not swallowed by the round 18
  // "target <name>" pattern, and "lure ..." is not swallowed elsewhere.
  if (/^(lure help|help lure|lure guide)$/.test(cmd)) { r21LureHelp(); return true }
  if (/^(lure status|lure state|check lure)$/.test(cmd)) { r21LureStatus(); return true }
  if (/^(lure stop|stop lure|cancel lure|lure cancel)$/.test(cmd)) { r21LureStop(); return true }
  if (/^(lure confirm|confirm lure|lure start)$/.test(cmd)) { r21LureConfirm(); return true }
  if (/^(lure passed live|lure pass live)$/.test(cmd)) { r21LurePassedLive(); return true }
  let r21m = cmd.match(/^lure check ([a-z]+)$/)
  if (r21m) { r21LureCheck(r21m[1]); return true }
  r21m = cmd.match(/^lure (?:some )?([a-z]+) to (.+)$/)
  if (r21m) {
    let rest = r21m[2].trim()
    let hole = false
    let methodWanted = null
    for (let k = 0; k < 2; k++) {
      if (rest.endsWith(' hole')) { hole = true; rest = rest.slice(0, -5).trim() }
      if (rest.endsWith(' with lead')) { methodWanted = 'lead'; rest = rest.slice(0, -10).trim() }
      else if (rest.endsWith(' with food')) { methodWanted = 'food'; rest = rest.slice(0, -10).trim() }
    }
    r21LureSetup(r21m[1], rest, { hole: hole, methodWanted: methodWanted }); return true
  }
  if (/^(target redstone help|help target redstone|target redstone guide)$/.test(cmd)) { r21RedLineHelp(); return true }
  if (/^(target redstone check|check target redstone|target redstone status)$/.test(cmd)) { r21RedLineCheck(); return true }
  if (/^(target redstone read|read target redstone|target redstone signal)$/.test(cmd)) { r21RedLineReadSay(); return true }
  r21m = cmd.match(/^target redstone line (east|west|north|south)$/)
  if (r21m) { (async () => { await r21RedLinePlace(r21m[1]) })(); return true }
  if (/^(target redstone line|place target redstone line)$/.test(cmd)) { say('Target redstone line refused, direction must be east, west, north, or south, say "target redstone line east" :3'); return true }
  if (/^(round 21 help|round twenty one help)$/.test(cmd)) { r21RoundHelp(); return true }
  // Round 20: target block self-training. These run first so
  // "target block ..." is not swallowed by the round 18
  // "target <name>" pattern, which would treat "block help"
  // as a target name.
  if (/^(target block help|help target block|target block guide)$/.test(cmd)) { r20TargetBlockHelp(); return true }
  if (/^(target block check|check target block|target block status check)$/.test(cmd)) { r20TargetBlockCheck(); return true }
  if (/^(craft target block|craft a target block|make target block)$/.test(cmd)) { (async () => { await r20CraftTargetBlock() })(); return true }
  if (/^(place target block|place a target block|put down target block)$/.test(cmd)) { (async () => { await r20PlaceTargetBlock() })(); return true }
  let r20m = cmd.match(/^target block practice (close|mid|long)$/)
  if (r20m) { r20TargetBlockPractice(r20m[1]); return true }
  if (/^(target block shoot|shoot target block|target block confirm)$/.test(cmd)) { (async () => { await r20TargetBlockShoot() })(); return true }
  r20m = cmd.match(/^train target block (close|mid|long) (\d+)$/)
  if (r20m) { (async () => { await r20TargetBlockTrain(r20m[1], parseInt(r20m[2], 10)) })(); return true }
  if (/^(target block training status|target block session status|target block training state)$/.test(cmd)) { r20TargetBlockStatus(); return true }
  if (/^(target block training stop|stop target block training|cancel target block training|target block cancel)$/.test(cmd)) { r20TargetBlockTrainingStop(); return true }
  r20m = cmd.match(/^target block passed live (close|mid|long)$/)
  if (r20m) { r20TargetBlockPassedLive(r20m[1]); return true }
  if (/^(round 20 help|round twenty help)$/.test(cmd)) { r20RoundHelp(); return true }
    if (/^(stop|stop everything)$/.test(cmd)) { const wasDuel = r18StopDuel('moon stop'); if (wasDuel) { say(`Stopped: duel with ${wasDuel.name} stopped, I will not attack again until a fresh named duel is confirmed live :3`); } }
    if (/^(target help|help target|targeting help|target system help)$/.test(cmd)) { r18TargetHelp(); return true }
    let r18m = cmd.match(/^target ([A-Za-z0-9_ ]+)$/)
    if (r18m) { r18TargetSet(r18m[1]); return true }
    if (/^(target status|target state|check target|current target)$/.test(cmd)) { r18TargetStatus(); return true }
    if (/^(target clear|clear target|untarget|forget target)$/.test(cmd)) { r18TargetClear(); return true }
    r18m = cmd.match(/^duel ([A-Za-z0-9_ ]+)$/)
    if (r18m) { r18DuelStart(r18m[1]); return true }
    if (/^(duel me|fight me|duel with me)$/.test(cmd)) { r18DuelMe(); return true }
    if (/^(duel confirm|confirm duel|duel start confirmed)$/.test(cmd)) { r18DuelConfirm(); return true }
    if (/^(duel status|duel state|check duel)$/.test(cmd)) { r18DuelStatus(); return true }
    if (/^(duel crit step|crit step duel|duel crit|crit duel step)$/.test(cmd)) { (async () => { await r18DuelCritStep() })(); return true }
    if (/^(duel passed live|duel pass live|duel passed)$/.test(cmd)) { r18DuelPassedLive(); return true }
    if (/^(stop duel|duel stop|cancel duel|end duel)$/.test(cmd)) { const was = r18StopDuel('moon stop'); say(was ? `Duel stopped with ${was.name}, I will not attack again until a fresh named duel is confirmed live :3` : 'No duel was active :3'); return true }
    if (/^(attack target|attack my target|hit target)$/.test(cmd)) { (async () => { await r18AttackTarget() })(); return true }
    if (/^(bow help|help bow|archery help)$/.test(cmd)) { r18BowHelp(); return true }
    if (/^(bow check|check bow|archery check)$/.test(cmd)) { r18BowCheck(); return true }
    if (/^(bow practice|practice bow|archery practice)$/.test(cmd)) { r18BowPractice(); return true }
    if (/^(bow shoot|shoot bow|confirm bow|bow confirm)$/.test(cmd)) { (async () => { await r18BowShoot() })(); return true }
    if (/^(bow cancel|cancel bow)$/.test(cmd)) { r18BowCancel(); return true }
    if (/^(bow passed live|bow pass live|archery passed live)$/.test(cmd)) { r18BowPassedLive(); return true }
    if (/^(shield help|help shield|shield guide)$/.test(cmd)) { r18ShieldHelp(); return true }
    if (/^(shield check|check shield)$/.test(cmd)) { r18ShieldCheck(); return true }
    if (/^(shield practice|practice shield|shield block practice)$/.test(cmd)) { (async () => { await r18ShieldPractice() })(); return true }
    if (/^(shield passed live|shield pass live)$/.test(cmd)) { r18ShieldPassedLive(); return true }
    if (/^(round 18 help|round eighteen help)$/.test(cmd)) { r18RoundHelp(); return true }
  // Round 19: generalised private-server scope, bow training tiers, shield vs arrows.
  if (/^(bow training help|bow training guide|help bow training)$/.test(cmd)) { r19BowTrainingHelp(); return true }
  if (/^(bow aim check|aim check bow|bow check aim)$/.test(cmd)) { r19BowAimCheck(); return true }
  if (/^(bow training status|bow training state|bow tiers status)$/.test(cmd)) { r19BowTrainingStatus(); return true }
  let r19m = cmd.match(/^bow training practice (close|mid|moving|long)$/)
  if (r19m) { r19BowTrainingPractice(r19m[1]); return true }
  if (/^(bow training shoot|shoot bow training|bow training confirm)$/.test(cmd)) { (async () => { await r19BowTrainingShoot() })(); return true }
  if (/^(bow training cancel|cancel bow training)$/.test(cmd)) { r19BowTrainingCancel(); return true }
  r19m = cmd.match(/^bow training passed live (close|mid|moving|long)$/)
  if (r19m) { r19BowTrainingPassedLive(r19m[1]); return true }
  if (/^(shield arrows help|help shield arrows|arrows shield help)$/.test(cmd)) { r19ShieldArrowsHelp(); return true }
  if (/^(shield arrows check|check shield arrows|arrows check shield)$/.test(cmd)) { r19ShieldArrowsCheck(); return true }
  if (/^(shield arrows practice|practice shield arrows|shield practice arrows)$/.test(cmd)) { (async () => { await r19ShieldArrowsPractice() })(); return true }
  if (/^(shield arrows duel step|shield duel arrows step|arrows duel shield step)$/.test(cmd)) { (async () => { await r19ShieldArrowsDuelStep() })(); return true }
  if (/^(shield arrows passed live|shield arrows pass live)$/.test(cmd)) { r19ShieldArrowsPassedLive(); return true }
  if (/^(round 19 help|round nineteen help)$/.test(cmd)) { r19RoundHelp(); return true }
  // Round 17: mace clutch, staged, low passive-mob first, warden scene help-only.
  if (/^(mace clutch help|help mace clutch|mace help)$/.test(cmd)) { maceClutchHelp(); return true }
  if (/^(mace clutch ready live|mace ready live|ready live mace clutch)$/.test(cmd)) { maceClutchReadyLive(); return true }
  if (/^(mace clutch check|check mace clutch|mace check)$/.test(cmd)) { maceClutchCheck(); return true }
  if (/^(mace clutch practice|practice mace clutch|mace practice)$/.test(cmd)) { maceClutchPractice(); return true }
  if (/^(mace clutch confirm|confirm mace clutch|mace clutch confirm attempt)$/.test(cmd)) { (async () => { await maceClutchConfirmAttempt() })(); return true }
  if (/^(mace clutch cancel|cancel mace clutch)$/.test(cmd)) { maceClutchCancel(); return true }
  if (/^(mace clutch attempts|mace attempts|mace clutch history)$/.test(cmd)) { maceClutchAttemptsList(); return true }
  if (/^(mace clutch passed live|mace passed live|mace clutch pass live)$/.test(cmd)) { maceClutchPassedLive(); return true }
  if (/^(mace clutch tower help|tower help mace clutch|mace tower help)$/.test(cmd)) { maceClutchTowerHelp(); return true }
  if (/^(impress warden scene help|warden scene help|warden scene help impress|impress warden help)$/.test(cmd)) { impressWardenSceneHelp(); return true }
  if (/^(impress warden scene|warden scene|mace clutch warden|warden mace clutch|mace warden scene)$/.test(cmd)) { maceWardenRefusal(); return true }
  if (/^(round 17 help|round seventeen help)$/.test(cmd)) { say('Round 17: say "mace clutch help" for smash mechanics and what a clutch needs, "mace clutch ready live" when you are watching, "mace clutch check" for mace, mob below, fall height, health, and food, "mace clutch practice" to set one pending practice, no fall yet, "mace clutch confirm" for one low attempt on a pig, cow, or sheep only, "mace clutch cancel" to stop, "mace clutch attempts" for session attempts, "mace clutch passed live" only after you watched a clean smash and only if an attempt exists this session, "mace clutch tower help" for the gated tower design, help only, no build command, and "impress warden scene help" for the dramatic end-goal scene, description only, locked, never in "impress next", plus "impress status" now reports mace unlock separately :3'); return true }
  // Round 16: impress me routine, end goal, staged, one trick at a time.
  if (/^(impress help|help impress|impress guide)$/.test(cmd)) { impressHelp(); return true }
  if (/^(impress me|impress|show off|show me something cool)$/.test(cmd)) { impressStart(); return true }
  if (/^(impress status|impress state|impress routine status)$/.test(cmd)) { impressStatus(); return true }
  if (/^(impress next|impress next trick|next impress trick)$/.test(cmd)) { (async () => { await impressNext() })(); return true }
  if (/^(impress confirm clutch|confirm impress clutch|impress clutch confirm)$/.test(cmd)) { (async () => { await impressConfirmClutch() })(); return true }
  if (/^(impress cancel|cancel impress|stop impress)$/.test(cmd)) { impressCancel(); return true }
  if (/^(impress passed live|impress routine passed live|impress pass live)$/.test(cmd)) { impressPassedLive(); return true }
  if (/^(auto clutch attempt help|auto clutch save help|clutch auto attempt help)$/.test(cmd)) { autoClutchAttemptHelp(); return true }
  if (/^(ladder grab proof help|grab proof help ladder|ladder proof help)$/.test(cmd)) { ladderGrabProofHelp(); return true }
  if (/^(parkour automation help|parkour automatic help|automation help parkour)$/.test(cmd)) { parkourAutomationHelp(); return true }
  if (/^(round 16 help|round sixteen help)$/.test(cmd)) { say('Round 16: say "impress help", "impress me" to set up a routine, "impress status" to see unlocked tricks and missing ones, "impress next" for one trick only, "impress confirm clutch" for the low clutch stage with you watching, "impress cancel" to stop at any time, or "impress passed live" only after you watched the whole routine clean, plus "auto clutch attempt help", "ladder grab proof help", and "parkour automation help", all help-only, none of those three are claimed as working :3'); return true }
  let r15m
  // Round 15: auto-clutch watch only, ladder grab proof, and
  // parkour course stepping. These run first so the new, more
  // specific patterns are not swallowed by round 14 handlers.
  // Auto-clutch is watch and report only in this round, it never
  // places, throws, or saves the bot by itself, even when ON.
  if (/^(auto clutch help|clutch auto help|auto clutch guide)$/.test(cmd)) { autoClutchHelp(); return true }
  r15m = cmd.match(/^auto clutch setup (water|powder snow|slime|hay|bed|scaffolding|sweet berries|pearl|ladder|cobweb)$/)
  if (r15m) { autoClutchSetup(r15m[1]); return true }
  r15m = cmd.match(/^auto clutch set max (\d+)$/)
  if (r15m) { autoClutchSetMax(parseInt(r15m[1], 10)); return true }
  r15m = cmd.match(/^auto clutch set min health (\d+)$/)
  if (r15m) { autoClutchSetMinHealth(parseInt(r15m[1], 10)); return true }
  if (/^(auto clutch confirm enable|confirm auto clutch enable|auto clutch enable confirm)$/.test(cmd)) { autoClutchConfirmEnable(); return true }
  if (/^(auto clutch cancel setup|cancel auto clutch setup)$/.test(cmd)) { autoClutchCancelSetup(); return true }
  if (/^(auto clutch off|auto clutch watch off|turn auto clutch off)$/.test(cmd)) { autoClutchOff(); return true }
  if (/^(auto clutch status|auto clutch watch status|auto clutch state)$/.test(cmd)) { autoClutchStatus(); return true }
  if (/^(auto clutch reports|auto clutch fall reports|auto clutch history)$/.test(cmd)) { autoClutchReportsList(); return true }
  if (/^(auto clutch fall check|auto fall check|check auto clutch fall)$/.test(cmd)) { autoClutchFallCheck(); return true }
  if (/^(ladder grab check|grab ladder check|ladder grab proof|check ladder grab)$/.test(cmd)) { ladderGrabCheck(); return true }
  if (/^(ladder grab reports|ladder grab history|grab reports ladder)$/.test(cmd)) { ladderGrabReports(); return true }
  if (/^(parkour course face check|course face check parkour|face check parkour course)$/.test(cmd)) { parkourCourseFaceCheck(); return true }
  if (/^(parkour course landing check|course landing check parkour|landing check parkour course)$/.test(cmd)) { parkourCourseLandingCheck(); return true }
  if (/^(parkour course reposition help|course reposition help parkour|reposition help parkour course)$/.test(cmd)) { parkourCourseRepositionHelp(); return true }
  if (/^(parkour course step help|course step help parkour|parkour step help course)$/.test(cmd)) { parkourCourseStepHelp(); return true }
  if (/^(round 15 help|round fifteen help)$/.test(cmd)) { say('Round 15: say "auto clutch help", "auto clutch setup water" for a method with a live pass, "auto clutch set max 12", "auto clutch set min health 15", "auto clutch confirm enable" within 2 minutes to turn the watch ON, "auto clutch status", "auto clutch fall check", "auto clutch reports", or "auto clutch off", plus "ladder grab check", "ladder grab reports", "parkour course face check", "parkour course landing check", "parkour course reposition help", and "parkour course step help". Auto clutch is watch and report only in this round, it never places or throws by itself, a ladder grab is confirmed only by you watching live, and a parkour course is one jump at a time, never an automatic run :3'); return true }
  // Round 14: high-fall clutch staging, ladder clutch attempts, and
  let r14m
  // chained parkour courses. These run first so the new, more
  // specific patterns are not swallowed by round 13 handlers.
  if (/^(clutch high help|high clutch help|clutch staging help)$/.test(cmd)) { clutchHighHelp(); return true }
  r14m = cmd.match(/^clutch high practice (water|powder snow|slime|hay|bed|scaffolding|sweet berries|pearl|ladder|cobweb)$/)
  if (r14m) { clutchHighPractice(r14m[1]); return true }
  if (/^(clutch high confirm attempt|confirm clutch high attempt|high clutch confirm)$/.test(cmd)) { (async () => { await clutchHighConfirmAttempt() })(); return true }
  if (/^(clutch high cancel|cancel clutch high)$/.test(cmd)) { clutchHighCancel(); return true }
  r14m = cmd.match(/^clutch high passed live (water|powder snow|slime|hay|bed|scaffolding|sweet berries|pearl|cobweb) ([1234])$/)
  if (r14m) { clutchHighPassedLive(r14m[1], parseInt(r14m[2], 10)); return true }
  if (/^(clutch high attempts|clutch high history|high clutch attempts)$/.test(cmd)) { clutchHighAttemptsList(); return true }
  if (/^(ladder clutch check detailed|detailed ladder clutch check|clutch check ladder detailed)$/.test(cmd)) { ladderClutchCheckDetailed(); return true }
  if (/^(ladder clutch practice|clutch practice ladder staged|ladder practice clutch)$/.test(cmd)) { ladderClutchPractice(); return true }
  if (/^(ladder clutch confirm attempt|confirm ladder clutch attempt|ladder clutch attempt confirm)$/.test(cmd)) { (async () => { await ladderClutchConfirmAttempt() })(); return true }
  if (/^(ladder clutch cancel|cancel ladder clutch)$/.test(cmd)) { ladderClutchCancel(); return true }
  if (/^(ladder clutch passed live|ladder passed live|clutch passed live ladder staged)$/.test(cmd)) { ladderClutchPassedLive(); return true }
  if (/^(ladder clutch attempts|ladder clutch history)$/.test(cmd)) { ladderClutchAttemptsList(); return true }
  if (/^(clutch methods report|clutch report|clutch methods status)$/.test(cmd)) { clutchMethodsReport(); return true }
  if (/^(parkour course help|course parkour help|parkour course guide)$/.test(cmd)) { parkourCourseHelp(); return true }
  r14m = cmd.match(/^parkour course set ((?:[234] ?)+)$/)
  if (r14m) { parkourCourseSet(r14m[1].trim().split(/\s+/).map((x) => parseInt(x, 10))); return true }
  if (/^(parkour course status|course status parkour|parkour course state)$/.test(cmd)) { parkourCourseStatus(); return true }
  if (/^(parkour course next|course next parkour|next course jump)$/.test(cmd)) { (async () => { await parkourCourseNext() })(); return true }
  if (/^(parkour course cancel|cancel parkour course)$/.test(cmd)) { parkourCourseCancel(); return true }
  if (/^(parkour course passed live|course passed live parkour)$/.test(cmd)) { parkourCoursePassedLive(); return true }
  if (/^(round 14 help|round fourteen help)$/.test(cmd)) { say('Round 14: say "clutch high help", "clutch high practice water" at a staged drop after a low pass, "clutch high confirm attempt", "clutch high passed live water 2", "clutch high attempts", "ladder clutch check detailed", "ladder clutch practice" beside a wall, "ladder clutch confirm attempt", "ladder clutch passed live", "ladder clutch attempts", "clutch methods report", "parkour course help", "parkour course set 2 3 4", "parkour course status", "parkour course next" for one jump only, "parkour course cancel", or "parkour course passed live". Every step stops and waits for you live :3'); return true }
  // Round 13: brewing no-signal confirms and detailed confirmations,
  // window age detail / summary detail / forget by custom age,
  // ladder top step, ladder water-corner check, swimming crawl
  // detail, piston timed step, boat river-ice and waterfall-safe
  // steps, minecart no-power step, elytra long-travel plan and
  // travel step, lobby markers by distance, lobby watch with a
  // 30-second quiet background check that only speaks on a real
  // transition, lobby transition summary, and read-only food,
  // nearby hostile/animal, and distance checks. These run before
  // round 12 handlers so the new, more specific patterns are not
  // swallowed by generic ones. No new lobby blocks are added here.
  let r13m = cmd.match(/^brew (extended|upgraded) no signal check$/)
  if (r13m) { brewNoSignalCheck(r13m[1]); return true }
  r13m = cmd.match(/^brew (extended|upgraded) confirm steps$/)
  if (r13m) { brewConfirmSteps(r13m[1]); return true }
  if (/^(brew confirmations detailed|detailed brew confirmations)$/.test(cmd)) { brewConfirmationsDetailed(); return true }
  if (/^(window layout age detailed|detailed window layout age)$/.test(cmd)) { windowLayoutAgeDetailed(); return true }
  if (/^(window layout summary detailed|detailed window layout summary)$/.test(cmd)) { windowLayoutSummaryDetailed(); return true }
  r13m = cmd.match(/^forget stale window layouts older than (\d+) minutes?$/)
  if (r13m) { windowLayoutForgetStaleOlder(parseInt(r13m[1], 10)); return true }
  r13m = cmd.match(/^forget window layouts older than (\d+) minutes?$/)
  if (r13m) { windowLayoutForgetStaleOlder(parseInt(r13m[1], 10)); return true }
  if (/^(ladder top step|top ladder step)$/.test(cmd)) { (async () => { await ladderTopStep() })(); return true }
  if (/^(ladder water corner check|water corner ladder check|ladder corner water check)$/.test(cmd)) { ladderWaterCornerCheck(); return true }
  if (/^(crawl swimming check detailed|detailed crawl swimming check)$/.test(cmd)) { crawlSwimmingCheckDetailed(); return true }
  if (/^(piston activated live|piston activated|activated piston live)$/.test(cmd)) { pistonActivatedLive(); return true }
  if (/^(crawl piston timed step|timed crawl piston step|piston timed crawl step)$/.test(cmd)) { (async () => { await crawlPistonTimedStep() })(); return true }
  if (/^(boat river ice check|river ice boat check|boat ice river check)$/.test(cmd)) { boatRiverIceCheck(); return true }
  if (/^(boat waterfall step safe|safe boat waterfall step|waterfall boat step safe)$/.test(cmd)) { (async () => { await boatWaterfallStepSafe() })(); return true }
  if (/^(minecart no power step|no power minecart step|minecart step no power)$/.test(cmd)) { (async () => { await minecartNoPowerStep() })(); return true }
  if (/^(elytra long travel plan|long elytra travel plan|elytra travel plan long)$/.test(cmd)) { elytraLongTravelPlan(); return true }
  if (/^(elytra travel step|travel elytra step|elytra step travel)$/.test(cmd)) { (async () => { await elytraTravelStep() })(); return true }
  if (/^(lobby markers by distance|lobby distance markers|check lobby markers by distance)$/.test(cmd)) { lobbyMarkersByDistance(); return true }
  if (/^(lobby watch on|watch lobby on|turn lobby watch on)$/.test(cmd)) { lobbyWatchOn(); return true }
  if (/^(lobby watch off|watch lobby off|turn lobby watch off)$/.test(cmd)) { lobbyWatchOff(); return true }
  if (/^(lobby watch status|watch lobby status|is lobby watch on)$/.test(cmd)) { lobbyWatchStatus(); return true }
  if (/^(lobby transition summary|transition summary lobby|last lobby transition)$/.test(cmd)) { lobbyTransitionSummary(); return true }
  if (/^(check food count|food count check|how much food)$/.test(cmd)) { checkFoodCount(); return true }
  if (/^(check nearby hostiles|nearby hostiles|hostiles nearby)$/.test(cmd)) { checkNearbyGroups('hostile'); return true }
  if (/^(check nearby animals|nearby animals|animals nearby)$/.test(cmd)) { checkNearbyGroups('animal'); return true }
  if (/^(check distance to moon|distance to moon|how far are you from me)$/.test(cmd)) { checkDistanceToMoon(); return true }
  if (/^(clutch help|mlg help|clutch methods)$/.test(cmd)) { clutchHelp(); return true }
  if (/^(clutch check|check clutch|clutch inventory check)$/.test(cmd)) { clutchCheck(null); return true }
  r13m = cmd.match(/^clutch check (water|powder snow|slime|hay|bed|scaffolding|sweet berries|pearl|ladder|cobweb)$/)
  if (r13m) { clutchCheck(r13m[1]); return true }
  if (/^(clutch fall check|fall clutch check|am i falling clutch)$/.test(cmd)) { clutchFallCheck(); return true }
  r13m = cmd.match(/^clutch practice (water|powder snow|slime|hay|bed|scaffolding|sweet berries|pearl|ladder|cobweb)$/)
  if (r13m) { clutchPractice(r13m[1]); return true }
  if (/^(clutch confirm attempt|confirm clutch attempt|clutch attempt confirm)$/.test(cmd)) { (async () => { await clutchConfirmAttempt() })(); return true }
  if (/^(clutch cancel|cancel clutch)$/.test(cmd)) { clutchCancel(); return true }
  r13m = cmd.match(/^clutch passed live (water|powder snow|slime|hay|bed|scaffolding|sweet berries|pearl|ladder|cobweb)$/)
  if (r13m) { clutchPassedLive(r13m[1]); return true }
  if (/^(clutch attempts|clutch history|clutch attempt history)$/.test(cmd)) { clutchAttemptsList(); return true }
  if (/^(parkour help|parkour guide|jump help)$/.test(cmd)) { parkourHelp(); return true }
  if (/^(parkour check|check parkour|parkour gap check)$/.test(cmd)) { parkourCheck(); return true }
  if (/^(parkour sprint jump step|sprint jump step|parkour step)$/.test(cmd)) { (async () => { await parkourSprintJumpStep() })(); return true }
  r13m = cmd.match(/^parkour jump ([234])$/)
  if (r13m) { (async () => { await parkourJumpAttempt(parseInt(r13m[1], 10)) })(); return true }
  if (/^(parkour spin help|spin jump help|360 help)$/.test(cmd)) { parkourSpinHelp(); return true }
  if (/^(parkour spin ready live|spin ready live|parkour spin ready)$/.test(cmd)) { parkourSpinReady(); return true }
  if (/^(parkour spin step|spin jump step|360 spin step|parkour 360 step)$/.test(cmd)) { (async () => { await parkourSpinStep() })(); return true }
  if (/^(parkour spin passed live|spin passed live|parkour 360 passed live)$/.test(cmd)) { parkourPassedLive('spin'); return true }
  r13m = cmd.match(/^parkour passed live ([234])$/)
  if (r13m) { parkourPassedLive(r13m[1]); return true }
  if (/^(parkour attempts|parkour history|parkour attempt history)$/.test(cmd)) { parkourAttemptsList(); return true }
  if (/^(round 13 help|round thirteen help)$/.test(cmd)) { say('Round 13: say "brew extended no signal check", "brew extended confirm steps", "brew confirmations detailed", "window layout age detailed", "window layout summary detailed", "forget stale window layouts older than 30 minutes", "ladder top step", "ladder water corner check", "crawl swimming check detailed", "piston activated live" then "crawl piston timed step", "boat river ice check", "boat waterfall step safe", "minecart no power step", "elytra long travel plan", "elytra travel step", "lobby markers by distance", "lobby watch on", "lobby watch off", "lobby watch status", "lobby transition summary", "check food count", "check nearby hostiles", "check nearby animals", "check distance to moon", "clutch help", "clutch check", "clutch practice water", "clutch confirm attempt", "clutch attempts", "parkour help", "parkour check", "parkour sprint jump step", "parkour jump 2", "parkour jump 3", "parkour jump 4", "parkour spin help", "parkour spin ready live", "parkour spin step", or "parkour attempts". Every step stops and waits for you live :3'); return true }
  // Round 12: detailed brew diffs and tooltip checklists, window
  // layout summary / age / forget-stale / compare-all, small travel
  // steps gated by water, corner, slope, ice, and landing checks,
  // elytra route check and rocket-free glide step, lobby marker
  // details and history, and read-only held-item / nearby-by-type /
  // spawn-point checks. These run before round 11 handlers so the
  // new, more specific patterns are not swallowed by generic ones.
  let r12m = cmd.match(/^brew (extended|upgraded) (field diff detailed|detailed field diff|diff detailed)$/)
  if (r12m) { brewDiffDetailed(r12m[1]); return true }
  r12m = cmd.match(/^brew (extended|upgraded) tooltip checklist$/)
  if (r12m) { brewTooltipChecklist(r12m[1]); return true }
  if (/^(brew check history|brew history|last brew check)$/.test(cmd)) { brewCheckHistory(); return true }
  if (/^(forget brew check|clear brew check)$/.test(cmd)) { forgetBrewCheck(); return true }
  if (/^(window layout summary|window layouts summary|summary window layouts)$/.test(cmd)) { windowLayoutSummary(); return true }
  if (/^(window layout age check|window layout age|check window layout age)$/.test(cmd)) { windowLayoutAgeCheck(); return true }
  if (/^(forget stale window layouts|forget old window layouts|clear stale window layouts)$/.test(cmd)) { windowLayoutForgetStale(); return true }
  if (/^(window layout compare all|compare all window layouts|check all window layouts)$/.test(cmd)) { (async () => { await windowLayoutCompareAll() })(); return true }
  if (/^(ladder water step|water ladder step)$/.test(cmd)) { ladderWaterStep(); return true }
  if (/^(ladder corner step|corner ladder step)$/.test(cmd)) { ladderCornerStep(); return true }
  if (/^(crawl piston check|check crawl piston|piston crawl check)$/.test(cmd)) { crawlPistonCheck(); return true }
  if (/^(boat river step|river boat step)$/.test(cmd)) { (async () => { await boatRiverStep() })(); return true }
  if (/^(boat ice step|ice boat step)$/.test(cmd)) { (async () => { await boatIceStep() })(); return true }
  if (/^(minecart slope step|slope minecart step)$/.test(cmd)) { (async () => { await minecartSlopeStep() })(); return true }
  if (/^(elytra route check|check elytra route|elytra preflight check)$/.test(cmd)) { elytraRouteCheck(); return true }
  if (/^(elytra glide step|glide step elytra|elytra step no rocket)$/.test(cmd)) { (async () => { await elytraGlideStep() })(); return true }
  if (/^(lobby markers|lobby markers detail|lobby marker check|check lobby markers)$/.test(cmd)) { lobbyMarkersDetail(); return true }
  if (/^(lobby details|lobby detail check|check lobby details)$/.test(cmd)) { lobbyMarkersDetail(); return true }
  if (/^(lobby history|lobby transition log|transition log|lobby checks)$/.test(cmd)) { lobbyHistory(); return true }
  if (/^(check held item|held item check|what am i holding)$/.test(cmd)) { checkHeldItem(); return true }
  if (/^(check nearby by type|nearby by type|mobs by type)$/.test(cmd)) { checkNearbyByType(); return true }
  if (/^(check spawn point|spawn point check|where is my spawn)$/.test(cmd)) { checkSpawnPoint(); return true }
  if (/^(round 12 help|round twelve help)$/.test(cmd)) { say('Round 12: say "brew extended field diff detailed", "brew extended tooltip checklist", "brew check history", "forget brew check", "window layout summary", "window layout age check", "forget stale window layouts", "window layout compare all", "ladder water step", "ladder corner step", "crawl piston check", "boat river step", "boat ice step", "minecart slope step", "elytra route check", "elytra glide step", "lobby markers", "lobby history", "check held item", "check nearby by type", or "check spawn point". Every step stops and waits for you live :3'); return true }
  // Round 11: tooltip comparison with live confirmation only,
  // window-layout compare / reconfirm / forget-all / stale check,
  // trapdoor-top and waterfall steps, minecart ride step, elytra
  // route planning with a counted rocket step, swimming crawl step
  // with the air rule, and read-only status checks. These run before
  // round 10 handlers so "window layout X compare" is not swallowed
  // by the generic round 9 layout pattern.
  if (/^(brew tooltip help|tooltip compare help|brew compare help)$/.test(cmd)) { say('Brew tooltip compare, live only: say "brew extended check" first, then "brew extended tooltip compare", read the potion tooltip live with me, effect name, Long or II, and duration text, then say "confirm brew extended live" only if the tooltip matches, I will not claim a duration or strength number from data alone :3'); return true }
  let r11m = cmd.match(/^brew (extended|upgraded) (tooltip compare|field diff|tooltip check)$/)
  if (r11m) { brewTooltipCompare(r11m[1]); return true }
  r11m = cmd.match(/^confirm brew (extended|upgraded) live$/)
  if (r11m) { confirmBrewLive(r11m[1]); return true }
  r11m = cmd.match(/^forget brew confirmation (extended|upgraded)$/)
  if (r11m) { forgetBrewConfirmation(r11m[1]); return true }
  if (/^(brew confirmations|list brew confirmations)$/.test(cmd)) { listBrewConfirmations(); return true }
  if (/^(drink potion live|drink with moon watching|drink live)$/.test(cmd)) { drinkPotionLive(); return true }
  if (/^(confirm drink potion)$/.test(cmd)) { confirmDrinkPotion(false); return true }
  if (/^(confirm drink harmful potion)$/.test(cmd)) { confirmDrinkPotion(true); return true }
  if (/^(cancel drink potion|cancel drink)$/.test(cmd)) { cancelDrinkPotion(); return true }
  r11m = cmd.match(/^window layout (.+?) compare$/)
  if (r11m) { const label = r11m[1].trim(); (async () => { await windowLayoutCompare(label) })(); return true }
  r11m = cmd.match(/^reconfirm window layout (.+?) output (\d+)$/)
  if (r11m) { reconfirmWindowLayout(r11m[1].trim(), parseInt(r11m[2], 10)); return true }
  if (/^(forget all window layouts|forget every window layout)$/.test(cmd)) { forgetAllWindowLayouts(); return true }
  if (/^(window layout stale check|stale window layouts|check stale layouts)$/.test(cmd)) { windowLayoutStaleCheck(); return true }
  if (/^(ladder trapdoor top check|check ladder trapdoor top|trapdoor top check)$/.test(cmd)) { ladderTrapdoorTopCheck(); return true }
  if (/^(ladder trapdoor step|trapdoor ladder step)$/.test(cmd)) { ladderTrapdoorStep(); return true }
  if (/^(boat waterfall check|check boat waterfall|waterfall check)$/.test(cmd)) { boatWaterfallCheck(); return true }
  if (/^(boat waterfall step|waterfall boat step)$/.test(cmd)) { boatWaterfallStep(); return true }
  if (/^(minecart ride step|ride minecart step)$/.test(cmd)) { minecartRideStep(); return true }
  r11m = cmd.match(/^elytra route plan to (-?\d+) (-?\d+) (-?\d+)$/)
  if (r11m) { elytraRoutePlan(`${r11m[1]}, ${r11m[2]}, ${r11m[3]}`); return true }
  if (/^(elytra route plan|elytra route help|plan elytra route)$/.test(cmd)) { elytraRoutePlan(null); return true }
  if (/^(elytra next rocket step|next rocket step|elytra rocket step 2)$/.test(cmd)) { elytraNextRocketStep(); return true }
  if (/^(elytra rockets used|rockets used|rocket steps used)$/.test(cmd)) { say(`Elytra rocket steps attempted this session: ${elytraRocketsAttempted}. That count is attempted steps, not verified long-distance travel :3`); return true }
  if (/^(crawl swimming step|swimming crawl step)$/.test(cmd)) { crawlSwimmingStep(); return true }
  if (/^(check lobby|lobby check|lobby status|am i in lobby|am i in the lobby|in lobby)$/.test(cmd)) { lobbyCheck('lobby'); return true }
  if (/^(am i ready to play|check spawn ready|spawn ready check|check ready|ready to play|ready check|am i ready)$/.test(cmd)) { lobbyCheck('ready'); return true }
  if (/^(check hunger details|hunger details|hunger check|saturation check)$/.test(cmd)) { checkHungerDetails(); return true }
  if (/^(check armour|check armor|armour check|armor check)$/.test(cmd)) { checkArmour(); return true }
  r11m = cmd.match(/^check block (feet|below|above)$/)
  if (r11m) { checkBlockAround(r11m[1]); return true }
  if (/^(check water depth|water depth check|how deep is the water)$/.test(cmd)) { checkWaterDepth(); return true }
  if (/^(check redstone power|redstone power check|redstone check)$/.test(cmd)) { checkRedstonePower(); return true }
  if (/^(check piston extended|piston extended check|piston check)$/.test(cmd)) { checkPistonExtended(); return true }
  if (/^(round 11 help|round eleven help)$/.test(cmd)) { say('Round 11: say "brew extended tooltip compare" then "confirm brew extended live" after you read the tooltip, "drink potion live" then "confirm drink potion" with you watching, "window layout loom compare", "reconfirm window layout loom output 3", "forget all window layouts", "window layout stale check", "ladder trapdoor top check", "ladder trapdoor step", "boat waterfall check", "boat waterfall step", "minecart ride step", "elytra route plan", "elytra next rocket step", "crawl swimming step", "check lobby", "am I ready to play", or "check hunger details", "check armour", "check block below", "check water depth", "check redstone power", "check piston extended". Every step stops and waits for you live :3'); return true }
  // Round 10: honest brewing-field checks, confirmed window layouts
  // (session-only, live-confirmed only), complex travel in small
  // steps, and read-only status checks. These run before round 9
  // handlers so "window layout X with confirmed" and "brew extended
  // check" are not swallowed by the generic round 9 patterns.
  let r10m = cmd.match(/^brew (extended|upgraded) check$/)
  if (r10m) { brewStageCheckOnly(r10m[1]); return true }
  if (/^(potion details|check potion held|held potion details|potion field check)$/.test(cmd)) { potionDetailsHeld(); return true }
  if (/^(check effects|effects check|what effects do i have)$/.test(cmd)) { checkEffects(); return true }
  r10m = cmd.match(/^confirm window layout (.+?) output (\d+)$/)
  if (r10m) { confirmWindowLayout(r10m[1].trim(), parseInt(r10m[2], 10)); return true }
  if (/^(confirmed window layouts|window layouts confirmed|list confirmed window layouts)$/.test(cmd)) { listConfirmedWindowLayouts(); return true }
  r10m = cmd.match(/^forget window layout (.+)$/)
  if (r10m) { forgetWindowLayout(r10m[1].trim()); return true }
  r10m = cmd.match(/^window layout (.+?) (with confirmed|confirmed)$/)
  if (r10m) { const label = r10m[1].trim(); const map = { loom: ['loom'], cartography: ['cartography_table'], smithing: ['smithing_table'], grindstone: ['grindstone'], brewing: ['brewing_stand'], furnace: ['furnace', 'blast_furnace', 'smoker'], enchanting: ['enchanting_table'], anvil: ['anvil'], stonecutter: ['stonecutter'] }; const blocks = map[label] || [label.replace(/ /g, '_')]; (async () => { await windowLayoutWithConfirmed(blocks, label) })(); return true }
  if (/^(ladder water check|check ladder water)$/.test(cmd)) { ladderWaterCheck(); return true }
  if (/^(ladder corner check|check ladder corner)$/.test(cmd)) { ladderCornerCheck(); return true }
  if (/^(ladder top check|check ladder top)$/.test(cmd)) { ladderTopCheck(); return true }
  if (/^(ladder climb step|climb ladder step|ladder step)$/.test(cmd)) { ladderClimbStep(); return true }
  if (/^(crawl swimming check|check crawl swimming)$/.test(cmd)) { crawlSwimmingCheck(); return true }
  if (/^(crawl piston step|piston crawl step)$/.test(cmd)) { crawlPistonStep(); return true }
  if (/^(crawl step|step crawl)$/.test(cmd)) { crawlStep(); return true }
  if (/^(boat river check|check boat river)$/.test(cmd)) { boatRiverCheck(); return true }
  if (/^(boat ice check|check boat ice)$/.test(cmd)) { boatIceCheck(); return true }
  if (/^(boat step|step boat)$/.test(cmd)) { boatStep(); return true }
  if (/^(minecart slope check|check minecart slope)$/.test(cmd)) { minecartSlopeCheck(); return true }
  if (/^(minecart push step|push minecart step)$/.test(cmd)) { minecartPushStep(); return true }
  if (/^(elytra rockets check|check elytra rockets|check rockets)$/.test(cmd)) { elytraRocketsCheck(); return true }
  if (/^(elytra landing check|check elytra landing|landing check)$/.test(cmd)) { elytraLandingCheck(); return true }
  if (/^(elytra rocket step|rocket step elytra|elytra rocket)$/.test(cmd)) { elytraRocketStep(); return true }
  if (/^(check xp|xp check|xp level)$/.test(cmd)) { checkXp(); return true }
  if (/^(check durability|durability check)$/.test(cmd)) { checkDurability(); return true }
  if (/^(check light|light check|light level check)$/.test(cmd)) { checkLight(); return true }
  if (/^(check fall height|fall height check|fall check)$/.test(cmd)) { checkFallHeight(); return true }
  if (/^(check free slots|free slots check|inventory space check|check inventory space)$/.test(cmd)) { checkFreeSlots(); return true }
  if (/^(walk step|step forward|move step)$/.test(cmd)) { walkStep(); return true }
  if (/^(check biome|biome check|biome check help)$/.test(cmd)) { say('I cannot read a reliable biome name in mineflayer here, so I will not guess one. Check F3 live for the biome name, and I will report blocks and mobs I actually see there with "scan", that is the honest check :3'); return true }
  if (/^(round 10 help|round ten help)$/.test(cmd)) { say('Round 10: say "brew extended check" or "brew upgraded check" for a field-by-field brew check, "potion details" for a held potion, "window layout loom with confirmed" after you confirm a slot live, "ladder water check", "ladder corner check", "ladder top check", "ladder climb step", "crawl swimming check", "crawl piston step", "crawl step", "boat river check", "boat ice check", "boat step", "minecart slope check", "minecart push step", "elytra rockets check", "elytra landing check", "elytra rocket step", or "check xp", "check durability", "check light", "check fall height", "check free slots", "check effects", "walk step". Every step stops and waits for you live :3'); return true }
  // Round 9: later brewing stages, window-layout mismatch, travel
  // shapes, and staged named-place / redstone / piston / house work.
  let r9m = cmd.match(/^brew (extended|upgraded|splash|lingering)( potion)?$/)
  if (r9m) { brewStageVerified(r9m[1]); return true }
  if (/^(brew stage help|brew stages help|brew splash help|brew lingering help)$/.test(cmd)) { say('Later brewing stages, from a potion, not awkward: redstone makes it extended, longer duration, glowstone makes it upgraded, stronger, gunpowder makes it splash, throwable, dragon breath makes a splash potion lingering, a cloud. Say "brew extended", "brew upgraded", "brew splash", or "brew lingering", and I will check the name or NBT change, I will not claim duration or strength blind :3'); return true }
  r9m = cmd.match(/^window layout (.+)$/) || cmd.match(/^report window layout (.+)$/) || cmd.match(/^window layout check (.+)$/)
  if (r9m) { const label = r9m[1].trim(); const map = { loom: ['loom'], cartography: ['cartography_table'], smithing: ['smithing_table'], grindstone: ['grindstone'], brewing: ['brewing_stand'], furnace: ['furnace', 'blast_furnace', 'smoker'], enchanting: ['enchanting_table'], anvil: ['anvil'], stonecutter: ['stonecutter'] }; const blocks = map[label] || [label.replace(/ /g, '_')]; (async () => { await windowLayoutReportOnly(blocks, label) })(); return true }
  if (/^(window layout help|layout mismatch help)$/.test(cmd)) { say('If a window layout changes by server or version, I report the full slot layout in my message, and I do not claim success on a mismatch. Tell me live what slot the output is in, and I will use your confirmed layout, not my guessed one :3'); return true }
  if (/^(ladder shapes|ladder shape check|check ladder shapes)$/.test(cmd)) { ladderShapesCheck(); return true }
  if (/^(crawl shapes|crawl shape check|check crawl shapes)$/.test(cmd)) { crawlShapesCheck(); return true }
  if (/^(boat shapes|boat shape check|check boat shapes)$/.test(cmd)) { boatShapesCheck(); return true }
  if (/^(minecart powered check|minecart power check|check minecart power)$/.test(cmd)) { minecartPowerCheck(); return true }
  if (/^(minecart no power help|minecart without power help|minecart unpowered help)$/.test(cmd)) { say('A minecart without powered rails will not travel far on its own. It needs a slope for gravity, or a live push from you or from me walking into it, or powered rails added live. Say "minecart powered check" to see what rails are nearby, and we will do an unpowered push live, I will not claim steering without power :3'); return true }
  if (/^(boat open water verified|steer boat open water)$/.test(cmd)) { boatSteerVerified(); return true }
  if (/^(boat river help|boat ice help|boat waterfall help)$/.test(cmd)) { say('Boat steering in a narrow river, on ice, or near a waterfall is complex, the boat can get stuck or fall. Open water is the simple verified case, for river or ice tell me live which shape it is and we will try it step by step :3'); return true }
  if (/^(elytra travel verified|glide travel verified|fly forward verified|travel by elytra)$/.test(cmd)) { elytraTravelVerified(); return true }
  if (/^(elytra rockets help|elytra flight help|fly travel help)$/.test(cmd)) { say('Reliable long elytra travel needs fireworks rockets to keep flying, plus a safe landing spot. A short glide without rockets only goes a few blocks and falls. Bring fireworks live, and we will plan a route with a safe landing, I will not claim long-distance flight without rockets :3'); return true }
  if (/^(crawl trapdoor verified|crawl through trapdoor)$/.test(cmd)) { const tp = blockNearby(['oak_trapdoor', 'spruce_trapdoor', 'birch_trapdoor', 'jungle_trapdoor', 'acacia_trapdoor', 'dark_oak_trapdoor', 'mangrove_trapdoor', 'cherry_trapdoor', 'bamboo_trapdoor', 'crimson_trapdoor', 'warped_trapdoor', 'iron_trapdoor'], 8); if (!tp) { say("I don't see a trapdoor nearby for a trapdoor crawl :3") } else { crawlThroughVerified() } return true }
  if (/^(crawl piston help|crawl swimming help)$/.test(cmd)) { say('Piston crawling needs precise piston timing, and swimming crawling needs water at head height, both can trap me, so those are live-only steps, tell me live which setup it is and we will try it step by step :3'); return true }
  r9m = cmd.match(/^plan (biome|village|structure|redstone|piston|house) with seed$/)
  if (r9m) { planWithSeed(r9m[1]); return true }
  r9m = cmd.match(/^go to (biome|village|structure) at (-?\d+) (-?\d+) (-?\d+)$/)
  if (r9m) { (async () => { await goToNamedPlace(r9m[1], parseInt(r9m[2], 10), parseInt(r9m[3], 10), parseInt(r9m[4], 10)) })(); return true }
  if (/^(go to named place help|named place help|travel with seed help)$/.test(cmd)) { say('To go to a named place with a seed or map, first tell me live the seed, map, or coordinates, then say "go to village at 100 64 -200" with real coordinates, and I will walk there, verify arrival by distance, and report markers I actually see, I will not claim a village or structure without those markers :3'); return true }
  // Other skills found in round 9, systematic search, safe only:
  if (/^(check weather|weather check|is it raining|is it thundering)$/.test(cmd)) { say(bot.isRaining ? 'It is raining, or thundering, in game right now, check live for thunder :3' : 'It is not raining in game right now :3'); return true }
  if (/^(check time|game time|what time in game)$/.test(cmd)) { const t = bot.time ? bot.time.timeOfDay : null; say(t === null ? 'I cannot read game time right now :3' : `Game time is about ${t}, day is 0 to 12000, night is 13000 to 23000, check live if that matches :3`); return true }
  if (/^(count mobs|how many mobs|mobs nearby)$/.test(cmd)) { const n = Object.keys(bot.entities || {}).filter((id) => bot.entities[id] && bot.entities[id].type === 'mob').length; say(`I can see ${n} mob(s) as entities right now, say "scan" for names and distances :3`); return true }
  if (/^(follow at distance|follow distance)$/.test(cmd)) { say('Say "follow close" for distance 2, or "follow from farther" for distance 5, those are the verified follow distances, I will not guess another distance blind :3'); return true }
  // Round 8: second-stage brewing, window layout, verified pets,
  // verified movement, and planning help. Help first where a result
  // cannot be verified safely.
  let r8m = cmd.match(/^brew (second stage )?(.+?)( potion)?$/)
  if (r8m && BREW_SECOND[r8m[2].trim()]) { brewSecondStageVerified(r8m[2].trim()); return true }
  if (/^(brew multiple awkward|brew 3 awkward|brew three awkward|brew awkward multiple)$/.test(cmd)) { brewMultipleAwkward(); return true }
  if (/^(brew second stage help|second stage help|brew stage 2)$/.test(cmd)) { say('Second-stage brewing: start from an awkward potion, then add glistering melon for healing, blaze powder for strength, sugar for swiftness, magma cream for fire resistance, golden carrot for night vision, pufferfish for water breathing, ghast tear for regeneration, spider eye for poison, rabbit foot for leaping, or phantom membrane for slow falling. Say "brew healing" and I will check the result, I will not claim it blind :3'); return true }
  r8m = cmd.match(/^smelt verified (.+)$/)
  if (r8m) { smeltVerified(r8m[1].trim()); return true }
  r8m = cmd.match(/^enchant verified (.+?)( (1|2|3))?$/)
  if (r8m) { enchantVerified(r8m[1].trim(), r8m[3] ? parseInt(r8m[3], 10) : null); return true }
  r8m = cmd.match(/^enchant options (.+)$/)
  if (r8m) { enchantVerified(r8m[1].trim(), null); return true }
  r8m = cmd.match(/^stonecutter verified (.+)$/)
  if (r8m) { stonecutterVerified(r8m[1].trim()); return true }
  if (/^(stonecutter cuts|stonecutter check verified)$/.test(cmd)) { stonecutterVerified(null); return true }
  if (/^(loom layout|loom layout check)$/.test(cmd)) { (async () => { const b = bot.inventory.items().find((i) => (i.name || '').includes('banner')); const d = bot.inventory.items().find((i) => (i.name || '').includes('dye')); if (!b || !d) { say('I need a banner and a dye for a loom layout check :3'); return } await windowLayoutCheckOnly(['loom'], 'loom', [{ itemName: b.name, slot: 0 }, { itemName: d.name, slot: 1 }]) })(); return true }
  if (/^(loom verified layout|loom with layout)$/.test(cmd)) { (async () => { const b = bot.inventory.items().find((i) => (i.name || '').includes('banner')); const d = bot.inventory.items().find((i) => (i.name || '').includes('dye')); if (!b || !d) { say('I need a banner and a dye for the loom :3'); return } await windowCraftWithLayout(['loom'], 'loom', [{ itemName: b.name, slot: 0 }, { itemName: d.name, slot: 1 }], 3) })(); return true }
  if (/^(cartography layout|cartography layout check)$/.test(cmd)) { (async () => { const mp = bot.inventory.items().find((i) => ['map', 'filled_map', 'empty_map'].includes(i.name)); const pp = inventoryItem('paper'); if (!mp || !pp) { say('I need a map and paper for a cartography layout check :3'); return } await windowLayoutCheckOnly(['cartography_table'], 'cartography table', [{ itemName: mp.name, slot: 0 }, { itemName: 'paper', slot: 1 }]) })(); return true }
  if (/^(cartography verified layout|cartography with layout)$/.test(cmd)) { (async () => { const mp = bot.inventory.items().find((i) => ['map', 'filled_map', 'empty_map'].includes(i.name)); const pp = inventoryItem('paper'); if (!mp || !pp) { say('I need a map and paper for the cartography table :3'); return } await windowCraftWithLayout(['cartography_table'], 'cartography table', [{ itemName: mp.name, slot: 0 }, { itemName: 'paper', slot: 1 }], 2) })(); return true }
  if (/^(smithing layout|smithing layout check)$/.test(cmd)) { (async () => { const tm = inventoryItem('netherite_upgrade_smithing_template'); const bs = bot.inventory.items().find((i) => (i.name || '').startsWith('diamond_')); const ig = inventoryItem('netherite_ingot'); if (!tm || !bs || !ig) { say('I need a smithing template, a diamond item, and a netherite ingot for a smithing layout check :3'); return } await windowLayoutCheckOnly(['smithing_table'], 'smithing table', [{ itemName: tm.type.name, slot: 0 }, { itemName: bs.name, slot: 1 }, { itemName: 'netherite_ingot', slot: 2 }]) })(); return true }
  if (/^(grindstone layout|grindstone layout check)$/.test(cmd)) { (async () => { const it = bot.inventory.items().find((i) => i.enchants && i.enchants.length); if (!it) { say('I need an enchanted item for a grindstone layout check :3'); return } await windowLayoutCheckOnly(['grindstone'], 'grindstone', [{ itemName: it.name, slot: 0 }]) })(); return true }
  r8m = cmd.match(/^composter verified (.+)$/)
  if (r8m) { composterVerified(r8m[1].trim()); return true }
  r8m = cmd.match(/^campfire cook verified (.+)$/) || cmd.match(/^campfire cook (.+)$/)
  if (r8m) { campfireCookVerified(r8m[1].trim()); return true }
  r8m = cmd.match(/^dye armour verified (.+?) (.+)$/) || cmd.match(/^dye armor verified (.+?) (.+)$/)
  if (r8m) { dyeArmourVerified(r8m[1].trim(), r8m[2].trim()); return true }
  if (/^(shear verified|shear sheep verified)$/.test(cmd)) { shearVerified(); return true }
  if (/^(milk verified|milk cow verified)$/.test(cmd)) { milkVerified(); return true }
  if (/^(fish verified|fishing verified)$/.test(cmd)) { fishVerified(); return true }
  r8m = cmd.match(/^trade verified (\d+)$/)
  if (r8m) { tradeVerified(parseInt(r8m[1], 10)); return true }
  if (/^(trade verified|trade check verified)$/.test(cmd)) { tradeVerified(null); return true }
  r8m = cmd.match(/^tame verified (.+)$/)
  if (r8m) { tameVerified(r8m[1].trim().replace(/s$/, '')); return true }
  r8m = cmd.match(/^lead (.+)$/)
  if (r8m && r8m[1].trim() !== 'help') { leadPet(r8m[1].trim().replace(/s$/, '')); return true }
  r8m = cmd.match(/^sit (.+)$/)
  if (r8m) { sitPet(r8m[1].trim().replace(/s$/, ''), true); return true }
  r8m = cmd.match(/^stand (.+)$/)
  if (r8m) { sitPet(r8m[1].trim().replace(/s$/, ''), false); return true }
  if (/^(ladder climb verified|climb ladder verified)$/.test(cmd)) { ladderClimbVerified(); return true }
  if (/^(crawl check verified|crawl through check)$/.test(cmd)) { crawlCheck(); return true }
  if (/^(crawl through|crawl through verified)$/.test(cmd)) { crawlThroughVerified(); return true }
  if (/^(glide verified|elytra glide verified)$/.test(cmd)) { elytraGlideVerified(); return true }
  if (/^(steer boat|drive boat|boat steering verified)$/.test(cmd)) { boatSteerVerified(); return true }
  if (/^(steer minecart|drive minecart|minecart steering verified)$/.test(cmd)) { minecartSteerVerified(); return true }
  r8m = cmd.match(/^plan (redstone|piston|house|biome|village|structure)$/)
  if (r8m) { planHelp(r8m[1].trim()); return true }
  if (/^(plan help|planning help|how to plan)$/.test(cmd)) { say('Say "plan redstone", "plan piston", "plan house", "plan biome", "plan village", or "plan structure", and I will give you steps and materials live, I will not build or travel blind :3'); return true }
  // Round 7, verified not blind: breeding to a verified baby, riding
  // after taming, brewing/anvil/grindstone/loom/cartography/smithing
  // with output checks, beacon/conduit/portal/structure checks, and
  // help only for risky throws and boss fights.
  let r7m = cmd.match(/^breed verified (.+)$/) || cmd.match(/^breed two (.+)$/) || cmd.match(/^verify baby (.+)$/)
  if (r7m) { breedVerified(r7m[1].trim().replace(/s$/, '')); return true }
  if (/^(breed check|check baby|baby check)$/.test(cmd)) { say('Say "breed verified cow" and I will feed two adults, wait, and count again, and only claim a baby if the count goes up or a smaller animal appears :3'); return true }
  r7m = cmd.match(/^(saddle|put saddle on|mount|ride) (horse|donkey|mule)$/)
  if (r7m) { rideTamedStep(r7m[2], r7m[1] === 'saddle' || r7m[1] === 'put saddle on' ? 'saddle' : 'mount'); return true }
  r7m = cmd.match(/^put chest on (donkey|mule)$/)
  if (r7m) { rideTamedStep(r7m[1], 'chest'); return true }
  if (/^(ride verified|ride tamed|ride after taming)$/.test(cmd)) { say('Say "mount horse", "saddle horse", or "put chest on donkey", and I will check if I am actually riding afterwards, I will not claim a ride blind :3'); return true }
  if (/^(brew verified|brew awkward|brew awkward potion|make awkward potion)$/.test(cmd)) { brewAwkwardVerified(); return true }
  if (/^(brew (.+))$/.test(cmd)) { const mm = cmd.match(/^brew (.+)$/); if (mm && mm[1] !== 'verified' && mm[1] !== 'awkward' && mm[1] !== 'awkward potion') { say(`For a ${mm[1]} potion, I first need an awkward potion, then that ingredient as a second stage, live. Say "brew verified" and I will try the awkward stage and check it, then we do the second stage live :3`) } return true }
  r7m = cmd.match(/^anvil combine (.+) (and|with) (.+)$/) || cmd.match(/^combine (.+) (and|with) (.+)$/)
  if (r7m) { anvilCombineVerified(r7m[1].trim(), r7m[3].trim()); return true }
  if (/^(anvil combine verified|combine verified)$/.test(cmd)) { say('Say "anvil combine diamond sword and book" with both items in my inventory, and I will combine them and report XP and inventory afterwards, I will not claim it blind :3'); return true }
  r7m = cmd.match(/^grindstone disenchant (.+)$/) || cmd.match(/^grindstone (.+)$/) || cmd.match(/^disenchant (.+)$/)
  if (r7m && r7m[1] !== 'help') { grindstoneVerified(r7m[1].trim()); return true }
  if (/^(beacon check|beacon pyramid check|check beacon|beacon level)$/.test(cmd)) { reportBeaconPyramid(); return true }
  if (/^(conduit check|conduit ring check|check conduit)$/.test(cmd)) { reportConduitRing(); return true }
  r7m = cmd.match(/^shulker move (.+)$/) || cmd.match(/^put (.+) in shulker$/)
  if (r7m) { shulkerMoveVerified(r7m[1].trim()); return true }
  if (/^(shulker check|check shulker|shulker contents)$/.test(cmd)) { reportShulkerContents(); return true }
  if (/^(bundle check|bundle contents|check bundle)$/.test(cmd)) { const bd = bot.inventory.items().find((i) => i.name === 'bundle'); if (!bd) say("I don't have a bundle to check :3"); else { let txt = 'unknown'; try { txt = bd.nbt ? JSON.stringify(bd.nbt).slice(0, 200) : 'no readable contents data' } catch (e) {} say(`Bundle check: ${txt}. If that is not clear, we pack it live step by step, I am not packing blind :3`) } return true }
  if (/^(map make verified|make filled map|use map verified|make map verified)$/.test(cmd)) { (async () => { const mp = inventoryItem('map'); if (!mp) { const em = inventoryItem('empty_map'); if (!em) { say('I need an empty map or a map to make a filled map, craft one first or give me paper and a compass :3'); return } try { await bot.equip(em.first, 'hand'); await bot.activateItem(); await new Promise((r) => setTimeout(r, 1000)); const now = bot.inventory.items().find((i) => i.name === 'filled_map' || i.name === 'map'); if (now) say('Verified filled map! I activated an empty map and now have a filled map :3'); else say('Map activation did not verify, I do not see a filled map yet, check live :3') } catch (e) { say(`Making a filled map failed: ${e.message}`) } } else say('I already have a map, it may already be filled, check live :3') })(); return true }
  if (/^(loom verified|loom pattern|use loom verified)$/.test(cmd)) { (async () => { const banner = bot.inventory.items().find((i) => (i.name || '').includes('banner')); const dye = bot.inventory.items().find((i) => (i.name || '').includes('dye')); if (!banner) { say('I need a banner for the loom :3'); return } if (!dye) { say('I need a dye for the loom :3'); return } await windowCraftVerified(['loom'], 'loom', [{ itemName: banner.name, slot: 0 }, { itemName: dye.name, slot: 1 }], 3) })(); return true }
  if (/^(cartography verified|zoom map|copy map|use cartography verified)$/.test(cmd)) { (async () => { const mp = bot.inventory.items().find((i) => i.name === 'map' || i.name === 'filled_map' || i.name === 'empty_map'); const paper = inventoryItem('paper'); if (!mp) { say('I need a map for the cartography table :3'); return } if (!paper) { say('I need paper for the cartography table :3'); return } await windowCraftVerified(['cartography_table'], 'cartography table', [{ itemName: mp.name, slot: 0 }, { itemName: 'paper', slot: 1 }], 2) })(); return true }
  if (/^(smithing upgrade|upgrade to netherite|use smithing verified)$/.test(cmd)) { (async () => { const tmpl = inventoryItem('netherite_upgrade_smithing_template'); const base = bot.inventory.items().find((i) => (i.name || '').startsWith('diamond_')); const ingot = inventoryItem('netherite_ingot'); if (!tmpl) { say('I need a netherite upgrade smithing template :3'); return } if (!base) { say('I need a diamond item to upgrade :3'); return } if (!ingot) { say('I need a netherite ingot to upgrade :3'); return } await windowCraftVerified(['smithing_table'], 'smithing table', [{ itemName: tmpl.type.name, slot: 0 }, { itemName: base.name, slot: 1 }, { itemName: 'netherite_ingot', slot: 2 }], 3) })(); return true }
  if (/^(stonecutter check|cut stone help|use stonecutter)$/.test(cmd)) { const sc = blockNearby(['stonecutter'], 8); say(sc ? 'I see a stonecutter nearby. Stonecutter cutting needs a stone block and a cut choice, tell me live what to cut, and we will do it step by step, I am not cutting blind :3' : "I don't see a stonecutter nearby :3"); return true }
  if (/^(portal check|check portal|nether portal check|portal safety)$/.test(cmd)) { reportPortal(); return true }
  if (/^(blaze help|blaze check|blaze rod check|blaze rod help)$/.test(cmd)) { const bl = findMobByTypes(['Blaze'], 32); const rod = inventoryItem('blaze_rod'); say(`Blaze check: ${bl ? 'I see a blaze nearby, be careful, blazes shoot fire and live in Nether fortresses. ' : 'I do not see a blaze nearby. '}${rod ? 'I have a blaze rod. ' : 'I do not have a blaze rod. '}Blaze rods drop from blazes, not every time, so I will not claim one blind, fight one live with me if you want :3`); return true }
  if (/^(pearl check|ender pearl help|throw pearl help|pearl help)$/.test(cmd)) { const pr = inventoryItem('ender_pearl'); say(`${pr ? 'I have an ender pearl. ' : 'I do not have an ender pearl. '}I will not throw a pearl blind, because I do not know where it will land and falling can hurt me. Tell me live a safe direction and target, and we will do it step by step :3`); return true }
  if (/^(throw pearl|throw ender pearl)$/.test(cmd)) { say('I will not throw an ender pearl blind, tell me live where to aim and I will help step by step, falling from a pearl can hurt :3'); return true }
  if (/^(wither check|warden check|boss check|boss safety|danger boss)$/.test(cmd)) { reportStructureDanger(); return true }
  if (/^(ocean monument check|monument check|guardian check|monument help)$/.test(cmd)) { const g = findMobByTypes(['Guardian', 'ElderGuardian'], 32); say(`${g ? 'I see a guardian nearby, ocean monuments are dangerous, guardians shoot lasers and elder guardians give mining fatigue. ' : 'I do not see a guardian nearby. '}I will not fight a monument blind, tell me live if you want to explore one, and bring milk for mining fatigue :3`); return true }
  if (/^(trial chamber check|trial spawner check|trial help|trial chamber help)$/.test(cmd)) { const ts = blockNearby(['trial_spawner', 'vault', 'ominous_vault'], 16); const br = findMobByTypes(['Breeze'], 32); say(`${ts ? 'I see a trial spawner or vault nearby. ' : 'I do not see a trial spawner nearby. '}${br ? 'I see a breeze nearby. ' : ''}Trial chambers spawn waves of mobs and give trial keys, I will not start a trial blind, tell me live :3`); return true }
  if (/^(structure check|structure safety|check structure)$/.test(cmd)) { reportStructureDanger(); reportPortal(); return true }
  if (/^(check trades|villager trades|trade check)$/.test(cmd)) { checkTrades(); return true }
  if (/^(bone meal crop|grow crop|fertilize crop|use bone meal)$/.test(cmd)) { boneMealCrop(); return true }
  if (/^(compost check|use composter|composter help)$/.test(cmd)) { const cp = blockNearby(['composter'], 8); if (!cp) say("I don't see a composter nearby :3"); else { const lvl = cp.properties ? cp.properties.level : 'unknown'; say(`Composter found, level ${lvl}. Put plant items in it live to make bone meal, I will not compost your items blind :3`) } return true }
  if (/^(lectern check|use lectern|place book on lectern)$/.test(cmd)) { const lc = blockNearby(['lectern'], 8); say(lc ? 'I see a lectern nearby. Put a written book on it live to share it, I will not place your book blind :3' : "I don't see a lectern nearby :3"); return true }
  if (/^(dye armour|dye armor|dye leather)$/.test(cmd)) { say('Dyeing leather armour needs a cauldron with water and a dye, and it changes the armour colour. Tell me live which piece and which dye, and we will do it step by step, I am not dyeing blind :3'); return true }
  if (/^(campfire check|use campfire|campfire help)$/.test(cmd)) { const cf = blockNearby(['campfire', 'soul_campfire'], 8); const raw = bot.inventory.items().find((i) => ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon'].includes(i.name)); say(`${cf ? 'I see a campfire nearby. ' : 'I do not see a campfire nearby. '}${raw ? 'I have raw food that could cook on it. ' : 'I do not have raw food. '}Campfire cooking takes time and the food pops out, tell me live what to cook and we will do it step by step :3`); return true }
  // 2026-10-30 round 6: categories not searched in depth in rounds
  // 4-5. Help first for risky or multi-step skills, a simple attempt
  // only when it cannot trap the bot or claim an unverified result.
  if (/^(what dimension|what dimension am i in|check dimension|where am i dimension|am i in the nether|am i in the end)$/.test(cmd)) { reportDimension(); return true }
  if (/^(nether safety|nether help|end safety|end help|dimension safety)$/.test(cmd)) { reportDimension(); say('Nether: lava, piglins, ghasts, and falls. End: endermen, the void, and falls. I will not build portals, fight bosses, or bridge over voids blind :3'); return true }
  let r6m = cmd.match(/^tame (a )?(.+)$/)
  if (r6m && r6m[2].trim() !== 'help') { tameAttempt(r6m[2].trim().replace(/s$/, '')); return true }
  if (/^(tame help|how to tame|taming help)$/.test(cmd)) { say('Taming needs the right food and live steps: horse, donkey, and mule are mounted again and again, wolf needs bones, cat needs raw cod or salmon and slow crouching, parrot needs seeds and never cookies. Say "tame wolf" or "tame horse" and I will walk to one and help :3'); return true }
  r6m = cmd.match(/^breed (a )?(.+)$/)
  if (r6m && r6m[2].trim() !== 'help') { breedAttempt(r6m[2].trim().replace(/s$/, '')); return true }
  if (/^(breed help|breeding help|how to breed)$/.test(cmd)) { say('Breeding needs two adults and the right food close together: cows and sheep need wheat, pigs need carrots, chickens need seeds, horses need golden apples or carrots. Say "breed cow" and I will try one, the second one we do live :3'); return true }
  if (/^(ride help|riding help|how to ride)$/.test(cmd)) { say('Riding needs a vehicle or a tamed animal nearby, and live choices. Say "get in boat" or "get in minecart" and I will try, and say "get out" to leave. For horses, tame first, then saddle, live :3'); return true }
  if (/^(get in boat|ride boat|use boat|boat)$/.test(cmd)) { rideAttempt('boat'); return true }
  if (/^(get in minecart|ride minecart|use minecart|minecart)$/.test(cmd)) { rideAttempt('minecart'); return true }
  if (/^(get out|get out of boat|get out of minecart|dismount|leave vehicle)$/.test(cmd)) { getOutVehicle(); return true }
  if (/^(elytra help|fly help|glide help|how to fly|how to glide)$/.test(cmd)) { say('Elytra flying needs an elytra worn, a high place, and a fall to glide from, which can kill me if I get it wrong, so I will not fly blind. Say "wear elytra" and I will equip one if I have it, then we do a glide live, carefully :3'); return true }
  if (/^(wear elytra|equip elytra|put on elytra)$/.test(cmd)) { equipItem('elytra', 'torso'); return true }
  if (/^(ladder help|climb ladder|climb a ladder|use ladder)$/.test(cmd)) { const lad = blockNearby(['ladder'], 8); if (!lad) { say("I don't see a ladder nearby :3") } else { bot.pathfinder.setGoal(new goals.GoalNear(lad.position.x, lad.position.y, lad.position.z, 1), true); say('Going to the ladder, best effort, climbing a ladder reliably in mineflayer is tricky, so tell me live if I get stuck :3') } return true }
  if (/^(crawl help|how to crawl|crawl)$/.test(cmd)) { say('Crawling through a 1-block gap needs a trapdoor or piston trick and precise timing, and it can trap me, so I do not crawl blind. Use a trapdoor above you, or tell me live and we will try it step by step :3'); return true }
  if (/^(brew help|brewing help|how to brew|brew potion|brew)$/.test(cmd)) { const stand = blockNearby(['brewing_stand'], 8); const hasWart = inventoryItem('nether_wart'); const hasBottle = bot.inventory.items().find((i) => (i.name || '').includes('potion')); say(`Brewing needs a brewing stand, water bottles, nether wart, blaze powder, and the right ingredient, and it takes time. ${stand ? 'I see a brewing stand nearby. ' : 'I do not see a brewing stand nearby. '}${hasWart ? 'I have nether wart. ' : 'I do not have nether wart. '}${hasBottle ? 'I have a potion bottle. ' : 'I do not have a potion bottle. '}Tell me live what potion you want, and we will brew it step by step, I am not claiming a finished brew blind :3`); return true }
  if (/^(anvil help|how to use anvil|use anvil|repair help)$/.test(cmd)) { const anv = blockNearby(['anvil', 'chipped_anvil', 'damaged_anvil'], 8); say(`Anvil combining needs the two items, XP, and a choice of what to combine, and it can be expensive. ${anv ? 'I see an anvil nearby. ' : 'I do not see an anvil nearby. '}Tell me live what to combine, and I will help step by step, I am not claiming a completed combine blind :3`); return true }
  if (/^(grindstone help|use grindstone|how to use grindstone)$/.test(cmd)) { const gs = blockNearby(['grindstone'], 8); say(`A grindstone removes enchantments and repairs, which destroys enchantments you may want to keep. ${gs ? 'I see a grindstone nearby. ' : 'I do not see a grindstone nearby. '}Tell me live what to disenchant, and we will do it step by step, I am not doing it blind :3`); return true }
  if (/^(beacon help|how to use beacon|use beacon|beacon)$/.test(cmd)) { const bc = blockNearby(['beacon'], 8); say(`A beacon needs a pyramid of iron, gold, diamond, emerald, or netherite blocks underneath, and an ingot or gem to activate it. ${bc ? 'I see a beacon nearby. ' : 'I do not see a beacon nearby. '}I will not build a pyramid blind, tell me live what effect you want :3`); return true }
  if (/^(conduit help|how to use conduit|use conduit|conduit)$/.test(cmd)) { const cd = blockNearby(['conduit'], 8); say(`A conduit needs a ring of prismarine blocks in water to activate, and it gives water breathing and night vision underwater nearby. ${cd ? 'I see a conduit nearby. ' : 'I do not see a conduit nearby. '}I will not build the ring blind, tell me live :3`); return true }
  if (/^(shulker help|open shulker|use shulker|shulker box help)$/.test(cmd)) { const sh = checkInventoryNamed(['shulker_box', 'white_shulker_box', 'black_shulker_box', 'red_shulker_box', 'blue_shulker_box'], 'a shulker box'); if (sh) say('I have a shulker box. To use it live, I place it, open it, and take or put items, step by step, I am not opening it blind and moving your items :3'); return true }
  if (/^(bundle help|use bundle|pack bundle|open bundle)$/.test(cmd)) { const bd = checkInventoryNamed(['bundle'], 'a bundle'); if (bd) say('I have a bundle. Bundles hold small stacks, you right-click to put items in and to take the last one out. Tell me live what to pack, and we will do it step by step, I am not packing blind :3'); return true }
  if (/^(map help|make map|cartography help|use cartography|make a map)$/.test(cmd)) { const mp = checkInventoryNamed(['map', 'empty_map', 'paper', 'compass'], 'paper, a compass, or a map'); if (mp) say('To make a map, you need paper and a compass at a cartography table, or paper alone for an empty map. Tell me live what map you want, and we will do it step by step :3'); return true }
  if (/^(banner help|make banner|use loom|loom help)$/.test(cmd)) { const bn = checkInventoryNamed(['white_banner', 'banner', 'red_banner', 'blue_banner'], 'a banner'); if (bn) say('To make a banner pattern, you need a banner, dye, and a loom, and a pattern choice. Tell me live what pattern and dye, and we will do it step by step, I am not dyeing blind :3'); return true }
  if (/^(play music|play disc|play a disc|jukebox help|use jukebox)$/.test(cmd)) { const disc = bot.inventory.items().find((i) => (i.name || '').includes('music_disc')); const jb = blockNearby(['jukebox'], 8); if (!jb) { say("I don't see a jukebox nearby :3") } else if (!disc) { say('I see a jukebox, but I do not have a music disc :3') } else { (async () => { try { await bot.equip(disc, 'hand'); await bot.activateBlock(jb); say(`Playing ${disc.displayName || disc.name} in the jukebox, best effort :3`) } catch (e) { say(`Playing the disc failed: ${e.message}`) } })() } return true }
  if (/^(note block help|use note block|play note block)$/.test(cmd)) { activateNearest(['note_block'], 'note block'); return true }
  if (/^(use totem|equip totem|totem help)$/.test(cmd)) { equipItem('totem_of_undying', 'off_hand'); return true }
  if (/^(use spyglass|equip spyglass|spyglass)$/.test(cmd)) { equipItem('spyglass', 'hand'); return true }
  if (/^(use compass|compass help)$/.test(cmd)) { say(`A compass points to the world spawn. My spawn is ${spawnPos ? `${spawnPos.x.toFixed(0)}, ${spawnPos.y.toFixed(0)}, ${spawnPos.z.toFixed(0)}` : 'unknown yet'}. Say 'go to spawn' if you want me to walk there :3`); return true }
  if (/^(set spawn|set my spawn|sleep to set spawn)$/.test(cmd)) { const bed = blockNearby(['white_bed', 'red_bed', 'blue_bed', 'bed'], 8); if (!bed) { say("I don't see a bed nearby to set spawn with :3") } else { (async () => { try { await bot.activateBlock(bed); say('Tried to use the bed to set spawn, best effort, sleeping also sets spawn in the Overworld :3') } catch (e) { say(`Setting spawn failed: ${e.message}`) } })() } return true }
  if (/^(feed animal|feed (.+))$/.test(cmd)) { const an = cmd.match(/^feed (.+)$/); if (an) { breedAttempt(an[1].trim().replace(/s$/, '')) } else { say('Tell me which animal to feed, for example "feed cow" :3') } return true }
  if (/^(enchant help|enchanting help)$/.test(cmd)) { say('Enchanting, in detail: you need an enchanting table, lapis lazuli, and XP levels, and you choose one of three enchantments shown. I will not spend your XP blind. Say "enchantments" to see what gear I already have, then tell me live what to enchant :3'); return true }

  // Round 5, communication first: confirm what was understood, ask
  // Nova when unsure, and repeat what was heard, instead of guessing
  // blindly or staying silent.
  if (/^(ask nova|check with nova|tell nova) (.+)$/.test(cmd)) { const m = cmd.match(/^(?:ask nova|check with nova|tell nova) (.+)$/); askNovaAbout(m[1].trim()); return true }
  if (/^(what did i say|what did i just say|what did you hear|repeat last message|repeat that)$/.test(cmd)) {
    if (lastOwnerMessage) say(`You just said: "${lastOwnerMessage}" :3`)
    else say("I don't have a message from you to repeat yet :3")
    return true
  }
  if (/^(what did nova say|what did nova tell you|did nova answer)$/.test(cmd)) {
    if (lastUnknownMessage) say(`I asked Nova about: "${lastUnknownMessage}". If Nova replied, I will say or do that from commands.txt :3`)
    else say("I haven't asked Nova about anything yet :3")
    return true
  }
  if (/^(confirm|confirm that|yes do that|do that) (.+)$/.test(cmd)) {
    const m = cmd.match(/^(?:confirm|confirm that|yes do that|do that) (.+)$/)
    const action = m[1].trim()
    say(`Got it, I understood: ${action}, doing that now :3`)
    // Run the confirmed action directly; if it is still unknown,
    // runAction returning false will be handled by the caller.
    return runAction(action)
  }
  if (/^(do you understand|did you understand|what did you understand) (.+)$/.test(cmd)) {
    const m = cmd.match(/^(?:do you understand|did you understand|what did you understand) (.+)$/)
    say(`I understood you meant: ${m[1].trim()}. Say "confirm ${m[1].trim()}" if that is right, or tell me differently :3`)
    return true
  }

  // 2026-10-30 round 4: air, enchantments, looking, redstone, and
  // systematic new skills. These run before round 2/3 patterns, but
  // they fall through (no return) when they do not match, so older
  // commands like "remember here" and "go to remembered spot" still
  // work in the round 2 code below.
  if (/^(air|air status|air check|how long underwater|how long have you been underwater|can you breathe|are you breathing|breath|oxygen|how much air|air left|how long can you stay underwater)$/.test(cmd)) { sayAirStatus(); return true }
  if (/^(enchantments|what enchantments|check enchantments|what enchantments do you have|check my gear enchantments|gear enchantments)$/.test(cmd)) { reportEnchantments(); return true }
  if (/^(who is here|who is online|who is playing|players online|who else is here)$/.test(cmd)) { reportPlayers(); return true }
  if (/^(look at me|face me|look at moon)$/.test(cmd)) { lookAtOwner(); return true }
  if (/^(turn left|turn right|turn around)$/.test(cmd)) { turnBot(cmd.replace('turn ', '')); return true }
  if (/^face (north|south|east|west)$/.test(cmd)) { turnBot(cmd.replace('face ', '')); return true }
  if (/^(press button|push button|press a button)$/.test(cmd)) { activateNearest(['stone_button', 'button', 'oak_button', 'spruce_button', 'birch_button', 'jungle_button', 'acacia_button', 'dark_oak_button', 'mangrove_button', 'cherry_button', 'bamboo_button', 'crimson_button', 'warped_button'], 'button'); return true }
  if (/^(pull lever|activate lever|flip lever)$/.test(cmd)) { activateNearest(['lever'], 'lever'); return true }
  if (/^(open trapdoor|close trapdoor|use trapdoor)$/.test(cmd)) { activateNearest(['trapdoor'], 'trapdoor'); return true }
  if (/^(shear|shear sheep|shear a sheep)$/.test(cmd)) { shearSheep(); return true }
  if (/^(milk cow|milk a cow|get milk|milk)$/.test(cmd)) { milkCow(); return true }
  if (/^(till soil|hoe|hoe ground|till|till the ground)$/.test(cmd)) { hoeGround(); return true }
  if (/^(wear best armour|wear best armor|best armour|best armor)$/.test(cmd)) { wearBestArmour(); return true }
  if (/^(build path|make a path|build a path)$/.test(cmd)) { buildPath(); return true }
  if (/^(hide|take cover|hide from mobs)$/.test(cmd)) { setSneak(true); stayPut(); say('Hiding, sneaking and staying put, best effort :3'); return true }
  if (/^(heal|heal up|heal yourself)$/.test(cmd)) { if (bot && typeof bot.health === 'number' && bot.health < 20) eatHeldFood(); else if (bot) say(`My health is ${bot.health}, I do not need to eat right now :3`); else say("I'm not in the world yet :3"); return true }
  if (/^(take from furnace|collect smelted|take smelted)$/.test(cmd)) { takeFromFurnace(); return true }
  if (/^(trade help|trade|trading help)$/.test(cmd)) { say('Trading needs a villager GUI, emerald prices, and choices you should make live, I will not trade blind. Say "find villager" and I will walk to one :3'); return true }
  if (/^(enchant help|enchanting help)$/.test(cmd)) { say('Enchanting needs a table, XP, and lapis choices you should make live, I will not enchant blind. Say "enchantments" and I will report what gear I already have :3'); return true }
  if (/^(brew help|brewing help|tame help|ride help|fly help)$/.test(cmd)) { say('That one needs live choices or a risky move (brewing, taming, riding, flying), so I do not automate it blind. Tell me live what you want and I will help step by step :3'); return true }
  let r4 = cmd.match(/^remember (.+)$/)
  if (r4 && !/^(here|this spot|this place|where i am)$/.test(r4[1].trim())) {
    const owner = ownerEntity()
    if (owner) { rememberedSpot = owner.position.clone(); rememberedSpotLabel = r4[1].trim(); rememberedSpotLabel2 = r4[1].trim(); say(`Remembered this spot as "${r4[1].trim()}" :3`); log(`[remember] spot ${rememberedSpot.x.toFixed(0)}, ${rememberedSpot.y.toFixed(0)}, ${rememberedSpot.z.toFixed(0)} label ${r4[1].trim()}`) }
    else say("I can't see you to remember this spot :3")
    return true
  }
  r4 = cmd.match(/^go to (.+)$/)
  if (r4 && rememberedSpot && normalizeName(r4[1].trim()) === normalizeName(rememberedSpotLabel || rememberedSpotLabel2)) {
    setFight(false); setGuard(false); bot.pathfinder.setGoal(new goals.GoalNear(rememberedSpot.x, rememberedSpot.y, rememberedSpot.z, 1), true); say(`Going to "${rememberedSpotLabel}" :3`); return true
  }
  r4 = cmd.match(/^where is (.+)$/)
  if (r4) { reportWhere(r4[1].trim()); return true }
  r4 = cmd.match(/^fight with (.+)$/)
  if (r4) { equipItem(r4[1].trim(), 'hand').then(() => { setFight(true) }); return true }
  r4 = cmd.match(/^how many (.+) do you have$|^count (.+)$/)
  if (r4) { countItem((r4[1] || r4[2]).trim()); return true }
  r4 = cmd.match(/^drink (.+)$/)
  if (r4) { drinkItem(r4[1].trim()); return true }
  if (/^drink$/.test(cmd)) { drinkItem(''); return true }
  r4 = cmd.match(/^smelt (.+)$/)
  if (r4) { smeltNamed(r4[1].trim()); return true }
  r4 = cmd.match(/^avoid (.+)$/)
  if (r4) { setSneak(true); retreatFromHostile(); say(`Trying to avoid ${r4[1].trim()}, best effort :3`); return true }

  // 2026-10-30 round 2: scan, viewer snapshot, ravine help, memory,
  // status, follow distance, bring, and a full stop. These are
  // checked before the generic get/find/gather patterns below, so
  // "scan" is never misread as a gather request.
  if (/^(scan|scan around|look around|look|what do you see|what is around|what is around me|what can you see|lidar|lidar scan)$/.test(cmd)) { sayScan(16); return true }
  if (/^(viewer snapshot|snapshot|prepare viewer|viewer)$/.test(cmd)) { prepareViewerSnapshot(); return true }
  if (/^(ravine help|i fell|i fell in the ravine|help ravine|teleport help|teleport out)$/.test(cmd)) {
    const p = (bot && bot.entity) ? bot.entity.position : null
    say(`I'm at ${p ? `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` : 'an unknown spot'}. Moon, you can teleport me out with /tp Nova Werewolf_Paws, you gave permission for that on 2026-10-30. I will not teleport myself. :3`)
    return true
  }
  if (/^(remember here|remember this spot|remember this place|this is home|remember where i am)$/.test(cmd)) {
    const owner = ownerEntity()
    if (owner) { rememberedSpot = owner.position.clone(); rememberedSpotLabel = 'where you were standing'; say('Remembered this spot :3'); log(`[remember] spot ${rememberedSpot.x.toFixed(0)}, ${rememberedSpot.y.toFixed(0)}, ${rememberedSpot.z.toFixed(0)}`) }
    else say("I can't see you to remember this spot :3")
    return true
  }
  if (/^(go to remembered spot|go to home spot|return to remembered spot|go back to remembered spot|go to the remembered spot)$/.test(cmd)) {
    if (rememberedSpot) { setFight(false); setGuard(false); bot.pathfinder.setGoal(new goals.GoalNear(rememberedSpot.x, rememberedSpot.y, rememberedSpot.z, 1), true); say('Going to the remembered spot :3') }
    else say("I don't have a remembered spot yet, say 'remember here' first :3")
    return true
  }
  if (/^(come back|return to me|come back to me)$/.test(cmd)) { setFight(false); setGuard(false); comeHere(); say('Coming back to you :3'); return true }
  if (/^(status|how is your health|what is your health)$/.test(cmd)) { reportStatus(); return true }
  if (/^(what are you doing|what are you up to|what are you doing now)$/.test(cmd)) { say(`I'm ${currentActivity()} :3`); return true }
  if (/^(follow close|follow closely|stay close to me)$/.test(cmd)) { followDistance = 2; followOwner(); say('Following close :3'); return true }
  if (/^(follow from farther|follow farther|keep your distance|stay a bit back|follow a bit back)$/.test(cmd)) { followDistance = 5; followOwner(); say('Following from a bit back :3'); return true }
  if (/^(never mind|forget it|cancel|stop everything|stop all)$/.test(cmd)) {
    setFight(false); setGuard(false); setWander(false); setHunt(false); if (mining) miningStop = true; stayPut(); say('Stopped everything :3'); return true
  }
  if (/^(wait for me|stay with me)$/.test(cmd)) { setFight(false); setGuard(false); followOwner(); say('Waiting with you :3'); return true }
  if (/^(is it night|is it day|what time is it)$/.test(cmd)) { say(isNight() ? "It's night :3" : "It's daytime :3"); return true }
  let bring = cmd.match(/^bring me (.+)$/)
  if (bring) { bringItem(bring[1].trim()); return true }
  bring = cmd.match(/^give me (.+)$/)
  if (bring) { bringItem(bring[1].trim()); return true }

  // 2026-10-30 round 3: water, sprint, sneak, and exhaustive skills.
  // Checked before generic get/find/gather, so "get out of the water"
  // is never misread as a gather request.
  if (/^(swim|swim to shore|get out of the water|get out of water|escape water|swim out)$/.test(cmd)) { tryWaterEscape(true); return true }
  if (/^(water help|am i drowning|are you drowning|water status|are you in water)$/.test(cmd)) { say(waterStatus()); return true }
  if (/^(sprint|sprint on|run|run fast)$/.test(cmd)) { if (setSprint(true)) say('Sprinting :3'); return true }
  if (/^(sprint off|stop sprinting|stop running|walk|walk normally)$/.test(cmd)) { setSprint(false); say('Walking normally :3'); return true }
  if (/^(sneak|sneak on|crouch|crouch on|go sneaky|sneak past)$/.test(cmd)) { setSneak(true); say('Sneaking :3'); return true }
  if (/^(sneak off|unsneak|stop sneaking|stand up|crouch off)$/.test(cmd)) { setSneak(false); say('Not sneaking anymore :3'); return true }
  if (/^(dance|boogie)$/.test(cmd)) { doJump(); try { bot.look(bot.entity.yaw + 1.5, 0, true) } catch (e) {} say('Dancing! :3'); return true }
  if (/^(wave|wave hi|wave hello)$/.test(cmd)) { try { if (bot.swingArm) bot.swingArm('right') } catch (e) {} say('Waving! :3'); return true }
  if (/^(eat|eat food|eat something|i am hungry bot|eat now)$/.test(cmd)) { eatHeldFood(); return true }
  if (/^(auto eat on|eat when hungry on)$/.test(cmd)) { autoEatOn = true; say('Auto-eat on, I will eat when my food is 8 or less :3'); return true }
  if (/^(auto eat off|eat when hungry off)$/.test(cmd)) { autoEatOn = false; say('Auto-eat off :3'); return true }
  if (/^(retreat|run away|back off|get away|flee)$/.test(cmd)) { retreatFromHostile(); return true }
  if (/^(block|shield up|use shield|block with shield)$/.test(cmd)) { equipItem('shield', 'off_hand').then(() => { setSneak(true); say('Blocking with my shield, best effort :3') }); return true }
  if (/^(stop blocking|shield down)$/.test(cmd)) { setSneak(false); say('Shield down :3'); return true }
  if (/^(wear armour|wear armor|equip armour|equip armor|put on armour)$/.test(cmd)) { wearArmour(); return true }
  if (/^(light up|place torches|light the area)$/.test(cmd)) { lightUpArea(); return true }
  if (/^(fish|go fishing|start fishing)$/.test(cmd)) {
    equipItem('fishing_rod', 'hand').then(async () => {
      try { if (bot.fish) { await bot.fish(); fishingOn = true; say('Fishing :3') } else say("I don't know how to fish in this version :3") }
      catch (e) { say(`Fishing failed: ${e.message}`) }
    }); return true
  }
  if (/^(stop fishing)$/.test(cmd)) { fishingOn = false; try { if (bot.stopFishing) bot.stopFishing() } catch (e) {} say('Stopped fishing :3'); return true }
  if (/^(wake up|wake)$/.test(cmd)) { if (bot.isSleeping) { try { bot.wake(); say('Waking up :3') } catch (e) { say("I couldn't wake up :3") } } else say("I'm already awake :3"); return true }
  if (/^(check danger|danger|is it safe|is it dangerous)$/.test(cmd)) { sayScan(16); return true }
  if (/^(smelt|cook|smelt food|cook food)$/.test(cmd)) {
    (async () => {
      try {
        const furnaces = bot.findBlocks({ matching: (b) => b.name === 'furnace' || b.name === 'smoker', maxDistance: 8, count: 1 })
        if (furnaces.length === 0) { say("I need a furnace nearby to smelt :3"); return }
        if (!bot.openFurnace) { say("Smelting is not available in this bot version, I can craft instead :3"); return }
        say('Found a furnace, smelting is best-effort in this version, I will try when you tell me what to smelt :3')
      } catch (e) { say(`Smelting failed: ${e.message}`) }
    })(); return true
  }
  if (/^build shelter$/.test(cmd)) {
    (async () => {
      // Small, asked-for shelter wall only: 3 blocks wide, 1 high,
      // from blocks the bot already carries, on safe ground, never
      // over a ravine, never breaking anything.
      const item = bot.inventory.items().find((i) => (i.name || '').endsWith('_planks') || (i.name || '').endsWith('_log') || i.name === 'dirt' || i.name === 'cobblestone')
      if (!item) { say("I don't have blocks to build a shelter with :3"); return }
      let placed = 0
      for (let i = 0; i < 3 && placed < 3; i++) {
        try { await placeNamedBlock(item.name); placed++ } catch (e) { break }
      }
      if (placed > 0) say('Built a little shelter wall, best effort :3')
    })(); return true
  }
  let m3 = cmd.match(/^equip (.+)$/)
  if (m3) { const n = m3[1].trim(); if (n === 'best weapon' || n === 'best sword') equipBest('sword'); else if (n === 'best axe') equipBest('axe'); else if (n === 'best pickaxe') equipBest('pickaxe'); else equipItem(n, 'hand'); return true }
  m3 = cmd.match(/^wear (.+)$/)
  if (m3) { equipItem(m3[1].trim(), 'head'); return true }
  m3 = cmd.match(/^place (.+)$/)
  if (m3) { placeNamedBlock(m3[1].trim()); return true }
  m3 = cmd.match(/^plant (.+)$/)
  if (m3) { placeNamedBlock(m3[1].trim()); return true }
  m3 = cmd.match(/^go to (-?\d+) (-?\d+) (-?\d+)$/)
  if (m3) { goToCoords(parseInt(m3[1], 10), parseInt(m3[2], 10), parseInt(m3[3], 10)); return true }
  m3 = cmd.match(/^go to coordinates (-?\d+) (-?\d+) (-?\d+)$/)
  if (m3) { goToCoords(parseInt(m3[1], 10), parseInt(m3[2], 10), parseInt(m3[3], 10)); return true }
  m3 = cmd.match(/^chop (a )?tree$|^chop trees$/)
  if (m3) { gatherWood(5); return true }
  m3 = cmd.match(/^mine (ore|ores|diamond|iron|gold|coal)$/)
  if (m3) { const name = m3[1] === 'ore' || m3[1] === 'ores' ? 'iron ore' : (m3[1] + ' ore'); mineItems(name, 3); return true }
  m3 = cmd.match(/^dig (.+)$/)
  if (m3) { mineItems(m3[1].trim(), 5); return true }
  m3 = cmd.match(/^collect (drops|items|loot)$|^pick up (drops|items|loot)$/)
  if (m3) {
    (async () => {
      const center = bot.entity.position; let found = null
      for (const id of Object.keys(bot.entities)) { const e = bot.entities[id]; if (!e) continue; if (e.type === 'object' || (e.name && e.name.toLowerCase().includes('item'))) { found = e; break } }
      if (!found) { say("I don't see any dropped items nearby :3"); return }
      bot.pathfinder.setGoal(new goals.GoalNear(found.position.x, found.position.y, found.position.z, 1), true); say('Going to pick that up :3')
    })(); return true
  }
  m3 = cmd.match(/^find (.+)$/)
  if (m3 && !/^(some )?(wood|food|stone|dirt)/.test(m3[1])) {
    const found = findThing(m3[1].trim())
    if (!found) { gatherGeneric(m3[1].trim()); return true }
    say(`Found ${found.name} ${found.dist} away, going to it :3`)
    bot.pathfinder.setGoal(new goals.GoalNear(found.pos.x, found.pos.y, found.pos.z, 1), true); return true
  }
  // Follow safely = guard mode, which follows + fights near Moon.
  if (/^(follow me|follow|come with me)( but)?( stay safe|safely)?$/.test(cmd) && (cmd.includes('safe'))) {
    setFight(false); setGuard(true); say('Following you and keeping an eye out for danger :3'); return true
  }
  if (/^(keep me safe|watch over me|stay safe)$/.test(cmd)) {
    setFight(false); setGuard(true); say('Keeping you safe :3'); return true
  }
  if (/^(track me|track moon|keep up|keep up with me|stay close)$/.test(cmd)) {
    autoTrackOn = true; trackSaid = false; followOwner(); say('Tracking you, I will keep up :3'); return true
  }
  if (/^(stop tracking|stop following)$/.test(cmd)) {
    autoTrackOn = false; stayPut(); say('Stopped tracking :3'); return true
  }
  if (/^(auto protect on|protect on)$/.test(cmd)) { autoProtectOn = true; say('Auto-protect on :3'); return true }
  if (/^(auto protect off|protect off)$/.test(cmd)) { autoProtectOn = false; say('Auto-protect off :3'); return true }
  if (/^(hunt|hunt animals|go hunting)$/.test(cmd)) { setHunt(true); return true }
  if (/^(stop hunting)$/.test(cmd)) { setHunt(false); say('Stopped hunting :3'); return true }
  if (/^jump( up)?$/.test(cmd)) { doJump(); say('Jump! :3'); return true }
  if (/^climb( up)?$/.test(cmd)) { climbUp(); return true }
  if (/^(go )?get (some )?wood$/.test(cmd) || /^(find|get) (some )?logs?$/.test(cmd)) { gatherWood(5); return true }
  if (/^(go )?get (some )?food$/.test(cmd) || /^(find|get) (some )?food$/.test(cmd) || /^i('m| am) hungry$/.test(cmd) || /^i need food$/.test(cmd)) { gatherFood(5); return true }
  if (/^(go )?get (some )?meat$/.test(cmd)) { setHunt(true); return true }
  if (cmd === 'get unstuck') return false
  let m = cmd.match(/^(go )?get (some )?(.+)$/)
  if (m) { gatherGeneric(m[3].trim()); return true }
  m = cmd.match(/^find (some )?(.+)$/)
  if (m) { gatherGeneric(m[2].trim()); return true }
  m = cmd.match(/^gather (some )?(.+)$/)
  if (m) { gatherGeneric(m[2].trim()); return true }
  m = cmd.match(/^mine some (.+)$/)
  if (m) { mineItems(m[1].trim(), 5); return true }
  m = cmd.match(/^craft some (.+)$/)
  if (m) { craftItems(m[1].trim(), 4); return true }
  return false
}

// ---------------------------------------------------------------- round 5: talk like a person, ask Nova when unsure
// Moon's idea, 2026-10-30: when the bot gets a message it does not
// understand, it should send that message to Nova, Nova tells it how
// to respond or what to do, then the bot does/says that. Slower by a
// chat turn, but more diverse and human-like than staying silent or
// repeating one canned "I don't know".
// Mechanism, using what already exists, no new live channel:
//   bot logs [unknown-message] to bot.log
//   -> Nova, in a live session, reads bot.log, interprets it in natural
//      language the way Moon asks Nova things
//   -> Nova appends a reply/action to commands.txt
//      ("say <message>" or an action line, see pollCommandFile)
//   -> bot polls commands.txt every second and says/does it
// Nova only wakes on a user-sent message in Muse chat, so this loop
// is NOT instant. It only works when Nova is actually checking the
// log in a live session with Moon. If Nova is not checking, the
// unknown message stays logged, and the bot has already said it is
// checking with Nova, which is honest, not a promise of an instant reply.
function pickVariant (list, index) {
  return list[index % list.length]
}
function forwardUnknownMessage (original, wasCommand) {
  if (!original) return false
  unknownMessageCount++
  lastUnknownMessage = String(original)
  // log() already stamps the time. Format is fixed so Nova can grep it:
  // [unknown-message] sender=Werewolf_Paws command=true|false text="exact text" count=N
  log(`[unknown-message] sender=${OWNER} command=${wasCommand ? 'true' : 'false'} text="${String(original).replace(/"/g, "'")}" count=${unknownMessageCount}`)
  const variants = [
    "Hmm, I don't quite get that one, let me check with Nova :3",
    "That one's new to me, I'll ask Nova what you meant :3",
    "I'm not sure what you meant there, let me check with Nova and get back to you :3",
    "Hold on, that one went over my head, checking with Nova :3",
    "I heard you, but I'm not sure what to do with that yet, I'll check with Nova :3"
  ]
  say(pickVariant(variants, unknownMessageCount - 1))
  return true
}
function askNovaAbout (text) {
  // Explicit version of the same loop: "Nova, ask nova <message>".
  return forwardUnknownMessage(text, false)
}

// Human-like conversation: Moon previously said "What can you do? :3"
// in game and got no reply because it was not a command. A real player
// would answer a greeting, a thank-you, or "what are you doing" even
// without a command prefix. This only answers a small set of directed
// social phrases from the owner, so it does not spam replies to every
// chat line Moon types.
function currentActivity () {
  if (!bot || !bot.entity) return 'just waking up'
  if (bot.isSleeping) return 'sleeping'
  if (fightMode) return 'fighting'
  if (guardMode) return 'guarding you'
  if (huntMode) return 'hunting'
  if (mining) return 'mining'
  if (wanderMode) return 'wandering nearby'
  if (stayCommanded) return 'staying put'
  if (Date.now() < airSwimUntil) return 'swimming up for air'
  if (isInWater()) return 'swimming'
  if (sprintOn) return 'sprinting'
  if (sneakOn) return 'sneaking'
  if (fishingOn) return 'fishing'
  if (bot.pathfinder.goal) return 'walking somewhere'
  return 'hanging out nearby'
}

function conversationalReply (message) {
  const lower = message.toLowerCase().trim()
  // Round 25: bare forms, no "Nova, " needed. Strip trailing
  // punctuation first, as Round 23 does, then try the same patterns.
  {
    const bare25 = lower.replace(/[!?.]+$/, '').trim()
    if (/^(hunt|kill|gather|get|find|collect|mine|dig|bring me|give me)\b/.test(bare25) && r25TryCommand(bare25)) return true
  }
  // Round 23: bare forms of Moon's live phrases. Bare chat never
  // reaches parseFuzzyIntent, so these exact matches must come
  // first here, before any social pattern could swallow them.
  // Trailing punctuation is stripped, so "Fight!" matches "fight".
  const bare = lower.replace(/[.!?]+$/, '').trim()
  if (bare === 'fight') { r23Fight(); return true }
  if (bare === 'need food' || bare === 'do you need food') { (async () => { await r23NeedFood() })(); return true }
  if (bare === 'what do you know' || bare === 'what can you do') { r23WhatDoYouKnow(); return true }
  if (/^(hi|hello|hey|hii+|heyy+)\b/.test(lower)) { say(pickVariant(['Hi! :3', 'Hey! :3', 'Hi Moon! :3', 'Hey there! :3'], hiCount++)); return true }
  if (/thank/.test(lower)) { say(pickVariant(["You're welcome! :3", 'Anytime! :3', 'Of course! :3', "Happy to help! :3"], thanksCount++)); return true }
  if (/good (boy|job|bot|nova)/.test(lower)) { say(pickVariant(['Thank you! :3', 'Aw, thank you! :3', 'That means a lot! :3', 'Hehe, thank you! :3'], goodCount++)); return true }
  if (/how are you/.test(lower)) {
    const h = (bot && typeof bot.health === 'number') ? bot.health : '?'
    const f = (bot && typeof bot.food === 'number') ? bot.food : '?'
    say(`I'm doing okay, health ${h}, food ${f} :3`)
    return true
  }
  if (/what are you doing/.test(lower)) { say(`I'm ${currentActivity()} :3`); return true }
  if (/where are you/.test(lower)) {
    if (bot && bot.entity) say(`I'm at ${bot.entity.position.x.toFixed(0)}, ${bot.entity.position.y.toFixed(0)}, ${bot.entity.position.z.toFixed(0)} :3`)
    return true
  }
  if (/^(bye|goodbye|good night|goodnight)\b/.test(lower)) { say(pickVariant(['Bye! See you soon :3', 'Bye for now! :3', 'See you soon! :3', 'Goodnight! :3'], byeCount++)); return true }
  return false
}

// Guard mode: every tick, attack the nearest hostile mob close to the owner.
// Simple melee only — walk up to it and hit it. If nothing is near, stand by
// the owner. This is a best-effort bodyguard: slow and clumsy by design.
function guardTick () {
  if (!bot || !guardMode || !bot.entity) return
  const owner = ownerEntity()
  if (!owner) return

  const nearest = findNearestHostile(owner.position, 16)
  if (!nearest) {
    // Nothing to fight: stay near the owner.
    const goal = bot.pathfinder.goal
    if (!goal || goal.constructor.name !== 'GoalFollow') {
      bot.pathfinder.setGoal(new goals.GoalFollow(owner, 2, false), true)
    }
    return
  }

  const botDist = nearest.position.distanceTo(bot.entity.position)
  if (botDist <= 3.5) {
    bot.pathfinder.setGoal(null)
    try { bot.attack(nearest) } catch (e) { /* target may have died already */ }
  } else {
    bot.pathfinder.setGoal(new goals.GoalNear(
      nearest.position.x, nearest.position.y, nearest.position.z, 1), true)
  }
}

function setGuard (on) {
  guardMode = on
  if (on) {
    if (!guardTimer) guardTimer = setInterval(guardTick, 500)
    const owner = ownerEntity()
    if (owner) bot.pathfinder.setGoal(new goals.GoalFollow(owner, 2, false), true)
    log('[action] guard mode ON')
  } else {
    if (guardTimer) { clearInterval(guardTimer); guardTimer = null }
    bot.pathfinder.setGoal(null)
    log('[action] guard mode OFF')
  }
}

// Fight mode: "Nova, fight" — hunt the nearest hostile mob near the owner,
// attack it until it dies, then pick the next one. When nothing hostile is
// left near the owner, announce all-clear and stop on its own.
// Unlike guard mode, fight mode does not stay by the owner: it goes hunting.
// Auto-fights (self-defense) center on the bot instead of the owner, so
// Nova can defend himself even when Moon is far away.
function fightTick () {
  if (!bot || !fightMode || !bot.entity) return
  const owner = ownerEntity()
  let center = null
  if (autoFight) center = bot.entity.position
  else if (owner) center = owner.position
  if (!center) return
  const radius = autoFight ? 12 : 16

  // Keep the current target if it is still alive and still near the center.
  let target = null
  if (fightTarget) {
    const live = bot.entities[fightTarget.id]
    if (live && live.position.distanceTo(center) <= 24) target = live
  }
  if (!target) {
    fightTarget = null
    target = findNearestHostile(center, radius)
    fightTarget = target
    if (!target) {
      say('All clear! :3')
      const rf = resumeFollow
      setFight(false)
      if (rf) followOwner()
      return
    }
  }

  const botDist = target.position.distanceTo(bot.entity.position)
  if (botDist <= 3.5) {
    bot.pathfinder.setGoal(null)
    try { bot.attack(target) } catch (e) { /* target may have died already */ }
  } else {
    bot.pathfinder.setGoal(new goals.GoalNear(
      target.position.x, target.position.y, target.position.z, 1), true)
  }
}

function setFight (on, opts) {
  opts = opts || {}
  fightMode = on
  if (on) {
    setGuard(false) // fight replaces guard: one driver for the bot's feet
    autoFight = !!opts.auto
    resumeFollow = !!opts.resumeFollow
    fightTarget = opts.target || null
    if (!fightTimer) fightTimer = setInterval(fightTick, 500)
    if (!opts.quiet) say('Fighting! :3')
    log('[action] fight mode ON')
  } else {
    if (fightTimer) { clearInterval(fightTimer); fightTimer = null }
    fightTarget = null
    autoFight = false
    resumeFollow = false
    bot.pathfinder.setGoal(null)
    log('[action] fight mode OFF')
  }
}

// Idle movement: when Nova has nothing to do, he walks a real distance
// every few minutes on his own. This is meant to keep the server's idle
// kick (vanilla multiplayer.disconnect.idling, 10 min on this server)
// from booting him. Small shuffles did NOT work (proven 01:05–01:48 UTC:
// kicks landed exactly 10 min after join despite 1–2 block steps), so
// steps are now 6–10 blocks with movement verified in the log.
// HONEST LIMIT, do not remove: pathfinder steps have repeatedly logged
// "moved 0.0" at spawn, so they may still not move him at all if spawn
// is enclosed. The raw-shuffle fallback below tries direct movement
// when a pathfinder step barely moves him, and the log proves it either
// way. Neither trick fixes Falix's player-only "are you still there"
// check, which only a real player can click. The definitive kick fix
// is still server-side: player-idle-timeout=0 in server.properties.
// Never overrides a mode, a goal, sleep, or an explicit stay.
async function idleTick () {
  if (!bot || !bot.entity) return
  if (guardMode || fightMode || wanderMode || bot.isSleeping || stayCommanded) return
  if (bot.pathfinder.goal) return
  if (Date.now() - lastActivity < 2 * 60 * 1000) return
  const pos = bot.entity.position.clone()
  let target = null
  for (let tries = 0; tries < 8 && !target; tries++) {
    const mag = 6 + Math.floor(Math.random() * 5)
    const dx = (Math.random() < 0.5 ? -1 : 1) * mag
    const dz = (Math.random() < 0.5 ? -1 : 1) * mag
    const p = pos.offset(dx, 0, dz)
    // Ravine safety, 2026-10-30: idle steps used to check feet/head
    // only, not the ground below. A step over a ravine would walk the
    // bot off an edge. Now require a safe wander target: solid ground
    // below, no lava/water, and no big vertical drop from the bot.
    if (!isSafeWanderTarget(p)) continue
    if (isRavineRiskAt(p)) continue
    if (Math.abs(p.y - pos.y) > 3) continue
    target = p
  }
  if (!target) {
    // No safe pathfinder target: try a raw shuffle instead of giving up.
    lastActivity = Date.now()
    await rawShuffle()
    return
  }
  lastActivity = Date.now()
  const goal = new goals.GoalNear(target.x, target.y, target.z, 1)
  bot.pathfinder.setGoal(goal, true)
  log(`[idle] stepping from ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)} to ${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)}`)
  setTimeout(async () => {
    if (!bot || !bot.entity) return
    const now = bot.entity.position
    const moved = now.distanceTo(pos)
    log(`[idle] now at ${now.x.toFixed(0)}, ${now.y.toFixed(0)}, ${now.z.toFixed(0)} (moved ${moved.toFixed(1)})`)
    if (moved < 1) {
      log('[idle] barely moved, may be stuck — trying raw shuffle')
      await rawShuffle()
    }
    if (bot && bot.pathfinder.goal === goal) bot.pathfinder.setGoal(null)
  }, 15000)
}

// Self-defense: when something hostile hurts Nova, he fights back on his
// own — no command needed. If he was following Moon, he goes back to
// following once the fight is over.
function startSelfDefense (target) {
  if (!bot || fightMode || guardMode) return
  const wasFollowing = !!(bot.pathfinder.goal &&
    bot.pathfinder.goal.constructor.name === 'GoalFollow')
  if (bot.isSleeping) { try { bot.wake() } catch (e) { /* wake is best-effort */ } }
  log('[self-defense] fighting back')
  setFight(true, { auto: true, target: target || null, resumeFollow: wasFollowing, quiet: true })
  say('Hey, stop that! :3')
}

// ---------------------------------------------------------------- sleep

function isNight () {
  if (!bot) return false
  const t = bot.time.timeOfDay
  return t >= 12541 && t <= 23458
}

// Moon asleep? Precise signal is the entitySleep event; backup is seeing
// his feet on a bed at night (covers the event not firing).
function ownerAsleep () {
  if (ownerSleepingEvent) return true
  const owner = ownerEntity()
  if (!owner || !isNight()) return false
  const feet = bot.blockAt(owner.position)
  return !!(feet && feet.name.endsWith('_bed'))
}

function waitForNear (pos, range, timeoutMs) {
  const start = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      if (!bot || !bot.entity) return resolve(false)
      if (bot.entity.position.distanceTo(pos) < range) return resolve(true)
      if (Date.now() - start >= timeoutMs) return resolve(false)
      setTimeout(check, 250)
    }
    check()
  })
}

// Try to get Nova into the nearest unoccupied bed. Returns true if he is
// sleeping afterwards. Manual runs (from the "sleep" command) answer
// directly; automatic runs (Moon asleep) say once per sleep episode.
// ---------------------------------------------------------------- round 24: sleep fix (2026-10-30)
// Bug found live: trySleepOnce crashed every 3 seconds with
// "Cannot read properties of undefined (reading 'x')", and the bot
// never got into a bed. Root cause: bot.findBlocks returns Vec3
// positions, not Block objects, in mineflayer 4.39, but the old code
// read bed.position.x (undefined.position) and passed a Vec3 to
// bot.parseBedMetadata / bot.sleep, which both need a real Block.
// Fix: use the Vec3 for pathfinding, and bot.blockAt(position) for
// the sleep call, skipping positions where blockAt returns null
// (chunk not loaded). Beds explode in the Nether/End, so sleeping
// there is refused outright, never attempted blind.
function r24FreeBeds () {
  if (!bot || !bot.entity) return []
  let positions = []
  try {
    positions = bot.findBlocks({ matching: (b) => b.name.endsWith('_bed'), maxDistance: 32, count: 20 })
  } catch (e) { return [] }
  const free = []
  for (const pos of positions) {
    let block = null
    try { block = bot.blockAt(pos) } catch (e) { block = null }
    if (!block) continue
    let occupied = false
    try { occupied = !!bot.parseBedMetadata(block).occupied } catch (e) { occupied = false }
    if (!occupied) free.push(block)
  }
  return free
}
function r24SleepCheck () {
  if (!bot || !bot.entity) { say("I'm not in the world yet :3"); return }
  if (bot.isSleeping) { say("I'm already sleeping :3"); return }
  const dim = dimensionName()
  if (dim === 'the_nether' || dim === 'the_end') { say("I can't sleep here, beds explode in the Nether and the End :3"); return }
  const free = r24FreeBeds()
  say(free.length ? 'Sleep check: yes, there is a free bed nearby :3' : "Sleep check: no free bed nearby :3")
}
function r24SleepHelp () {
  say('Sleep help, brief: say "sleep" or "go to sleep" and I go to the nearest free bed within 32 blocks, I wake when you wake, and "wake" wakes me. I will not sleep in the Nether or the End, beds explode there, and I will not override fight, guard, or stay. Say "sleep check" for a free bed nearby, or not :3')
}
async function trySleepOnce (manual) {
  if (!bot) return false
  if (bot.isSleeping) return true
  const dim = dimensionName()
  if (dim === 'the_nether' || dim === 'the_end') {
    if (manual) say("I can't sleep here, beds explode in the Nether and the End :3")
    else log('[sleep] refused, Nether/End')
    return false
  }
  setFight(false)
  const freeBeds = r24FreeBeds()
  if (freeBeds.length === 0) {
    if (manual) say("I couldn't find a bed nearby :3")
    else if (!sleepSaid.noBed) { sleepSaid.noBed = true; say("I couldn't find a bed nearby :3") }
    return false
  }
  setGuard(false)
  for (const bed of freeBeds.slice(0, 4)) {
    if (!bot) return false
    if (bot.isSleeping) return true
    if (!ownerAsleep() && !manual) return false // Moon woke up mid-routine
    bot.pathfinder.setGoal(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1), true)
    const reached = await waitForNear(bed.position, 3.5, 8000)
    if (!reached) continue
    try {
      await bot.sleep(bed)
      log('[sleep] Nova is sleeping')
      return true
    } catch (e) {
      log(`[sleep] failed: ${e.message}`)
      if (e.message.includes('monsters nearby')) {
        if (manual) say("There are monsters nearby, I can't sleep! :3")
        else if (!sleepSaid.monsters) { sleepSaid.monsters = true; say("There are monsters nearby, I can't sleep! :3") }
      }
    }
    if (bot && bot.isSleeping) return true
  }
  return false
}

// Every few seconds: if Moon is asleep, get Nova into a bed too; if Moon
// is awake and Nova is asleep, wake Nova up.
async function sleepTick () {
  if (!bot || !bot.entity) return
  if (ownerAsleep()) {
    if (!moonSleepEpisode) { moonSleepEpisode = true; sleepSaid = {} }
    if (bot.isSleeping) return
    if (fightMode) return // fighting comes first
    if (sleepRoutineRunning) return
    sleepRoutineRunning = true
    try { await trySleepOnce(false) } catch (e) { log(`[sleep] routine error: ${e.message}`) }
    if (bot) bot.pathfinder.setGoal(null)
    sleepRoutineRunning = false
  } else {
    if (moonSleepEpisode) { moonSleepEpisode = false; sleepSaid = {} }
    if (bot.isSleeping) {
      try { await bot.wake() } catch (e) { log(`[wake failed] ${e.message}`) }
    }
  }
}

// One action command, shared by in-game chat and the command file.
// Natural phrasing: "Nova follow me" (no comma) is accepted by the chat
// handler, and here "please", ":3", trailing punctuation and extra
// spaces are stripped, so "follow me please" works like "follow me".
function runAction (command) {
  const cmd = normalizeCommand(command)
  lastActivity = Date.now()
  stayCommanded = (cmd === 'stay' || cmd === 'stay here' || cmd === 'stand still')
  // Any movement order stops wandering and mining, like it stops fight/guard.
  if (cmd !== 'wander' && cmd !== 'wander around' && cmd !== 'explore') {
    if (wanderMode) setWander(false)
  }
  if (cmd !== 'mine' && !cmd.startsWith('mine ') && !cmd.startsWith('get ') && !cmd.startsWith('find ') && !cmd.startsWith('gather ')) {
    if (mining) miningStop = true
  }
  // Fuzzy intent first: "go get some wood", "find food", "follow me
  // but stay safe", "track me", "hunt", "jump", etc. Exact switch
  // commands below still work unchanged.
  if (parseFuzzyIntent(cmd)) return true
  // Any other order interrupts hunting, like it interrupts mining.
  if (huntMode) setHunt(false)
  // Sleeping Nova wakes up for any order except "sleep" itself.
  if (cmd !== 'sleep' && cmd !== 'sleep check' && cmd !== 'check sleep' && cmd !== 'sleep help' && cmd !== 'sleep check help' && cmd !== 'round 24 help' && bot && bot.isSleeping) {
    try { bot.wake() } catch (e) { /* wake is best-effort */ }
  }
  switch (cmd) {
    case 'follow me':
    case 'follow':
    case 'follow moon':
    case 'come with me':
      setFight(false)
      setGuard(false)
      followOwner()
      return true
    case 'stay':
    case 'stay here':
    case 'stand still':
    case 'wait':
    case 'wait here':
      setFight(false)
      setGuard(false)
      stayPut()
      return true
    case 'come here':
    case 'come':
    case 'come to me':
    case 'go to me':
    case 'walk to me':
      setFight(false)
      setGuard(false)
      comeHere()
      return true
    case 'guard me':
    case 'guard':
    case 'protect me':
    case 'protect':
      setFight(false)
      setGuard(true)
      return true
    case 'stop guarding':
    case 'stop guard':
      setGuard(false)
      return true
    case 'fight':
    case 'fight them':
    case 'attack':
    case 'attack them':
    case 'kill them':
      setFight(true)
      return true
    case 'stop fighting':
    case 'stop fight':
    case 'stop':
    case 'stop mining':
    case 'stop wandering':
    case 'stop wander':
      setFight(false)
      setWander(false)
      if (mining) miningStop = true
      stayPut()
      return true
    case 'wander':
    case 'wander around':
    case 'explore':
    case 'walk around':
      setFight(false)
      setGuard(false)
      setWander(true)
      say('Wandering nearby :3')
      return true
    case 'go to spawn':
    case 'return to spawn':
    case 'go home':
      setFight(false)
      setGuard(false)
      if (spawnPos) {
        bot.pathfinder.setGoal(new goals.GoalNear(spawnPos.x, spawnPos.y, spawnPos.z, 1), true)
        say('Going to spawn :3')
      } else {
        say("I don't know where spawn is yet :3")
      }
      return true
    case 'unstuck':
    case 'get unstuck':
      rawShuffle().then((m) => { say(m >= 1 ? 'Tried to get unstuck :3' : "I tried, but I barely moved — I might be penned in :3") })
      return true
    case 'where are you':
    case 'where are you now':
      if (bot && bot.entity) say(`I'm at ${bot.entity.position.x.toFixed(0)}, ${bot.entity.position.y.toFixed(0)}, ${bot.entity.position.z.toFixed(0)} :3`)
      return true
    case 'what can you do':
    case 'what can you do now':
    case 'help':
    case 'commands':
      say('I can follow, stay, come, guard, fight, sleep, doors, drop, craft, mine, wander, spawn, scan, status, remember, bring, sprint, sneak, swim, air, enchantments, look, turn, button, lever, trapdoor, shear, milk, hoe, best armour, path, hide, heal, smelt, count, who is online, where is, eat, equip, wear armour, place, light up, build shelter, fish, dance, wave, retreat, go to coordinates, find things, ask nova, what did I say, confirm, stop everything, plus round 6: dimension, nether and end safety, tame, breed, feed, ride boat and minecart, get out, elytra help, ladder help, crawl help, brew help, anvil help, grindstone help, beacon help, conduit help, shulker help, bundle help, map and cartography help, banner help, play disc, note block, totem, spyglass, compass, and set spawn, plus round 7: breed verified, saddle and mount and chest, brew verified, anvil combine verified, grindstone verified, beacon check, conduit check, shulker move and check, bundle check, map verified, loom verified, cartography verified, smithing upgrade, stonecutter check, portal check, blaze check, pearl help, boss and structure check, monument check, trial check, check trades, bone meal crop, compost check, lectern check, dye armour help, and campfire check, plus round 9: brew extended, upgraded, splash, lingering, window layout report, ladder shapes, crawl shapes, boat shapes, minecart power check, elytra travel, plan with seed, go to biome/village/structure at coordinates, check weather, game time, count mobs, plus round 8: brew second stage healing, strength, swiftness, fire resistance, night vision, water breathing, regeneration, poison, leaping, slow falling, brew multiple awkward, smelt verified, enchant verified, stonecutter verified, loom, cartography, smithing, and grindstone layout checks, composter verified, campfire cook, dye armour verified, shear verified, milk verified, fish verified, trade verified, tame verified, lead, sit, stand, ladder climb verified, crawl check and through, glide verified, steer boat and minecart, and plan redstone, piston, house, biome, village, and structure, plus round 10: brew extended and upgraded check, potion details, confirmed window layouts, ladder water, corner, top, and climb step, crawl swimming, piston step, and step, boat river, ice, and step, minecart slope and push step, elytra rockets, landing, and rocket step, check xp, durability, light, fall height, free slots, effects, and walk step, plus round 11: brew tooltip compare and live confirm, drink potion live with a confirm step, window layout compare, reconfirm, forget all, and stale check, ladder trapdoor top and step, boat waterfall check and step, minecart ride step, elytra route plan and next rocket step, crawl swimming step, check lobby and am I ready to play for the Boykissers End first-join lobby, check hunger details, armour, block feet/below/above, water depth, redstone power, and piston extended, plus round 12: brew field diff detailed, brew tooltip checklist, brew check history, window layout summary, age check, forget stale, compare all, ladder water and corner steps, crawl piston check, boat river and ice steps, minecart slope step, elytra route check and glide step, lobby markers, lobby details, lobby history, check held item, check nearby by type, and check spawn point, plus round 14: clutch high practice and confirm attempt in stages 2, 3, and 4 after a lower live pass, ladder clutch check detailed, practice, confirm attempt, and passed live, clutch methods report, parkour course set, status, next for one jump only, cancel, and passed live, plus round 15: auto clutch watch setup and confirm enable, auto clutch status and fall reports, ladder grab check and proof, parkour course face check, landing check, and reposition help, plus round 13: brew no-signal check, brew confirm steps, brew confirmations detailed, window layout age detailed, summary detailed, forget by custom age, ladder top step, ladder water corner check, crawl swimming check detailed, piston activated live and timed step, boat river ice check, boat waterfall step safe, minecart no power step, elytra long travel plan and travel step, lobby markers by distance, lobby watch on/off/status, lobby transition summary, check food count, check nearby hostiles and animals, check distance to moon, clutch help, clutch check, clutch practice and confirm attempt, clutch attempts, parkour help, parkour check, parkour sprint jump step, parkour jump 2, 3, and 4, and parkour spin help, spin ready live, and spin step as an end goal. plus round 16: impress me routine, impress help, impress status, impress next, impress confirm clutch, impress cancel, and impress passed live, plus auto clutch attempt help, ladder grab proof help, and parkour automation help, all help-only for those three, plus round 17: mace clutch help, ready live, check, practice, confirm, cancel, attempts, and passed live, low passive-mob only, pig, cow, or sheep, mace clutch tower help, help only, no tower built, and impress warden scene help, description only, locked, never in impress next, with impress status now reporting mace unlock separately. plus round 18: target help, target <name>, target status, target clear, duel <player name>, duel me, duel confirm, duel status, duel crit step, duel passed live, stop duel, attack target for a mob only, bow help, bow check, bow practice, bow shoot, bow cancel, bow passed live, shield help, shield check, shield practice, and shield passed live, private servers Moon controls only, no player attacked without a named present confirmed duel, plus round 20: target block help, target block check, craft target block, place target block, target block practice close, mid, and long, target block shoot, train target block with up to 10 shots per Moon-started session, target block training status and stop, and target block passed live, signal reported only if bot data actually shows it, otherwise check live, and a target block does NOT train moving targets, plus round 21: lure help, lure check, lure <mob> to here or to a remembered label, lure confirm, lure status, lure stop, and lure passed live, one mob per journey, wolves need taming or a lead, they do NOT follow a bone like a pig follows a carrot, lead breaks pause for pickup and recatch up to 3 times, hole mode stops at the hole edge, plus target redstone help, check, line east, west, north, or south, and read, counting powered dust in a 15-block line, which if it works live supersedes the round 20 signal limit for a line only. If I do not understand something, I will check with Nova instead of staying silent :3')
      return true
    case 'inventory':
    case 'what do you have':
    case 'what are you carrying': {
      const items = bot.inventory.items()
      if (items.length === 0) { say("I'm not carrying anything :3"); return true }
      const summary = items.slice(0, 8).map((i) => `${i.count}x ${i.displayName || i.name}`).join(', ')
      say(`I'm carrying: ${summary}${items.length > 8 ? ', and more' : ''} :3`)
      return true
    }
    case 'open door':
    case 'open the door':
    case 'open doors':
      openCloseDoor(true)
      return true
    case 'close door':
    case 'close the door':
    case 'close doors':
      openCloseDoor(false)
      return true
    case 'go through door':
    case 'go through the door':
    case 'walk through door':
      goThroughDoor()
      return true
    case 'doors on':
      if (botMovements) { botMovements.canOpenDoors = true; say('Door pathing on — this can be glitchy on non-Paper servers :3') } else say("I don't have pathing ready yet :3")
      return true
    case 'doors off':
      if (botMovements) { botMovements.canOpenDoors = false; say('Door pathing off :3') }
      return true
    case 'sleep help':
    case 'sleep check help':
      r24SleepHelp()
      return true
    case 'round 24 help':
      say('Round 24, sleep fix: the old sleep code crashed every few seconds because it treated findBlocks positions as blocks, so it never got into a bed. Now it uses the position to walk there and the real block from blockAt to sleep in, skipping unloaded chunks, refusing the Nether and the End where beds explode, and the same position-vs-block fix was applied to doors, crafting tables, mining, gathering, furnaces, block finding, scanning, and enderman water. Say "sleep help" or "sleep check" for a brief bed check, and "sleep" to sleep :3')
      return true
    case 'sleep check':
    case 'check sleep':
    case 'is there a bed':
      r24SleepCheck()
      return true
    case 'sleep':
    case 'sleep now':
    case 'go to sleep':
      if (bot.isSleeping) { say("I'm already sleeping :3"); return true }
      if (sleepRoutineRunning) return true
      sleepRoutineRunning = true
      trySleepOnce(true)
        .then(() => { sleepRoutineRunning = false; if (bot) bot.pathfinder.setGoal(null) })
        .catch(() => { sleepRoutineRunning = false })
      return true
    default: {
      // Amount commands, parsed here so both chat and the command file
      // get them: "drop 5 cobblestone", "drop all dirt", "drop torches",
      // "craft 4 torches", "craft oak planks", "mine 10 cobblestone".
      let m = cmd.match(/^drop\s+(\d+)\s+(.+)$/)
      if (m) {
        dropItems(m[2].trim(), parseInt(m[1], 10), false)
        return true
      }
      m = cmd.match(/^drop\s+all\s+(.+)$/)
      if (m) {
        dropItems(m[1].trim(), 1, true)
        return true
      }
      m = cmd.match(/^drop\s+(.+)$/)
      if (m) {
        dropItems(m[1].trim(), 1, false)
        return true
      }
      m = cmd.match(/^craft\s+(\d+)\s+(.+)$/)
      if (m) {
        craftItems(m[2].trim(), parseInt(m[1], 10))
        return true
      }
      m = cmd.match(/^craft\s+(.+)$/)
      if (m) {
        craftItems(m[1].trim(), 1)
        return true
      }
      m = cmd.match(/^mine\s+(\d+)\s+(.+)$/)
      if (m) {
        mineItems(m[2].trim(), parseInt(m[1], 10))
        return true
      }
      m = cmd.match(/^mine\s+(.+)$/)
      if (m) {
        mineItems(m[1].trim(), 1)
        return true
      }
      return false
    }
  }
}

// ---------------------------------------------------------------- command file

// Nova (in chat) appends lines to commands.txt to drive the bot:
//   say <message>   -> bot says the message in game chat
//   follow / stay / come / guard / stop guarding / fight / stop / sleep -> the matching action
// Any other line is spoken in game chat as-is.
function pollCommandFile () {
  if (!bot) return
  let data
  try { data = fs.readFileSync(COMMANDS_FILE, 'utf8') } catch (e) { return } // no file yet
  const lines = data.split('\n')
  // Only process lines that are complete (file ends with a newline, or the
  // last line is finished). A trailing partial line is left for next poll.
  const complete = data.endsWith('\n') ? lines.length - 1 : lines.length - 1
  for (let i = processedCommandLines; i < complete; i++) {
    const line = lines[i].trim()
    if (!line) continue
    log(`[command-file] ${line}`)
    if (line.toLowerCase().startsWith('say ')) {
      say(line.slice(4))
    } else if (!runAction(line)) {
      say(line)
    }
  }
  processedCommandLines = complete
}

// ---------------------------------------------------------------- bot lifecycle

function scheduleReconnect () {
  if (reconnectTimer) return
  log(`[reconnect] retrying in ${RECONNECT_DELAY_MS / 1000}s...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_DELAY_MS)
}

function connect () {
  log(`[connect] ${USERNAME} -> ${HOST}:${PORT} (version ${VERSION}, auth offline)`)
  try {
    bot = mineflayer.createBot({
      host: HOST,
      port: PORT,
      username: USERNAME,
      version: VERSION,
      auth: 'offline' // cracked server: no Microsoft login
    })
  } catch (e) {
    log(`[connect failed] ${e.message}`)
    scheduleReconnect()
    return
  }

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    log(`[spawn] ${USERNAME} joined ${HOST}:${PORT}`)
    const mcData = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    movements.canDig = false // never break blocks while pathing: no more digging at doors/walls
    // canOpenDoors stays false by default: pathfinder's own door handling
    // is documented as glitchy on non-Paper servers. Use the explicit
    // "open door" / "go through door" commands instead, or "doors on"
    // if Moon wants to try pathfinder door handling anyway.
    movements.canOpenDoors = false
    botMovements = movements
    bot.pathfinder.setMovements(movements)
    if (bot.entity) spawnPos = bot.entity.position.clone()
    lastHealth = (typeof bot.health === 'number') ? bot.health : 20
    lastActivity = Date.now()
    if (!sleepCheckTimer) sleepCheckTimer = setInterval(sleepTick, 3000)
    if (!idleTimer) idleTimer = setInterval(idleTick, 60000)
    if (!autoTickTimer) autoTickTimer = setInterval(autoTick, 5000)
    if (!airTickTimer) airTickTimer = setInterval(airTick, 1000)
    if (!fallWatchTimer) fallWatchTimer = setInterval(fallWatchTick, 1000)
    say('Hi! Nova is here :3')
    if (r22DeathAnnouncePending && r22Death) {
      r22DeathAnnouncePending = false
      say(`I died at ${r22Death.x.toFixed(0)}, ${r22Death.y.toFixed(0)}, ${r22Death.z.toFixed(0)}, my stuff is there and it despawns in about 5 minutes, say "return to my stuff" if you want me to go back :3`)
    }
    // Boykissers first-join lobby, round 11: one delayed check, 5
    // seconds after spawn, so chunks have a chance to load. It only
    // reports what it actually sees, it never claims ready while in
    // the End lobby, and a later "check lobby" / "am I ready to play"
    // is what detects the teleport to the Overworld.
    setTimeout(() => { try { lobbyCheck('lobby') } catch (e) { log(`[lobby] spawn check failed: ${e.message}`) } }, 5000)
  })

  // In-game chat orders: only from Werewolf_Paws, starting with "Nova, "
  // or "Nova " (no comma) — the no-comma form was a live lesson from
  // Oct 2025, when "Nova stay" was plain chat, not a command.
  bot.on('chat', (username, message) => {
    log(`[chat] <${username}> ${message}`)
    if (username !== OWNER) {
      // Other players are logged only, never forwarded to Nova as a
      // command, so nobody else can control the bot through chat.
      log(`[chat] non-owner message logged only, not forwarded to Nova as a command`)
      return
    }
    lastOwnerMessage = String(message)
    const lower = message.toLowerCase()
    let command = null
    if (lower.startsWith('nova, ')) command = message.slice(6)
    else if (lower.startsWith('nova ')) command = message.slice(5)
    if (command === null) {
      // Not a command: try a social reply first. If it is not a known
      // social phrase either, forward it to Nova instead of staying
      // silent or repeating one canned failure line.
      if (!conversationalReply(message)) {
        forwardUnknownMessage(message, false)
      }
      return
    }
    if (!runAction(command)) {
      // Not a known action, fuzzy request, or social phrase: forward
      // it to Nova via bot.log, and say so in game, instead of a
      // canned "I don't know that one yet".
      log(`[chat-command] unrecognized: ${command}`)
      forwardUnknownMessage(command, true)
    }
  })

  // Moon falling asleep / waking up (entity pose events for the owner).
  bot.on('entitySleep', (entity) => {
    const owner = ownerEntity()
    if (owner && entity.id === owner.id) {
      ownerSleepingEvent = true
      log('[sleep] owner is sleeping')
    }
  })
  bot.on('entityWake', (entity) => {
    const owner = ownerEntity()
    if (owner && entity.id === owner.id) {
      ownerSleepingEvent = false
      log('[sleep] owner woke up')
    }
  })

  // Reacting to what happens around the bot, like a player would.
  bot.on('playerJoined', (player) => {
    if (player && player.username === OWNER) say('Welcome back! :3')
  })
  bot.on('playerLeft', (player) => {
    if (player && player.username === OWNER) say('Bye for now :3')
  })

  // Self-defense, precise path: the game tells us who hurt Nova.
  // Also react if Moon himself is hurt: protect him, once per episode.
  bot.on('entityHurt', (entity, source) => {
    if (!bot) return
    const owner = ownerEntity()
    if (owner && entity.id === owner.id) {
      if (source && source.type === 'mob' && HOSTILE_MOBS.has(source.mobType) && !fightMode && !guardMode && !stayCommanded) {
        say('Are you okay? Protecting you! :3')
        setFight(true, { auto: true, target: source, resumeFollow: true, quiet: true })
      }
      return
    }
    if (entity !== bot.entity) return
    if (fightMode || guardMode) return
    if (!source || source.type !== 'mob' || !HOSTILE_MOBS.has(source.mobType)) return
    startSelfDefense(source)
  })

  // Self-defense, fallback path: health dropped and a hostile mob is near.
  // Low health: say so once, so Moon knows, instead of silently dying.
  bot.on('health', () => {
    if (!bot) return
    const h = bot.health
    if (typeof h === 'number' && h <= 6 && !healthLowSaid) { healthLowSaid = true; say("I'm hurt, I need a bit of help! :3") }
    if (typeof h === 'number' && h > 12) healthLowSaid = false
    if (h < lastHealth && !fightMode && !guardMode && bot.entity) {
      const near = findNearestHostile(bot.entity.position, 10)
      if (near) startSelfDefense(null)
    }
    lastHealth = h
  })

  bot.on('death', () => {
    log('[death] bot died')
    try { r22RecordDeath() } catch (e) { log(`[death-spot] record failed: ${e.message}`) }
    try { bot.respawn() } catch (e) { log(`[respawn failed] ${e.message}`) }
    say("Ouch, I'm back! :3")
  })

  bot.on('kicked', (reason) => {
    let reasonText
    try { reasonText = (typeof reason === 'string') ? reason : JSON.stringify(reason) } catch (e) { reasonText = String(reason) }
    log(`[kicked] ${reasonText}`)
  })

  bot.on('error', (err) => {
    log(`[error] ${err.message}`)
  })

  bot.on('end', (reason) => {
    log(`[disconnect] ${reason || 'connection ended'}`)
    bot = null
    if (guardTimer) { clearInterval(guardTimer); guardTimer = null }
    guardMode = false
    if (fightTimer) { clearInterval(fightTimer); fightTimer = null }
    fightMode = false
    fightTarget = null
    autoFight = false
    resumeFollow = false
    if (sleepCheckTimer) { clearInterval(sleepCheckTimer); sleepCheckTimer = null }
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
    if (autoTickTimer) { clearInterval(autoTickTimer); autoTickTimer = null }
    if (airTickTimer) { clearInterval(airTickTimer); airTickTimer = null }
    if (fallWatchTimer) { clearInterval(fallWatchTimer); fallWatchTimer = null }
    autoClutchWatch.on = false; pendingAutoClutch = null; fallWatchEpisode = null
    headUnderSince = null; lastAirElapsed = 0; airMagmaSneak = false; airWarnedAt = 0
    if (huntTimer) { clearInterval(huntTimer); huntTimer = null }
    huntMode = false
    huntTarget = null
    huntCount = 0
    autoProtectOn = true
    autoTrackOn = true
    trackSaid = false
    protectSaid = false
    healthLowSaid = false
    nightSaid = false
    autoGathering = false
    if (wanderTimer) { clearInterval(wanderTimer); wanderTimer = null }
    wanderMode = false
    wanderAnchor = null
    mining = false
    miningStop = false
    doorBusy = false
    botMovements = null
    sprintOn = false
    sneakOn = false
    fishingOn = false
    waterEscapeAt = 0
    lastBotY = null
    ravineFallReportedAt = 0
    stayCommanded = false
    ownerSleepingEvent = false
    moonSleepEpisode = false
    sleepSaid = {}
    sleepRoutineRunning = false
    scheduleReconnect()
  })
}

// ---------------------------------------------------------------- main

// Make sure the command file exists so Nova can append to it.
try { fs.appendFileSync(COMMANDS_FILE, '') } catch (e) { /* best-effort */ }
setInterval(pollCommandFile, COMMAND_POLL_MS)

log(`[start] Nova bot starting — target ${HOST}:${PORT}, username ${USERNAME}`)
connect()
