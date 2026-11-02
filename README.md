# Marble Rush

An endless 3D marble game in the browser, built with three.js and Rapier.
Tilt the stage like Super Monkey Ball; the track is generated as you roll and
gets faster and nastier: banked turns, hills, boost pads, jumps, narrow
bridges, spirals and full loops. Goal gates add time, gems add points.

## Run

```bash
npm install
npm run dev
```

## Controls

- **WASD / arrows**: tilt the stage (forward to accelerate, back to brake)
- **Gamepad** left stick, or **touch** drag
- **Space / click**: start · **P**: pause · **M**: mute

## Tinkering

- `?seed=123` reproduces a track, `?piece=loop` (or `jump`, `sharp`, `spiral`, `narrow`) starts you at the first piece of that kind.
- `node test/sim.mjs <seed> <seconds> <forwardInput>` rolls a scripted ball down a track and reports every fall.
- Tuning lives in `src/config.js` (speed and difficulty curves) and `src/control.js` (steering).
