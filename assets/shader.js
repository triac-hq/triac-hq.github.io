export const vertexSource = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const fragmentSource = `
precision highp float;

uniform vec2 resolution;
uniform vec2 viewport;
uniform vec4 logo;
uniform vec2 pointer;
uniform vec3 pulse;
uniform float time;
uniform float hover;
uniform float reveal;
uniform sampler2D distanceMap;
uniform sampler2D characters;

float word(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -64.0;
  vec2 encoded = texture2D(distanceMap, vec2(uv.x, 1.0 - uv.y)).rg;
  return (dot(encoded, vec2(256.0, 1.0)) / 257.0 - .5) * 128.0;
}

float glyph(vec2 point, vec2 cell, float strength) {
  vec2 local = fract(point / cell);
  float index = floor(clamp(strength, 0.0, .999) * 8.0);
  return texture2D(characters, vec2((index + local.x) / 8.0, 1.0 - local.y)).r;
}

float field(vec2 p) {
  p += vec2(sin(p.y * 1.1 + time * .23), cos(p.x * .7 - time * .17)) * .7;
  return sin(p.x * 1.35 + p.y * .5 + time * .26) + cos(p.y * 1.6 - p.x * .4 - time * .19);
}

vec3 asciiBackground(vec2 point, float wave) {
  float scale = clamp(viewport.x / 900.0, .78, 1.0);
  // Two independently moving character planes give the field depth, all the
  // way through the word's gaps and translucent surface. No central mask.
  vec2 nearPoint = point + pointer * vec2(32.0, 22.0);
  vec2 cell = vec2(9.0, 14.0) * scale;
  vec2 sampled = (floor(nearPoint / cell) + .5) * cell;
  vec2 p = (sampled - viewport * .5) / viewport.y * 4.8;
  float flow = field(p);
  float ridge = .5 + .5 * cos(flow * 4.8);
  float body = pow(ridge, 2.5);
  float crest = pow(ridge, 14.0);
  float character = glyph(nearPoint, cell, .12 + body * .84);
  float hue = .5 + .5 * sin(p.x * .6 - p.y * .35 + time * .10);
  vec3 tint = mix(vec3(.15, .60, .62), vec3(.48, .30, .69), hue);
  vec3 ink = tint * (.10 + body * .62 + wave * .45);
  ink += vec3(.25, .40, .44) * crest * .32;

  vec2 farPoint = point - pointer * vec2(13.0, 9.0) + vec2(time * 1.8, -time * 1.1);
  vec2 farCell = vec2(4.0, 7.0) * scale;
  vec2 farSample = (floor(farPoint / farCell) + .5) * farCell;
  vec2 q = (farSample - viewport * .5) / viewport.y * 3.4 + vec2(3.7, 1.9);
  float farRidge = pow(.5 + .5 * sin(field(q) * 3.5 - time * .12), 5.0);
  float farCharacter = glyph(farPoint, farCell, .05 + farRidge * .4);
  vec3 distant = mix(vec3(.10, .28, .34), vec3(.29, .19, .43), 1.0 - hue);

  vec3 background = vec3(.022, .032, .05);
  background += tint * (.025 + body * .023);
  background += distant * farCharacter * (.08 + farRidge * .34) * (1.0 - body * .55);
  background += ink * character;
  return background;
}

mat3 rotation() {
  float a = -.09 + pointer.y * .24 + sin(time * .21) * .025;
  float b = -.10 + pointer.x * .32 + sin(time * .17) * .025;
  mat3 x = mat3(1., 0., 0., 0., cos(a), -sin(a), 0., sin(a), cos(a));
  mat3 y = mat3(cos(b), 0., sin(b), 0., 1., 0., -sin(b), 0., cos(b));
  return x * y;
}

float shape(vec3 p) {
  vec2 uv = p.xy / vec2(4.4, 1.1) + .5;
  float sdf = -word(uv) * (4.4 / 1024.0);
  // A gently undulating face bends the reflected light without deforming the word.
  float surface = .023 * sin(p.x * 2.0 + time * .24) + .018 * cos(p.y * 4.0 + time * .18);
  vec2 d = vec2(sdf + .04, abs(p.z - surface) - .105);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - .04;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(.005, -.005);
  return normalize(e.xyy * shape(p + e.xyy) + e.yyx * shape(p + e.yyx)
                 + e.yxy * shape(p + e.yxy) + e.xxx * shape(p + e.xxx));
}

vec3 environment(vec3 direction) {
  float angle = direction.y + direction.x * .17;
  float horizon = smoothstep(-.2, .28, angle);
  vec3 sky = mix(vec3(.035, .06, .095), vec3(.48, .62, .70), horizon);
  float ribbon = pow(.5 + .5 * sin(angle * 12.0 + direction.z * 2.0 + time * .12), 3.0);
  sky = mix(sky, vec3(.78, .88, .92), ribbon * .75);
  float cyan = pow(max(dot(direction, normalize(vec3(-.45, .15, 1.))), 0.0), 18.0);
  float violet = pow(max(dot(direction, normalize(vec3(.55, -.2, 1.))), 0.0), 12.0);
  sky += cyan * vec3(.12, .48, .46) + violet * vec3(.32, .13, .47);
  float strip = pow(max(dot(direction, normalize(vec3(-.3, .7, .8))), 0.0), 55.0);
  sky += vec3(.9, .98, 1.) * strip * 1.7;
  return sky;
}

void main() {
  vec2 original = gl_FragCoord.xy / resolution * viewport;
  vec2 point = original;
  float wave = 0.0;
  if (pulse.z >= 0.0 && pulse.z < 4.0) {
    vec2 delta = (point - pulse.xy * viewport) / viewport.y;
    float radius = length(delta);
    wave = exp(-pow((radius - pulse.z * .55) * 18.0, 2.0)) * exp(-pulse.z * .95);
    point += delta / max(radius, .001) * wave * 23.0;
  }
  vec2 p = (point - viewport * .5) / viewport.y;
  vec3 background = asciiBackground(point, wave);
  vec3 color = background;

  vec2 uv = (point - logo.xy) / logo.zw;
  // Skip the ray marcher outside the word's projected bounds.
  if (uv.x > -.06 && uv.x < 1.06 && uv.y > -.25 && uv.y < 1.25) {
    mat3 transform = rotation();
    vec3 origin = transform * vec3(0., 0., 5.5);
    vec3 ray = transform * normalize(vec3((uv - .5) * vec2(4.4, 1.1), -5.5));
    float travel = 4.65;
    float closest = 1.0;
    vec3 position = origin + ray * travel;
    bool hit = false;
    for (int i = 0; i < 64; i++) {
      position = origin + ray * travel;
      float distance = shape(position);
      closest = min(closest, distance);
      if (distance < .0015) { hit = true; break; }
      travel += max(distance * .8, .001);
      if (travel > 6.6) break;
    }
    if (hit) {
      vec3 normal = normalAt(position);
      vec3 reflection = reflect(ray, normal);
      vec3 reflected = environment(reflection);
      vec3 light = normalize(vec3(-.5 + pointer.x * .6, .9 + pointer.y * .3, 1.4));
      float diffuse = max(dot(normal, light), 0.0);
      float fresnel = pow(1.0 - max(dot(-ray, normal), 0.0), 4.0);
      float specular = pow(max(dot(normalize(light - ray), normal), 0.0), 72.0);
      vec3 metal = reflected * (.78 + diffuse * .2) + vec3(.06, .09, .11);
      metal += vec3(.75, .9, 1.) * specular * .7;
      metal += fresnel * vec3(.16, .29, .35);
      // The characters live on the 3D surface, so the engraving turns with the text.
      vec2 surface = (position.xy + vec2(2.2, .55)) * 300.0;
      float type = glyph(surface, vec2(4.0, 6.0), .35 + .55 * (.5 + .5 * sin(position.y * 11.0 + time * .1)));
      float face = smoothstep(.6, .95, abs(normal.z));
      vec2 cursorDelta = (original - (pointer + .5) * viewport) / min(viewport.x, viewport.y);
      float lens = exp(-dot(cursorDelta, cursorDelta) * 38.0) * hover;
      float assembly = 1.0 - smoothstep(reveal * 1.6 - .35, reveal * 1.6 + .05, position.x / 4.4 + .5);
      float transparency = max(lens * .84, 1.0 - assembly);
      float transmission = mix(1.0, mix(.86 + type * .14, type, transparency), face);
      metal = mix(background, metal, transmission);
      float scan = exp(-pow((position.x - sin(time * .22) * 3.0) * 4.5, 2.0));
      metal += vec3(.055, .12, .15) * scan * type * face;
      metal += vec3(.08, .22, .25) * type * lens * face;
      color = metal;
    } else {
      color += vec3(.06, .14, .18) * exp(-closest * 160.0) * .18;
    }
  }
  float vignette = 1.0 - smoothstep(.45, 1.3, length(p * vec2(.65, 1.0)));
  color *= .8 + .2 * vignette;
  gl_FragColor = vec4(color, 1.0);
}
`;
