uniform vec3 baseColor;
uniform vec3 tipColor;

varying float vHeight;
varying vec2 vUv;
varying float vPresence;
varying vec3 vTest;
varying vec3 vN;
varying vec3 vTangent;
varying vec3 vSide;
varying vec2 vToCenter;
varying vec3 vWorldPos;

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
  // 1. TBN Frame Construction
  vec3 T = normalize(vTangent);
  vec3 S = normalize(vSide);
  vec3 baseNormal = normalize(vN);
  
  // 2. Rim + Midrib Effect
  float u = vUv.x - 0.5;
  float au = abs(u);
  
  float midSoft = 0.2;
  float mid01 = smoothstep(-midSoft, midSoft, u);
  
  float rimPos = 0.42;
  float rimSoft = 0.2;
  float rimMask = smoothstep(rimPos, rimPos + rimSoft, au);
  
  float v01 = mix(mid01, 1.0 - mid01, rimMask);
  float ny = v01 * 2.0 - 1.0;
  
  // 3. Apply Rim + Midrib to Normal
  float widthNormalStrength = 0.35;
  vec3 geoNormal = normalize(baseNormal + S * ny * widthNormalStrength);
  
  // 4. Compute Lighting Normal
  vec3 lightingNormal = computeLightingNormal(geoNormal, vToCenter, vHeight, vWorldPos);
  
  // 5. Set CSM Fragment Normal
  csm_FragNormal = lightingNormal;
  
  // 6. Color Output
  vec3 color = mix(baseColor, tipColor, vHeight);

  float ao = mix(0.4, 1.0, vHeight);
  // color *= ao;

  // Removed seed-based tint (can be restored if needed)

  // color *= vPresence;

  csm_DiffuseColor = vec4(color, 1.0);
  // csm_FragColor = vec4(color, 1.0);
  // csm_FragColor = vec4(vHeight, 0.0, 0.0, 1.0);
}

