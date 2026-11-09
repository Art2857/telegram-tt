import{t as e}from"./math-DcsLM4n_.js";import{r as t,s as n}from"./openModals-5V8KAjMA.js";import{a as r,i,r as a}from"./WalletAppIcon-CqhChTQQ.js";import{a as o,i as s,n as c,o as l,t as u}from"./model-t1-qf2J0.js";var d=`// The diamond and its sparkles, without the internal bounces and the opposite-face ray\r
\r
// The edges rely on derivatives in branches that differ from pixel to pixel, which WGSL rejects unless this check is\r
// off\r
diagnostic(off, derivative_uniformity);\r
\r
struct Uniforms {\r
    model: mat4x4f,\r
    projection: mat4x4f,\r
    inverseModel: mat4x4f,\r
    parameters: vec4f, // time, refraction, brightness, sparkles\r
    viewport: vec4f, // width, height, optical plane count, unused\r
    sparkleShape: vec4f, // main layer scale, contour morph, core scale, star glow scale\r
    sparkleHalo: vec4f, // circular glow scale, main face rotation, horizontal correction, visibility\r
    crownGradient: vec4f,\r
    pavilionGradient: vec4f,\r
    lightSweep: vec4f, // diagonal position, environment phase, transmission, reserved\r
    facetProjection: vec4f, // reference pitch cosine/sine, source units, projected top\r
    crownSweep: vec4f,\r
    rightCrownSweep: vec4f,\r
    leftCrownSweep: vec4f,\r
    pavilionSweep: vec4f,\r
    rightPavilionSweep: vec4f,\r
    leftPavilionSweep: vec4f,\r
    appearance: vec4f, // palette identifier, whitening\r
    referenceCrownFlash: vec4f,\r
    referencePavilionFlash: vec4f,\r
}\r
\r
struct SparkleAnchor {\r
    position: vec4f,\r
    normal: vec4f,\r
}\r
\r
struct Hull {\r
    planes: array<vec4f, 17>,\r
    anchors: array<SparkleAnchor, 8>,\r
}\r
\r
struct Raster {\r
    @builtin(position) position: vec4f,\r
    @location(0) localPosition: vec3f,\r
    @location(1) normal: vec3f,\r
    @location(2) worldPosition: vec3f,\r
    // Table, crown, pavilion; interpolated across rounded edges\r
    @location(3) facetWeights: vec3f,\r
}\r
\r
struct SparkleRaster {\r
    @builtin(position) position: vec4f,\r
    @location(0) sourcePoint: vec2f,\r
    @location(1) @interpolate(flat) strength: f32,\r
    @location(2) @interpolate(flat) layer: u32,\r
}\r
\r
@group(0) @binding(0) var<uniform> u: Uniforms;\r
@group(0) @binding(1) var<uniform> hull: Hull;\r
\r
const CROWN_STOPS = array<f32, 7>(0.0, 0.162, 0.324, 0.501, 0.667, 0.833, 1.0);\r
const CROWN_COLORS = array<vec3f, 7>(vec3f(0.145, 0.792, 1.0), vec3f(0.373, 0.875, 1.0),\r
    vec3f(0.6, 0.957, 1.0), vec3f(0.3, 0.798, 1.0), vec3f(0.0, 0.639, 1.0),\r
    vec3f(0.0, 0.545, 1.0), vec3f(0.0, 0.451, 1.0));\r
const RING = array<vec2f, 8>(vec2f(0.0, 1.0), vec2f(0.70710678, 0.70710678),\r
    vec2f(1.0, 0.0), vec2f(0.70710678, -0.70710678), vec2f(0.0, -1.0),\r
    vec2f(-0.70710678, -0.70710678), vec2f(-1.0, 0.0), vec2f(-0.70710678, 0.70710678));\r
\r
@vertex\r
fn diamondVertex(\r
    @location(0) position: vec4f, @location(1) normal: vec4f, @location(2) surface: vec4f,\r
) -> Raster {\r
    let world = u.model * position;\r
    var result: Raster;\r
    result.position = u.projection * world;\r
    result.localPosition = position.xyz;\r
    result.normal = normalize((u.model * normal).xyz);\r
    result.worldPosition = world.xyz;\r
    result.facetWeights = select(\r
        vec3f(f32(surface.z == 0.0), f32(surface.z == 1.0), f32(surface.z == 2.0)),\r
        vec3f(surface.xy, 1.0 - surface.x - surface.y),\r
        surface.z == 3.0,\r
    );\r
    return result;\r
}\r
\r
// Stop after stop rather than a loop, see \`pavilionReflections\`\r
fn referenceCrown(p: vec2f, gradient: vec4f) -> vec3f {\r
    let start = gradient.xy;\r
    let direction = gradient.zw - start;\r
    let t = saturate(dot(p - start, direction) / dot(direction, direction));\r
    if (t <= CROWN_STOPS[1]) { return mixCrownStops(t, 0); }\r
    if (t <= CROWN_STOPS[2]) { return mixCrownStops(t, 1); }\r
    if (t <= CROWN_STOPS[3]) { return mixCrownStops(t, 2); }\r
    if (t <= CROWN_STOPS[4]) { return mixCrownStops(t, 3); }\r
    if (t <= CROWN_STOPS[5]) { return mixCrownStops(t, 4); }\r
    if (t <= CROWN_STOPS[6]) { return mixCrownStops(t, 5); }\r
    return CROWN_COLORS[6];\r
}\r
\r
fn mixCrownStops(t: f32, index: u32) -> vec3f {\r
    let stops = CROWN_STOPS;\r
    let colors = CROWN_COLORS;\r
    return mix(colors[index], colors[index + 1u], (t - stops[index]) / (stops[index + 1u] - stops[index]));\r
}\r
\r
fn lateralDepth(color: vec3f, normal: vec3f, y: f32, facetWeights: vec3f, opticalLuminance: f32) -> vec3f {\r
    let horizontalNormal = length(normal.xz);\r
    let side = smoothstep(0.22, 0.80, abs(normal.x) / max(horizontalNormal, 0.001));\r
    let shoulder = smoothstep(0.06, 0.57, y);\r
    let lower = smoothstep(0.12, 0.90, -y);\r
    let reflectedLight = smoothstep(0.28, 0.78, color.g);\r
    // A restrained blue-violet shadow keeps the sides distinct without\r
    // swallowing their cyan gradients and moving reflections.\r
    let deepBlue = mix(vec3f(0.017, 0.035, 0.90), vec3f(0.006, 0.11, 1.0), reflectedLight);\r
    var sideColor = mix(deepBlue, vec3f(0.22, 0.86, 1.0), shoulder * 0.69);\r
    sideColor = mix(sideColor, vec3f(0.018, 0.39, 1.0), lower * 0.52);\r
    let reflectionDetail = 0.105 + opticalLuminance * 0.14 + smoothstep(0.70, 0.95, color.g) * 0.26;\r
    sideColor = mix(sideColor, color, reflectionDetail);\r
    let weight = side * 0.96 * (1.0 - facetWeights.x);\r
    return mix(color, sideColor, weight);\r
}\r
\r
fn facetBarycentric(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> vec3f {\r
    let v = b - a;\r
    let w = c - a;\r
    let q = p - a;\r
    let determinant = v.x * w.y - v.y * w.x;\r
    let y = (q.x * w.y - q.y * w.x) / determinant;\r
    let z = (v.x * q.y - v.y * q.x) / determinant;\r
    return vec3f(1.0 - y - z, y, z);\r
}\r
\r
fn facetCoverage(barycentric: vec3f) -> f32 {\r
    let edge = min(barycentric.x, min(barycentric.y, barycentric.z));\r
    let aa = max(fwidth(edge), 0.004);\r
    return smoothstep(-aa, aa, edge);\r
}\r
\r
fn sourceFacetPoint(localPosition: vec3f, outward: vec2f) -> vec2f {\r
    let across = dot(localPosition.xz, vec2f(outward.y, -outward.x));\r
    let depth = dot(localPosition.xz, outward);\r
    let c = u.facetProjection.x;\r
    let s = u.facetProjection.y;\r
    let y = c * localPosition.y - s * depth;\r
    let z = s * localPosition.y + c * depth;\r
    let w = u.projection[2].w * z + u.projection[3].w;\r
    return vec2f(257.6 + across / w * u.facetProjection.z,\r
        103.8 + (u.facetProjection.w - y / w) * u.facetProjection.z);\r
}\r
\r
fn getOutward(localNormal: vec3f) -> vec2f {\r
    return select(vec2f(0.0, sign(localNormal.z)), vec2f(sign(localNormal.x), 0.0),\r
        abs(localNormal.x) > abs(localNormal.z));\r
}\r
\r
fn getBroad(localNormal: vec3f) -> f32 {\r
    let normalXZ = abs(localNormal.xz);\r
    return 1.0 - smoothstep(0.20, 0.65,\r
        min(normalXZ.x, normalXZ.y) / max(max(normalXZ.x, normalXZ.y), 0.0001));\r
}\r
\r
fn illustratedFacets(inputColor: vec3f, r: Raster) -> vec3f {\r
    var color = inputColor;\r
    let localNormal = normalize((u.inverseModel * vec4f(normalize(r.normal), 0.0)).xyz);\r
    // Fixed material coordinates on each broad face. The same reference camera\r
    // maps the authored facets and the sparkle anchors onto the current cut.\r
    let outward = getOutward(localNormal);\r
    let tangent = vec3f(outward.y, 0.0, -outward.x);\r
    let p = sourceFacetPoint(r.localPosition, outward);\r
    // Fade the drawing before the diagonal facets, where the next face's\r
    // coordinate system takes over. No duplicated motifs along rounded edges.\r
    let broad = getBroad(localNormal);\r
    let worldTangent = (u.model * vec4f(tangent, 0.0)).xyz;\r
    let n = normalize(r.normal);\r
    let light = normalize(vec3f(0.6 * sin(u.lightSweep.y), 0.5, 1.0));\r
    let leftLight = pow(saturate(dot(normalize(n - worldTangent * 0.38), light)), 5.0);\r
    let rightLight = pow(saturate(dot(normalize(n + worldTangent * 0.38), light)), 5.0);\r
    if (r.facetWeights.y > 0.0) {\r
        // Both crown triangles meet at the same upper junction.\r
        let crownJunction = vec2f(258.8, 128.9);\r
        // Authored lower corners now share the same projection as the mesh.\r
        let crownBaseLeft = vec2f(108.8, 240.8);\r
        let crownBaseRight = vec2f(406.8, 240.8);\r
        let left = facetBarycentric(p, vec2f(142.1, 106.3), crownJunction, crownBaseLeft);\r
        let leftStrength = facetCoverage(left) * (0.18 + 0.40 * leftLight) * saturate(1.0 - left.y);\r
        color = mix(color, vec3f(0.79, 0.988, 1.0), leftStrength * r.facetWeights.y * broad);\r
        let right = facetBarycentric(p, crownBaseRight, crownJunction, vec2f(378.5, 108.2));\r
        // The source is light at the left junction and dark at the right edge.\r
        // Use horizontal facet coordinates so the gradient turns with the gem.\r
        let gradient = smoothstep(crownJunction.x, crownBaseRight.x, p.x);\r
        var tint = mix(vec3f(0.28, 0.83, 1.0), vec3f(0.025, 0.43, 1.0), gradient);\r
        tint = mix(tint, vec3f(0.57, 0.95, 1.0), rightLight * 0.24);\r
        color = mix(color, tint, facetCoverage(right) * 0.90 * r.facetWeights.y * broad);\r
    }\r
    if (r.facetWeights.z > 0.0) {\r
        // A translucent kite belongs to each broad pavilion face. Material-space\r
        // edges stay attached to the surface throughout a complete rotation.\r
        let kite = vec2f(dot(r.localPosition, tangent), r.localPosition.y);\r
        const halfWidth = 0.245;\r
        const top = -0.61;\r
        const shoulder = -0.70;\r
        const bottom = -1.075;\r
        const upperHeight = top - shoulder;\r
        const lowerHeight = shoulder - bottom;\r
        let upperEdge = ((top - kite.y) * halfWidth - abs(kite.x) * upperHeight)\r
            / length(vec2f(halfWidth, upperHeight));\r
        let lowerEdge = ((kite.y - bottom) * halfWidth - abs(kite.x) * lowerHeight)\r
            / length(vec2f(halfWidth, lowerHeight));\r
        let edge = min(upperEdge, lowerEdge);\r
        let aa = max(fwidth(edge), 0.0015);\r
        let coverage = smoothstep(-aa, aa, edge);\r
        let illumination = saturate(dot(n, normalize(vec3f(-0.65, 0.5, 1.0))));\r
        var tint = mix(vec3f(0.48, 0.96, 1.0), vec3f(0.70, 1.0, 1.0), illumination);\r
        let across = saturate(0.5 + kite.x / (2.0 * halfWidth));\r
        tint *= mix(vec3f(1.0), vec3f(0.88, 0.97, 1.0), across);\r
        color = mix(color, tint, coverage * 0.28 * r.facetWeights.z * broad);\r
    }\r
    return color;\r
}\r
\r
fn studio(direction: vec3f, phase: f32) -> vec3f {\r
    let angle = 0.85 * sin(phase);\r
    let d = vec3f(cos(angle) * direction.x - sin(angle) * direction.z, direction.y,\r
        sin(angle) * direction.x + cos(angle) * direction.z);\r
    let up = smoothstep(-0.65, 0.85, d.y);\r
    var c = mix(vec3f(0.002, 0.075, 0.88), vec3f(0.19, 0.78, 1.0), up);\r
    let key = pow(saturate(dot(d, normalize(vec3f(-0.6, 0.8, 0.7)))), 10.0);\r
    let stripPosition = 0.12 + 0.48 * sin(phase);\r
    // \`pow\` is undefined for a negative base; GLSL compilers turn the \`pow(x, 2.0)\` of the original into \`x * x\`\r
    let stripOffset = (d.x + d.y * 0.42 - stripPosition) * 9.0;\r
    let strip = exp(-stripOffset * stripOffset);\r
    let side = pow(saturate(dot(d, normalize(vec3f(0.8, 0.2, -0.5)))), 18.0);\r
    c = mix(c, vec3f(0.68, 0.98, 1.0), key * 0.94);\r
    c = mix(c, vec3f(0.80, 0.99, 1.0), strip * 0.64);\r
    c += side * vec3f(0.1, 0.3, 0.38);\r
    return c;\r
}\r
\r
fn facetEdgeRoll(p: vec2f, a: vec2f, b: vec2f) -> vec2f {\r
    let segment = b - a;\r
    let edgeLength = length(segment);\r
    let along = segment / edgeLength;\r
    let across = vec2f(-along.y, along.x);\r
    let offset = dot(p - a, across);\r
    let progress = dot(p - a, along);\r
    let width = max(1.6, fwidth(offset));\r
    let q = offset / width;\r
    let ends = smoothstep(0.0, 5.0, progress) * (1.0 - smoothstep(edgeLength - 5.0, edgeLength, progress));\r
    return across * (q * exp(-q * q) * 0.22 * ends);\r
}\r
\r
fn polishedNormal(r: Raster, localNormal: vec3f) -> vec3f {\r
    // Only the two surface crown diagonals get this tiny optical fillet.\r
    // The actual outline and the internal optical hull stay unchanged.\r
    if (r.facetWeights.y <= 0.0) { return normalize(r.normal); }\r
    let outward = getOutward(localNormal);\r
    let broad = getBroad(localNormal);\r
    let p = sourceFacetPoint(r.localPosition, outward);\r
    let roll = facetEdgeRoll(p, vec2f(258.8, 128.9), vec2f(108.8, 240.8))\r
        + facetEdgeRoll(p, vec2f(258.8, 128.9), vec2f(406.8, 240.8));\r
    let across = vec3f(outward.y, 0.0, -outward.x);\r
    let up = normalize(cross(localNormal, across));\r
    let normal = normalize(localNormal - (across * roll.x - up * roll.y) * broad * r.facetWeights.y);\r
    return normalize((u.model * vec4f(normal, 0.0)).xyz);\r
}\r
\r
fn studioPanel(reflected: vec3f, direction: vec3f, size: vec2f) -> f32 {\r
    let alignment = dot(reflected, direction);\r
    let horizontal = normalize(cross(vec3f(0.0, 1.0, 0.0), direction));\r
    let vertical = cross(direction, horizontal);\r
    let point = vec2f(dot(reflected, horizontal), dot(reflected, vertical)) / max(alignment, 0.15);\r
    // Filter the narrow reflection at small sizes and grazing angles.\r
    let dx = dpdx(point);\r
    let dy = dpdy(point);\r
    let variance = size * size + dx * dx + dy * dy;\r
    let energy = size.x * size.y / sqrt(variance.x * variance.y);\r
    return exp(-dot(point * point, 1.0 / variance)) * energy * smoothstep(0.15, 0.40, alignment);\r
}\r
\r
fn surfaceFinish(color: vec3f, normal: vec3f, view: vec3f) -> vec3f {\r
    let reflected = reflect(-view, normal);\r
    let phase = u.lightSweep.y;\r
    let key = studioPanel(reflected, normalize(vec3f(-0.36 + 0.14 * sin(phase), 0.90, 0.72)), vec2f(0.16, 0.48));\r
    let rim = studioPanel(reflected, normalize(vec3f(0.72, -0.52 + 0.10 * cos(phase), 0.18)), vec2f(0.10, 0.60));\r
    let fresnel = pow(1.0 - saturate(dot(normal, view)), 4.0);\r
    let strength = key * (0.35 + 0.35 * fresnel) + rim * (0.16 + 0.30 * fresnel);\r
    return mix(color, vec3f(0.87, 0.99, 1.0), strength);\r
}\r
\r
fn sourceBand(p: vec2f, gradient: vec4f) -> f32 {\r
    let direction = gradient.zw - gradient.xy;\r
    let t = dot(p - gradient.xy, direction) / dot(direction, direction);\r
    return saturate(1.0 - abs(t - 0.49) / 0.49);\r
}\r
\r
fn facetSweep(r: Raster, localNormal: vec3f) -> f32 {\r
    let tangent = normalize(vec3f(localNormal.z + 0.00001, 0.0, -localNormal.x));\r
    let across = dot(r.localPosition, tangent) * 225.8;\r
    let side = smoothstep(0.20, 0.50, abs(normalize(r.normal).x));\r
    let isRight = r.normal.x > 0.0;\r
    let crown = mix(u.crownSweep, select(u.leftCrownSweep, u.rightCrownSweep, isRight), side);\r
    let pavilion = mix(u.pavilionSweep, select(u.leftPavilionSweep, u.rightPavilionSweep, isRight), side);\r
    return sourceBand(vec2f(across, (0.3065 - r.localPosition.y) * 239.0), crown) * r.facetWeights.y\r
        + sourceBand(vec2f(across, (-0.54 - r.localPosition.y) * 235.0), pavilion) * r.facetWeights.z;\r
}\r
\r
fn reflectionTriangle(\r
    origin: vec3f, ray: vec3f, a: vec3f, b: vec3f, c: vec3f, coordinates: ptr<function, vec3f>,\r
) -> f32 {\r
    let ab = b - a;\r
    let ac = c - a;\r
    let crossRay = cross(ray, ac);\r
    let determinant = dot(ab, crossRay);\r
    if (abs(determinant) < 0.00001) { return 1e5; }\r
    let offset = origin - a;\r
    let first = dot(offset, crossRay) / determinant;\r
    let q = cross(offset, ab);\r
    let second = dot(ray, q) / determinant;\r
    let t = dot(ac, q) / determinant;\r
    let result = vec3f(1.0 - first - second, first, second);\r
    *coordinates = result;\r
    return select(1e5, t, min(min(result.x, result.y), result.z) >= 0.0 && t > 0.001);\r
}\r
\r
// The pavilion trace, filled facet by facet\r
struct PavilionTrace {\r
    entry: f32,\r
    exitDistance: f32,\r
    entryNormal: vec3f,\r
    sideColor: vec3f,\r
    sideWeight: f32,\r
    veilColor: vec3f,\r
    veilWeight: f32,\r
}\r
\r
fn pavilionReflections(inputColor: vec3f, origin: vec3f, ray: vec3f) -> vec3f {\r
    var color = inputColor;\r
    if (u.parameters.y <= 0.0) { return color; }\r
    // One convex fan of reflected facets, shared by every camera orientation.\r
    // Clip the whole volume so adjoining facets never acquire dark seams.\r
    let worldRay = normalize((u.model * vec4f(ray, 0.0)).xyz);\r
    var trace = PavilionTrace(0.0, 1e5, vec3f(0.0, 1.0, 0.0), vec3f(0.0), 0.0, vec3f(0.0), 0.0);\r
    // Written out instead of a loop: on Metal, WebGPU keeps loops from being unrolled, and with a loop here the\r
    // shader runs three times slower\r
    tracePavilionSector(&trace, RING[0], RING[1], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[1], RING[2], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[2], RING[3], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[3], RING[4], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[4], RING[5], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[5], RING[6], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[6], RING[7], origin, ray, worldRay);\r
    tracePavilionSector(&trace, RING[7], RING[0], origin, ray, worldRay);\r
    let strength = saturate(u.parameters.y / 0.72);\r
    if (trace.veilWeight > 0.0) {\r
        color = mix(color, trace.veilColor / trace.veilWeight, (1.0 - exp(-trace.veilWeight * 0.46)) * strength);\r
    }\r
    if (trace.sideWeight > 0.0) {\r
        color = mix(color, trace.sideColor / trace.sideWeight, (1.0 - exp(-trace.sideWeight * 1.4)) * strength);\r
    }\r
    // \`studioPanel\` uses screen derivatives. Evaluate it on both sides of the\r
    // hull boundary; divergent execution produces dotted edges on Adreno.\r
    let hit = origin + ray * trace.entry;\r
    let worldNormal = normalize((u.model * vec4f(trace.entryNormal, 0.0)).xyz);\r
    let light = saturate(dot(worldNormal, normalize(vec3f(-0.65, 0.15, 1.0))));\r
    let gleam = studioPanel(reflect(worldRay, worldNormal),\r
        normalize(vec3f(-0.35 + 0.15 * sin(u.lightSweep.y), 0.60, 0.75)), vec2f(0.25, 0.65));\r
    var tint = mix(vec3f(0.025, 0.54, 1.0), vec3f(0.40, 0.92, 1.0), light);\r
    tint = mix(tint, vec3f(0.72, 0.99, 1.0), gleam * 0.16);\r
    let thickness = smoothstep(0.0, 0.18, trace.exitDistance - trace.entry);\r
    let fade = smoothstep(-1.07, -0.93, hit.y);\r
    let isInside = select(0.0, 1.0, trace.entry < trace.exitDistance);\r
    color = mix(color, tint, 0.28 * thickness * fade * strength * isInside);\r
    return color;\r
}\r
\r
fn tracePavilionSector(\r
    trace: ptr<function, PavilionTrace>, current: vec2f, next: vec2f, origin: vec3f, ray: vec3f, worldRay: vec3f,\r
) {\r
    const top = vec3f(0.0, -0.28, 0.0);\r
    const tip = vec3f(0.0, -1.06, 0.0);\r
    let illumination = normalize(vec3f(-0.55, 0.65, 1.0));\r
    let a = vec3f(current.x * 0.28, -0.68, current.y * 0.28);\r
    let b = vec3f(next.x * 0.28, -0.68, next.y * 0.28);\r
    clipPavilionPlane(trace, a, b, top, origin, ray);\r
    clipPavilionPlane(trace, a, b, tip, origin, ray);\r
    let radial = vec3f(current.x, 0.0, current.y);\r
    let tangent = vec3f(current.y, 0.0, -current.x);\r
    // Broad, low-contrast echoes of the crown stretch through the volume\r
    // towards the same lower junction. Adjacent planes meet without dark gaps.\r
    // Continue the same planes above the girdle so their top fade stays\r
    // hidden behind the crown, including the deeper, opposite reflections.\r
    const upperY = 0.20;\r
    const extension = (upperY + 0.12) / 0.65;\r
    const upperRadius = 0.64 + (0.64 - 0.19) * extension;\r
    const upperWidth = 0.265097 + (0.265097 - 0.078701) * extension;\r
    let upperLeft = radial * upperRadius - tangent * upperWidth + vec3f(0.0, upperY, 0.0);\r
    let upperRight = radial * upperRadius + tangent * upperWidth + vec3f(0.0, upperY, 0.0);\r
    let lowerLeft = radial * 0.19 - tangent * 0.078701 + vec3f(0.0, -0.77, 0.0);\r
    let lowerRight = radial * 0.19 + tangent * 0.078701 + vec3f(0.0, -0.77, 0.0);\r
    var ribbonCoordinates: vec3f;\r
    var ribbon = reflectionTriangle(origin, ray, upperLeft, upperRight, lowerLeft, &ribbonCoordinates);\r
    if (ribbon > 100.0) {\r
        ribbon = reflectionTriangle(origin, ray, upperRight, lowerRight, lowerLeft, &ribbonCoordinates);\r
    }\r
    if (ribbon < 100.0) {\r
        let hit = origin + ray * ribbon;\r
        let depth = (-0.12 - hit.y) / 0.65;\r
        let across = dot(hit, tangent);\r
        let right = mix(0.265097, 0.078701, depth);\r
        let left = -right;\r
        let worldRadial = normalize((u.model * vec4f(radial, 0.0)).xyz);\r
        let facing = saturate(-dot(worldRadial, worldRay));\r
        let fade = smoothstep(0.0, 0.065, upperY - hit.y) * (1.0 - smoothstep(0.70, 1.0, depth));\r
        let opacity = fade * (0.16 + 0.84 * facing);\r
        let light = saturate(0.5 + 0.5 * dot(worldRadial, illumination));\r
        // Broad reflected facets fill the middle with restrained diagonal\r
        // changes in tone, expressed in the fixed plane's own coordinates.\r
        let acrossPlane = saturate((across - left) / (right - left));\r
        let diagonal = smoothstep(-0.045, 0.045, acrossPlane - 0.35 - depth * 0.55);\r
        let middle = smoothstep(0.12, 0.24, depth) * (1.0 - smoothstep(0.50, 0.64, depth));\r
        var tint = mix(vec3f(0.015, 0.56, 1.0), vec3f(0.33, 0.97, 1.0), light);\r
        tint = mix(tint, vec3f(0.42, 0.97, 1.0), middle * (0.32 - 0.20 * diagonal));\r
        tint = mix(tint, vec3f(0.015, 0.46, 1.0), diagonal * 0.24);\r
        (*trace).veilColor += tint * opacity;\r
        (*trace).veilWeight += opacity;\r
    }\r
    let aSide = radial * 0.72 + tangent * 0.055 + vec3f(0.0, -0.30, 0.0);\r
    let bSide = radial * 0.49 - tangent * 0.105 + vec3f(0.0, -0.60, 0.0);\r
    let cSide = radial * 0.15 + tangent * 0.020 + vec3f(0.0, -0.93, 0.0);\r
    var coordinates: vec3f;\r
    let t = reflectionTriangle(origin, ray, aSide, bSide, cSide, &coordinates);\r
    if (t < 100.0) {\r
        let worldRadial = normalize((u.model * vec4f(radial, 0.0)).xyz);\r
        // Long glints read at the sides; a front-facing sector must not\r
        // become an opaque needle in the middle of the stone.\r
        let sideFacing = 1.0 - abs(dot(worldRadial, worldRay));\r
        let edge = min(coordinates.y, coordinates.z);\r
        let opacity = smoothstep(0.20, 0.75, sideFacing)\r
            * smoothstep(0.0, 0.085, edge) * smoothstep(0.0, 0.035, coordinates.x);\r
        let light = 0.5 + 0.5 * dot(worldRadial, illumination);\r
        let tint = mix(vec3f(0.16, 0.80, 1.0), vec3f(0.85, 1.0, 1.0), light);\r
        (*trace).sideColor += tint * opacity;\r
        (*trace).sideWeight += opacity;\r
    }\r
}\r
\r
fn clipPavilionPlane(\r
    trace: ptr<function, PavilionTrace>, a: vec3f, b: vec3f, peak: vec3f, origin: vec3f, ray: vec3f,\r
) {\r
    var n = normalize(cross(a - peak, b - peak));\r
    if (dot(n, (a + b + peak) / 3.0 - vec3f(0.0, -0.68, 0.0)) < 0.0) { n = -n; }\r
    let denominator = dot(n, ray);\r
    let side = dot(n, origin - peak);\r
    if (abs(denominator) < 0.00001) {\r
        if (side > 0.0) { (*trace).exitDistance = -1.0; }\r
    } else {\r
        let t = -side / denominator;\r
        if (denominator < 0.0 && t > (*trace).entry) {\r
            (*trace).entry = t;\r
            (*trace).entryNormal = n;\r
        }\r
        if (denominator > 0.0) { (*trace).exitDistance = min((*trace).exitDistance, t); }\r
    }\r
}\r
\r
fn materialPalette(color: vec3f, facetWeights: vec3f, appearance: u32) -> vec3f {\r
    switch (appearance) {\r
        case 1u: {\r
            // Keep the authored icy blue in the middle values: interpolating\r
            // directly to white desaturates the crown into a cold grey.\r
            let tone = smoothstep(0.0, 0.92, saturate(dot(color.rg, vec2f(0.22, 0.78))));\r
            let shadow = mix(vec3f(0.63, 0.77, 0.95), vec3f(0.733, 0.859, 1.0), facetWeights.y * 0.25);\r
            const ice = vec3f(207.0, 241.0, 253.0) / 255.0; // #cff1fd\r
            var upper = mix(shadow, ice, smoothstep(0.0, 0.62, tone));\r
            upper = mix(upper, vec3f(1.0), smoothstep(0.58, 1.0, tone) * 0.92);\r
            // Lift the pavilion while retaining a distinct shadow range below\r
            // the white crown, with a little more blue in its lighter facets.\r
            let lower = mix(vec3f(0.59, 0.71, 0.865), vec3f(0.96, 0.985, 1.0), pow(tone, 1.10));\r
            return mix(upper, lower, facetWeights.z);\r
        }\r
        case 2u: {\r
            let tone = smoothstep(0.035, 0.90, saturate(dot(color.rg, vec2f(0.20, 0.80))));\r
            let cool = mix(vec3f(0.025, 0.29, 0.83), vec3f(0.38, 0.78, 1.0), smoothstep(0.0, 0.65, tone));\r
            let upper = mix(cool, vec3f(0.94, 0.99, 1.0), smoothstep(0.45, 1.0, tone));\r
            let lower = mix(vec3f(0.025, 0.34, 0.92), vec3f(0.90, 0.99, 1.0), pow(tone, 2.35));\r
            return mix(upper, lower, facetWeights.z);\r
        }\r
        default: {\r
            return color;\r
        }\r
    }\r
}\r
\r
fn glowPlane(\r
    plane: vec4f, position: vec3f, ray: vec3f, localNormal: vec3f,\r
    planeAlignment: ptr<function, f32>, thickness: ptr<function, f32>,\r
) {\r
    *planeAlignment = max(*planeAlignment, dot(plane.xyz, localNormal));\r
    let denominator = dot(plane.xyz, ray);\r
    if (denominator > 0.0001) {\r
        let planeExit = -(dot(plane.xyz, position) + plane.w) / denominator;\r
        *thickness = min(*thickness, max(0.0, planeExit));\r
    }\r
}\r
\r
fn coolInnerGlow(\r
    color: vec3f, position: vec3f, ray: vec3f, normal: vec3f, localNormal: vec3f, view: vec3f,\r
) -> vec3f {\r
    // Thin parts transmit a white light band into the stone. The optical chord\r
    // follows the 3D cut under every rotation, without expanding the silhouette.\r
    var thickness = 1e5;\r
    var planeAlignment = 0.0;\r
    // The optical hull always has 17 planes. Constant indices avoid the expensive\r
    // dynamically indexed uniform loop on mobile GPUs, without changing ray math.\r
    glowPlane(hull.planes[0], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[1], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[2], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[3], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[4], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[5], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[6], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[7], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[8], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[9], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[10], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[11], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[12], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[13], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[14], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[15], position, ray, localNormal, &planeAlignment, &thickness);\r
    glowPlane(hull.planes[16], position, ray, localNormal, &planeAlignment, &thickness);\r
    // Scale the penetration with the taper: the tip gets a narrow rim,\r
    // rather than filling with a solid white pool as its whole depth shrinks.\r
    let crossSection = clamp((position.y + 1.09) / 0.98, 0.07, 1.0);\r
    let inner = 1.0 - smoothstep(0.01, 0.80 * crossSection, thickness);\r
    let grazing = 1.0 - saturate(dot(normal, view));\r
    let roundedEdge = smoothstep(0.0015, 0.028, 1.0 - planeAlignment);\r
    let bevel = pow(grazing, 3.0);\r
    let glow = saturate(inner * 0.85 + bevel * 0.85 + roundedEdge * smoothstep(0.18, 0.80, grazing));\r
    return mix(color, vec3f(0.96, 1.0, 1.0), glow);\r
}\r
\r
@fragment\r
fn diamondFragment(r: Raster) -> @location(0) vec4f {\r
    let n = normalize(r.normal);\r
    let cameraDistance = -u.projection[3].w / u.projection[2].w;\r
    let view = normalize(vec3f(0.0, 0.0, cameraDistance) - r.worldPosition);\r
    let localView = (u.inverseModel * vec4f(-view, 0.0)).xyz;\r
    let localNormal = normalize((u.inverseModel * vec4f(n, 0.0)).xyz);\r
    let transmitted = refract(localView, localNormal, 1.0 / 1.62);\r
    // Zero internal bounces on every device; retain the existing material mapping.\r
    var optical = vec3f(0.0);\r
    let reflection = studio(reflect(-view, n), u.lightSweep.y);\r
    let fresnel = 0.08 + 0.46 * pow(1.0 - saturate(dot(n, view)), 4.0);\r
\r
    let height = saturate((r.localPosition.y + 1.05) / 1.65);\r
    let key = saturate(dot(n, normalize(vec3f(-0.65, 0.85, 1.0))));\r
    let left = saturate(0.52 - r.worldPosition.x * 0.43);\r
    let blue = vec3f(0.008, 0.22, 1.0);\r
    let cyan = vec3f(0.29, 0.87, 1.0);\r
    var body = mix(blue, cyan, saturate(key * 0.60 + left * 0.38));\r
    let verticalBand = mix(0.5 + 0.5 * sin(height * 18.0 + n.x * 3.0), 1.0, r.facetWeights.z);\r
    body *= mix(vec3f(0.24, 0.48, 0.96), vec3f(1.0), verticalBand * 0.5 + 0.5);\r
    let opticalLuminance = smoothstep(0.25, 0.85, optical.g);\r
    // Give the pavilion a cyan body tone without changing reflection contrast\r
    // or the subdued lower motif. Crown and table keep their existing palette.\r
    let opticalShadow = mix(vec3f(0.005, 0.13, 1.0), vec3f(0.015, 0.36, 1.0), r.facetWeights.z);\r
    let opticalLight = mix(vec3f(0.58, 0.97, 1.0), vec3f(0.45, 0.99, 1.0), r.facetWeights.z);\r
    optical = mix(opticalShadow, opticalLight, opticalLuminance);\r
    let opticalWeight = u.parameters.y * mix(0.90, 0.08, r.facetWeights.y);\r
    var color = mix(body, optical, opticalWeight);\r
    color = mix(color, reflection, fresnel);\r
\r
    let crownGlow = smoothstep(0.10, 0.60, r.localPosition.y) * left;\r
    color = mix(color, vec3f(0.70, 0.99, 1.0), crownGlow * 0.58);\r
    var crownLight = pow(saturate(dot(n, normalize(vec3f(-0.38, 0.55, 1.0)))), 9.0);\r
    crownLight *= smoothstep(-0.03, 0.28, r.localPosition.y);\r
    color = mix(color, vec3f(0.65, 0.98, 1.0), crownLight * 0.35);\r
    let facetBase = color;\r
    if (r.facetWeights.y > 0.0) {\r
        let softboxX = (r.worldPosition.x + 0.42) * 1.6;\r
        let softboxY = (r.worldPosition.y - 0.32) * 2.2;\r
        let softbox = exp(-softboxX * softboxX - softboxY * softboxY);\r
        color = mix(color, vec3f(0.71, 0.99, 1.0), softbox * crownLight * 0.36);\r
        let shadow = pow(saturate(1.0 - key), 1.4);\r
        color = mix(color, vec3f(0.015, 0.08, 1.0), shadow * 0.7);\r
        let tangent = normalize(vec3f(localNormal.z, 0.0, -localNormal.x));\r
        let authoredPosition = vec2f(dot(r.localPosition, tangent) * 225.8 + n.x * 65.0,\r
            (0.3065 - r.localPosition.y) * 244.0);\r
        color = mix(referenceCrown(authoredPosition, u.crownGradient), color, 0.28);\r
        color = mix(facetBase, color, r.facetWeights.y);\r
    }\r
    if (r.facetWeights.z > 0.0) {\r
        color = mix(color, mix(vec3f(0.008, 0.32, 1.0), optical, 0.86), r.facetWeights.z * u.parameters.y);\r
    }\r
    let facetFlash = smoothstep(0.20, 0.78, opticalLuminance);\r
    let flashWeight = mix(0.24, 0.08, r.facetWeights.y);\r
    color *= mix(vec3f(1.0), mix(vec3f(0.76, 0.82, 0.99), vec3f(1.0), facetFlash), flashWeight);\r
    color = mix(color, vec3f(0.66, 0.98, 1.0), pow(facetFlash, 2.0) * 0.24 * flashWeight);\r
    color = lateralDepth(color, n, r.localPosition.y, r.facetWeights, opticalLuminance);\r
    color = mix(color, optical, r.facetWeights.z * u.parameters.y * 0.48);\r
    color = mix(color, body, r.facetWeights.z * pow(saturate(n.z), 2.0) * 0.32);\r
    if (r.facetWeights.z > 0.0) {\r
        let detailRay = normalize(mix(localView, transmitted, 0.16));\r
        color = mix(color, pavilionReflections(color, r.localPosition, detailRay), r.facetWeights.z);\r
    }\r
    let tipGlow = pow(saturate((-r.localPosition.y - 0.55) / 0.50), 2.0);\r
    color = mix(color, vec3f(0.57, 0.96, 1.0), tipGlow * 0.20);\r
    // A shallow, translucent image of the table, like Layer 36.0 in Lottie.\r
    // Its optical footprint is smaller than the rounded outer shoulder.\r
    let tableRay = vec3f(localView.x, localView.y * 0.72, localView.z);\r
    if (tableRay.y > 0.001) {\r
        let tableHeight = -hull.planes[0].w / hull.planes[0].y;\r
        let tableDistance = (tableHeight - r.localPosition.y) / tableRay.y;\r
        let hit = (r.localPosition + tableRay * tableDistance).xz;\r
        const extent = 0.632;\r
        const corner = 0.285;\r
        let q = abs(hit);\r
        let edge = max(max(q.x, q.y) - extent, (q.x + q.y - extent - corner) * 0.70710678);\r
        let aa = max(fwidth(edge), 0.001);\r
        let coverage = 1.0 - smoothstep(-aa, aa, edge);\r
        let direction = tableRay.xz / max(length(tableRay.xz), 0.0001);\r
        let depth = saturate(0.5 + dot(hit, direction) / (2.0 * extent));\r
        // Source opacity: 80.0% group opacity times a 49...65% fill gradient.\r
        let opacity = mix(0.39, 0.52, depth);\r
        color = mix(color, vec3f(0.765, 0.988, 1.0), coverage * opacity\r
            * saturate(u.parameters.y / 0.72) * r.facetWeights.y);\r
    }\r
    color = illustratedFacets(color, r);\r
    color = mix(color, vec3f(0.63, 0.96, 1.0), 0.58 * r.facetWeights.x);\r
    let sweep = facetSweep(r, localNormal);\r
    let sweepCore = smoothstep(0.35, 1.0, sweep);\r
    color = mix(color, vec3f(0.592, 0.953, 1.0), sweep * 0.20 + sweepCore * sweepCore * 0.62);\r
    color = surfaceFinish(color, polishedNormal(r, localNormal), view);\r
    let appearance = u32(u.appearance.x);\r
    color = materialPalette(color, r.facetWeights, appearance);\r
    if (appearance == 2u) {\r
        color = coolInnerGlow(color, r.localPosition, localView, n, localNormal, view);\r
    }\r
    if (appearance == 1u) {\r
        // Source facet flashes stay on the physical front/side planes, including\r
        // their rounded transitions. They never become screen-space overlays.\r
        let direction = normalize(localNormal.xz + vec2f(0.0, 0.00001));\r
        let side = smoothstep(0.18, 0.65, abs(direction.x));\r
        let front = smoothstep(0.02, 0.32, direction.y);\r
        let regions = vec3f(1.0 - side, side * step(0.0, direction.x), side * (1.0 - step(0.0, direction.x))) * front;\r
        let alpha = dot(regions, u.referenceCrownFlash.xyz) * r.facetWeights.y\r
            + dot(regions, u.referencePavilionFlash.xyz) * r.facetWeights.z;\r
        let referenceFacing = smoothstep(0.0, 0.2, (u.model * vec4f(0.0, 0.0, 1.0, 0.0)).z);\r
        color = mix(color, vec3f(1.0), alpha * referenceFacing);\r
    }\r
    let whiten = u.appearance.y;\r
    if (whiten > 0.0) {\r
        let w = pow(whiten, 0.7);\r
        let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));\r
        let lift = smoothstep(0.32, 0.62, luma);\r
        var glass = mix(vec3f(0.07, 0.33, 0.95), vec3f(1.0), lift);\r
        let rim = pow(1.0 - saturate(abs(n.z)), 2.2);\r
        glass = mix(glass, vec3f(1.0), rim * 0.8);\r
        let seam = saturate(length(fwidth(n)) * 5.5);\r
        glass = mix(glass, vec3f(1.0), seam * 0.85);\r
        glass = max(glass, vec3f(smoothstep(0.62, 0.95, luma)));\r
        color = mix(color, glass, w);\r
        let alpha = mix(1.0, mix(0.34, 0.94, max(lift, max(rim, seam))), w);\r
        return vec4f(saturate(color * u.parameters.z) * alpha, alpha);\r
    }\r
    return vec4f(saturate(color * u.parameters.z), 1.0);\r
}\r
\r
@vertex\r
fn sparkleVertex(\r
    @location(0) contours: vec4f, @location(1) material: vec4f, @builtin(instance_index) instance: u32,\r
) -> SparkleRaster {\r
    let layer = u32(material.x);\r
    const authoringToWorld = 2.0 / 447.9;\r
    var local = hull.anchors[instance].position.xyz;\r
    var normal = hull.anchors[instance].normal.xyz;\r
    if (instance == 0u) {\r
        let c = cos(u.sparkleHalo.y);\r
        let s = sin(u.sparkleHalo.y);\r
        local = vec3f(c * local.x + s * local.z, local.y, -s * local.x + c * local.z);\r
        normal = vec3f(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);\r
    }\r
    if (instance != 0u) { local += normal * 0.008; }\r
    let worldNormal = (u.model * vec4f(normal, 0.0)).xyz;\r
    let pulse = pow(max(0.0, sin(u.parameters.x * 2.1 + f32(instance) * 2.37 + 1.5)), 16.0);\r
    let front = select(smoothstep(0.15, 0.55, worldNormal.z), u.sparkleHalo.w, instance == 0u);\r
    var strength = front * u.parameters.w;\r
    var center = u.projection * u.model * vec4f(local, 1.0);\r
    if (u.viewport.w > 0.0) {\r
        center = vec4f(0.0, 0.0, 0.5, 1.0);\r
        strength = select(0.0, u.parameters.w, instance == 0u);\r
    }\r
    let morph = select(0.0, u.sparkleShape.y, instance == 0u);\r
    let sourcePoint = mix(contours.xy, contours.zw, morph);\r
    var groupScale = 1.0;\r
    var offset = vec2f(0.0);\r
    if (layer == 0u) { groupScale = u.sparkleHalo.x; offset.y = 5.9; }\r
    if (layer == 1u) { groupScale = u.sparkleShape.w; offset.y = -0.8; }\r
    if (layer == 2u) { groupScale = u.sparkleShape.z; offset.y = -0.9; }\r
    if (layer == 3u) { groupScale = 0.309; offset = vec2f(0.6, -0.4); }\r
    let mainEnvelope = select(u.sparkleHalo.w, 1.0, u.viewport.w > 0.0);\r
    let scale = select((0.632 / 0.75) * pulse, u.sparkleShape.x * mainEnvelope, instance == 0u);\r
    let point = (sourcePoint * groupScale + offset) * authoringToWorld * scale;\r
    var result: SparkleRaster;\r
    // Correct the anchor with the gem, but keep the authored flare proportions.\r
    result.position = center + center.w * vec4f(point.x * u.projection[0][0] / u.sparkleHalo.z,\r
        -point.y * u.projection[1][1], 0.0, 0.0);\r
    result.sourcePoint = sourcePoint;\r
    result.strength = strength;\r
    result.layer = layer;\r
    return result;\r
}\r
\r
fn radialOpacity(radius: f32, first: f32, middle: f32) -> f32 {\r
    if (radius <= first) { return 1.0; }\r
    if (radius <= middle) { return mix(1.0, 0.5, (radius - first) / (middle - first)); }\r
    return 0.5 * saturate((1.0 - radius) / (1.0 - middle));\r
}\r
\r
@fragment\r
fn sparkleFragment(r: SparkleRaster) -> @location(0) vec4f {\r
    var alpha = 1.0;\r
    var color = vec3f(1.0);\r
    if (r.layer == 0u) {\r
        let radius = length(r.sourcePoint - vec2f(-0.5, 0.2)) / 108.5;\r
        alpha = radialOpacity(radius, 0.312, 0.624) * 0.60;\r
    } else if (r.layer == 1u) {\r
        let radius = length(r.sourcePoint - vec2f(-0.5, 0.9)) / 113.1;\r
        alpha = radialOpacity(radius, 0.297, 0.503) * 0.60;\r
        color = vec3f(0.82, 1.0, 0.902);\r
    } else if (r.layer == 2u) {\r
        alpha = 0.96;\r
    } else if (r.layer == 3u) {\r
        let radius = saturate(length(r.sourcePoint) / length(vec2f(176.0, -170.0)));\r
        alpha = 1.0 - radius;\r
        color = mix(vec3f(0.694, 0.969, 1.0), vec3f(0.663, 0.957, 1.0), radius);\r
    } else if (r.layer == 5u) {\r
        alpha = radialOpacity(length(r.sourcePoint) / length(vec2f(228.9, 3.9)), 0.237, 0.623);\r
    }\r
    let appearance = u32(u.appearance.x);\r
    if (appearance == 1u) {\r
        color = select(vec3f(1.0), vec3f(0.635, 0.749, 1.0), r.layer == 0u);\r
        // The white source retains only the circular halo, without the extra\r
        // star-shaped glow used by the blue material.\r
        if (r.layer == 1u) { alpha = 0.0; }\r
    } else if (appearance == 2u) {\r
        color = select(vec3f(1.0), vec3f(0.82, 0.96, 1.0), r.layer == 1u);\r
    }\r
    alpha *= r.strength;\r
    return vec4f(color * alpha, alpha);\r
}\r
`,f=`// The salute stars. One draw covers every salute: the instances go salute after salute, so a later salute blends over\r
// an earlier one.\r
\r
struct Salutes {\r
    // Salute age, opacity, salute seed, star count of one salute\r
    items: array<vec4f, 3>,\r
}\r
\r
struct StarRaster {\r
    @builtin(position) position: vec4f,\r
    @location(0) uv: vec2f,\r
    @location(1) @interpolate(flat) color: vec4f,\r
}\r
\r
@group(0) @binding(0) var<uniform> salutes: Salutes;\r
\r
const PI = 3.14159265358979;\r
// Instance numbers continue after the steady stars of the iOS shader, so the salutes look the same\r
const STEADY_STAR_COUNT = 240u;\r
const VERTICAL_SPREAD = 0.78;\r
// The star field keeps its layout relative to the canvas, as the amount and history diamonds of the iOS demo have it\r
const FIELD_SCALE = 0.55 / 1.52;\r
const FIELD_SHIFT = 0.12;\r
// Radius the stars show from\r
const EMISSION = 0.3;\r
const HALO = 0.035;\r
const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0),\r
    vec2f(1.0, -1.0), vec2f(1.0, 1.0));\r
\r
fn starRandom(value: u32) -> f32 {\r
    var seed = value;\r
    seed ^= seed >> 16u;\r
    seed *= 0x7feb352du;\r
    seed ^= seed >> 15u;\r
    seed *= 0x846ca68bu;\r
    seed ^= seed >> 16u;\r
    return f32(seed & 0x00ffffffu) / 16777216.0;\r
}\r
\r
@vertex\r
fn starVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> StarRaster {\r
    let count = u32(salutes.items[0].w);\r
    let animation = salutes.items[instance / count].xyz;\r
    let star = instance % count;\r
    let index = f32(star);\r
    let seed = (star + STEADY_STAR_COUNT) * 127u + 9137u + u32(animation.z) * 104729u;\r
\r
    let age = animation.x;\r
    let lifetime = mix(1.2, 2.0, starRandom(seed + 1u));\r
    let progress = clamp(age / lifetime, 0.0, 1.0);\r
    let alive = f32(age >= 0.0 && age < lifetime);\r
    var fade = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.62, 1.0, progress)) * alive * animation.y;\r
    let depth = mix(0.60, 1.0, starRandom(seed + 3u));\r
\r
    // Evenly in all directions and over the whole area, along R2 sequences\r
    let angle = 2.0 * PI * fract(0.5 + index * 0.75487767 + (starRandom(seed + 13u) - 0.5) * 0.04);\r
    let direction = vec2f(cos(angle), sin(angle));\r
    let fill = fract(0.5 + index * 0.56984029 + (starRandom(seed + 5u) - 0.5) * 0.06);\r
    let reach = 2.4 * sqrt(mix(0.08, 1.0, fill));\r
    let travel = max(age, 0.0);\r
    let reached = 0.04 + reach * (1.0 - exp(-travel / 0.22)) + 0.06 * travel;\r
    let drift = sin(age * 0.85 + starRandom(seed + 6u) * 6.28) * 0.02;\r
    var center = (direction * reached + vec2f(-direction.y, direction.x) * drift) * vec2f(1.0, VERTICAL_SPREAD);\r
    center.y -= 0.10;\r
\r
    let breathPeriod = mix(2.0, 3.4, starRandom(seed + 24u));\r
    let breathWave = 0.5 - 0.5 * cos(age * (2.0 * PI / breathPeriod) + starRandom(seed + 25u) * 2.0 * PI);\r
    let shine = smoothstep(0.0, 1.0, fade) * mix(0.7, 1.0, breathWave);\r
    let radius = 1.53 * mix(0.0228, 0.084, pow(starRandom(seed + 7u), 1.7)) * depth * mix(0.87, 1.0, shine);\r
    // Shown once out from behind the diamond\r
    fade *= smoothstep(0.45 * EMISSION, 0.7 * EMISSION, length(center));\r
\r
    let rotation = starRandom(seed + 8u) * 1.57 + age * mix(-0.20, 0.20, starRandom(seed + 9u));\r
    let uv = CORNERS[vertex] * 1.45;\r
    let point = mat2x2f(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * uv * radius;\r
\r
    let choice = starRandom(seed + 10u);\r
    var tone = select(select(select(vec3f(0.145, 0.792, 1.0), vec3f(0.0, 0.639, 1.0), choice < 0.82),\r
        vec3f(0.0, 0.451, 1.0), choice < 0.50), vec3f(0.045, 0.36, 1.0), choice < 0.22);\r
    tone = mix(tone, vec3f(0.247, 0.894, 1.0), smoothstep(0.12, 1.0, shine) * 0.30) * 0.78;\r
\r
    var result: StarRaster;\r
    result.position = vec4f((center + point + vec2f(0.0, FIELD_SHIFT)) * FIELD_SCALE, 0.0, 1.0);\r
    result.uv = uv;\r
    result.color = vec4f(tone, fade * mix(0.52, 0.95, starRandom(seed + 11u)) * mix(0.80, 1.0, depth));\r
    return result;\r
}\r
\r
@fragment\r
fn starFragment(r: StarRaster) -> @location(0) vec4f {\r
    let p = abs(r.uv);\r
    // A four-pointed star bounded by two parabolas\r
    let d = sqrt(max(p.x, 0.00001)) + sqrt(max(p.y, 0.00001)) - 1.0;\r
    let aa = max(fwidth(d), 0.04);\r
    let core = 1.0 - smoothstep(-aa, aa, d);\r
    let glow = exp(-dot(r.uv, r.uv) * 4.5) * HALO;\r
    let alpha = clamp(core + glow, 0.0, 1.0) * r.color.a;\r
    return vec4f(r.color.rgb * alpha, alpha);\r
}\r
`,p=144;function m(t){return Math.max(1,Math.round(p*e(t,0,1)))}var h=`depth24plus`,g={color:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`}},_=116,ee=16,te=32,ne=48,v=52,y=56,b=60,x=64,S=12,C=76,re=80,ie=104,w=3;async function T(e,t){let n=e.createShaderModule({code:d}),r=e.createBindGroupLayout({entries:[0,1].map(e=>({binding:e,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{}}))}),i=e.createPipelineLayout({bindGroupLayouts:[r]}),[a,o,f]=await Promise.all([l(),e.createRenderPipelineAsync({layout:i,vertex:{module:n,entryPoint:`diamondVertex`,buffers:[D(3)]},fragment:{module:n,entryPoint:`diamondFragment`,targets:[{format:t}]},primitive:{topology:`triangle-list`,cullMode:`back`},depthStencil:{format:h,depthWriteEnabled:!0,depthCompare:`less-equal`},multisample:{count:4}}),e.createRenderPipelineAsync({layout:i,vertex:{module:n,entryPoint:`sparkleVertex`,buffers:[D(2)]},fragment:{module:n,entryPoint:`sparkleFragment`,targets:[{format:t,blend:g}]},primitive:{topology:`triangle-list`},depthStencil:{format:h,depthWriteEnabled:!1,depthCompare:`always`},multisample:{count:4}})]),p=O(e,a.vertices,3),m=O(e,a.mainSparkle,2),w=O(e,a.smallSparkles,2),T=k(e,GPUBufferUsage.UNIFORM,[a.planes,a.anchors]),E=s(a);function j(t){let n=new Float32Array(_);n.set(a.facetProjection,C),n[ie]=u[t];let i=e.createBuffer({size:n.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});return{buffer:i,bindGroup:e.createBindGroup({layout:r,entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:T}}]}),data:n}}function M(t,n,{size:r},i){let{frame:a}=n,{data:o}=t;o.set(n.modelMatrix),o.set(n.projection,ee),o.set(n.inverseModelMatrix,te),A(o,ne,i,c,1,1),A(o,v,r,r,17,0),o.set(a.subarray(36,40),y),A(o,b,a[40],n.anchor,n.widthScale,n.sparkleVisibility),o.set(a.subarray(0,S),x),o.set(a.subarray(S,36),re),e.queue.writeBuffer(t.buffer,0,o)}function N(e,t,{x:n,y:r,size:i}){e.setViewport(n,r,i,i,0,1),e.setBindGroup(0,t.bindGroup),e.setPipeline(o),e.setVertexBuffer(0,p.buffer),e.draw(p.vertexCount),e.setPipeline(f),e.setVertexBuffer(0,m.buffer),e.draw(m.vertexCount,1,0,0),e.setVertexBuffer(0,w.buffer),e.draw(w.vertexCount,7,0,1)}function P(e,t,n,r,i,a,o,s){M(t,E(n,i,a,o,s),r,i),N(e,t,r)}return{createTarget:j,solve:E,writeTarget:M,encode:N,draw:P}}async function E(e,t){let n=e.createShaderModule({code:f}),r=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{}}]}),i=await e.createRenderPipelineAsync({layout:e.createPipelineLayout({bindGroupLayouts:[r]}),vertex:{module:n,entryPoint:`starVertex`},fragment:{module:n,entryPoint:`starFragment`,targets:[{format:t,blend:g}]},primitive:{topology:`triangle-list`},depthStencil:{format:h,depthWriteEnabled:!1,depthCompare:`always`},multisample:{count:4}});function a(){let t=new Float32Array(w*4),n=e.createBuffer({size:t.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});return{buffer:n,bindGroup:e.createBindGroup({layout:r,entries:[{binding:0,resource:{buffer:n}}]}),data:t}}function o(t,n,{x:r,y:a,size:o},s,c,l,u){let d=m(u),{data:f}=n;s.forEach(({startTime:e,seed:t},n)=>{A(f,n*4,c-e,l,t,d)}),e.queue.writeBuffer(n.buffer,0,f),t.setViewport(r,a,o,o,0,1),t.setBindGroup(0,n.bindGroup),t.setPipeline(i),t.draw(6,d*s.length)}return{createTarget:a,draw:o}}function D(e){return{arrayStride:e*4*4,attributes:Array.from({length:e},(e,t)=>({shaderLocation:t,offset:t*4*4,format:`float32x4`}))}}function O(e,t,n){return{buffer:k(e,GPUBufferUsage.VERTEX,[t]),vertexCount:t.length/(n*4)}}function k(e,t,n){let r=n.reduce((e,t)=>e+t.length,0),i=e.createBuffer({size:r*4,usage:t,mappedAtCreation:!0}),a=new Float32Array(i.getMappedRange()),o=0;return n.forEach(e=>{a.set(e,o),o+=e.length}),i.unmap(),i}function A(e,t,n,r,i,a){e[t]=n,e[t+1]=r,e[t+2]=i,e[t+3]=a}var j=3e4,M=new Map,N=new Map,P=a(),F,I,L=!1,R=0,z,B;i.subscribe(()=>{i()&&$()}),t.subscribe(Y);function V(){return!!navigator.gpu&&!L&&!i()}function H(){return V()?(window.clearTimeout(B),B=void 0,F??=U(),F):Promise.resolve(void 0)}async function U(){try{await l()}catch{r(`cannot load the model`);return}try{let e=await navigator.gpu.requestAdapter();if(!e||e.info?.isFallbackAdapter){L=!0;return}let t=await e.requestDevice(),n=navigator.gpu.getPreferredCanvasFormat(),[a,o]=await Promise.all([T(t,n),E(t,n)]);if(i()){t.destroy();return}let s={device:t,format:n,scene:a,stars:o};return t.lost.then(({reason:e})=>{e!==`destroyed`&&I===s&&r(`WebGPU device lost`)}),I=s,Q(),s}catch{L=!0;return}}function W(e,t,n){let r=t.getContext(`webgpu`);if(!r)return;let{device:i,format:a}=e;r.configure({device:i,format:a,alphaMode:`premultiplied`,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST});let o=e.scene.createTarget(n),s=e.stars.createTarget();return R++,window.clearTimeout(B),B=void 0,{sceneTarget:o,starTarget:s,beginPass(t){return G(e,t,r.getCurrentTexture())},copyFrom(e,n){e.copyTextureToTexture({texture:n},{texture:r.getCurrentTexture()},[t.width,t.height])},destroy(){o.buffer.destroy(),s.buffer.destroy(),r.unconfigure(),R--,Q()}}}function G(e,t,n){let{colorView:r,depthView:i}=q(e,n.width,n.height);return t.beginRenderPass({colorAttachments:[{view:r,resolveTarget:n.createView(),clearValue:[0,0,0,0],loadOp:`clear`,storeOp:`discard`}],depthStencilAttachment:{view:i,depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`discard`}})}function K({device:e,format:t},n){return e.createTexture({size:[n,n],format:t,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC})}function q({device:e,format:t},n,r){let i=`${n}x${r}`,a=N.get(i);if(a)return a;let o=e.createTexture({size:[n,r],format:t,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT}),s=e.createTexture({size:[n,r],format:h,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});return a={textures:[o,s],colorView:o.createView(),depthView:s.createView()},N.set(i,a),a}function J(e){M.set(e,{}),Y()}function ae(e){M.delete(e),Y()}function Y(){I&&(!t()&&[...M.keys()].some(e=>e.getIsPlaying())?oe():X())}function oe(){z===void 0&&(M.forEach(e=>{e.lastFrameTime=void 0}),P.reset(),z=requestAnimationFrame(Z))}function X(){z!==void 0&&(cancelAnimationFrame(z),z=void 0)}function Z(e){if(z=requestAnimationFrame(Z),n()){P.reset();return}P.track(e);let t=I;if(!t)return;let r=t.device.createCommandEncoder(),i=!1;M.forEach((t,n)=>{if(!n.getIsPlaying()||t.lastFrameTime!==void 0&&e-t.lastFrameTime<n.getMinInterval())return;let a=o(e,t.lastFrameTime);t.lastFrameTime=e,n.draw(r,a,e),i=!0}),i&&t.device.queue.submit([r.finish()])}function Q(){!R&&F&&(window.clearTimeout(B),B=window.setTimeout($,j))}function $(){window.clearTimeout(B),B=void 0,F=void 0,I&&=(X(),N.forEach(({textures:e})=>e.forEach(e=>e.destroy())),N.clear(),I.device.destroy(),void 0)}export{V as a,Y as c,K as i,G as n,ae as o,W as r,H as s,J as t};
//# sourceMappingURL=gpu-BEvZe_Nk.js.map