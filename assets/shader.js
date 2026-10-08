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
uniform sampler2D fieldMap;
uniform sampler2D metalRamp;
uniform vec2 fieldSize;

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

vec3 asciiBackground(vec2 point, float wave) {
  vec2 cell = vec2(9.0, 14.0) * clamp(viewport.x / 900.0, .78, 1.0);
  vec2 nearPoint = point + pointer * vec2(32.0, 22.0);
  vec2 sampleUV = (floor(nearPoint / cell) + 5.5) / fieldSize;
  vec4 field = texture2D(fieldMap, sampleUV);
  float character = glyph(nearPoint, cell, field.a);
  return vec3(.022, .032, .05) + field.rgb * (.065 + character * (1.0 + wave));
}

vec3 environment(vec3 direction) {
  float angle = direction.y + direction.x * .17;
  float coordinate = clamp(.5 + angle * .48 + sin(time * .12) * .035, 0.0, 1.0);
  return texture2D(metalRamp, vec2(coordinate, .5)).rgb;
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
  // Shade the beveled face directly from the distance field, with bounded work
  // per pixel. This preserves Retina detail without a ray-marching loop.
  uv.x += (uv.y - .5) * .006;
  uv += pointer * vec2(.008, .015);
  if (uv.x > -.03 && uv.x < 1.04 && uv.y > -.1 && uv.y < 1.1) {
    float distance = word(uv);
    vec2 depth = vec2(.009, -.035);
    float side = max(distance, max(word(uv - depth), word(uv - depth * .5)));
    float aa = max(.15, 768.0 * viewport.x / (logo.z * resolution.x));
    float assembly = 1.0 - smoothstep(reveal * 1.6 - .35, reveal * 1.6 + .05, uv.x);
    color = mix(color, vec3(.12, .21, .26), smoothstep(-aa, aa, side) * assembly);
    if (distance > -aa) {
      // Bevel normals are baked alongside distance, avoiding four extra lookups.
      vec2 normalXY = texture2D(distanceMap, vec2(uv.x, 1.0 - uv.y)).ba * 2.0 - 1.0;
      float bevel = 1.0 - smoothstep(0.0, 5.0, distance);
      vec2 slope = normalXY * bevel * 1.8;
      slope += vec2(-.05 + .025 * sin(uv.x * 4.0 + time * .17),
                    (uv.y - .5) * .48 + .035 * sin(time * .24));
      vec3 normal = normalize(vec3(slope, 1.0));
      vec3 reflected = environment(reflect(vec3(0.0, 0.0, -1.0), normal));
      float diffuse = max(dot(normal, normalize(vec3(-.5, .9, 1.4))), 0.0);
      vec3 metal = reflected * (.78 + diffuse * .2) + vec3(.06, .09, .11);
      float type = glyph(point, vec2(3.0, 4.5), .35 + .55 * (.5 + .5 * sin(uv.y * 11.0 + time * .1)));
      metal *= .94 + type * .06;
      vec2 cursorDelta = (original - (pointer + .5) * viewport) / min(viewport.x, viewport.y);
      float lens = exp(-dot(cursorDelta, cursorDelta) * 38.0) * hover;
      metal = mix(metal, background, lens * .75 * (1.0 - type));
      color = mix(color, metal, smoothstep(-aa, aa, distance) * assembly);
    }
  }

  float vignette = 1.0 - smoothstep(.45, 1.3, length(p * vec2(.65, 1.0)));
  color *= .8 + .2 * vignette;
  gl_FragColor = vec4(color, 1.0);
}
`;

// Evaluate the flow once per character cell, not once per Retina pixel.
export const fieldFragmentSource = `
precision highp float;
uniform vec2 viewport;
uniform float time;
float field(vec2 p) {
  p += vec2(sin(p.y * 1.1 + time * .23), cos(p.x * .7 - time * .17)) * .7;
  return sin(p.x * 1.35 + p.y * .5 + time * .26) + cos(p.y * 1.6 - p.x * .4 - time * .19);
}
void main() {
  vec2 cell = vec2(9.0, 14.0) * clamp(viewport.x / 900.0, .78, 1.0);
  vec2 point = (gl_FragCoord.xy - 5.0) * cell;
  vec2 p = (point - viewport * .5) / viewport.y * 4.8;
  float ridge = .5 + .5 * cos(field(p) * 4.8);
  float body = pow(ridge, 2.5);
  float crest = pow(ridge, 14.0);
  float hue = .5 + .5 * sin(p.x * .6 - p.y * .35 + time * .10);
  vec3 tint = mix(vec3(.15, .60, .62), vec3(.48, .30, .69), hue);
  vec3 ink = tint * (.10 + body * .62) + vec3(.25, .40, .44) * crest * .32;
  gl_FragColor = vec4(ink, .12 + body * .84);
}
`;
