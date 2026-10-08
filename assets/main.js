import { vertexSource, fragmentSource, fieldFragmentSource } from './shader.js?v=4bc47a37784f';

const canvas = document.querySelector('#scene');
const stage = document.querySelector('.world');
const heading = document.querySelector('.wordmark');
const wordmark = heading.querySelector('img');
const motionToggle = document.querySelector('.motion-toggle');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
await wordmark.decode();
let gl;
try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' }); } catch { /* Keep the HTML wordmark. */ }

if (gl) {
  try {
    start(gl);
  }
  catch (error) {
    canvas.style.visibility = 'hidden';
    document.documentElement.classList.remove('shader-ready');
    console.warn('Using the static TRIAC wordmark.', error);
  }
}

function start(gl) {
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  function makeProgram(source) {
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, source);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return program;
  }
  const program = makeProgram(fragmentSource);
  const fieldProgram = makeProgram(fieldFragmentSource);
  const fieldTime = gl.getUniformLocation(fieldProgram, 'time');
  const fieldViewport = gl.getUniformLocation(fieldProgram, 'viewport');
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const names = ['resolution', 'viewport', 'logo', 'time', 'pointer', 'hover', 'reveal', 'pulse', 'distanceMap', 'characters', 'fieldMap', 'fieldSize', 'metalRamp'];
  const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
  const mask = makeWordmark();
  texture(0, mask.width, mask.height, mask.data, gl.RGBA, gl.LINEAR);
  gl.uniform1i(uniforms.distanceMap, 0);

  const atlas = document.createElement('canvas');
  atlas.width = 256;
  atlas.height = 32;
  const ink = atlas.getContext('2d');
  ink.fillStyle = '#000';
  ink.fillRect(0, 0, atlas.width, atlas.height);
  ink.fillStyle = '#fff';
  ink.font = '22px monospace';
  ink.textAlign = 'center';
  ink.textBaseline = 'middle';
  [...'.:-=+*#@'].forEach((character, i) => ink.fillText(character, i * 32 + 16, 16));
  texture(1, atlas.width, atlas.height, atlas, gl.RGBA, gl.LINEAR);
  gl.uniform1i(uniforms.characters, 1);

  // A small baked reflection ramp replaces per-pixel lighting powers and trig.
  const ramp = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const angle = (i / 255 - .5) / .48;
    const horizon = Math.max(0, Math.min(1, (angle + .2) / .48));
    const blend = horizon * horizon * (3 - 2 * horizon);
    const ribbon = (.5 + .5 * Math.sin(angle * 12 + 2)) ** 3 * .75;
    const cyan = Math.exp(-(((angle - .2) / .3) ** 2));
    const violet = Math.exp(-(((angle + .25) / .25) ** 2));
    for (let c = 0; c < 3; c++) {
      const sky = [.035, .06, .095][c] * (1 - blend) + [.48, .62, .70][c] * blend;
      const value = sky * (1 - ribbon) + [.78, .88, .92][c] * ribbon
        + [.025, .10, .10][c] * cyan + [.06, .025, .085][c] * violet;
      ramp[i * 4 + c] = Math.round(Math.min(1, value) * 255);
    }
    ramp[i * 4 + 3] = 255;
  }
  texture(2, 256, 1, ramp, gl.RGBA, gl.LINEAR);
  gl.uniform1i(uniforms.metalRamp, 2);

  const fieldTexture = texture(3, 1, 1, null, gl.RGBA, gl.NEAREST);
  const fieldBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTexture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Cannot render the character field.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.uniform1i(uniforms.fieldMap, 3);
  let fieldWidth = 1;
  let fieldHeight = 1;

  function texture(unit, width, height, data, format, filter) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const value = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (data instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return value;
  }

  let elapsed = 0;
  let last = null;
  let nextDraw = 0;
  let frame = null;
  let paused = motion.matches;
  let lost = false;
  let visible = true;
  let viewWidth = stage.clientWidth;
  let viewHeight = stage.clientHeight;
  const target = { x: 0, y: 0, active: 0 };
  const pointer = { x: 0, y: 0, active: 0 };
  const pulse = { x: .5, y: .5, started: -10 };

  function draw() {
    if (lost) return;
    gl.useProgram(fieldProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fieldBuffer);
    gl.viewport(0, 0, fieldWidth, fieldHeight);
    gl.uniform1f(fieldTime, elapsed);
    gl.uniform2f(fieldViewport, viewWidth, viewHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.hover, pointer.active);
    gl.uniform1f(uniforms.reveal, motion.matches ? 1 : Math.min(1, elapsed / 2.2));
    gl.uniform3f(uniforms.pulse, pulse.x, pulse.y, elapsed - pulse.started);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function resize(render = true) {
    if (lost) return;
    viewWidth = stage.clientWidth;
    viewHeight = stage.clientHeight;
    // Match the screen's pixel density. Frame rate never lowers image quality.
    const ratio = Math.min(devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(viewWidth * ratio));
    const height = Math.max(1, Math.round(viewHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.viewport, viewWidth, viewHeight);
    const bounds = heading.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    gl.uniform4f(uniforms.logo, bounds.left - stageBounds.left, stageBounds.bottom - bounds.bottom, bounds.width, bounds.height);
    const cellScale = Math.max(.78, Math.min(1, viewWidth / 900));
    fieldWidth = Math.ceil(viewWidth / (9 * cellScale)) + 10;
    fieldHeight = Math.ceil(viewHeight / (14 * cellScale)) + 10;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fieldWidth, fieldHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.uniform2f(uniforms.fieldSize, fieldWidth, fieldHeight);
    if (render) draw();
  }

  function tick(now) {
    const interval = 1000 / 60;
    if (last === null) nextDraw = now;
    if (now + .5 >= nextDraw) {
      const delta = last === null ? interval : now - last;
      last = now;
      // Preserve the deadline instead of dropping frames on rounding at 60 Hz.
      nextDraw += interval * Math.max(1, Math.floor((now - nextDraw) / interval) + 1);
      const seconds = Math.min(delta, 100) / 1000;
      elapsed += seconds;
      const easing = 1 - Math.exp(-2 * seconds);
      pointer.x += (target.x - pointer.x) * easing;
      pointer.y += (target.y - pointer.y) * easing;
      pointer.active += (target.active - pointer.active) * easing;

      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    last = null;
    if (!paused && !document.hidden && !lost && visible) frame = requestAnimationFrame(tick);
  }

  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const bounds = stage.getBoundingClientRect();
    target.x = (event.clientX - bounds.left) / viewWidth - .5;
    target.y = .5 - (event.clientY - bounds.top) / viewHeight;
    target.active = 1;
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; target.active = 0; });
  stage.addEventListener('pointerdown', event => {
    if (paused) return;
    const bounds = stage.getBoundingClientRect();
    pulse.x = (event.clientX - bounds.left) / viewWidth;
    pulse.y = 1 - (event.clientY - bounds.top) / viewHeight;
    pulse.started = elapsed;
  });
  document.addEventListener('visibilitychange', sync);
  function updateMotionControl() {
    motionToggle.textContent = paused ? 'Play motion' : 'Pause motion';
    motionToggle.setAttribute('aria-label', paused ? 'Play background animation' : 'Pause background animation');
  }
  motionToggle.addEventListener('click', () => {
    paused = !paused;
    updateMotionControl();
    sync();
  });
  motion.addEventListener('change', event => { paused = event.matches; updateMotionControl(); draw(); sync(); });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    sync();
    document.documentElement.classList.remove('shader-ready');
    canvas.style.visibility = 'hidden';
    motionToggle.hidden = true;
  });
  // A readable static wordmark remains available even if the GPU becomes unavailable.
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    sync();
  }).observe(stage);
  resize();
  document.documentElement.classList.add('shader-ready');
  updateMotionControl();
  motionToggle.hidden = false;
  sync();
}

function makeWordmark() {
  const width = 2048;
  const height = 512;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const ink = source.getContext('2d', { willReadFrequently: true });
  // Share the vector artwork with the static fallback; no font swap on load.
  ink.drawImage(wordmark, 0, 0, width, height);

  const pixels = ink.getImageData(0, 0, width, height).data;
  const inside = new Float64Array(width * height);
  const outside = new Float64Array(width * height);
  for (let i = 0; i < inside.length; i++) {
    const filled = pixels[i * 4 + 3] > 127;
    inside[i] = filled ? 0 : 1e9;
    outside[i] = filled ? 1e9 : 0;
  }
  distanceTransform(inside, width, height);
  distanceTransform(outside, width, height);
  // Pack 16-bit distances into RG to avoid terracing along the curved bevels.
  const data = new Uint8Array(width * height * 4);
  const signed = new Float64Array(inside.length);
  for (let i = 0; i < signed.length; i++) signed[i] = Math.sqrt(outside[i]) - Math.sqrt(inside[i]);
  for (let i = 0; i < inside.length; i++) {
    const value = Math.round(Math.max(0, Math.min(1, .5 + signed[i] / 256)) * 65535);
    data[i * 4] = value >> 8;
    data[i * 4 + 1] = value & 255;
    const x = i % width;
    const dx = signed[x === width - 1 ? i : i + 1] - signed[x === 0 ? i : i - 1];
    const dy = signed[Math.min(signed.length - 1, i + width)] - signed[Math.max(0, i - width)];
    const length = Math.hypot(dx, dy) || 1;
    data[i * 4 + 2] = Math.round((.5 - dx / length * .5) * 255);
    data[i * 4 + 3] = Math.round((.5 + dy / length * .5) * 255);
  }
  return { width, height, data };
}

// Exact squared Euclidean distance in two linear passes, baked only once.
function distanceTransform(grid, width, height) {
  const count = Math.max(width, height);
  const f = new Float64Array(count);
  const d = new Float64Array(count);
  const sites = new Int32Array(count);
  const edges = new Float64Array(count + 1);
  function pass(length) {
    let k = 0;
    sites[0] = 0;
    edges[0] = -Infinity;
    edges[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s;
      do {
        const p = sites[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= edges[k]) k--;
        else break;
      } while (k >= 0);
      k++;
      sites[k] = q;
      edges[k] = s;
      edges[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (edges[k + 1] < q) k++;
      d[q] = (q - sites[k]) ** 2 + f[sites[k]];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    pass(height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    pass(width);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
}
