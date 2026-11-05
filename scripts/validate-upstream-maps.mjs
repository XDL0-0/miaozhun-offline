// Validate the retained 2026-11-05 public map package. No network or renderer.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {parse} = require('./vendor/acorn.cjs');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedMaps = ['ascent', 'bonsai', 'duality', 'infinity', 'jam', 'juliett', 'plummet', 'rook', 'triad'];
const reviewedCodecSha256 = 'bf57e15ea770dd98d419b11b251fabb30b28e422bc092a5580b1df245195eba4';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const json = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function localPath(root, pathname) {
  ensure(/^\/aim-maps\/[a-zA-Z0-9_.-]+$/.test(pathname), `Non-map or unsafe asset path: ${pathname}`);
  return path.join(root, pathname.slice(1));
}

// This VM is not a security boundary for arbitrary JS. Only this reviewed,
// hash-pinned codec is executed; no other upstream module is imported.
export function createLocalCodec(source, assetsDirectory) {
  ensure(sha256(source) === reviewedCodecSha256, 'Unreviewed codec: SHA-256 differs from ATp_kJvD.js');
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  ensure(!ast.body.some(node => node.type === 'ImportDeclaration'), 'Codec unexpectedly imports another module');
  const exports = ast.body.filter(node => node.type === 'ExportNamedDeclaration');
  const raw = exports.flatMap(node => node.specifiers).find(spec => spec.exported.name === 'e');
  ensure(raw && /^[A-Za-z_$][\w$]*$/.test(raw.local.name), 'Public raw resource decoder export missing');
  let executable = source;
  for (const node of exports.toReversed()) executable = executable.slice(0, node.start) + executable.slice(node.end);
  const fetched = new Set();
  const localFetch = async input => {
    const url = new URL(String(input), 'https://aimpro.world');
    ensure(url.origin === 'https://aimpro.world' && !url.search && !url.hash, `Blocked codec request: ${url.href}`);
    const file = localPath(assetsDirectory, url.pathname);
    fetched.add(url.pathname);
    ensure(fs.existsSync(file), `Missing local codec input: ${url.pathname}`);
    const bytes = fs.readFileSync(file);
    return new Response(bytes, {status: 200, headers: {'content-length': String(bytes.length)}});
  };
  const location = Object.freeze({hostname: 'aimpro.world'});
  const context = vm.createContext({
    window: Object.freeze({location}), location, fetch: localFetch,
    crypto: Object.freeze({subtle: crypto.webcrypto.subtle}),
    TextEncoder, TextDecoder, Response, Blob, DecompressionStream,
    Uint8Array, ArrayBuffer, DataView, atob,
  }, {codeGeneration: {strings: false, wasm: false}});
  vm.runInContext(executable + `\nglobalThis.__decodeResource = ${raw.local.name};`, context, {timeout: 2000});
  return {
    fetched,
    async decode(logicalPath, family) {
      context.__logicalPath = logicalPath;
      context.__family = family;
      const task = vm.runInContext('__decodeResource(__logicalPath, __family)', context, {timeout: 2000});
      return Buffer.from(await task);
    },
  };
}

export function inspectImage(input, expectedMime) {
  const b = Buffer.from(input);
  let result;
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    ensure(b.toString('ascii', 12, 16) === 'IHDR', 'PNG missing IHDR');
    result = {mimeType: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20)};
    let offset = 8, ended = false;
    while (offset < b.length) {
      ensure(offset + 12 <= b.length, 'Truncated PNG chunk');
      const length = b.readUInt32BE(offset), type = b.toString('ascii', offset + 4, offset + 8);
      ensure(offset + 12 + length <= b.length, `Truncated PNG ${type}`);
      offset += 12 + length;
      if (type === 'IEND') { ensure(length === 0 && offset === b.length, 'Invalid PNG ending'); ended = true; break; }
    }
    ensure(ended, 'PNG missing IEND');
  } else if (b.length >= 80 && b.subarray(0, 12).equals(Buffer.from([171,75,84,88,32,50,48,187,13,10,26,10]))) {
    const levels = b.readUInt32LE(40);
    ensure(levels > 0 && 80 + levels * 24 <= b.length, 'Invalid KTX2 level index');
    result = {mimeType: 'image/ktx2', width: b.readUInt32LE(20), height: b.readUInt32LE(24),
      depth: b.readUInt32LE(28), layers: b.readUInt32LE(32), faces: b.readUInt32LE(36),
      levels, vkFormat: b.readUInt32LE(12), supercompressionScheme: b.readUInt32LE(44)};
    for (let i = 0; i < levels; i++) {
      const offset = Number(b.readBigUInt64LE(80 + i * 24)), length = Number(b.readBigUInt64LE(88 + i * 24));
      ensure(integer(offset) && integer(length) && offset + length <= b.length, `KTX2 mip ${i} out of bounds`);
    }
    for (const [offset, length, label] of [[b.readUInt32LE(48), b.readUInt32LE(52), 'DFD'], [b.readUInt32LE(56), b.readUInt32LE(60), 'KVD'], [Number(b.readBigUInt64LE(64)), Number(b.readBigUInt64LE(72)), 'SGD']]) {
      ensure(integer(offset) && integer(length) && offset + length <= b.length, `KTX2 ${label} out of bounds`);
    }
  } else if (b.length >= 16 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brands = [], dimensions = [];
    function boxes(start, end, depth = 0) {
      ensure(depth <= 12, 'AVIF box nesting too deep');
      for (let offset = start; offset < end;) {
        ensure(offset + 8 <= end, 'Truncated AVIF box');
        let length = b.readUInt32BE(offset), header = 8;
        const type = b.toString('ascii', offset + 4, offset + 8);
        if (length === 1) { ensure(offset + 16 <= end, 'Truncated AVIF large box'); length = Number(b.readBigUInt64BE(offset + 8)); header = 16; }
        if (length === 0) length = end - offset;
        ensure(integer(length, header) && offset + length <= end, `AVIF ${type} out of bounds`);
        const payload = offset + header, limit = offset + length;
        if (type === 'ftyp') {
          ensure(payload + 8 <= limit, 'Invalid AVIF ftyp');
          brands.push(b.toString('ascii', payload, payload + 4));
          for (let at = payload + 8; at + 4 <= limit; at += 4) brands.push(b.toString('ascii', at, at + 4));
        }
        if (type === 'ispe') {
          ensure(payload + 12 <= limit, 'Truncated AVIF ispe');
          dimensions.push({width: b.readUInt32BE(payload + 4), height: b.readUInt32BE(payload + 8)});
        }
        if (['meta', 'iprp', 'ipco'].includes(type)) boxes(payload + (type === 'meta' ? 4 : 0), limit, depth + 1);
        offset = limit;
      }
    }
    boxes(0, b.length);
    ensure(brands.includes('avif') || brands.includes('avis'), 'ISO media is not AVIF');
    ensure(dimensions.length > 0, 'AVIF missing spatial extent');
    result = {mimeType: 'image/avif', brands: [...new Set(brands)], spatialExtents: dimensions};
    // Multiple ispe properties can describe tiles; do not pretend they identify the primary image.
    if (dimensions.length === 1) Object.assign(result, dimensions[0]);
  } else throw new Error('Unknown or truncated image signature');
  if (result.width !== undefined) ensure(result.width > 0 && result.height > 0, 'Invalid image dimensions');
  ensure(!expectedMime || result.mimeType === expectedMime, `Image MIME mismatch: ${result.mimeType} vs ${expectedMime}`);
  return result;
}

function inspectGltf(metadata, records) {
  const g = metadata;
  ensure(object(g?.asset) && g.asset.version === '2.0', 'privateMap metadata is not glTF 2.0');
  for (const name of ['scenes', 'nodes', 'meshes', 'materials', 'textures', 'images', 'samplers', 'accessors', 'bufferViews']) ensure(Array.isArray(g?.[name]), `Missing glTF array: ${name}`);
  const ref = (list, id, label) => { ensure(integer(id) && id < list.length, `Invalid ${label} reference: ${id}`); return list[id]; };
  const widths = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
  const components = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
  const recordUsers = new Set();
  for (const [id, view] of g.bufferViews.entries()) {
    ensure(integer(view.byteLength) && view.byteLength <= 128 * 1024 * 1024, `Invalid bufferView[${id}] byteLength`);
    const record = ref(records, view.record, `bufferView[${id}] record`);
    recordUsers.add(view.record);
    if (view.meshopt) {
      const m = view.meshopt;
      ensure(record.kind === 'meshopt' && integer(m.count, 1) && integer(m.byteStride, 1) && m.count * m.byteStride === view.byteLength, `Invalid meshopt bufferView[${id}] size/type`);
      ensure(['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(m.mode) && [undefined, 'NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL'].includes(m.filter), `Unsupported meshopt bufferView[${id}] mode/filter`);
    } else ensure(record.kind === 'raw' && record.byteLength === view.byteLength, `Raw bufferView[${id}] size/type mismatch`);
  }
  for (const [id, a] of g.accessors.entries()) {
    const size = widths[a.componentType], count = components[a.type], offset = a.byteOffset ?? 0;
    ensure(size && count && integer(a.count) && integer(offset) && offset % size === 0 && a.count * count * size <= 128 * 1024 * 1024 && a.sparse === undefined, `Invalid accessor[${id}]`);
    if (a.bufferView !== undefined) {
      const view = ref(g.bufferViews, a.bufferView, `accessor[${id}] bufferView`), element = size * count, stride = view.byteStride ?? element;
      ensure(integer(stride, element) && stride % size === 0 && offset + (a.count ? (a.count - 1) * stride + element : 0) <= view.byteLength, `Accessor[${id}] out of bounds`);
    }
  }
  const images = g.images.map((item, index) => {
    if (item.uri) return {index, uri: item.uri, external: !item.uri.startsWith('data:')};
    const view = ref(g.bufferViews, item.bufferView, `image[${index}] bufferView`), record = records[view.record];
    ensure(!view.meshopt && record.kind === 'raw', `Image[${index}] is meshopt encoded`);
    return {index, ...inspectImage(record.bytes, item.mimeType), bytes: record.byteLength, sha256: record.sha256};
  });
  for (const [id, texture] of g.textures.entries()) {
    ref(g.images, texture.extensions?.KHR_texture_basisu?.source ?? texture.source, `texture[${id}] source`);
    if (texture.sampler !== undefined) ref(g.samplers, texture.sampler, `texture[${id}] sampler`);
  }
  function textureReferences(value, key = '') {
    if (!object(value)) return;
    if (key.endsWith('Texture') && value.index !== undefined) ref(g.textures, value.index, 'material texture');
    for (const [k, v] of Object.entries(value)) textureReferences(v, k);
  }
  g.materials.forEach(value => textureReferences(value));
  const positions = new Set();
  let primitives = 0, geometryTriangles = 0;
  const meshTriangles = g.meshes.map((mesh, meshIndex) => {
    ensure(Array.isArray(mesh.primitives), `Mesh[${meshIndex}] missing primitives`);
    let triangles = 0;
    for (const p of mesh.primitives) {
      ensure((p.mode ?? 4) === 4 && object(p.attributes), `Invalid triangle primitive in mesh[${meshIndex}]`);
      for (const [name, id] of Object.entries(p.attributes)) ref(g.accessors, id, `mesh[${meshIndex}].${name}`);
      const position = ref(g.accessors, p.attributes.POSITION, `mesh[${meshIndex}] POSITION`);
      ensure(position.type === 'VEC3', 'POSITION is not VEC3');
      positions.add(p.attributes.POSITION);
      let indexCount = position.count;
      if (p.indices !== undefined) { const a = ref(g.accessors, p.indices, 'indices'); ensure(a.type === 'SCALAR' && [5121,5123,5125].includes(a.componentType), 'Invalid index accessor'); indexCount = a.count; }
      ensure(indexCount % 3 === 0, 'Triangle primitive count is not a multiple of three');
      if (p.material !== undefined) ref(g.materials, p.material, 'primitive material');
      triangles += indexCount / 3; primitives++;
    }
    geometryTriangles += triangles;
    return triangles;
  });
  for (const [id, node] of g.nodes.entries()) {
    if (node.mesh !== undefined) ref(g.meshes, node.mesh, `node[${id}] mesh`);
    for (const child of node.children ?? []) ref(g.nodes, child, `node[${id}] child`);
    for (const [name, length] of [['matrix',16], ['translation',3], ['rotation',4], ['scale',3]]) if (node[name] !== undefined) ensure(Array.isArray(node[name]) && node[name].length === length && node[name].every(Number.isFinite), `Invalid node[${id}] ${name}`);
  }
  // Detect cycles even in a retained node not reached by the active scene.
  const visiting = new Set(), complete = new Set();
  function visit(id) {
    ensure(!visiting.has(id), `Node graph cycle at ${id}`);
    if (complete.has(id)) return;
    visiting.add(id); for (const child of g.nodes[id].children ?? []) visit(child); visiting.delete(id); complete.add(id);
  }
  g.nodes.forEach((_, id) => visit(id));
  const sceneMetrics = g.scenes.map((scene, id) => {
    ensure(Array.isArray(scene.nodes), `Scene[${id}] missing nodes`);
    let placedTriangles = 0, meshPlacements = 0, nodePlacements = 0;
    function count(nodeId) {
      const node = ref(g.nodes, nodeId, 'scene node'); nodePlacements++;
      ensure(nodePlacements <= 1000000, 'Excessive scene node expansion');
      if (node.mesh !== undefined) { meshPlacements++; placedTriangles += meshTriangles[node.mesh]; }
      for (const child of node.children ?? []) count(child);
    }
    scene.nodes.forEach(count);
    return {id, nodePlacements, meshPlacements, placedTriangles};
  });
  ref(g.scenes, g.scene ?? 0, 'default scene');
  return {meshes: g.meshes.length, nodes: g.nodes.length, materials: g.materials.length, textures: g.textures.length,
    images: images.length, imageDetails: images, primitives, geometryTriangles,
    uniquePositionAccessorVertices: [...positions].reduce((sum, id) => sum + g.accessors[id].count, 0),
    sceneMetrics, accessors: g.accessors.length, bufferViews: g.bufferViews.length,
    unreferencedRecords: records.map((_, id) => id).filter(id => !recordUsers.has(id)),
    metricScope: 'Counts derive from validated metadata; meshopt payloads are authenticated but not decompressed or rendered.'};
}

export function inspectPrivateMap(input) {
  const b = Buffer.from(input);
  ensure(b.length >= 16 && b.toString('ascii', 0, 4) === 'VMP1', 'Expected VMP1 privateMap, not ordinary GLB');
  ensure(b[4] === 1 && b[5] === 0 && b.readUInt16LE(6) === 0, 'Unsupported privateMap version/flags');
  const metadataBytes = b.readUInt32LE(8), count = b.readUInt32LE(12);
  ensure(metadataBytes <= 16 * 1024 * 1024 && count <= 32768 && 16 + metadataBytes <= b.length, 'Invalid privateMap header');
  const metadata = json(b.subarray(16, 16 + metadataBytes)), records = [];
  let offset = 16 + metadataBytes;
  for (let id = 0; id < count; id++) {
    ensure(offset + 8 <= b.length, `Truncated privateMap record ${id}`);
    const kind = b[offset], length = b.readUInt32LE(offset + 4);
    ensure(kind <= 1 && b[offset + 1] === 0 && b[offset + 2] === 0 && b[offset + 3] === 0 && length <= 128 * 1024 * 1024 && offset + 8 + length <= b.length, `Invalid privateMap record ${id}`);
    const bytes = b.subarray(offset + 8, offset + 8 + length);
    records.push({id, kind: kind ? 'meshopt' : 'raw', offset: offset + 8, byteLength: length, sha256: sha256(bytes), bytes});
    offset += 8 + length;
  }
  ensure(offset === b.length, 'Unexpected trailing privateMap data');
  const metrics = inspectGltf(metadata, records);
  return {metadata, summary: {format: 'VMP1/privateMap', version: b[4], metadataBytes, recordCount: count,
    records: records.map(({bytes, ...record}) => record), metrics}};
}

function references(value, pointer = '', output = []) {
  if (typeof value === 'string' && /\.(?:json|png|avif|ktx2|jpe?g|webp|bin|glb)(?:\.enc)?(?:[?#].*)?$/i.test(value) && !value.startsWith('data:')) output.push({pointer, uri: value});
  else if (Array.isArray(value)) value.forEach((v, i) => references(v, `${pointer}/${i}`, output));
  else if (object(value)) for (const [k, v] of Object.entries(value)) references(v, `${pointer}/${k}`, output);
  return output;
}

export async function validateSnapshot(snapshot) {
  const report = {schemaVersion: 1, generatedAt: new Date().toISOString(), snapshot: path.relative(repository, snapshot),
    success: false, network: 'disabled: codec fetch serves local /aim-maps files only', codec: {file: 'source/js/ATp_kJvD.js', sha256: reviewedCodecSha256, domain: 'aimpro.world'},
    expectedMaps, maps: [], resources: [], externalReferences: [], failures: [],
    limitations: ['VMP1 is a private container, not GLB; old GLTFLoader cannot consume it.',
      'VSE2 requires the reviewed public resource codec and normal domain mapping.',
      'Meshopt records are authenticated and structurally checked; compressed mesh payloads are not decoded.',
      'Image signatures, containers and dimensions are inspected; pixel decoding and browser rendering are not tested.',
      'Geometry and placed triangle counts are metadata counts before runtime batching, PVS and culling; they are not draw calls or FPS.']};
  fs.mkdirSync(snapshot, {recursive: true});
  const output = path.join(snapshot, 'decoded/aim-maps');
  const failure = (asset, error) => report.failures.push({path: asset, error: String(error?.message ?? error)});
  try {
    const revisions = JSON.parse(fs.readFileSync(path.join(snapshot, 'asset-revisions.json'), 'utf8'));
    const entries = Object.entries(revisions).filter(([name]) => name.startsWith('/aim-maps/')).sort(([a], [b]) => a.localeCompare(b));
    const maps = entries.filter(([name]) => name.endsWith('.glb')).map(([name]) => path.basename(name, '.glb')).sort();
    ensure(JSON.stringify(maps) === JSON.stringify(expectedMaps), `Unexpected map inventory: ${maps.join(', ')}`);
    const assets = path.join(snapshot, 'assets');
    const codec = createLocalCodec(fs.readFileSync(path.join(snapshot, report.codec.file), 'utf8'), assets);
    const baselineFile = path.join(repository, 'verification.json');
    const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
    fs.rmSync(output, {recursive: true, force: true}); fs.mkdirSync(output, {recursive: true});
    const perMap = new Map(maps.map(map => [map, {map, success: false, resources: 0, decryptedBytes: 0, metadata: {}}]));
    for (const map of maps) for (const suffix of ['collision.json', 'glb', 'lightmaps.json', 'lights.json', 'pvs.json', 'surfaces.json']) ensure(revisions[`/aim-maps/${map}.${suffix}`], `Revision missing: ${map}.${suffix}`);
    for (const map of ['bonsai', 'jam', 'plummet', 'infinity']) ensure(revisions[`/aim-maps/${map}.ropes.json`], `Rope revision missing: ${map}`);
    const all = [...entries, ...maps.flatMap(map => [[`/aim-maps/${map}.minimap.json`, null], [`/aim-maps/${map}.minimap.png`, null]])];
    for (const [logicalPath, revision] of all) {
      try {
        ensure(revision === null || /^[0-9a-f]{12}$/.test(revision), `Invalid revision for ${logicalPath}`);
        const diskPath = logicalPath + (revision ? `.${revision}.enc` : '');
        const stored = fs.readFileSync(localPath(assets, diskPath));
        const bytes = revision ? await codec.decode(logicalPath, logicalPath.endsWith('.glb') ? 'map' : undefined) : stored;
        const map = path.basename(logicalPath).split('.')[0], item = perMap.get(map);
        ensure(item, `Unknown map: ${map}`);
        const resource = {path: logicalPath, storedPath: `assets${diskPath}`, storedBytes: stored.length, storedSha256: sha256(stored),
          decodedBytes: bytes.length, decodedSha256: sha256(bytes), authenticated: Boolean(revision),
          storedFormat: revision ? stored.toString('ascii', 0, 4) : 'plaintext'};
        ensure(bytes.length > 0, 'Empty decoded asset');
        let parsed;
        if (logicalPath.endsWith('.json')) {
          parsed = json(bytes); ensure(object(parsed), 'JSON metadata must be an object');
          resource.keys = Object.keys(parsed); item.metadata[path.basename(logicalPath).slice(map.length + 1)] = resource.keys;
          if (logicalPath.endsWith('.minimap.json')) {
            ensure(Array.isArray(parsed.callouts) && object(parsed.transform), 'Invalid minimap metadata');
            ensure(parsed.callouts.every(v => object(v) && typeof v.name === 'string' && Number.isFinite(v.x) && Number.isFinite(v.z)), 'Invalid minimap callout');
            item.minimapCallouts = parsed.callouts.length;
          }
          resource.output = `decoded${logicalPath}`; writeJson(path.join(snapshot, resource.output), parsed);
        } else if (logicalPath.endsWith('.glb')) {
          const visual = inspectPrivateMap(bytes); parsed = visual.metadata;
          resource.output = `decoded/aim-maps/${map}.vmp1`;
          fs.writeFileSync(path.join(snapshot, resource.output), bytes);
          writeJson(path.join(output, `${map}.private-map.json`), visual.metadata);
          item.visual = visual.summary;
          const old = baseline?.maps?.find(entry => entry.map === map);
          item.baselineComparison = old ? {newMap: false, baselineReportGeneratedAt: baseline.generatedAt, baselineFormat: 'GLB', newFormat: 'VMP1/privateMap',
            oldDecodedBytes: old.model?.bytes, newDecodedBytes: bytes.length, decodedBytesDelta: bytes.length - old.model.bytes,
            oldImages: old.model.images, newImages: visual.summary.metrics.images, imageCountDelta: visual.summary.metrics.images - old.model.images,
            baselineMetricScope: 'Existing verifier contains byte/image counts; baseline mesh/triangle counts are unavailable.'} : {newMap: true};
        } else {
          resource.image = inspectImage(bytes, logicalPath.endsWith('.avif') ? 'image/avif' : 'image/png');
        }
        for (const reference of parsed ? references(parsed) : []) {
          const url = new URL(reference.uri, `https://aimpro.world${logicalPath}`);
          ensure(url.origin === 'https://aimpro.world' && !url.search && !url.hash, `External or ambiguous reference: ${reference.uri}`);
          const resolved = url.pathname, encoded = revisions[resolved] ? `${resolved}.${revisions[resolved]}.enc` : resolved;
          const exists = fs.existsSync(localPath(assets, encoded));
          report.externalReferences.push({source: logicalPath, ...reference, resolved, exists});
          ensure(exists, `Missing referenced asset: ${resolved}`);
        }
        item.resources++; item.decryptedBytes += bytes.length; report.resources.push(resource);
      } catch (error) { failure(logicalPath, error); }
    }
    for (const item of perMap.values()) {
      item.success = Boolean(item.visual) && !report.failures.some(entry => entry.path.startsWith(`/aim-maps/${item.map}.`));
      const old = baseline?.maps?.find(entry => entry.map === item.map);
      if (old) item.metadataKeyChanges = Object.fromEntries(Object.entries(item.metadata).map(([name, keys]) => [name, {
        added: keys.filter(key => !(old.manifestKeys[name] ?? []).includes(key)),
        removed: (old.manifestKeys[name] ?? []).filter(key => !keys.includes(key)),
      }]));
      report.maps.push(item);
    }
    report.localFetches = [...codec.fetched].sort();
    report.expectedResourceCount = all.length;
    report.success = report.maps.length === 9 && report.maps.every(map => map.success) && report.failures.length === 0 && report.resources.length === all.length;
  } catch (error) { failure('validation setup', error); }
  writeJson(path.join(snapshot, 'map-validation.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/validate-upstream-maps.mjs [--snapshot=upstream/aimpro-2026-11-05]\nOnly reads local source/assets; replaces its own decoded/aim-maps outputs and map-validation.json.');
  } else {
    ensure(args.every(arg => arg.startsWith('--snapshot=')), 'Unknown argument; use --help');
    const snapshot = path.resolve(repository, args.find(arg => arg.startsWith('--snapshot='))?.slice(11) ?? 'upstream/aimpro-2026-11-05');
    const report = await validateSnapshot(snapshot);
    console.log(JSON.stringify({success: report.success, maps: report.maps.filter(map => map.success).length,
      resources: report.resources.length, failures: report.failures, report: path.join(snapshot, 'map-validation.json')}, null, 2));
    process.exitCode = report.success ? 0 : 1;
  }
}
