(function () {
  "use strict";

  var canvas = document.getElementById("slalom-canvas");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var startBtn = document.getElementById("slalom-start");
  var pauseBtn = document.getElementById("slalom-pause");
  var clearedEl = document.getElementById("slalom-cleared");
  var missedEl = document.getElementById("slalom-missed");

  var W = canvas.width;
  var H = canvas.height;

  var state = {
    running: false,
    paused: false,
    skierX: W / 2,
    skierY: H * 0.78,
    skierVX: 0,
    inputDir: 0, // -1 left, 0, +1 right
    pointerActive: false,
    pointerX: null,
    gates: [],
    nextGateIn: 90, // frames until next gate spawns
    cleared: 0,
    missed: 0,
    flashFrames: 0,
    snowflakes: [],
    lastTs: 0
  };

  var SKIER_WIDTH = 14;
  var SKIER_HEIGHT = 22;
  var SKIER_MAX_SPEED = 3.2;
  var SKIER_ACCEL = 0.45;
  var SKIER_FRICTION = 0.82;
  var SCROLL_SPEED = 2.2;
  var GATE_GAP_MIN = 60;
  var GATE_GAP_MAX = 90;
  var GATE_INTERVAL_MIN = 70;
  var GATE_INTERVAL_MAX = 110;
  var SNOWFLAKE_COUNT = 22;

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function spawnGate() {
    var gap = rand(GATE_GAP_MIN, GATE_GAP_MAX);
    var centerX = rand(gap / 2 + 12, W - gap / 2 - 12);
    state.gates.push({
      y: -10,
      centerX: centerX,
      gap: gap,
      scored: false
    });
  }

  function seedSnowflakes() {
    state.snowflakes.length = 0;
    for (var i = 0; i < SNOWFLAKE_COUNT; i++) {
      state.snowflakes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(0.6, 1.8),
        vy: rand(0.4, 1.1)
      });
    }
  }

  function reset() {
    state.skierX = W / 2;
    state.skierY = H * 0.78;
    state.skierVX = 0;
    state.inputDir = 0;
    state.gates.length = 0;
    state.nextGateIn = 40;
    state.cleared = 0;
    state.missed = 0;
    state.flashFrames = 0;
    seedSnowflakes();
    updateScore();
  }

  function updateScore() {
    if (clearedEl) clearedEl.textContent = String(state.cleared);
    if (missedEl) missedEl.textContent = String(state.missed);
  }

  function step() {
    // Snow drift
    for (var i = 0; i < state.snowflakes.length; i++) {
      var s = state.snowflakes[i];
      s.y += s.vy + SCROLL_SPEED * 0.4;
      if (s.y > H) {
        s.y = -2;
        s.x = Math.random() * W;
      }
    }

    // Spawn gates
    state.nextGateIn--;
    if (state.nextGateIn <= 0) {
      spawnGate();
      state.nextGateIn = Math.floor(rand(GATE_INTERVAL_MIN, GATE_INTERVAL_MAX));
    }

    // Move gates downward (slope scrolls past skier)
    for (var j = 0; j < state.gates.length; j++) {
      state.gates[j].y += SCROLL_SPEED;
    }

    // Steering input -> velocity
    var dir = state.inputDir;
    if (state.pointerActive && state.pointerX != null) {
      var dx = state.pointerX - state.skierX;
      if (Math.abs(dx) < 1) dir = 0;
      else dir = dx > 0 ? 1 : -1;
      // ease toward pointer rather than full accel for nicer feel
      state.skierVX += dir * SKIER_ACCEL * Math.min(1, Math.abs(dx) / 40);
    } else if (dir !== 0) {
      state.skierVX += dir * SKIER_ACCEL;
    } else {
      state.skierVX *= SKIER_FRICTION;
      if (Math.abs(state.skierVX) < 0.05) state.skierVX = 0;
    }

    if (state.skierVX > SKIER_MAX_SPEED) state.skierVX = SKIER_MAX_SPEED;
    if (state.skierVX < -SKIER_MAX_SPEED) state.skierVX = -SKIER_MAX_SPEED;

    state.skierX += state.skierVX;
    // Keep skier on slope
    var halfW = SKIER_WIDTH / 2;
    if (state.skierX < halfW) {
      state.skierX = halfW;
      state.skierVX = 0;
    }
    if (state.skierX > W - halfW) {
      state.skierX = W - halfW;
      state.skierVX = 0;
    }

    // Gate scoring + cleanup
    var skierTopY = state.skierY - SKIER_HEIGHT / 2;
    for (var k = state.gates.length - 1; k >= 0; k--) {
      var g = state.gates[k];
      if (!g.scored && g.y >= skierTopY) {
        // Crossing the skier — judge it
        var leftPole = g.centerX - g.gap / 2;
        var rightPole = g.centerX + g.gap / 2;
        if (state.skierX >= leftPole && state.skierX <= rightPole) {
          state.cleared++;
        } else {
          state.missed++;
          state.flashFrames = 12;
        }
        g.scored = true;
        updateScore();
      }
      if (g.y > H + 30) {
        state.gates.splice(k, 1);
      }
    }

    if (state.flashFrames > 0) state.flashFrames--;
  }

  function draw() {
    // Slope background (subtle vertical stripes for motion)
    ctx.clearRect(0, 0, W, H);

    // Faint piste lines that scroll
    var stripeSpacing = 56;
    var offset = (performance.now() * 0.06) % stripeSpacing;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
    ctx.lineWidth = 1;
    for (var y = -stripeSpacing + offset; y < H; y += stripeSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Snowflakes
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    for (var i = 0; i < state.snowflakes.length; i++) {
      var s = state.snowflakes[i];
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gates
    for (var j = 0; j < state.gates.length; j++) {
      var g = state.gates[j];
      drawGate(g);
    }

    // Skier
    drawSkier(state.skierX, state.skierY, state.flashFrames > 0);

    // Paused overlay
    if (state.paused) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 18px system-ui, sans-serif";
      ctx.fillText("Paused", W / 2, H / 2);
    } else if (!state.running) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.fillText("Press Start", W / 2, H / 2);
    }
  }

  function drawGate(g) {
    var leftX = g.centerX - g.gap / 2;
    var rightX = g.centerX + g.gap / 2;
    // Flag pennants
    ctx.fillStyle = "#ef4444"; // red gate
    drawFlag(leftX, g.y, true);
    ctx.fillStyle = "#3b82f6"; // blue gate
    drawFlag(rightX, g.y, false);

    // Poles
    ctx.strokeStyle = "rgba(30, 41, 59, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftX, g.y - 6);
    ctx.lineTo(leftX, g.y + 14);
    ctx.moveTo(rightX, g.y - 6);
    ctx.lineTo(rightX, g.y + 14);
    ctx.stroke();
  }

  function drawFlag(x, y, pointsRight) {
    ctx.beginPath();
    if (pointsRight) {
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 12, y - 2);
      ctx.lineTo(x, y + 2);
    } else {
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 12, y - 2);
      ctx.lineTo(x, y + 2);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawSkier(x, y, flashing) {
    ctx.save();
    ctx.translate(x, y);
    // Skis
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, 10);
    ctx.lineTo(-5, -8);
    ctx.moveTo(5, 10);
    ctx.lineTo(5, -8);
    ctx.stroke();

    // Body
    ctx.fillStyle = flashing ? "#f97316" : "#0f172a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Helmet
    ctx.fillStyle = flashing ? "#fde68a" : "#2563eb";
    ctx.beginPath();
    ctx.arc(0, -8, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function loop() {
    if (!state.running) {
      draw();
      return;
    }
    if (!state.paused) step();
    draw();
    requestAnimationFrame(loop);
  }

  function start() {
    if (state.running && !state.paused) return;
    if (!state.running) reset();
    state.running = true;
    state.paused = false;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    pauseBtn.textContent = "Pause";
    requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    if (!state.paused) requestAnimationFrame(loop);
    else draw();
  }

  // Keyboard
  document.addEventListener("keydown", function (e) {
    if (!state.running) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      state.inputDir = -1;
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      state.inputDir = 1;
    } else if (e.key === " " || e.key === "p" || e.key === "P") {
      togglePause();
      e.preventDefault();
    }
  });
  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      if (state.inputDir === -1) state.inputDir = 0;
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      if (state.inputDir === 1) state.inputDir = 0;
    }
  });

  // Pointer / touch — drag horizontally inside the canvas
  function canvasPointerX(evt) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    return (evt.clientX - rect.left) * scaleX;
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (!state.running) return;
    state.pointerActive = true;
    state.pointerX = canvasPointerX(e);
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!state.pointerActive) return;
    state.pointerX = canvasPointerX(e);
  });
  function releasePointer(e) {
    state.pointerActive = false;
    state.pointerX = null;
    if (e && canvas.releasePointerCapture && e.pointerId != null) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("pointerleave", releasePointer);

  // Buttons
  if (startBtn) startBtn.addEventListener("click", start);
  if (pauseBtn) pauseBtn.addEventListener("click", togglePause);

  // Initial paint so the canvas isn't blank
  seedSnowflakes();
  draw();
})();
