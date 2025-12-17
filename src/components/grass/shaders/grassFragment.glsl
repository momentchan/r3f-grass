uniform vec3 baseColor;
uniform vec3 tipColor;
uniform float uMidSoft;
uniform float uRimPos;
uniform float uRimSoft;
uniform vec3 uLightDirection;
uniform vec3 uLightColor;
uniform float uBackLightStrength;
uniform vec2 uBladeSeedRange;  // min, max for blade seed color variation
uniform vec2 uClumpInternalRange;  // min, max for clump internal color variation
uniform vec2 uClumpSeedRange;  // min, max for clump seed color variation
uniform float uAOPower;  // power exponent for AO curve

varying float vHeight;
varying vec2 vUv;
varying float vPresence;
varying vec3 vTest;
varying vec3 vN;
varying vec3 vTangent;
varying vec3 vSide;
varying vec2 vToCenter;
varying vec3 vWorldPos;
varying float vClumpSeed;
varying float vBladeSeed;

// ============================================================================
// Lighting Normal Computation (Ghost-style)
// ============================================================================
vec3 computeLightingNormal(
  vec3 geoNormal,
  vec2 toCenter,
  float t,
  vec3 worldPos
) {
  vec3 clumpNormal = normalize(vec3(toCenter.x, 0.7, toCenter.y));
  float heightMask = pow(1.0 - t, 0.7);
  float dist = length(cameraPosition - worldPos);
  float distMask = smoothstep(4.0, 12.0, dist);
  
  return normalize(
    mix(
      geoNormal,
      clumpNormal,
      heightMask * distMask
    )
  );
}

// ============================================================================
// Main Fragment Shader
// ============================================================================
void main() {
  // --------------------------------------------------------------------------
  // 1. TBN Frame
  // --------------------------------------------------------------------------
  vec3 T = normalize(vTangent);
  vec3 S = normalize(vSide);
  vec3 baseNormal = normalize(vN);

  // --------------------------------------------------------------------------
  // 2. Width shaping (Rim + Midrib)
  // --------------------------------------------------------------------------
  float u = vUv.x - 0.5;
  float au = abs(u);

  float mid01 = smoothstep(-uMidSoft, uMidSoft, u);
  float rimMask = smoothstep(uRimPos, uRimPos + uRimSoft, au);
  float v01 = mix(mid01, 1.0 - mid01, rimMask);
  float ny = v01 * 2.0 - 1.0;

  float widthNormalStrength = 0.35;
  vec3 geoNormal = normalize(baseNormal + S * ny * widthNormalStrength);

  // --------------------------------------------------------------------------
  // 3. Lighting normal (Ghost-style clump blending)
  // --------------------------------------------------------------------------
  vec3 lightingNormal = computeLightingNormal(
    geoNormal,
    vToCenter,
    vHeight,
    vWorldPos
  );

  csm_FragNormal = lightingNormal;

  // --------------------------------------------------------------------------
  // 4. Base Color (Height Gradient)
  // --------------------------------------------------------------------------
  vec3 color = mix(baseColor, tipColor, vHeight);

  // --------------------------------------------------------------------------
  // 5. Ghost-style Color Layering (three layers)
  // --------------------------------------------------------------------------
  float innerClump = smoothstep(0.0, 1.0, length(vToCenter));
  color *= mix(uClumpInternalRange.x, uClumpInternalRange.y, innerClump);
  color *= mix(uClumpSeedRange.x, uClumpSeedRange.y, vClumpSeed);
  color *= mix(uBladeSeedRange.x, uBladeSeedRange.y, vBladeSeed);

  // --------------------------------------------------------------------------
  // 6. Height-based AO (must multiply) - Ghost shape source
  // --------------------------------------------------------------------------
  float ao = mix(0.35, 1.0, pow(vHeight, uAOPower));
  color *= ao;

  // --------------------------------------------------------------------------
  // 7. Distance-based Shading Simplification (Ghost important)
  // --------------------------------------------------------------------------
  float dist = length(cameraPosition - vWorldPos);
  float distFade = smoothstep(6.0, 14.0, dist);

  // Reduce contrast and color variation at distance
  color = mix(color, vec3(dot(color, vec3(0.333))), distFade * 0.35);

  // --------------------------------------------------------------------------
  // 8. Fake Translucency / Backlight (Ghost core)
  // --------------------------------------------------------------------------
  vec3 Ng = normalize(baseNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uLightDirection);
  vec3 N = lightingNormal;

  // Backlight condition: light on back + grazing angle
  float backNdL = clamp(dot(-N, L), 0.0, 1.0);
  float NdV = dot(Ng, V);
  float viewGrazing = smoothstep(0.0, 0.6, 1.0 - NdV);

  float thickness = pow(1.0 - vHeight, 1.3);
  float backLight = backNdL * viewGrazing * thickness;

  vec3 trans = uLightColor * backLight * uBackLightStrength;
  color += trans;

  csm_DiffuseColor = vec4(color, 1.0);
}

