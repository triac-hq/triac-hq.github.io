import { vertexSource, fragmentSource } from './shader.js?v=15e61a8509e9';

const canvas = document.querySelector('#scene');
const heading = document.querySelector('h1');
const wordmark = heading.querySelector('img');
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
  const program = gl.createProgram();
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const names = ['resolution', 'viewport', 'logo', 'time', 'pointer', 'hover', 'reveal', 'pulse', 'distanceMap', 'characters'];
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
  }

  let elapsed = 0;
  let last = null;
  let nextDraw = 0;
  let frame = null;
  let paused = motion.matches;
  let lost = false;
  let quality = 1;
  let sampleTime = 0;
  let sampleFrames = 0;
  let smoothTime = 0;
  const coarsePointer = matchMedia('(pointer: coarse)');
  const target = { x: 0, y: 0, active: 0 };
  const pointer = { x: 0, y: 0, active: 0 };
  const pulse = { x: .5, y: .5, started: -10 };

  function draw() {
    if (lost) return;
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.hover, pointer.active);
    gl.uniform1f(uniforms.reveal, motion.matches ? 1 : Math.min(1, elapsed / 2.2));
    gl.uniform3f(uniforms.pulse, pulse.x, pulse.y, elapsed - pulse.started);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function resize(render = true) {
    if (lost) return;
    // Ray marching is expensive: start with fewer pixels, especially on phones.
    // Keep HTML text at native resolution while adapting only the WebGL canvas.
    const ratio = quality * Math.min(devicePixelRatio || 1, coarsePointer.matches ? .85 : 1,
      Math.sqrt(650000 / (innerWidth * innerHeight)));
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.viewport, innerWidth, innerHeight);
    const bounds = heading.getBoundingClientRect();
    gl.uniform4f(uniforms.logo, bounds.left, innerHeight - bounds.bottom, bounds.width, bounds.height);
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

      sampleTime += delta;
      sampleFrames++;
      if (sampleTime >= 750) {
        const average = sampleTime / sampleFrames;
        const previous = quality;
        if (average > 22) {
          quality = Math.max(.5, quality * .8);
          smoothTime = 0;
        } else if (average < 18) {
          smoothTime += sampleTime;
          if (smoothTime >= 4000) {
            quality = Math.min(1, quality + .05);
            smoothTime = 0;
          }
        } else {
          smoothTime = 0;
        }
        sampleTime = 0;
        sampleFrames = 0;
        if (quality !== previous) resize(false);
      }
      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    last = null;
    sampleTime = 0;
    sampleFrames = 0;
    smoothTime = 0;
    if (!paused && !document.hidden && !lost) frame = requestAnimationFrame(tick);
  }

  addEventListener('pointermove', event => {
    target.x = event.clientX / innerWidth - .5;
    target.y = .5 - event.clientY / innerHeight;
    target.active = 1;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; target.active = 0; });
  document.addEventListener('pointerdown', event => {
    if (paused) return;
    pulse.x = event.clientX / innerWidth;
    pulse.y = 1 - event.clientY / innerHeight;
    pulse.started = elapsed;
  });
  document.addEventListener('visibilitychange', sync);
  // No interface over the artwork: Space pauses; reduced motion starts still.
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    event.preventDefault();
    paused = !paused;
    sync();
  });
  motion.addEventListener('change', event => { paused = event.matches; draw(); sync(); });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    sync();
    document.documentElement.classList.remove('shader-ready');
    canvas.style.visibility = 'hidden';
  });
  // A readable static wordmark remains available even if the GPU becomes unavailable.
  new ResizeObserver(resize).observe(document.querySelector('.world'));
  resize();
  document.documentElement.classList.add('shader-ready');
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
  for (let i = 0; i < inside.length; i++) {
    const signed = Math.sqrt(outside[i]) - Math.sqrt(inside[i]);
    const value = Math.round(Math.max(0, Math.min(1, .5 + signed / 256)) * 65535);
    data[i * 4] = value >> 8;
    data[i * 4 + 1] = value & 255;
    data[i * 4 + 3] = 255;
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
