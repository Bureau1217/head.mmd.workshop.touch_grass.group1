# World steps: a canvas bigger than the screen

What the current project would need for a canvas that is bigger than the screen, with things happening on different parts of it.

The project already has a good base. The news panel is `position: fixed` (the CSS comment even says "while the canvas moves"), and the server already sends shared data to every browser. The bigger pieces are missing. These are the parts you'd need.

## 1. A world with its own coordinates

Decide on a fixed world size, for example 5000 × 5000, that doesn't depend on any screen. Everything on the canvas gets a position in **world coordinates** (`x`, `y`). That's what makes "the tree at 3200, 800" mean the same place for everyone, whether they're on a phone or a large monitor.

## 2. A camera (viewport)

Each visitor sees one window onto the world. You need:

- **The camera's position** (and zoom, if you want it) for that visitor.
- **A way to move it:** dragging with the mouse or a finger, scrolling, maybe the arrow keys. On phones, `touch-action: none` on the canvas stops the page itself from scrolling.
- **Conversion:** screen position = world position − camera position (× zoom). It's also needed backwards, so a click lands on the right spot in the world.

There are two common ways to build it:

- **One `<canvas>` the size of the screen**, redrawn each frame, drawing only what's in view. This handles many moving things best, and it's what the reference project does. Scale the canvas by `devicePixelRatio`, or text will look blurry on sharp screens.
- **One very large `<div>`** holding normal HTML elements, moved with `transform: translate(...)`. This is easier for text and styling, but slows down with many elements.

For a text-heavy piece with things happening everywhere, the canvas is the better choice.

## 3. Layers

- **World layer:** moves with the camera. Decide whether the paper grain belongs to it. Right now `grain.js` puts it on `body`, so it stays still while things move over it. If the paper should move with the world, draw the grain tile on the canvas instead.
- **Interface layer:** stays fixed on top. The news panel is already like this.

## 4. Shared world state on the server

This is the biggest change from what the project has now:

- **History is a log** (what happened). **World state is a snapshot** (what exists right now, and where). The server needs to hold both, for example an `objects` list with an id, type and `x`, `y` for each.
- **On `'welcome'`,** send the current world state along with `history`, so a newcomer sees the same canvas as everyone else.
- **When something changes,** the browser sends it to the server, the server updates the state, and it broadcasts the change. This is the same flow as `'joined'`.
- **Events get positions.** Anything that happens should carry `x`, `y`, so it can be drawn in the right place. The news panel could then say where something happened, or jump the camera there when you click it.

## 5. Possibly later

- **Seeing other visitors:** where others are looking or pointing (live cursors or small viewport outlines). This means sending camera positions often, so it would need throttling.
- **Rate limiting:** the reference's `allowed()`, once visitors can act on the world.
- **Sending only nearby changes:** only needed if the world gets very busy. For a workshop-sized group, sending everything is fine.
- **Saving the world to a file**, as `memory.txt` did in the reference, if it should survive a restart. Left out for now.

## What to do now

Very little has to change in the current project:

- Keep interface elements in the fixed layer.
- When you add new event types, give them `x`, `y` from the start.
- Name the server's data so a world `state` can sit next to `history` in the welcome.

The canvas and camera can then be added as a new file, for example `public/world.js`, without touching the news code.
