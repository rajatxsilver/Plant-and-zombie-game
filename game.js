/* game.js — Garden Defense (upgraded, embedded small SVG sprites) */

/* ---------- Embedded small SVG sprites as data-URIs (optional) ---------- */
/* These are tiny inline SVGs so you have "embedded" graphics if you want to use them.
   The game primarily draws using Canvas shapes; images are provided for extensibility.
*/
const SPRITES = {
    peashooter: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect rx="10" ry="10" width="64" height="64" fill="#6ee7b7"/><circle cx="48" cy="32" r="10" fill="#0a1a28"/></svg>`
    ),
    sunflower: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="10" fill="#ffd166"/><circle cx="32" cy="32" r="12" fill="#ffb703"/></svg>`
    ),
    zombie: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="10" fill="#ff6b6b"/><circle cx="22" cy="24" r="4" fill="#0a1a28"/><circle cx="42" cy="24" r="4" fill="#0a1a28"/></svg>`
    )
};

// Preload images (optional)
const IMGS = {};
for (const k in SPRITES) {
    const img = new Image();
    img.src = SPRITES[k];
    IMGS[k] = img;
}

/* ---------- Game configuration (same behaviour you approved) ---------- */
const COLS = 9, ROWS = 5;
const TILE_W = 100, TILE_H = 100;
const WAVES_TOTAL = 5;

const PLANTS = {
    peashooter: { cost: 100, hp: 5, fireRate: 1400, type: 'attack', volley: 1 },
    twinpea: { cost: 175, hp: 6, fireRate: 1200, type: 'attack', volley: 2 },
    sunflower: { cost: 50, hp: 4, sunRate: 9000, type: 'support' },
    cherry: { cost: 150, hp: 1, arm: 1000, type: 'bomb', radius: 120, dmg: 999 },
    wallnut: { cost: 50, hp: 20, type: 'block' },
};

const ENEMIES = {
    shambling: { speed: 0.040, hp: 6, dmg: 0.25, eatRate: 500, color: '#ff6b6b' },
    fast: { speed: 0.065, hp: 4, dmg: 0.25, eatRate: 450, color: '#ff9f6e' },
    armored: { speed: 0.034, hp: 11, dmg: 0.25, eatRate: 520, color: '#e25555' },
    tank: { speed: 0.028, hp: 18, dmg: 0.35, eatRate: 520, color: '#d94a4a' },
};

const SUN_PICKUP = { amount: 25, r: 18, fallMin: 220, fallMax: 440, skyCooldown: [7000, 11000] };

/* ---------- Game state ---------- */
const state = {
    grid: [...Array(ROWS)].map(() => Array(COLS).fill(null)),
    bullets: [],
    enemies: [],
    suns: 10000,               // start with 10000 as requested
    selected: 'peashooter',
    running: false,
    lastTime: 0,
    wave: 1,
    inWave: false,
    gameOver: false,
    pickups: [],
    explosions: [],
    skySunTimer: 0,
    targetSkySun: rand(...SUN_PICKUP.skyCooldown),
    timers: [],
    muted: false,
    audioCtx: null
};

/* ---------- Canvas / DOM references ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const sunLabel = document.getElementById('sunLabel');
const waveLabel = document.getElementById('waveLabel');

/* ---------- Audio helpers ---------- */
function ensureAudio() {
    if (!state.audioCtx) {
        try { state.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { state.audioCtx = null; }
    }
}
function sfx(type) {
    if (state.muted || !state.audioCtx) return;
    const ctxA = state.audioCtx;
    const o = ctxA.createOscillator();
    const g = ctxA.createGain();
    o.connect(g); g.connect(ctxA.destination);
    const now = ctxA.currentTime;
    let f1 = 500, f2 = 0.001, dur = 0.08;
    if (type === 'shoot') { f1 = 740; f2 = 280; dur = 0.06; }
    else if (type === 'sun') { f1 = 660; f2 = 880; dur = 0.09; }
    else if (type === 'boom') { f1 = 120; f2 = 60; dur = 0.35; }
    else if (type === 'hit') { f1 = 320; f2 = 220; dur = 0.04; }
    else if (type === 'place') { f1 = 520; f2 = 420; dur = 0.06; }
    else if (type === 'error') { f1 = 220; f2 = 180; dur = 0.12; }
    else if (type === 'win') { f1 = 660; f2 = 990; dur = 0.4; }
    o.frequency.setValueAtTime(f1, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), now + dur);
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now); o.stop(now + dur);
}

/* ---------- Utilities ---------- */
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const LANE_Y = i => i * TILE_H;
function tileFromMouse(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (evt.clientX - rect.left) * scaleX;
    const y = (evt.clientY - rect.top) * scaleY;
    const c = Math.floor(x / TILE_W);
    const r = Math.floor(y / TILE_H);
    return { r, c, x, y };
}
function canPlace(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS && !state.grid[r][c]; }

/* ---------- Placement ---------- */
function placePlant(type, r, c) {
    const def = PLANTS[type];
    if (!def) return false;
    if (state.suns < def.cost) { flashOverlay('Not enough ☀️'); sfx('error'); return false; }
    state.suns -= def.cost;
    const plant = { type, hp: def.hp, r, c, lastFire: 0, lastSun: 0, armed: 0 };
    state.grid[r][c] = plant; sfx('place');
    if (type === 'cherry') {
        state.timers.push(setTimeout(() => {
            makeExplosion(c * TILE_W + TILE_W / 2, r * TILE_H + TILE_H / 2, def.radius, def.dmg);
            state.grid[r][c] = null;
        }, def.arm));
    }
    return true;
}
function removePlant(r, c) { if (state.grid[r][c]) state.grid[r][c] = null; }

/* ---------- Enemies & Waves ---------- */
function spawnEnemy(row, kind = 'shambling', boost = 1) {
    const base = ENEMIES[kind] || ENEMIES.shambling;
    const e = {
        x: canvas.width + 10,
        y: LANE_Y(row) + TILE_H / 2,
        lane: row,
        hp: base.hp * (1 + 0.12 * (boost - 1)),
        speed: base.speed * (1 + 0.06 * (boost - 1)),
        eatTimer: 0,
        kind,
        color: base.color
    };
    state.enemies.push(e);
}

function spawnWave() {
    if (state.inWave || state.gameOver) return;
    state.inWave = true;
    const W = state.wave;
    const count = 5 + W * 2;
    for (let i = 0; i < count; i++) {
        const delay = 600 + i * 450 + Math.random() * 600;
        const lane = Math.floor(Math.random() * ROWS);
        const pool = W >= 4 ? ['fast', 'armored', 'tank', 'shambling'] : W >= 3 ? ['fast', 'armored', 'shambling'] : W >= 2 ? ['fast', 'shambling'] : ['shambling'];
        const kind = pool[Math.floor(Math.random() * pool.length)];
        const boost = 1 + Math.floor(i / 5) + (W - 1) * 0.3;
        state.timers.push(setTimeout(() => spawnEnemy(lane, kind, boost), delay));
    }
    flashOverlay(`Wave ${state.wave} incoming!`);
}

function checkWaveClear() {
    if (state.inWave && state.enemies.length === 0 && timersFinished()) {
        state.inWave = false;
        state.wave++;
        if (state.wave > WAVES_TOTAL) { winGame(); }
    }
}
function timersFinished() { return true; } // simplified for this build

/* ---------- Bullets ---------- */
function shoot(plant) {
    const def = PLANTS[plant.type];
    const baseX = plant.c * TILE_W + 70;
    const y = plant.r * TILE_H + TILE_H / 2;
    const volley = Math.max(1, def.volley || 1);
    for (let i = 0; i < volley; i++) {
        state.bullets.push({ x: baseX, y: y + (i - (volley - 1) / 2) * 10, v: 0.4, dmg: 1, lane: plant.r });
    }
    sfx('shoot');
}

/* ---------- Suns ---------- */
function dropSkySun() {
    const x = rand(0, canvas.width - 40) + 20;
    const stopY = rand(SUN_PICKUP.fallMin, SUN_PICKUP.fallMax);
    state.pickups.push({ x, y: -20, vy: 0.06, stopY, r: SUN_PICKUP.r, amount: SUN_PICKUP.amount, life: 12000, type: 'sun' });
}
function spawnSunFromPlant(plant) { state.suns += SUN_PICKUP.amount; sfx('sun'); } // auto-add to storage

function tryCollectSun(px, py) {
    for (let i = state.pickups.length - 1; i >= 0; i--) {
        const p = state.pickups[i]; if (p.type !== 'sun') continue;
        const dx = p.x - px, dy = p.y - py;
        if (dx * dx + dy * dy <= (p.r + 8) * (p.r + 8)) {
            state.suns += p.amount; state.pickups.splice(i, 1); sfx('sun');
            return true;
        }
    }
    return false;
}

/* ---------- Explosions ---------- */
function makeExplosion(x, y, radius, dmg) {
    sfx('boom');
    state.explosions.push({ x, y, r: 10, R: radius, t: 0, T: 380 });
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        const dx = e.x - x, dy = e.y - y; if (dx * dx + dy * dy <= radius * radius) { e.hp -= dmg; if (e.hp <= 0) state.enemies.splice(i, 1); }
    }
}

/* ---------- Update & Draw ---------- */
function update(dt) {
    if (!state.running || state.gameOver) return;

    state.skySunTimer += dt;
    if (state.skySunTimer > state.targetSkySun) {
        dropSkySun(); state.skySunTimer = 0; state.targetSkySun = rand(...SUN_PICKUP.skyCooldown);
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = state.grid[r][c];
            if (!p) continue;
            const def = PLANTS[p.type];
            if (p.type === 'peashooter' || p.type === 'twinpea') {
                p.lastFire += dt;
                const enemyAhead = state.enemies.some(e => e.lane === r && e.x > c * TILE_W);
                if (enemyAhead && p.lastFire > def.fireRate) { shoot(p); p.lastFire = 0; }
            } else if (p.type === 'sunflower') {
                p.lastSun += dt;
                if (p.lastSun > def.sunRate) { spawnSunFromPlant(p); p.lastSun = 0; }
            }
        }
    }

    for (let i = state.pickups.length - 1; i >= 0; i--) {
        const p = state.pickups[i]; p.life -= dt; if (p.vy && p.y < p.stopY) p.y += p.vy * dt; if (p.life <= 0) state.pickups.splice(i, 1);
    }

    for (let i = state.bullets.length - 1; i >= 0; i--) {
        const b = state.bullets[i];
        b.x += b.v * dt;
        const enemy = state.enemies.find(e => e.lane === b.lane && e.x - 18 < b.x);
        if (enemy) { enemy.hp -= b.dmg; sfx('hit'); state.bullets.splice(i, 1); continue; }
        if (b.x > canvas.width) state.bullets.splice(i, 1);
    }

    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        const tileC = Math.floor((e.x - 40) / TILE_W);
        const tileR = e.lane;
        const plant = (tileC >= 0 && tileC < COLS) ? state.grid[tileR][tileC] : null;
        if (plant) {
            e.eatTimer += dt;
            const base = ENEMIES[e.kind] || ENEMIES.shambling;
            if (e.eatTimer > base.eatRate) {
                plant.hp -= base.dmg; e.eatTimer = 0;
                if (plant.hp <= 0) state.grid[tileR][tileC] = null;
            }
        } else { e.x -= e.speed * dt; }

        if (e.hp <= 0) { state.enemies.splice(i, 1); continue; }
        if (e.x < 10) { gameOver(); return; }
    }

    checkWaveClear();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? getComputedStyle(document.documentElement).getPropertyValue('--tile') : getComputedStyle(document.documentElement).getPropertyValue('--tile-alt');
            ctx.fillRect(c * TILE_W, r * TILE_H, TILE_W, TILE_H);
        }
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = state.grid[r][c]; if (!p) continue;
            const x = c * TILE_W + 10, y = r * TILE_H + 10;
            ctx.fillStyle = '#2ecc71';
            ctx.fillRect(x + 20, y + TILE_H - 40, 10, 30);

            if (p.type === 'peashooter' || p.type === 'twinpea') {
                // prefer sprite if loaded
                if (IMGS.peashooter && IMGS.peashooter.complete) ctx.drawImage(IMGS.peashooter, x + 28, y + 28, 40, 40);
                else { ctx.fillStyle = '#6ee7b7'; roundedRect(x + 35, y + 30, 40, 40, 12); ctx.fill(); ctx.fillStyle = '#0a1a28'; ctx.beginPath(); ctx.arc(x + 75, y + 50, 8, -0.2, 0.2); ctx.fill(); }
                if (p.type === 'twinpea') { ctx.fillRect(x + 38, y + 24, 36, 6); }
            } else if (p.type === 'sunflower') {
                if (IMGS.sunflower && IMGS.sunflower.complete) ctx.drawImage(IMGS.sunflower, x + 18, y + 20, 52, 52);
                else { for (let k = 0; k < 12; k++) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.ellipse(x + 45, y + 50, 10, 20, k * Math.PI / 6, 0, 2 * Math.PI); ctx.fill(); } ctx.fillStyle = '#ffb703'; ctx.beginPath(); ctx.arc(x + 45, y + 50, 16, 0, 2 * Math.PI); ctx.fill(); }
            } else if (p.type === 'wallnut') {
                ctx.fillStyle = '#b08857'; roundedRect(x + 20, y + 28, 50, 54, 14); ctx.fill();
                ctx.fillStyle = '#5b3b1d'; ctx.fillRect(x + 36, y + 56, 6, 6); ctx.fillRect(x + 54, y + 56, 6, 6);
            } else if (p.type === 'cherry') {
                ctx.fillStyle = '#ff4d6d'; roundedRect(x + 32, y + 44, 22, 22, 6); ctx.fill();
                ctx.fillStyle = '#ff4d6d'; roundedRect(x + 50, y + 34, 22, 22, 6); ctx.fill();
            }

            const def = PLANTS[p.type];
            ctx.fillStyle = '#0b1a28'; ctx.fillRect(x + 12, y + 8, 70, 6);
            ctx.fillStyle = '#59d2fe'; ctx.fillRect(x + 12, y + 8, 70 * (p.hp / def.hp), 6);
        }
    }

    for (const p of state.pickups) {
        if (p.type === 'sun') {
            const grd = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
            grd.addColorStop(0, '#fff3b0'); grd.addColorStop(1, '#ffd166');
            ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI); ctx.fill();
        }
    }

    for (const b of state.bullets) {
        ctx.fillStyle = '#9be7ff'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 2 * Math.PI); ctx.fill();
    }

    for (const e of state.enemies) {
        const x = e.x, y = e.y;
        if (IMGS.zombie && IMGS.zombie.complete) ctx.drawImage(IMGS.zombie, x - 28, y - 28, 56, 56);
        else { ctx.fillStyle = e.color; roundedRect(x - 28, y - 28, 56, 56, 12); ctx.fill(); ctx.fillStyle = '#0a1a28'; ctx.beginPath(); ctx.arc(x - 10, y - 6, 4, 0, 2 * Math.PI); ctx.fill(); ctx.beginPath(); ctx.arc(x + 10, y - 6, 4, 0, 2 * Math.PI); ctx.fill(); ctx.fillRect(x - 10, y + 8, 20, 4); }
        const maxHP = Math.max(ENEMIES[e.kind]?.hp || 6, 6) * 1.8;
        ctx.fillStyle = '#0b1a28'; ctx.fillRect(x - 24, y - 34, 48, 5);
        ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 24, y - 34, 48 * (e.hp / maxHP), 5);
    }

    for (let i = state.explosions.length - 1; i >= 0; i--) {
        const ex = state.explosions[i]; ex.t += 16; ex.r = Math.min(ex.R, ex.r + 7);
        ctx.strokeStyle = 'rgba(255,220,120,.7)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, 2 * Math.PI); ctx.stroke();
        if (ex.t > ex.T) state.explosions.splice(i, 1);
    }

    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    for (let r = 1; r < ROWS; r++) { line(0, r * TILE_H, canvas.width, r * TILE_H); }
    for (let c = 1; c < COLS; c++) { line(c * TILE_W, 0, c * TILE_H, c * TILE_W); }
}

function roundedRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function loop(ts) {
    if (!state.lastTime) state.lastTime = ts;
    const dt = ts - state.lastTime; state.lastTime = ts;
    if (state.running) update(dt);
    sunLabel.textContent = `Sun: ${state.suns}`;
    waveLabel.textContent = `Wave ${Math.min(state.wave, WAVES_TOTAL)} / ${WAVES_TOTAL}`;
    draw();
    requestAnimationFrame(loop);
}

/* ---------- UI events ---------- */
document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.selected = card.dataset.plant || 'shovel';
    });
});
document.querySelector('.card[data-plant="peashooter"]').classList.add('selected');

canvas.addEventListener('click', (e) => {
    const { r, c, x, y } = tileFromMouse(e);
    if (tryCollectSun(x, y)) return;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    if (state.selected === 'shovel') { removePlant(r, c); return; }
    if (canPlace(r, c)) { placePlant(state.selected, r, c); } else { flashOverlay('Tile occupied'); sfx('error'); }
});

document.getElementById('startBtn').addEventListener('click', () => {
    if (state.gameOver) return;
    ensureAudio();
    if (!state.running) { state.running = true; overlay.style.display = 'none'; }
    if (!state.inWave) spawnWave();
});

document.getElementById('pauseBtn').addEventListener('click', () => {
    state.running = !state.running;
    overlay.style.display = state.running ? 'none' : 'flex';
    overlayText.textContent = state.running ? '' : 'Paused';
});

document.getElementById('resetBtn').addEventListener('click', resetGame);
document.getElementById('muteToggle').addEventListener('change', (e) => {
    state.muted = e.target.checked; if (!state.muted) ensureAudio();
});

function flashOverlay(text, ms = 900) {
    overlayText.textContent = text; overlay.style.display = 'flex';
    setTimeout(() => { if (state.running) overlay.style.display = 'none'; }, ms);
}

function winGame() { state.gameOver = true; state.running = false; sfx('win'); overlayText.textContent = 'You Win! 🏆 — press Reset to play again'; overlay.style.display = 'flex'; disableStart(); }
function gameOver() { state.gameOver = true; state.running = false; overlayText.textContent = 'Game Over 🌧️ — press Reset'; overlay.style.display = 'flex'; disableStart(); }
function disableStart() { document.getElementById('startBtn').disabled = true; }
function enableStart() { document.getElementById('startBtn').disabled = false; }
function clearTimers() { state.timers.forEach(t => clearTimeout(t)); state.timers.length = 0; }

function resetGame() {
    clearTimers(); enableStart();
    state.grid = [...Array(ROWS)].map(() => Array(COLS).fill(null));
    state.bullets = []; state.enemies = []; state.pickups = []; state.explosions = [];
    state.suns = 10000; state.running = false; state.gameOver = false; state.wave = 1; state.inWave = false; state.lastTime = 0; state.skySunTimer = 0; state.targetSkySun = rand(...SUN_PICKUP.skyCooldown);
    overlayText.textContent = 'Reset — click Start'; overlay.style.display = 'flex';
}

/* start render loop */
requestAnimationFrame(loop);
