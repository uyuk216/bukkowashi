(() => {
  'use strict';

  const GAME_SECONDS = 15;
  const MAX_PARTICLES = 720;
  const MAX_DEBRIS = 360;
  const MAX_POPUPS = 54;
  const STORAGE_KEY = 'yubi1-smash-best-v1';
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  const hud = document.getElementById('hud');
  const titleOverlay = document.getElementById('titleOverlay');
  const resultOverlay = document.getElementById('resultOverlay');
  const scoreValue = document.getElementById('scoreValue');
  const timeValue = document.getElementById('timeValue');
  const timeBar = document.getElementById('timeBar');
  const stageValue = document.getElementById('stageValue');
  const comboReadout = document.getElementById('comboReadout');
  const finalScore = document.getElementById('finalScore');
  const bestScore = document.getElementById('bestScore');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const random = Math.random;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const formatScore = value => Math.floor(value).toLocaleString('ja-JP');

  const state = {
    mode: 'title',
    width: 0,
    height: 0,
    dpr: 1,
    world: null,
    score: 0,
    best: 0,
    secondsLeft: GAME_SECONDS,
    stage: 1,
    combo: 0,
    comboTimer: 0,
    elapsed: 0,
    hitStop: 0,
    shake: 0,
    particles: [],
    debris: [],
    popups: [],
    pointer: { down: false, id: null, last: null, segments: [] },
    sound: null,
    lastSoundAt: -1,
    lastBuzzAt: -1,
    needsCollapse: false,
    lastUiTime: -1
  };

  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    state.best = Number.isFinite(saved) && saved > 0 ? saved : 0;
  } catch (_) {
    state.best = 0;
  }

  function setupCanvas() {
    const old = state.world;
    const oldWidth = state.width;
    const oldHeight = state.height;
    state.width = Math.max(1, window.innerWidth);
    state.height = Math.max(1, window.innerHeight);
    state.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;

    if (!old) {
      buildCity();
      return;
    }

    // Keep the remaining street shape across rotation and viewport changes.
    const next = makeWorld();
    const scaleX = state.width / Math.max(1, oldWidth);
    const scaleY = state.height / Math.max(1, oldHeight);
    for (const block of old.blocks.values()) {
      const px = old.left + (block.col + 0.5) * old.cell;
      const py = old.baseY - (block.row + 0.5) * old.cell;
      const col = clamp(Math.floor((px * scaleX - next.left) / next.cell), 0, next.cols - 1);
      const row = clamp(Math.floor((next.baseY - py * scaleY) / next.cell), 0, next.rows - 1);
      const key = keyFor(col, row);
      if (!next.blocks.has(key)) next.blocks.set(key, { ...block, col, row, key });
    }
    state.world = next;
    state.particles.length = 0;
    state.debris.length = 0;
    state.popups.length = 0;
  }

  function keyFor(col, row) { return `${col}:${row}`; }

  function makeWorld() {
    const cell = clamp(Math.round(state.width / 15), 20, 34);
    const cols = Math.max(5, Math.ceil(state.width / cell));
    const rows = Math.max(8, Math.ceil(state.height * 0.87 / cell));
    return {
      cell,
      cols,
      rows,
      left: (state.width - cols * cell) / 2,
      baseY: state.height + cell * 0.1,
      blocks: new Map(),
      groundY: state.height + cell * 0.1
    };
  }

  function buildCity() {
    const world = makeWorld();
    let col = 0;
    let buildingIndex = 0;
    let bombCount = 0;
    const maxHeight = world.rows;

    while (col < world.cols) {
      const gap = col > 0 && random() < 0.22 ? 1 : 0;
      if (gap) { col += 1; continue; }
      const width = Math.min(world.cols - col, 2 + Math.floor(random() * 4));
      const towerHeight = clamp(Math.round(maxHeight * (0.42 + random() * 0.56)), 7, maxHeight);
      const hue = Math.round((buildingIndex * 43 + random() * 36 + state.stage * 17) % 360);
      for (let x = col; x < col + width; x += 1) {
        const heightOffset = Math.floor(random() * 3);
        const buildingHeight = Math.max(5, towerHeight - heightOffset);
        for (let row = 0; row < buildingHeight; row += 1) {
          const bomb = random() < 0.016;
          if (bomb) bombCount += 1;
          const key = keyFor(x, row);
          world.blocks.set(key, {
            key,
            col: x,
            row,
            hue: (hue + row * 0.45 + random() * 8) % 360,
            light: 48 + Math.floor(random() * 13),
            bomb,
            impactCooldown: 0
          });
        }
      }
      col += width;
      buildingIndex += 1;
    }

    // Every fresh street gets a beacon to reward a lucky swipe.
    if (bombCount === 0 && world.blocks.size > 0) {
      const choices = [...world.blocks.values()].filter(block => block.row > 3);
      const pick = choices[Math.floor(random() * choices.length)] || world.blocks.values().next().value;
      if (pick) pick.bomb = true;
    }
    state.world = world;
  }

  function colorForBlock(block, extraLight = 0) {
    const light = clamp(block.light + extraLight, 20, 82);
    return `hsl(${block.hue} 82% ${light}%)`;
  }

  function blockPosition(block) {
    const world = state.world;
    return {
      x: world.left + block.col * world.cell,
      y: world.baseY - (block.row + 1) * world.cell
    };
  }

  function drawBackground(time) {
    const w = state.width;
    const h = state.height;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#101533');
    sky.addColorStop(.44, '#272151');
    sky.addColorStop(.76, '#562658');
    sky.addColorStop(1, '#192441');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * .53, h * .42, 2, w * .53, h * .42, h * .62);
    glow.addColorStop(0, 'rgba(112,75,187,.25)');
    glow.addColorStop(.45, 'rgba(255,74,164,.075)');
    glow.addColorStop(1, 'rgba(10,12,32,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 42; i += 1) {
      const x = ((i * 83.17 + 27) % 997) / 997 * w;
      const y = ((i * 61.73 + 19) % 397) / 397 * h * .57;
      const blink = .25 + (Math.sin(time * (1.2 + i % 4) + i * 7) + 1) * .2;
      ctx.globalAlpha = blink;
      ctx.fillStyle = i % 5 === 0 ? '#ffbde5' : '#bdeaff';
      ctx.beginPath();
      ctx.arc(x, y, i % 7 === 0 ? 1.4 : .75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // A hazy neon moon anchors the skyline without an image asset.
    const moonX = w * .78;
    const moonY = h * .22;
    const moon = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, Math.min(92, w * .24));
    moon.addColorStop(0, 'rgba(255,231,151,.20)');
    moon.addColorStop(.22, 'rgba(255,177,231,.12)');
    moon.addColorStop(1, 'rgba(255,129,215,0)');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(moonX, moonY, Math.min(92, w * .24), 0, Math.PI * 2);
    ctx.fill();

    // Distant silhouettes add depth behind the breakable blocks.
    const base = h * .83;
    for (let i = 0; i < 12; i += 1) {
      const bw = w / 9 + (i % 3) * 7;
      const bx = (i * w / 10 - w * .05) % (w + bw) - bw * .3;
      const bh = h * (.18 + ((i * 17) % 29) / 100);
      ctx.fillStyle = i % 2 ? 'rgba(20,31,67,.44)' : 'rgba(24,28,70,.56)';
      ctx.fillRect(bx, base - bh, bw, bh + 20);
      ctx.fillStyle = 'rgba(114,170,255,.13)';
      for (let wx = bx + 5; wx < bx + bw - 3; wx += 11) {
        for (let wy = base - bh + 9; wy < base - 5; wy += 15) {
          if (Math.sin(wx * .17 + wy * .23) > .12) ctx.fillRect(wx, wy, 3, 5);
        }
      }
    }

    const groundGradient = ctx.createLinearGradient(0, h * .8, 0, h);
    groundGradient.addColorStop(0, 'rgba(255,91,200,.04)');
    groundGradient.addColorStop(1, 'rgba(41,195,255,.10)');
    ctx.fillStyle = groundGradient;
    ctx.fillRect(0, h * .8, w, h * .2);
  }

  function drawBlock(block, time) {
    const world = state.world;
    const { x, y } = blockPosition(block);
    const size = world.cell;
    const gap = Math.max(1, size * .045);
    const left = x + gap;
    const top = y + gap;
    const side = Math.max(2, size * .1);
    const bottom = world.baseY - block.row * size;

    if (block.bomb) {
      const pulse = .5 + (Math.sin(time * 7.8 + block.col + block.row) + 1) * .25;
      ctx.globalAlpha = .55 + pulse * .35;
      ctx.fillStyle = `hsla(${(time * 140 + 36) % 360} 100% 70% / ${.2 + pulse * .18})`;
      ctx.fillRect(left - 3, top - 3, size - gap * 2 + 6, size - gap * 2 + 6);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(5,9,29,.38)';
    ctx.fillRect(left + 2, top + 3, size - gap * 2, size - gap * 2);
    ctx.fillStyle = colorForBlock(block);
    ctx.fillRect(left, top, size - gap * 2, size - gap * 2);

    // Two small bevels make each tile read as a chunky city brick.
    ctx.fillStyle = colorForBlock(block, 17);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + side, top + side * .62);
    ctx.lineTo(left + size - gap * 2, top + side * .62);
    ctx.lineTo(left + size - gap * 2, top);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colorForBlock(block, -17);
    ctx.beginPath();
    ctx.moveTo(left + size - gap * 2 - side, top + side * .55);
    ctx.lineTo(left + size - gap * 2, top);
    ctx.lineTo(left + size - gap * 2, bottom - gap);
    ctx.lineTo(left + size - gap * 2 - side, bottom - gap * 2.1);
    ctx.closePath();
    ctx.fill();

    if (block.bomb) {
      const cx = left + (size - gap * 2) * .49;
      const cy = top + (size - gap * 2) * .52;
      ctx.fillStyle = '#fff8c9';
      ctx.beginPath();
      ctx.arc(cx, cy, size * .11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${(time * 140 + 32) % 360} 100% 79% / .95)`;
      ctx.lineWidth = Math.max(1.4, size * .055);
      ctx.beginPath();
      ctx.arc(cx, cy, size * (.19 + Math.sin(time * 8) * .025), 0, Math.PI * 2);
      ctx.stroke();
    } else if (block.row % 4 === 2 && block.col % 3 !== 1) {
      ctx.fillStyle = 'rgba(255,246,198,.43)';
      ctx.fillRect(left + side * 1.6, top + size * .36, Math.max(2, size * .16), Math.max(3, size * .22));
    }
  }

  function drawWorld(time) {
    const world = state.world;
    if (!world) return;
    const blocks = [...world.blocks.values()];
    blocks.sort((a, b) => b.row - a.row || a.col - b.col);
    for (const block of blocks) drawBlock(block, time);

    // Neon street line and perspective marks under the lowest bricks.
    const floorY = clamp(world.baseY - world.cell * .06, 0, state.height);
    ctx.strokeStyle = 'rgba(106,225,255,.43)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(state.width, floorY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(113,199,255,.11)';
    for (let x = -state.width; x < state.width * 2; x += state.width / 7) {
      ctx.beginPath();
      ctx.moveTo(state.width * .5, floorY);
      ctx.lineTo(x, state.height + 20);
      ctx.stroke();
    }
  }

  function addParticle(particle) {
    state.particles.push(particle);
    if (state.particles.length > MAX_PARTICLES) state.particles.splice(0, state.particles.length - MAX_PARTICLES);
  }

  function addDebris(piece) {
    state.debris.push(piece);
    while (state.debris.length > MAX_DEBRIS) {
      const dropped = state.debris.shift();
      if (dropped.scoring && !dropped.scored && state.mode === 'playing') {
        dropped.scored = true;
        awardBlock(dropped.x, dropped.y);
        makeShards(dropped.x, dropped.y, dropped.hue, .5, 3);
      }
    }
  }

  function addPopup(x, y, text, hue = 50, scale = 1) {
    state.popups.push({ x, y, text, hue, scale, life: .82, maxLife: .82, vy: -47 - random() * 20 });
    if (state.popups.length > MAX_POPUPS) state.popups.shift();
  }

  function makeShards(x, y, hue, energy = 1, amount = 5) {
    const cap = Math.min(amount, Math.max(0, MAX_PARTICLES - state.particles.length));
    for (let i = 0; i < cap; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = (45 + random() * 220) * energy;
      const size = 2 + random() * Math.max(3, state.world.cell * .18);
      addParticle({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 35,
        size, hue: (hue + random() * 48 - 24 + 360) % 360,
        life: .35 + random() * .65, maxLife: .9, rot: random() * 6.2,
        vr: (random() - .5) * 13, gravity: 530, square: true
      });
    }
  }

  function spawnWholeBlock(block, vx = 0, vy = 0, impulse = .55, scoring = false) {
    const pos = blockPosition(block);
    const cell = state.world.cell;
    addDebris({
      x: pos.x + cell * .5,
      y: pos.y + cell * .5,
      size: cell * .72,
      hue: block.hue,
      light: block.light,
      vx: vx + (random() - .5) * 74 * impulse,
      vy: vy - random() * 48 * impulse,
      rot: random() * 6.2,
      vr: (random() - .5) * 8,
      life: 3.5,
      bounces: 0,
      impactCooldown: 0,
      whole: true,
      scoring,
      scored: false
    });
  }

  function awardBlock(x, y) {
    if (state.comboTimer <= 0) state.combo = 0;
    state.combo += 1;
    state.comboTimer = .78;
    const multiplier = 1 + Math.floor((state.combo - 1) / 4);
    const points = 120 * multiplier;
    state.score += points;
    const hue = (48 + state.combo * 33) % 360;
    addPopup(x, y, `+${points}`, hue, multiplier > 1 ? 1.13 : 1);
    if (state.combo === 4 || (state.combo > 4 && state.combo % 4 === 0)) addPopup(x, y - 20, `×${multiplier} コンボ`, hue, 1.25);
    state.hitStop = Math.max(state.hitStop, multiplier > 2 ? .045 : .027);
    state.shake = Math.min(16, state.shake + (multiplier > 2 ? 5.8 : 3.2));
    playHitSound(multiplier);
    vibrate(8 + Math.min(multiplier, 4) * 2);
  }

  function removeBlock(block) {
    if (!state.world.blocks.delete(block.key)) return false;
    const pos = blockPosition(block);
    return { ...pos, centerX: pos.x + state.world.cell * .5, centerY: pos.y + state.world.cell * .5 };
  }

  function strikeBlock(block, sweepVx = 0, sweepVy = 0) {
    const position = removeBlock(block);
    if (!position) return false;
    awardBlock(position.centerX, position.centerY);
    makeShards(position.centerX, position.centerY, block.hue, 1.05, 7);
    if (block.bomb) detonateBomb(block, position.centerX, position.centerY);
    state.needsCollapse = true;
    return true;
  }

  function createExplosion(centerX, centerY, radius, hue, strength = 1) {
    state.particles.push({
      x: centerX, y: centerY, radius: 5, maxRadius: radius, hue,
      life: .36, maxLife: .36, ring: true
    });
    if (state.particles.length > MAX_PARTICLES) state.particles.splice(0, state.particles.length - MAX_PARTICLES);
    for (let i = 0; i < 34; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = (80 + random() * 470) * strength;
      addParticle({
        x: centerX, y: centerY,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: 2.5 + random() * 6, hue: (hue + random() * 66) % 360,
        life: .38 + random() * .75, maxLife: 1.1, rot: random() * 6.2,
        vr: (random() - .5) * 17, gravity: 230, square: true
      });
    }
  }

  function detonateBomb(first, firstX, firstY) {
    const queue = [{ block: first, x: firstX, y: firstY }];
    const queued = new Set([first.key]);
    let detonations = 0;
    while (queue.length && detonations < 8) {
      const item = queue.shift();
      const bomb = item.block;
      const centerX = item.x;
      const centerY = item.y;
      if (bomb !== first && !state.world.blocks.has(bomb.key)) continue;
      if (bomb !== first) {
        const removed = removeBlock(bomb);
        if (!removed) continue;
        awardBlock(removed.centerX, removed.centerY);
      }
      detonations += 1;
      const radius = state.world.cell * (4.1 + Math.min(state.stage, 4) * .25);
      const bombHue = (state.elapsed * 126 + 34) % 360;
      createExplosion(centerX, centerY, radius, bombHue, 1.1);
      state.shake = Math.min(25, state.shake + 16);
      state.hitStop = Math.max(state.hitStop, .072);
      soundExplosion();
      vibrate(32);

      const affected = [...state.world.blocks.values()];
      for (const target of affected) {
        const position = blockPosition(target);
        const tx = position.x + state.world.cell * .5;
        const ty = position.y + state.world.cell * .5;
        const dx = tx - centerX;
        const dy = ty - centerY;
        const distance = Math.hypot(dx, dy);
        if (target.bomb && distance < radius * 1.05) {
          if (!queued.has(target.key)) {
            queue.push({ block: target, x: tx, y: ty });
            queued.add(target.key);
          }
          continue;
        }
        const reach = distance <= radius || (distance <= radius * 1.43 && random() < .42);
        if (!reach) continue;
        const removed = removeBlock(target);
        if (!removed) continue;
        awardBlock(removed.centerX, removed.centerY);
        const length = Math.max(1, distance);
        const power = distance <= radius ? 1.35 : .78;
        makeShards(
          removed.centerX, removed.centerY, target.hue, power,
          distance <= radius ? 5 : 3
        );
        if (distance > radius * .8 && random() < .26) {
          spawnWholeBlock(target, (dx / length) * 150, (dy / length) * 120 - 130, 1.2);
        }
      }
    }
    state.needsCollapse = true;
  }

  function lineDistanceSquared(pointX, pointY, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < .01) {
      const px = pointX - start.x;
      const py = pointY - start.y;
      return px * px + py * py;
    }
    const t = clamp(((pointX - start.x) * dx + (pointY - start.y) * dy) / lengthSq, 0, 1);
    const px = pointX - (start.x + t * dx);
    const py = pointY - (start.y + t * dy);
    return px * px + py * py;
  }

  function pointRectDistanceSquared(px, py, x, y, width, height) {
    const dx = Math.max(x - px, 0, px - (x + width));
    const dy = Math.max(y - py, 0, py - (y + height));
    return dx * dx + dy * dy;
  }

  function segmentIntersectsRect(start, end, x, y, width, height) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let tMin = 0;
    let tMax = 1;
    const clips = [
      [-dx, start.x - x], [dx, x + width - start.x],
      [-dy, start.y - y], [dy, y + height - start.y]
    ];
    for (const [p, q] of clips) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return false;
        continue;
      }
      const ratio = q / p;
      if (p < 0) {
        if (ratio > tMax) return false;
        tMin = Math.max(tMin, ratio);
      } else {
        if (ratio < tMin) return false;
        tMax = Math.min(tMax, ratio);
      }
    }
    return tMin <= tMax;
  }

  function segmentRectDistanceSquared(start, end, x, y, width, height) {
    if (segmentIntersectsRect(start, end, x, y, width, height)) return 0;
    let closest = Math.min(
      pointRectDistanceSquared(start.x, start.y, x, y, width, height),
      pointRectDistanceSquared(end.x, end.y, x, y, width, height)
    );
    const corners = [
      [x, y], [x + width, y], [x, y + height], [x + width, y + height]
    ];
    for (const [cornerX, cornerY] of corners) {
      closest = Math.min(closest, lineDistanceSquared(cornerX, cornerY, start, end));
    }
    return closest;
  }

  function processPointerSegments() {
    const segments = state.pointer.segments;
    if (!segments.length || state.mode !== 'playing') return;
    const world = state.world;
    const hitRadius = Math.max(4, world.cell * .2);
    for (const segment of segments) {
      const dx = segment.end.x - segment.start.x;
      const dy = segment.end.y - segment.start.y;
      const pad = hitRadius + world.cell;
      const minX = Math.min(segment.start.x, segment.end.x) - pad;
      const maxX = Math.max(segment.start.x, segment.end.x) + pad;
      const minY = Math.min(segment.start.y, segment.end.y) - pad;
      const maxY = Math.max(segment.start.y, segment.end.y) + pad;
      const blocks = [...world.blocks.values()];
      for (const block of blocks) {
        const pos = blockPosition(block);
        if (pos.x + world.cell < minX || pos.x > maxX || pos.y + world.cell < minY || pos.y > maxY) continue;
        if (segmentRectDistanceSquared(segment.start, segment.end, pos.x, pos.y, world.cell, world.cell) <= hitRadius * hitRadius) {
          strikeBlock(block, dx, dy);
        }
      }
    }
    segments.length = 0;
  }

  function collapseUnsupported() {
    const world = state.world;
    const grounded = new Set();
    const queue = [];
    for (const block of world.blocks.values()) {
      if (block.row === 0) {
        grounded.add(block.key);
        queue.push(block);
      }
    }
    for (let i = 0; i < queue.length; i += 1) {
      const block = queue[i];
      const neighbors = [
        [block.col - 1, block.row], [block.col + 1, block.row],
        [block.col, block.row - 1], [block.col, block.row + 1]
      ];
      for (const [col, row] of neighbors) {
        const key = keyFor(col, row);
        if (grounded.has(key)) continue;
        const neighbor = world.blocks.get(key);
        if (neighbor) {
          grounded.add(key);
          queue.push(neighbor);
        }
      }
    }
    const loose = [];
    for (const block of world.blocks.values()) if (!grounded.has(block.key)) loose.push(block);
    for (const block of loose) {
      const position = removeBlock(block);
      if (!position) continue;
      spawnWholeBlock(block, (random() - .5) * 45, 15 + random() * 50, .7, true);
      if (random() < .21) makeShards(position.centerX, position.centerY, block.hue, .32, 1);
    }
    state.needsCollapse = false;
  }

  function collideFallingPiece(piece, dt) {
    if (state.mode !== 'playing') return;
    if (!piece.whole || piece.impactCooldown > 0 || piece.vy < 180) return;
    const world = state.world;
    const col = Math.floor((piece.x - world.left) / world.cell);
    const row = Math.floor((world.baseY - piece.y) / world.cell) - 1;
    for (let y = row - 1; y <= row + 1; y += 1) {
      for (let x = col - 1; x <= col + 1; x += 1) {
        const block = world.blocks.get(keyFor(x, y));
        if (!block) continue;
        const pos = blockPosition(block);
        if (piece.x + piece.size * .38 < pos.x || piece.x - piece.size * .38 > pos.x + world.cell) continue;
        if (piece.y + piece.size * .38 < pos.y || piece.y - piece.size * .38 > pos.y + world.cell) continue;
        const removed = removeBlock(block);
        if (!removed) continue;
        awardBlock(removed.centerX, removed.centerY);
        makeShards(removed.centerX, removed.centerY, block.hue, .72, 5);
        if (block.bomb) detonateBomb(block, removed.centerX, removed.centerY);
        piece.vy *= -.22;
        piece.vx += (piece.x - removed.centerX) * 2.4;
        piece.impactCooldown = .13;
        state.needsCollapse = true;
        return;
      }
    }
  }

  function updateDebris(dt) {
    const world = state.world;
    for (let i = state.debris.length - 1; i >= 0; i -= 1) {
      const piece = state.debris[i];
      piece.life -= dt;
      piece.impactCooldown = Math.max(0, piece.impactCooldown - dt);
      piece.vy += 850 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.rot += piece.vr * dt;
      collideFallingPiece(piece, dt);

      if (piece.y + piece.size * .5 >= world.groundY) {
        piece.y = world.groundY - piece.size * .5;
        if (piece.whole && piece.scoring && !piece.scored) {
          piece.scored = true;
          piece.whole = false;
          awardBlock(piece.x, piece.y);
          makeShards(piece.x, piece.y, piece.hue, .8, 5);
        }
        if (Math.abs(piece.vy) > 92) {
          const burstCount = piece.whole ? 5 : 1;
          makeShards(piece.x, piece.y + piece.size * .4, piece.hue, Math.min(1.3, Math.abs(piece.vy) / 280), burstCount);
          if (piece.whole && Math.abs(piece.vy) > 205) state.hitStop = Math.max(state.hitStop, .012);
          piece.bounces += 1;
          piece.vy *= -.28;
          piece.vx *= .74;
        } else {
          piece.vy = 0;
          piece.vx *= Math.exp(-5 * dt);
        }
        if (piece.whole && piece.bounces >= 2) piece.whole = false;
      }
      piece.vx *= Math.exp(-.22 * dt);
      if (piece.life <= 0 || piece.y > state.height + world.cell * 3 || (Math.abs(piece.vx) < 4 && Math.abs(piece.vy) < 9 && piece.y >= world.groundY - piece.size)) {
        state.debris.splice(i, 1);
      }
    }
  }

  function updateEffects(dt) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= dt;
      if (particle.ring) {
        const t = 1 - Math.max(0, particle.life) / particle.maxLife;
        particle.radius = 5 + (particle.maxRadius - 5) * t;
      } else {
        particle.vy += particle.gravity * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.rot += particle.vr * dt;
        particle.vx *= Math.exp(-.35 * dt);
      }
      if (particle.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.popups.length - 1; i >= 0; i -= 1) {
      const popup = state.popups[i];
      popup.life -= dt;
      popup.y += popup.vy * dt;
      if (popup.life <= 0) state.popups.splice(i, 1);
    }
  }

  function drawDebris() {
    for (const piece of state.debris) {
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.fillStyle = `hsl(${piece.hue} 84% ${piece.light || 61}%)`;
      ctx.fillRect(-piece.size * .5, -piece.size * .5, piece.size, piece.size);
      ctx.fillStyle = 'rgba(255,255,255,.38)';
      ctx.fillRect(-piece.size * .5, -piece.size * .5, piece.size, Math.max(1.5, piece.size * .12));
      ctx.restore();
    }
  }

  function drawEffects() {
    for (const particle of state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      if (particle.ring) {
        ctx.strokeStyle = `hsla(${particle.hue} 100% 72% / ${alpha})`;
        ctx.lineWidth = Math.max(1, 8 * alpha);
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = `hsl(${particle.hue} 100% 66%)`;
      if (particle.square) {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        ctx.fillRect(-particle.size * .5, -particle.size * .5, particle.size, particle.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const popup of state.popups) {
      const alpha = clamp(popup.life / popup.maxLife, 0, 1);
      const scale = popup.scale * (1 + (1 - alpha) * .18);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(popup.x, popup.y);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `1000 ${popup.text.includes('コンボ') ? 13 : 21}px ui-rounded, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(25,14,57,.85)';
      ctx.strokeText(popup.text, 0, 0);
      ctx.fillStyle = `hsl(${popup.hue} 100% 70%)`;
      ctx.fillText(popup.text, 0, 0);
      ctx.restore();
    }
  }

  function drawRainbow() {
    const level = clamp((state.combo - 3) / 14, 0, 1);
    if (level <= 0 || state.mode !== 'playing') return;
    const shift = (state.elapsed * 85) % 360;
    const gradient = ctx.createLinearGradient(0, 0, state.width, state.height * .65);
    for (let i = 0; i <= 6; i += 1) gradient.addColorStop(i / 6, `hsla(${(shift + i * 60) % 360} 100% 62% / .28)`);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = .08 + level * (.06 + (Math.sin(state.elapsed * 20) + 1) * .025);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateHud(force = false) {
    const roundedTenths = Math.ceil(Math.max(0, state.secondsLeft) * 10) / 10;
    const tenths = Math.max(0, Math.min(15, roundedTenths));
    const value = tenths.toFixed(1);
    if (force || state.lastUiTime !== value) {
      timeValue.textContent = value;
      timeBar.style.transform = `scaleX(${Math.max(0, state.secondsLeft / GAME_SECONDS)})`;
      state.lastUiTime = value;
    }
    scoreValue.textContent = formatScore(state.score);
    stageValue.textContent = `街 ${String(state.stage).padStart(2, '0')}`;
    const multiplier = Math.max(1, 1 + Math.floor((state.combo - 1) / 4));
    if (state.combo >= 2 && state.comboTimer > 0) {
      comboReadout.classList.add('visible');
      comboReadout.innerHTML = `<small>${state.combo}連続</small> ×${multiplier}`;
      comboReadout.style.color = `hsl(${(48 + state.combo * 33) % 360} 100% 72%)`;
    } else {
      comboReadout.classList.remove('visible');
      comboReadout.textContent = '';
    }
  }

  function finishGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'over';
    state.secondsLeft = 0;
    state.pointer.down = false;
    state.pointer.segments.length = 0;
    state.debris.length = 0;
    state.needsCollapse = false;
    if (state.score > state.best) {
      state.best = state.score;
      try { window.localStorage.setItem(STORAGE_KEY, String(state.best)); } catch (_) { /* Storage can be unavailable in private browsing. */ }
    }
    finalScore.textContent = formatScore(state.score);
    bestScore.textContent = formatScore(state.best);
    hud.hidden = true;
    resultOverlay.hidden = false;
    vibrate([25, 30, 38]);
  }

  function startGame() {
    unlockAudio();
    lastFrame = performance.now();
    state.mode = 'playing';
    state.score = 0;
    state.secondsLeft = GAME_SECONDS;
    state.stage = 1;
    state.combo = 0;
    state.comboTimer = 0;
    state.hitStop = 0;
    state.shake = 0;
    state.particles.length = 0;
    state.debris.length = 0;
    state.popups.length = 0;
    state.pointer.down = false;
    state.pointer.segments.length = 0;
    state.lastUiTime = -1;
    buildCity();
    titleOverlay.hidden = true;
    resultOverlay.hidden = true;
    hud.hidden = false;
    updateHud(true);
  }

  function update(dt, wallDt) {
    state.elapsed += dt;
    if (state.mode === 'playing') {
      state.secondsLeft -= wallDt;
      if (state.secondsLeft <= 0) {
        finishGame();
        return;
      }
      if (state.hitStop > 0) {
        state.hitStop = Math.max(0, state.hitStop - dt);
        updateHud();
        return;
      }
      if (state.comboTimer > 0) {
        state.comboTimer -= dt;
        if (state.comboTimer <= 0) state.combo = 0;
      }
      processPointerSegments();
      updateDebris(dt);
      if (state.needsCollapse) collapseUnsupported();
      if (state.world.blocks.size === 0) {
        state.stage += 1;
        addPopup(state.width * .5, state.height * .47, '街クリア！', 177, 1.55);
        state.shake = Math.max(state.shake, 6);
        buildCity();
      }
      updateHud();
    } else if (state.mode === 'title') {
      updateDebris(dt);
    }
    updateEffects(dt);
    state.shake *= Math.exp(-7 * dt);
    if (state.shake < .08) state.shake = 0;
  }

  function render() {
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    const reduced = reduceMotion.matches;
    const shake = state.shake * (reduced ? .17 : 1);
    const offsetX = shake ? (random() - .5) * shake * 2 : 0;
    const offsetY = shake ? (random() - .5) * shake * 2 : 0;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    drawBackground(state.elapsed);
    drawWorld(state.elapsed);
    drawDebris();
    drawEffects();
    ctx.restore();
    drawRainbow();
  }

  let lastFrame = performance.now();
  function frame(now) {
    const wallDt = Math.max(0, (now - lastFrame) / 1000);
    const dt = Math.min(.034, wallDt);
    lastFrame = now;
    update(dt, wallDt);
    render();
    window.requestAnimationFrame(frame);
  }

  function pointerPoint(event) { return { x: event.clientX, y: event.clientY }; }

  canvas.addEventListener('pointerdown', event => {
    if (state.mode !== 'playing' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    state.pointer.down = true;
    state.pointer.id = event.pointerId;
    state.pointer.last = pointerPoint(event);
    state.pointer.segments.push({ start: state.pointer.last, end: state.pointer.last });
    if (state.pointer.segments.length > 36) state.pointer.segments.shift();
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Capture is optional on older browsers. */ }
  }, { passive: false });

  canvas.addEventListener('pointermove', event => {
    if (!state.pointer.down || event.pointerId !== state.pointer.id) return;
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    for (const part of events) {
      const next = pointerPoint(part);
      if (state.pointer.last) state.pointer.segments.push({ start: state.pointer.last, end: next });
      state.pointer.last = next;
      if (state.pointer.segments.length > 36) state.pointer.segments.shift();
    }
  }, { passive: false });

  function stopPointer(event) {
    if (!state.pointer.down || event.pointerId !== state.pointer.id) return;
    state.pointer.down = false;
    state.pointer.id = null;
    state.pointer.last = null;
  }
  canvas.addEventListener('pointerup', stopPointer);
  canvas.addEventListener('pointercancel', stopPointer);
  canvas.addEventListener('lostpointercapture', stopPointer);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('contextmenu', event => event.preventDefault());

  function unlockAudio() {
    if (!state.sound) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      try { state.sound = new AudioContextClass(); } catch (_) { return; }
    }
    if (state.sound.state === 'suspended') state.sound.resume().catch(() => {});
  }

  function playHitSound(multiplier) {
    if (!state.sound || state.sound.state !== 'running') return;
    const now = state.sound.currentTime;
    if (now - state.lastSoundAt < .032) return;
    state.lastSoundAt = now;
    const oscillator = state.sound.createOscillator();
    const gain = state.sound.createGain();
    const comboPitch = Math.min(state.combo, 22) * 24;
    const frequency = Math.min(1500, 250 + comboPitch + multiplier * 28);
    oscillator.type = state.combo > 5 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(90, frequency * .72), now + .095);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.min(.17, .075 + multiplier * .018), now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .11);
    oscillator.connect(gain);
    gain.connect(state.sound.destination);
    oscillator.start(now);
    oscillator.stop(now + .115);
  }

  function soundExplosion() {
    if (!state.sound || state.sound.state !== 'running') return;
    const now = state.sound.currentTime;
    const oscillator = state.sound.createOscillator();
    const gain = state.sound.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(105, now);
    oscillator.frequency.exponentialRampToValueAtTime(37, now + .34);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.24, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .39);
    oscillator.connect(gain);
    gain.connect(state.sound.destination);
    oscillator.start(now);
    oscillator.stop(now + .4);
  }

  function vibrate(pattern) {
    const now = state.elapsed;
    if (now - state.lastBuzzAt < .085) return;
    if (typeof navigator.vibrate !== 'function') return;
    state.lastBuzzAt = now;
    try { navigator.vibrate(pattern); } catch (_) { /* Haptics are optional. */ }
  }

  document.getElementById('startButton').addEventListener('click', startGame);
  document.getElementById('replayButton').addEventListener('click', startGame);
  window.addEventListener('resize', setupCanvas, { passive: true });
  window.addEventListener('orientationchange', setupCanvas, { passive: true });
  setupCanvas();
  window.requestAnimationFrame(frame);
})();
